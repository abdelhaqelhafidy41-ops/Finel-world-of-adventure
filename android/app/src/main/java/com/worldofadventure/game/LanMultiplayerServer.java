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
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.regex.Pattern;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Native Offline LAN Multiplayer Server for Android (zero Internet required).
 * Serves HTTP room endpoints + RFC 6455 WebSocket on local Wi-Fi (max 4 players)
 * and responds to / sends UDP LAN discovery beacons on port 41235.
 */
public class LanMultiplayerServer {
    private static final java.util.Set<String> VALID_WEATHER_STATES = new java.util.HashSet<>(java.util.Arrays.asList("clear", "rain", "storm", "snow", "fog", "cloudy", "windy", "sandstorm", "blizzard", "thunderstorm"));
    private static final int CURRENT_MOD_API_VERSION = 1;
    private static final Pattern SAFE_MOD_ID_PATTERN = Pattern.compile("^[a-z0-9][a-z0-9._-]{1,63}$", Pattern.CASE_INSENSITIVE);
    private static final Set<String> VALID_MOD_COMPAT_MODES = new HashSet<>(java.util.Arrays.asList("required", "optional", "client_only"));

    public static final int MAX_LAN_PLAYERS = 4;
    public static final int DEFAULT_LAN_PORT = 41234;
    public static final int DISCOVERY_PORT = 41235;
    private static final int MAX_PLAYER_COINS = 99999;
    private static final int MAX_PLAYER_LEVEL = 50;
    private static final String DISCOVERY_MAGIC = "WOA_LAN_V1";
    private static final String WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
    private static final String[] AVATAR_COLORS = {"#6ab06e", "#e5a93c", "#58b4d1", "#d96b6b"};
    private static final String[] PARTY_MARKER_COLORS = {"#3b82f6", "#10b981", "#f59e0b", "#ec4899"};
    private static final String CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

    private static final class WeaponSpec {
        final String id;
        final double baseDamage;
        final double minDamage;
        final double maxDamage;
        final double range;
        final long cooldownMs;
        final boolean isRanged;
        final double critMult;
        final double critChance;
        final double headshotMult;
        final double minSpeed;
        final double maxSpeed;
        final double gravity;

        WeaponSpec(String id, double baseDamage, double range, long cooldownMs, double critMult, double critChance) {
            this(id, baseDamage, baseDamage, baseDamage, range, cooldownMs, false, critMult, critChance, 1.0, 0, 0, 0);
        }

        WeaponSpec(
                String id,
                double baseDamage,
                double minDamage,
                double maxDamage,
                double range,
                long cooldownMs,
                boolean isRanged,
                double critMult,
                double critChance,
                double headshotMult,
                double minSpeed,
                double maxSpeed,
                double gravity
        ) {
            this.id = id;
            this.baseDamage = baseDamage;
            this.minDamage = minDamage;
            this.maxDamage = maxDamage;
            this.range = range;
            this.cooldownMs = cooldownMs;
            this.isRanged = isRanged;
            this.critMult = critMult;
            this.critChance = critChance;
            this.headshotMult = headshotMult;
            this.minSpeed = minSpeed;
            this.maxSpeed = maxSpeed;
            this.gravity = gravity;
        }
    }

    private static final class LootDropSpec {
        final String itemId;
        final int count;
        final String label;
        final double chance;

        LootDropSpec(String itemId, int count, String label, double chance) {
            this.itemId = itemId;
            this.count = count;
            this.label = label;
            this.chance = chance;
        }
    }

    private static final class EnemyLootTableSpec {
        final boolean isBoss;
        final int personalXp;
        final int personalCoins;
        final List<LootDropSpec> personalItems;
        final boolean hasShared;
        final int sharedXpPool;
        final int sharedCoinsPool;
        final List<LootDropSpec> sharedItems;
        final List<LootDropSpec> worldDrops;

        EnemyLootTableSpec(
                boolean isBoss,
                int personalXp,
                int personalCoins,
                List<LootDropSpec> personalItems,
                boolean hasShared,
                int sharedXpPool,
                int sharedCoinsPool,
                List<LootDropSpec> sharedItems,
                List<LootDropSpec> worldDrops
        ) {
            this.isBoss = isBoss;
            this.personalXp = personalXp;
            this.personalCoins = personalCoins;
            this.personalItems = personalItems;
            this.hasShared = hasShared;
            this.sharedXpPool = sharedXpPool;
            this.sharedCoinsPool = sharedCoinsPool;
            this.sharedItems = sharedItems;
            this.worldDrops = worldDrops;
        }
    }

    private static final Map<String, WeaponSpec> LAN_WEAPON_SPECS = new HashMap<>();
    private static final Map<String, Integer> LAN_ENEMY_MAX_HP = new HashMap<>();
    private static final Map<String, Integer> LAN_ANIMAL_MAX_HP = new HashMap<>();
    private static final Map<String, Integer> LAN_NPC_MAX_HP = new HashMap<>();
    private static final Map<String, Integer> LAN_ENEMY_ATTACK_MAX_DAMAGE = new HashMap<>();
    private static final Map<String, EnemyLootTableSpec> LAN_ENEMY_LOOT_TABLES = new HashMap<>();

    static {
        LAN_WEAPON_SPECS.put("unarmed", new WeaponSpec("unarmed", 9, 2.1, 300, 1.0, 0.0));
        LAN_WEAPON_SPECS.put("ranger-sword", new WeaponSpec("ranger-sword", 26, 2.85, 340, 1.5, 0.18));
        LAN_WEAPON_SPECS.put("wooden-sword", new WeaponSpec("wooden-sword", 16, 2.6, 320, 1.5, 0.12));
        LAN_WEAPON_SPECS.put("iron-sword", new WeaponSpec("iron-sword", 34, 2.95, 360, 1.5, 0.2));
        LAN_WEAPON_SPECS.put("steel-sword", new WeaponSpec("steel-sword", 44, 3.05, 320, 1.5, 0.26));
        LAN_WEAPON_SPECS.put("woodland-axe", new WeaponSpec("woodland-axe", 42, 2.95, 580, 1.75, 0.15));
        LAN_WEAPON_SPECS.put("battle-axe", new WeaponSpec("battle-axe", 52, 3.1, 620, 1.75, 0.18));
        LAN_WEAPON_SPECS.put("hunter-knife", new WeaponSpec("hunter-knife", 22, 2.25, 210, 1.75, 0.34));
        LAN_WEAPON_SPECS.put("spear", new WeaponSpec("spear", 36, 3.85, 440, 1.6, 0.22));
        LAN_WEAPON_SPECS.put("stone-club", new WeaponSpec("stone-club", 22, 2.65, 620, 1.5, 0.12));
        LAN_WEAPON_SPECS.put("copper-sword", new WeaponSpec("copper-sword", 24, 2.8, 410, 1.5, 0.17));
        LAN_WEAPON_SPECS.put("bronze-spear", new WeaponSpec("bronze-spear", 30, 3.7, 520, 1.6, 0.2));
        LAN_WEAPON_SPECS.put("silver-sword", new WeaponSpec("silver-sword", 40, 3.0, 390, 1.5, 0.24));
        LAN_WEAPON_SPECS.put("hunter-bow", new WeaponSpec("hunter-bow", 32, 10, 50, 52, 360, true, 1.65, 0.24, 2.0, 15, 45, 9.8));
        LAN_WEAPON_SPECS.put("crossbow", new WeaponSpec("crossbow", 46, 16, 66, 58, 560, true, 1.65, 0.28, 2.0, 22, 56, 6.2));

        LAN_ENEMY_MAX_HP.put("bandit_scout", 65);
        LAN_ENEMY_MAX_HP.put("thorn_stalker", 50);
        LAN_ENEMY_MAX_HP.put("stone_sentinel", 120);
        LAN_ENEMY_MAX_HP.put("ancient_monster", 95);
        LAN_ENEMY_MAX_HP.put("ancient_guardian", 420);

        LAN_ANIMAL_MAX_HP.put("deer", 55);
        LAN_ANIMAL_MAX_HP.put("rabbit", 22);
        LAN_ANIMAL_MAX_HP.put("wolf", 68);
        LAN_ANIMAL_MAX_HP.put("bear", 135);
        LAN_ANIMAL_MAX_HP.put("bird", 14);
        LAN_ANIMAL_MAX_HP.put("cow", 80);
        LAN_ANIMAL_MAX_HP.put("sheep", 45);
        LAN_ANIMAL_MAX_HP.put("chicken", 16);

        LAN_NPC_MAX_HP.put("guard", 140);
        LAN_NPC_MAX_HP.put("default", 100);

        LAN_ENEMY_ATTACK_MAX_DAMAGE.put("bandit_scout", 18);
        LAN_ENEMY_ATTACK_MAX_DAMAGE.put("thorn_stalker", 16);
        LAN_ENEMY_ATTACK_MAX_DAMAGE.put("stone_sentinel", 32);
        LAN_ENEMY_ATTACK_MAX_DAMAGE.put("ancient_monster", 30);
        LAN_ENEMY_ATTACK_MAX_DAMAGE.put("ancient_guardian", 58);
        LAN_ENEMY_ATTACK_MAX_DAMAGE.put("wolf", 15);
        LAN_ENEMY_ATTACK_MAX_DAMAGE.put("bear", 28);
        LAN_ENEMY_ATTACK_MAX_DAMAGE.put("default", 30);

        LAN_ENEMY_LOOT_TABLES.put("bandit_scout", new EnemyLootTableSpec(
                false, 28, 14, Collections.singletonList(new LootDropSpec("arrow", 3, null, 0.7)),
                false, 0, 0, Collections.emptyList(),
                Collections.singletonList(new LootDropSpec("hearth-loaf", 1, "Sunstone Hearth Loaf", 0.45))
        ));
        LAN_ENEMY_LOOT_TABLES.put("thorn_stalker", new EnemyLootTableSpec(
                false, 24, 10, Collections.singletonList(new LootDropSpec("meadow-herb", 1, null, 0.65)),
                false, 0, 0, Collections.emptyList(),
                Collections.singletonList(new LootDropSpec("mushroom", 1, "Forest Mushroom", 0.5))
        ));
        LAN_ENEMY_LOOT_TABLES.put("stone_sentinel", new EnemyLootTableSpec(
                false, 48, 28, Collections.singletonList(new LootDropSpec("iron-ore", 2, null, 0.85)),
                true, 24, 16, Collections.singletonList(new LootDropSpec("coal", 2, null, 1.0)),
                Collections.singletonList(new LootDropSpec("rare-mineral", 1, "Sunstone Crystal", 0.65))
        ));
        LAN_ENEMY_LOOT_TABLES.put("ancient_monster", new EnemyLootTableSpec(
                false, 42, 22, Collections.singletonList(new LootDropSpec("iron-ore", 1, null, 0.75)),
                true, 20, 14, Collections.emptyList(),
                Collections.singletonList(new LootDropSpec("apothecary-tonic", 1, "Apothecary Vitality Tonic", 0.4))
        ));
        List<LootDropSpec> bossWorldDrops = new ArrayList<>();
        bossWorldDrops.add(new LootDropSpec("gold-ore", 3, "Gold Ore Cache", 1.0));
        bossWorldDrops.add(new LootDropSpec("steel-sword", 1, "Tempered Steel Blade", 0.5));
        LAN_ENEMY_LOOT_TABLES.put("ancient_guardian", new EnemyLootTableSpec(
                true, 180, 95, Collections.singletonList(new LootDropSpec("apothecary-tonic", 1, null, 1.0)),
                true, 120, 80, Collections.singletonList(new LootDropSpec("rare-mineral", 2, null, 1.0)),
                bossWorldDrops
        ));
    }

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

    private static final class EntityRecord {
        String id;
        String kind;
        String archetype;
        int maxHp;
        int hp;
        boolean isDead;
        long diedAtMs;
        double x;
        double y;
        double z;
        double yaw;
        String state;
        long lastUpdatedAtMs;
        int killSeq;
        final Map<String, Integer> damageByPlayer = new LinkedHashMap<>();
        String targetPlayerId = null;
        boolean isBoss = false;
        int bossPhase = 1;
        String attackState = null;
        String dialogueState = null;
        String dialoguePlayerId = null;
        String questState = null;
        String schedulePeriod = null;
        String worldId = null;
        String chunkId = null;
        Boolean loaded = null;
        JSONObject questTarget = null;
    }

    private static final class ActiveArrowRecord {
        String arrowId;
        String shooterId;
        String weaponId;
        double charge;
        double originX;
        double originY;
        double originZ;
        double dirX;
        double dirY;
        double dirZ;
        double speed;
        double gravity;
        long createdAtMs;
        boolean consumed;
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
        JSONObject modMetadata = null;
        JSONObject worldTime;
        JSONObject worldWeather;
        final Map<String, PlayerRecord> players = new LinkedHashMap<>();
        final Map<String, PartyRecord> parties = new LinkedHashMap<>();
        final Map<String, PartyInviteRecord> partyInvites = new LinkedHashMap<>();
        final Map<String, EntityRecord> entities = new LinkedHashMap<>();
        final Map<String, ActiveArrowRecord> activeArrows = new LinkedHashMap<>();
        final Map<String, JSONObject> bossEncounters = new LinkedHashMap<>();
        final Map<String, JSONObject> droppedItems = new LinkedHashMap<>();
        final Set<String> openedChests = new LinkedHashSet<>();
        final Set<String> collectedPickups = new LinkedHashSet<>();
        final Set<String> discoveredLandmarks = new LinkedHashSet<>();
        final Map<String, JSONObject> depletedResources = new LinkedHashMap<>();
        final Map<String, Boolean> doors = new LinkedHashMap<>();
        final Map<String, JSONObject> placedBeds = new LinkedHashMap<>();
        final Map<String, JSONObject> placedStations = new LinkedHashMap<>();
        final Map<String, JSONObject> playerBuildings = new LinkedHashMap<>();
        final Map<String, JSONObject> villagesDev = new LinkedHashMap<>();
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
        int xp = 0;
        int coins = 0;
        int health = 100;
        int maxHealth = 100;
        boolean isDead = false;
        Long reviveAtMs = null;
        long lastDamageAtMs = 0;
        long lastAttackAtMs = 0;
        String lastSwingId = null;
        String lastSwingWeaponId = null;
        long lastSwingAtMs = 0;
        final List<String> lastSwingTargetIds = new ArrayList<>();
        final Map<String, Long> lastEnemyAttackAtBySource = new HashMap<>();
        final List<String> claimedRewardIds = new ArrayList<>();
        double posX = 0;
        double posY = 0;
        double posZ = 4;
        double posYaw = 0;
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

    private JSONObject sanitizeModMetadata(JSONObject raw) {
        if (raw == null) return null;
        try {
            int modApiVersion = Math.max(1, Math.min(999, raw.optInt("modApiVersion", CURRENT_MOD_API_VERSION)));
            int schemaVersion = Math.max(1, Math.min(999, raw.optInt("schemaVersion", 1)));
            String savedAtGameVersion = sanitizeText(raw.optString("savedAtGameVersion", "1.0.0"), 24, "1.0.0");
            JSONArray rawMods = raw.optJSONArray("mods");
            Map<String, JSONObject> modsById = new java.util.TreeMap<>();
            if (rawMods != null) {
                for (int i = 0; i < rawMods.length() && modsById.size() < 128; i++) {
                    JSONObject entry = rawMods.optJSONObject(i);
                    if (entry == null) continue;
                    String modId = entry.optString("modId", "").trim();
                    if (modId.length() > 64) modId = modId.substring(0, 64);
                    if (modId.isEmpty() || !SAFE_MOD_ID_PATTERN.matcher(modId).matches()) continue;
                    String compat = entry.optString("multiplayerCompatibility", "required").trim();
                    if (!VALID_MOD_COMPAT_MODES.contains(compat)) compat = "required";
                    int entryApi = Math.max(1, Math.min(999, entry.optInt("modApiVersion", modApiVersion)));
                    int entrySchema = Math.max(1, Math.min(999, entry.optInt("schemaVersion", schemaVersion)));
                    JSONObject clean = new JSONObject();
                    clean.put("modId", modId);
                    clean.put("name", sanitizeText(entry.optString("name", modId), 64, modId));
                    clean.put("version", sanitizeText(entry.optString("version", "1.0.0"), 32, "1.0.0"));
                    clean.put("modApiVersion", entryApi);
                    clean.put("schemaVersion", entrySchema);
                    clean.put("multiplayerCompatibility", compat);
                    modsById.put(modId, clean);
                }
            }
            JSONArray cleanMods = new JSONArray();
            for (JSONObject m : modsById.values()) cleanMods.put(m);
            JSONObject out = new JSONObject();
            out.put("modApiVersion", modApiVersion);
            out.put("schemaVersion", schemaVersion);
            out.put("savedAtGameVersion", savedAtGameVersion);
            out.put("mods", cleanMods);
            return out;
        } catch (Exception e) {
            return null;
        }
    }

    private JSONObject verifyModCompatibility(JSONObject rawHostMeta, JSONObject rawClientMeta) throws Exception {
        JSONObject hostMeta = sanitizeModMetadata(rawHostMeta);
        JSONObject clientMeta = sanitizeModMetadata(rawClientMeta);
        JSONArray issues = new JSONArray();
        JSONArray hostMods = hostMeta != null && hostMeta.optJSONArray("mods") != null ? hostMeta.optJSONArray("mods") : new JSONArray();
        JSONArray clientMods = clientMeta != null && clientMeta.optJSONArray("mods") != null ? clientMeta.optJSONArray("mods") : new JSONArray();

        int hostRequiredCount = 0;
        for (int i = 0; i < hostMods.length(); i++) {
            JSONObject hm = hostMods.optJSONObject(i);
            if (hm != null && !"client_only".equals(hm.optString("multiplayerCompatibility", "required"))) {
                hostRequiredCount++;
            }
        }

        Map<String, JSONObject> clientById = new HashMap<>();
        for (int i = 0; i < clientMods.length(); i++) {
            JSONObject cm = clientMods.optJSONObject(i);
            if (cm != null) clientById.put(cm.optString("modId"), cm);
        }

        if (hostMeta != null) {
            int hostApi = hostMeta.optInt("modApiVersion", CURRENT_MOD_API_VERSION);
            int hostSchema = hostMeta.optInt("schemaVersion", 1);
            if (hostApi > CURRENT_MOD_API_VERSION) {
                JSONObject issue = new JSONObject();
                issue.put("modId", "__mod_api__");
                issue.put("code", "api_version_mismatch");
                issue.put("expectedVersion", "<= v" + CURRENT_MOD_API_VERSION);
                issue.put("actualVersion", "v" + hostApi);
                issue.put("message", "Host requires Mod API v" + hostApi + " (supported <= v" + CURRENT_MOD_API_VERSION + ").");
                issues.put(issue);
            }
            if (hostSchema != 1) {
                JSONObject issue = new JSONObject();
                issue.put("modId", "__mod_schema__");
                issue.put("code", "schema_version_mismatch");
                issue.put("expectedVersion", "1");
                issue.put("actualVersion", String.valueOf(hostSchema));
                issue.put("message", "Host uses unsupported mod schema v" + hostSchema + ".");
                issues.put(issue);
            }
        }

        Set<String> hostRequiredIds = new HashSet<>();
        for (int i = 0; i < hostMods.length(); i++) {
            JSONObject hm = hostMods.optJSONObject(i);
            if (hm == null) continue;
            String compat = hm.optString("multiplayerCompatibility", "required");
            if ("client_only".equals(compat)) continue;
            String modId = hm.optString("modId", "");
            String modName = hm.optString("name", modId);
            String hostVer = hm.optString("version", "1.0.0");
            hostRequiredIds.add(modId);

            JSONObject cm = clientById.get(modId);
            if (cm == null) {
                if ("required".equals(compat)) {
                    JSONObject issue = new JSONObject();
                    issue.put("modId", modId);
                    issue.put("modName", modName);
                    issue.put("code", "missing_mod");
                    issue.put("expectedVersion", hostVer);
                    issue.put("message", "Missing required mod \"" + modName + "\" (" + modId + " v" + hostVer + ").");
                    issues.put(issue);
                }
                continue;
            }
            String clientVer = cm.optString("version", "1.0.0");
            if ("required".equals(compat) && !hostVer.equals(clientVer)) {
                JSONObject issue = new JSONObject();
                issue.put("modId", modId);
                issue.put("modName", modName);
                issue.put("code", "version_mismatch");
                issue.put("expectedVersion", hostVer);
                issue.put("actualVersion", clientVer);
                issue.put("message", "Mod \"" + modName + "\" version mismatch (host v" + hostVer + ", local v" + clientVer + ").");
                issues.put(issue);
            }
            int hApi = hm.optInt("modApiVersion", CURRENT_MOD_API_VERSION);
            int cApi = cm.optInt("modApiVersion", CURRENT_MOD_API_VERSION);
            if (hApi != cApi) {
                JSONObject issue = new JSONObject();
                issue.put("modId", modId);
                issue.put("modName", modName);
                issue.put("code", "api_version_mismatch");
                issue.put("expectedVersion", "v" + hApi);
                issue.put("actualVersion", "v" + cApi);
                issue.put("message", "Mod \"" + modName + "\" API version mismatch (host v" + hApi + ", local v" + cApi + ").");
                issues.put(issue);
            }
            int hSchema = hm.optInt("schemaVersion", 1);
            int cSchema = cm.optInt("schemaVersion", 1);
            if (hSchema != cSchema) {
                JSONObject issue = new JSONObject();
                issue.put("modId", modId);
                issue.put("modName", modName);
                issue.put("code", "schema_version_mismatch");
                issue.put("expectedVersion", "v" + hSchema);
                issue.put("actualVersion", "v" + cSchema);
                issue.put("message", "Mod \"" + modName + "\" schema version mismatch (host v" + hSchema + ", local v" + cSchema + ").");
                issues.put(issue);
            }
        }

        for (int i = 0; i < clientMods.length(); i++) {
            JSONObject cm = clientMods.optJSONObject(i);
            if (cm == null) continue;
            if (!"required".equals(cm.optString("multiplayerCompatibility", "required"))) continue;
            String modId = cm.optString("modId", "");
            if (!hostRequiredIds.contains(modId)) {
                String modName = cm.optString("name", modId);
                String clientVer = cm.optString("version", "1.0.0");
                JSONObject issue = new JSONObject();
                issue.put("modId", modId);
                issue.put("modName", modName);
                issue.put("code", "extra_active_mod");
                if (hostRequiredCount == 0) issue.put("expectedVersion", "Vanilla (None)");
                issue.put("actualVersion", clientVer);
                issue.put("message", hostRequiredCount == 0
                        ? "Host is running a Vanilla world. Disable active gameplay mod \"" + modName + "\" (" + modId + ") to join."
                        : "Local gameplay mod \"" + modName + "\" (" + modId + " v" + clientVer + ") is not active on the host.");
                issues.put(issue);
            }
        }

        boolean compatible = issues.length() == 0;
        String summary;
        if (!compatible) {
            String firstMsg = issues.optJSONObject(0) != null ? issues.optJSONObject(0).optString("message", "Mod mismatch") : "Mod mismatch";
            summary = issues.length() == 1 ? firstMsg : (issues.length() + " mod compatibility issues detected: " + firstMsg);
        } else if (hostRequiredCount == 0) {
            summary = "Vanilla compatible.";
        } else {
            summary = "Mod configuration is compatible.";
        }

        JSONObject report = new JSONObject();
        report.put("compatible", compatible);
        report.put("summary", summary);
        report.put("hostModCount", hostRequiredCount);
        report.put("issues", issues);
        return report;
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
        JSONArray chestsArr = new JSONArray();
        for (String cid : room.openedChests) chestsArr.put(cid);
        ws.put("openedChests", chestsArr);

        JSONArray pickupsArr = new JSONArray();
        for (String pid : room.collectedPickups) pickupsArr.put(pid);
        ws.put("collectedPickups", pickupsArr);

        JSONArray depletedArr = new JSONArray();
        for (JSONObject r : room.depletedResources.values()) {
            depletedArr.put(new JSONObject(r.toString()));
        }
        ws.put("depletedResources", depletedArr);

        JSONArray doorsArr = new JSONArray();
        for (Map.Entry<String, Boolean> de : room.doors.entrySet()) {
            JSONObject doorObj = new JSONObject();
            doorObj.put("id", de.getKey());
            doorObj.put("isOpen", Boolean.TRUE.equals(de.getValue()));
            doorsArr.put(doorObj);
        }
        ws.put("doors", doorsArr);

        JSONArray bedsArr = new JSONArray();
        for (JSONObject b : room.placedBeds.values()) bedsArr.put(new JSONObject(b.toString()));
        ws.put("placedBeds", bedsArr);

        JSONArray stationsArr = new JSONArray();
        for (JSONObject s : room.placedStations.values()) stationsArr.put(new JSONObject(s.toString()));
        ws.put("placedStations", stationsArr);

        JSONArray buildingsArr = new JSONArray();
        for (JSONObject b : room.playerBuildings.values()) buildingsArr.put(new JSONObject(b.toString()));
        ws.put("playerBuildings", buildingsArr);

        JSONArray villagesArr = new JSONArray();
        for (JSONObject v : room.villagesDev.values()) villagesArr.put(new JSONObject(v.toString()));
        ws.put("villagesDev", villagesArr);

        JSONArray droppedArr = new JSONArray();
        for (JSONObject d : room.droppedItems.values()) {
            droppedArr.put(new JSONObject(d.toString()));
        }
        ws.put("droppedItems", droppedArr);
        ws.put("quests", new JSONArray());
        JSONArray landmarks = new JSONArray();
        if (room.discoveredLandmarks.isEmpty()) {
            landmarks.put("spawn-glade");
        } else {
            for (String lm : room.discoveredLandmarks) landmarks.put(lm);
        }
        ws.put("discoveredLandmarks", landmarks);

        JSONArray deadArr = new JSONArray();
        JSONArray entStatesArr = new JSONArray();
        for (EntityRecord ent : room.entities.values()) {
            if (ent.isDead) {
                JSONObject de = new JSONObject();
                de.put("id", ent.id);
                de.put("kind", ent.kind);
                deadArr.put(de);
            }
            JSONObject es = new JSONObject();
            es.put("id", ent.id);
            es.put("kind", ent.kind);
            es.put("archetype", ent.archetype);
            es.put("x", ent.x);
            es.put("y", ent.y);
            es.put("z", ent.z);
            es.put("yaw", ent.yaw);
            es.put("state", ent.state);
            es.put("hp", ent.hp);
            es.put("maxHp", ent.maxHp);
            es.put("isDead", ent.isDead);
            es.put("alive", !ent.isDead);
            if (ent.targetPlayerId != null) es.put("targetPlayerId", ent.targetPlayerId);
            if (ent.isBoss) {
                es.put("isBoss", true);
                es.put("bossPhase", ent.bossPhase);
            }
            if (ent.attackState != null) es.put("attackState", ent.attackState);
            entStatesArr.put(es);
        }
        ws.put("deadEntities", deadArr);
        ws.put("entityStates", entStatesArr);

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
        if (room.modMetadata != null) {
            ws.put("modMetadata", new JSONObject(room.modMetadata.toString()));
        }

        JSONArray bossArr = new JSONArray();
        for (JSONObject b : room.bossEncounters.values()) {
            bossArr.put(new JSONObject(b.toString()));
        }
        ws.put("bossEncounters", bossArr);

        PlayerRecord player = room.players.get(playerId);
        if (player != null) {
            ws.put("coins", player.coins);
            ws.put("xp", player.xp);
            ws.put("level", player.level);
            JSONObject pPos = new JSONObject();
            pPos.put("x", player.posX);
            pPos.put("y", player.posY);
            pPos.put("z", player.posZ);
            pPos.put("yaw", player.posYaw);
            ws.put("playerPosition", pPos);
            ws.put("playerVitals", buildPlayerVitalsPayload(player));
        }
        return ws;
    }

    private void recordWorldStateGameEvent(String eventName, JSONObject data, String playerId, long now) {
        if (room == null || data == null) return;
        try {
            switch (eventName) {
                case "CHEST_OPENED": {
                    String chestId = data.optString("chestId", "");
                    if (!chestId.isEmpty()) room.openedChests.add(chestId);
                    break;
                }
                case "PLAYER_COLLECTED_RESOURCE": {
                    String nodeId = data.optString("nodeId", "");
                    if (!nodeId.isEmpty()) {
                        JSONObject r = new JSONObject();
                        r.put("id", nodeId);
                        r.put("usesRemaining", data.optInt("usesRemaining", 0));
                        r.put("regenAtMs", now + 90000L);
                        room.depletedResources.put(nodeId, r);
                    }
                    break;
                }
                case "ITEM_DROPPED": {
                    String dropId = data.optString("dropId", "");
                    String itemId = data.optString("itemId", "");
                    if (!dropId.isEmpty() && !itemId.isEmpty()) {
                        JSONObject d = new JSONObject();
                        d.put("id", dropId);
                        d.put("itemId", itemId);
                        d.put("count", Math.max(1, data.optInt("count", 1)));
                        d.put("label", data.optString("label", itemId));
                        d.put("x", data.optDouble("x", 0.0));
                        d.put("y", data.optDouble("y", 0.0));
                        d.put("z", data.optDouble("z", 0.0));
                        d.put("droppedBy", playerId);
                        room.droppedItems.put(dropId, d);
                    }
                    break;
                }
                case "ITEM_PICKED_UP": {
                    String pickupId = data.optString("pickupId", "");
                    if (!pickupId.isEmpty()) {
                        if (data.optBoolean("isPlayerDrop", false)) {
                            room.droppedItems.remove(pickupId);
                        } else {
                            room.collectedPickups.add(pickupId);
                        }
                    }
                    break;
                }
                case "DOOR_OPENED":
                case "DOOR_CLOSED": {
                    String doorId = data.optString("doorId", "");
                    if (!doorId.isEmpty()) {
                        room.doors.put(doorId, "DOOR_OPENED".equals(eventName));
                    }
                    break;
                }
                case "BED_PLACED": {
                    String bedId = data.optString("bedId", "");
                    if (!bedId.isEmpty()) {
                        JSONObject b = new JSONObject();
                        b.put("id", bedId);
                        b.put("x", data.optDouble("x", 0.0));
                        b.put("y", data.optDouble("y", 0.0));
                        b.put("z", data.optDouble("z", 0.0));
                        b.put("yaw", data.optDouble("yaw", 0.0));
                        b.put("ownerId", data.optString("ownerId", playerId));
                        room.placedBeds.put(bedId, b);
                    }
                    break;
                }
                case "STATION_PLACED": {
                    String stationId = data.optString("stationId", "");
                    if (!stationId.isEmpty()) {
                        JSONObject s = new JSONObject();
                        s.put("id", stationId);
                        s.put("stationType", "furnace".equals(data.optString("stationType")) ? "furnace" : "crafting_table");
                        s.put("x", data.optDouble("x", 0.0));
                        s.put("y", data.optDouble("y", 0.0));
                        s.put("z", data.optDouble("z", 0.0));
                        s.put("yaw", data.optDouble("yaw", 0.0));
                        s.put("ownerId", data.optString("ownerId", playerId));
                        room.placedStations.put(stationId, s);
                    }
                    break;
                }
                case "WORLD_EVENT": {
                    if ("landmark_discovered".equals(data.optString("kind")) && !data.optString("landmarkId", "").isEmpty()) {
                        room.discoveredLandmarks.add(data.optString("landmarkId"));
                    }
                    break;
                }
                case "PLAYER_BUILD_PLACE": {
                    String sid = data.optString("structureId", "");
                    String bid = data.optString("blueprintId", "");
                    if (!sid.isEmpty() && !bid.isEmpty()) {
                        JSONObject st = new JSONObject();
                        st.put("id", sid);
                        st.put("blueprintId", bid);
                        st.put("x", data.optDouble("x", 0.0));
                        st.put("y", data.optDouble("y", 0.0));
                        st.put("z", data.optDouble("z", 0.0));
                        st.put("yaw", data.optDouble("yaw", 0.0));
                        st.put("structureHp", data.optDouble("structureHp", 100.0));
                        st.put("maxStructureHp", data.optDouble("maxStructureHp", 100.0));
                        st.put("ownerId", data.optString("ownerId", playerId));
                        st.put("ownerName", data.optString("ownerName", "Explorer"));
                        st.put("permissionScope", data.optString("permissionScope", "owner"));
                        st.put("createdAtMs", data.optLong("createdAtMs", now));
                        room.playerBuildings.put(sid, st);
                    }
                    break;
                }
                case "PLAYER_BUILD_REPAIR": {
                    String sid = data.optString("structureId", "");
                    JSONObject st = sid.isEmpty() ? null : room.playerBuildings.get(sid);
                    if (st != null && data.has("structureHp")) {
                        st.put("structureHp", data.optDouble("structureHp"));
                    }
                    break;
                }
                case "PLAYER_BUILD_UPGRADE": {
                    String sid = data.optString("structureId", "");
                    String bid = data.optString("blueprintId", "");
                    JSONObject st = sid.isEmpty() ? null : room.playerBuildings.get(sid);
                    if (st != null && !bid.isEmpty()) {
                        st.put("blueprintId", bid);
                    }
                    break;
                }
                case "PLAYER_BUILD_PERMS": {
                    String sid = data.optString("structureId", "");
                    String scope = data.optString("permissionScope", "");
                    JSONObject st = sid.isEmpty() ? null : room.playerBuildings.get(sid);
                    if (st != null && !scope.isEmpty()) {
                        st.put("permissionScope", scope);
                    }
                    break;
                }
                case "PLAYER_BUILD_DEMOLISH": {
                    String sid = data.optString("structureId", "");
                    if (!sid.isEmpty()) {
                        room.playerBuildings.remove(sid);
                    }
                    break;
                }
                case "PLAYER_FARM_TILL": {
                    String sid = data.optString("structureId", "");
                    JSONObject st = sid.isEmpty() ? null : room.playerBuildings.get(sid);
                    if (st != null) {
                        st.put("farmSoilPrepared", true);
                        st.put("farmStage", 1);
                    }
                    break;
                }
                case "PLAYER_FARM_PLANT": {
                    String sid = data.optString("structureId", "");
                    String cid = data.optString("cropId", "");
                    JSONObject st = sid.isEmpty() ? null : room.playerBuildings.get(sid);
                    if (st != null && !cid.isEmpty()) {
                        st.put("farmCropId", cid);
                        st.put("farmStage", 2);
                    }
                    break;
                }
                case "PLAYER_FARM_WATER": {
                    String sid = data.optString("structureId", "");
                    JSONObject st = sid.isEmpty() ? null : room.playerBuildings.get(sid);
                    if (st != null) {
                        st.put("farmWaterLevel", 1);
                    }
                    break;
                }
                case "PLAYER_FARM_HARVEST": {
                    String sid = data.optString("structureId", "");
                    JSONObject st = sid.isEmpty() ? null : room.playerBuildings.get(sid);
                    if (st != null) {
                        st.put("farmStage", 1);
                        st.put("farmProgress", 0);
                        st.remove("farmCropId");
                    }
                    break;
                }
                case "VILLAGE_REPAIR":
                case "VILLAGE_PROJECT":
                case "VILLAGE_DEFENSE_WON":
                case "MERCHANT_BUY":
                case "MERCHANT_SELL": {
                    String vid = data.optString("villageId", "");
                    if (vid.isEmpty()) break;
                    JSONObject rec = room.villagesDev.get(vid);
                    if (rec == null) {
                        rec = new JSONObject();
                        rec.put("villageId", vid);
                        rec.put("level", 1);
                        rec.put("progressXp", 0);
                        rec.put("reputationPoints", 0);
                        rec.put("completedRepairIds", new JSONArray());
                        rec.put("completedProjectIds", new JSONArray());
                        rec.put("cropsHarvestedCount", 0);
                        rec.put("tradesCompletedCount", 0);
                        rec.put("defensesWonCount", 0);
                        room.villagesDev.put(vid, rec);
                    }
                    if (data.has("villageXp")) {
                        rec.put("progressXp", Math.max(rec.optInt("progressXp", 0), data.optInt("villageXp", 0)));
                    }
                    if (data.has("villageRep")) {
                        rec.put("reputationPoints", Math.max(rec.optInt("reputationPoints", 0), data.optInt("villageRep", 0)));
                    }
                    if ("VILLAGE_REPAIR".equals(eventName) && !data.optString("repairId", "").isEmpty()) {
                        String rid = data.optString("repairId");
                        JSONArray arr = rec.optJSONArray("completedRepairIds");
                        if (arr != null) {
                            boolean found = false;
                            for (int i = 0; i < arr.length(); i++) {
                                if (rid.equals(arr.optString(i))) { found = true; break; }
                            }
                            if (!found) arr.put(rid);
                        }
                    }
                    if ("VILLAGE_PROJECT".equals(eventName) && !data.optString("projectId", "").isEmpty()) {
                        String pid = data.optString("projectId");
                        JSONArray arr = rec.optJSONArray("completedProjectIds");
                        if (arr != null) {
                            boolean found = false;
                            for (int i = 0; i < arr.length(); i++) {
                                if (pid.equals(arr.optString(i))) { found = true; break; }
                            }
                            if (!found) arr.put(pid);
                        }
                    }
                    if ("VILLAGE_DEFENSE_WON".equals(eventName) && data.has("defensesWonCount")) {
                        rec.put("defensesWonCount", Math.max(rec.optInt("defensesWonCount", 0), data.optInt("defensesWonCount", 0)));
                    }
                    break;
                }
                default:
                    break;
            }
        } catch (Exception ignored) {
        }
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
                        if (room.modMetadata != null) {
                            announce.put("modMetadata", new JSONObject(room.modMetadata.toString()));
                        }
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
                    contentLength = Math.min(2097152, Math.max(0, Integer.parseInt(headers.get("content-length"))));
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
                    if (room != null && room.modMetadata != null) {
                        res.put("modMetadata", new JSONObject(room.modMetadata.toString()));
                    }
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
            String rawWt = options.optString("worldType", "normal");
            if ("creative".equals(rawWt) || "survival".equals(rawWt) || "adventure".equals(rawWt)) {
                r.worldType = rawWt;
            } else {
                r.worldType = "normal";
            }
            String diff = options.optString("difficulty", "normal");
            r.difficulty = ("easy".equals(diff) || "hard".equals(diff)) ? diff : "normal";
            int optSeed = options.optInt("seed", -1);
            r.seed = (options.has("seed") && optSeed > 0) ? optSeed : (100000 + rng.nextInt(899999));
            r.hostId = randomId("pl", 8);
            r.status = "waiting";
            r.createdAt = System.currentTimeMillis();
            r.modMetadata = sanitizeModMetadata(options.optJSONObject("modMetadata"));

            JSONObject optTime = options.optJSONObject("worldTime");
            r.worldTime = new JSONObject();
            double initHours = optTime != null ? optTime.optDouble("worldHours", 8.5) : 8.5;
            if (Double.isNaN(initHours) || Double.isInfinite(initHours)) initHours = 8.5;
            initHours = ((initHours % 24.0) + 24.0) % 24.0;
            r.worldTime.put("worldHours", initHours);
            r.worldTime.put("dayCount", Math.max(1, optTime != null ? optTime.optInt("dayCount", 1) : 1));
            double fullDay = optTime != null ? optTime.optDouble("fullDayDurationSeconds", 360.0) : 360.0;
            r.worldTime.put("fullDayDurationSeconds", fullDay > 0 ? fullDay : 360.0);
            r.worldTime.put("timeScale", optTime != null ? optTime.optDouble("timeScale", 1.0) : 1.0);
            r.worldTime.put("paused", optTime != null && optTime.optBoolean("paused", false));
            r.worldTime.put("anchorServerMs", r.createdAt);

            JSONObject optWeather = options.optJSONObject("worldWeather");
            String initWeather = (optWeather != null && VALID_WEATHER_STATES.contains(optWeather.optString("currentState", "clear")))
                    ? optWeather.optString("currentState", "clear")
                    : "clear";
            String targetWeather = (optWeather != null && VALID_WEATHER_STATES.contains(optWeather.optString("targetState", initWeather)))
                    ? optWeather.optString("targetState", initWeather)
                    : initWeather;
            r.worldWeather = new JSONObject();
            r.worldWeather.put("currentState", initWeather);
            r.worldWeather.put("targetState", targetWeather);
            r.worldWeather.put("intensity", optWeather != null ? optWeather.optDouble("intensity", 0.0) : 0.0);
            r.worldWeather.put("dynamicEnabled", optWeather == null || optWeather.optBoolean("dynamicEnabled", true));
            r.worldWeather.put("transitionDurationSeconds", optWeather != null ? optWeather.optDouble("transitionDurationSeconds", 14.0) : 14.0);
            r.worldWeather.put("startMs", r.createdAt);
            r.worldWeather.put("durationMs", 240000);
            r.worldWeather.put("endMs", r.createdAt + 240000);

            r.discoveredLandmarks.add("spawn-glade");
            JSONObject savedState = options.optJSONObject("savedWorldState");
            if (savedState != null) {
                JSONArray ch = savedState.optJSONArray("openedChests");
                if (ch != null) for (int i = 0; i < ch.length(); i++) {
                    String id = ch.optString(i, "");
                    if (!id.isEmpty()) r.openedChests.add(id);
                }
                JSONArray pk = savedState.optJSONArray("collectedPickups");
                if (pk != null) for (int i = 0; i < pk.length(); i++) {
                    String id = pk.optString(i, "");
                    if (!id.isEmpty()) r.collectedPickups.add(id);
                }
                JSONArray dp = savedState.optJSONArray("depletedResources");
                if (dp != null) for (int i = 0; i < dp.length(); i++) {
                    JSONObject obj = dp.optJSONObject(i);
                    if (obj != null && !obj.optString("id", "").isEmpty()) {
                        r.depletedResources.put(obj.optString("id"), new JSONObject(obj.toString()));
                    }
                }
                JSONArray dr = savedState.optJSONArray("doors");
                if (dr != null) for (int i = 0; i < dr.length(); i++) {
                    JSONObject obj = dr.optJSONObject(i);
                    if (obj != null && !obj.optString("id", "").isEmpty()) {
                        r.doors.put(obj.optString("id"), obj.optBoolean("isOpen", false));
                    }
                }
                JSONArray bd = savedState.optJSONArray("placedBeds");
                if (bd != null) for (int i = 0; i < bd.length(); i++) {
                    JSONObject obj = bd.optJSONObject(i);
                    if (obj != null && !obj.optString("id", "").isEmpty()) {
                        r.placedBeds.put(obj.optString("id"), new JSONObject(obj.toString()));
                    }
                }
                JSONArray st = savedState.optJSONArray("placedStations");
                if (st != null) for (int i = 0; i < st.length(); i++) {
                    JSONObject obj = st.optJSONObject(i);
                    if (obj != null && !obj.optString("id", "").isEmpty()) {
                        r.placedStations.put(obj.optString("id"), new JSONObject(obj.toString()));
                    }
                }
                JSONArray pb = savedState.optJSONArray("playerBuildings");
                if (pb != null) for (int i = 0; i < pb.length(); i++) {
                    JSONObject obj = pb.optJSONObject(i);
                    if (obj != null && !obj.optString("id", "").isEmpty()) {
                        r.playerBuildings.put(obj.optString("id"), new JSONObject(obj.toString()));
                    }
                }
                JSONArray vd = savedState.optJSONArray("villagesDev");
                if (vd != null) for (int i = 0; i < vd.length(); i++) {
                    JSONObject obj = vd.optJSONObject(i);
                    if (obj != null && !obj.optString("villageId", "").isEmpty()) {
                        r.villagesDev.put(obj.optString("villageId"), new JSONObject(obj.toString()));
                    }
                }
                JSONArray lm = savedState.optJSONArray("discoveredLandmarks");
                if (lm != null) for (int i = 0; i < lm.length(); i++) {
                    String id = lm.optString(i, "");
                    if (!id.isEmpty()) r.discoveredLandmarks.add(id);
                }
                JSONArray di = savedState.optJSONArray("droppedItems");
                if (di != null) for (int i = 0; i < di.length(); i++) {
                    JSONObject obj = di.optJSONObject(i);
                    if (obj != null && !obj.optString("id", "").isEmpty()) {
                        r.droppedItems.put(obj.optString("id"), new JSONObject(obj.toString()));
                    }
                }
                JSONArray de = savedState.optJSONArray("deadEntities");
                if (de != null) for (int i = 0; i < de.length(); i++) {
                    JSONObject obj = de.optJSONObject(i);
                    if (obj != null && !obj.optString("id", "").isEmpty()) {
                        EntityRecord er = new EntityRecord();
                        er.id = obj.optString("id");
                        er.kind = "animal".equals(obj.optString("kind")) ? "animal" : "enemy";
                        er.archetype = "default";
                        er.maxHp = 100;
                        er.hp = 0;
                        er.isDead = true;
                        er.diedAtMs = r.createdAt;
                        er.state = "dead";
                        er.lastUpdatedAtMs = r.createdAt;
                        r.entities.put(er.id, er);
                    }
                }
            }

            PlayerRecord host = new PlayerRecord();
            host.playerId = r.hostId;
            host.networkEntityId = "net_" + r.hostId;
            host.displayName = r.hostName;
            host.isHost = true;
            host.isReady = true;
            host.joinedAt = r.createdAt;
            host.partyJoinedAt = r.createdAt;
            host.avatarColor = AVATAR_COLORS[0];
            host.coins = "creative".equals(r.worldType) ? 500 : 0;
            host.posX = 0;
            host.posY = 0;
            host.posZ = 4;
            host.posYaw = 0;
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

            JSONObject modCompat = verifyModCompatibility(room.modMetadata, options.optJSONObject("clientModMetadata"));
            if (!modCompat.optBoolean("compatible", true)) {
                res.put("_status", 409);
                res.put("ok", false);
                res.put("error", "MOD_INCOMPATIBLE");
                res.put("message", modCompat.optString("summary", "Mod configuration is incompatible."));
                res.put("modCompatibility", modCompat);
                if (room.modMetadata != null) {
                    res.put("hostModMetadata", new JSONObject(room.modMetadata.toString()));
                }
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
            p.coins = "creative".equals(room.worldType) ? 500 : 0;
            double xOff = (room.players.size() - 1) * 2.2;
            p.posX = xOff;
            p.posY = 0;
            p.posZ = 4;
            p.posYaw = 0;
            p.state = defaultPlayerState(xOff, p.networkEntityId, p.joinedAt);

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

    private static int resolveEntityMaxHp(String kind, String archetype) {
        if ("enemy".equals(kind)) {
            Integer val = LAN_ENEMY_MAX_HP.get(archetype);
            return val != null ? val : 80;
        }
        if ("animal".equals(kind)) {
            Integer val = LAN_ANIMAL_MAX_HP.get(archetype);
            return val != null ? val : 50;
        }
        Integer val = LAN_NPC_MAX_HP.get(archetype);
        return val != null ? val : 100;
    }

    private static boolean isBossArchetypeOrFlag(String kind, String archetype, boolean isBossFlag) {
        return isBossFlag || ("enemy".equals(kind) && "ancient_guardian".equals(archetype));
    }

    private static double deterministicLootRoll(String seedKey) {
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            byte[] d = md.digest(seedKey.getBytes(StandardCharsets.UTF_8));
            long v = ((d[0] & 0xFFL) << 24) | ((d[1] & 0xFFL) << 16) | ((d[2] & 0xFFL) << 8) | (d[3] & 0xFFL);
            return v / 4294967296.0;
        } catch (Exception e) {
            return 0.5;
        }
    }

    private JSONObject buildPlayerVitalsPayload(PlayerRecord p) throws Exception {
        JSONObject v = new JSONObject();
        v.put("playerId", p.playerId);
        v.put("networkEntityId", p.networkEntityId);
        v.put("health", p.health);
        v.put("maxHealth", p.maxHealth);
        v.put("isDead", p.isDead);
        v.put("reviveAtMs", p.reviveAtMs != null ? p.reviveAtMs : JSONObject.NULL);
        return v;
    }

    private JSONObject buildProgressionPayload(PlayerRecord p, String reason) throws Exception {
        JSONObject prog = new JSONObject();
        prog.put("playerId", p.playerId);
        prog.put("coins", p.coins);
        prog.put("xp", p.xp);
        prog.put("level", p.level);
        prog.put("xpToNextLevel", p.level * 100);
        prog.put("reason", reason);
        return prog;
    }

    private void grantProgression(String playerId, int deltaXp, int deltaCoins, String reason) {
        if (room == null) return;
        PlayerRecord p = room.players.get(playerId);
        if (p == null) return;
        if (deltaCoins != 0) {
            p.coins = Math.max(0, Math.min(MAX_PLAYER_COINS, p.coins + deltaCoins));
        }
        if (deltaXp > 0 && p.level < MAX_PLAYER_LEVEL) {
            p.xp += deltaXp;
            while (p.level < MAX_PLAYER_LEVEL && p.xp >= p.level * 100) {
                p.xp -= p.level * 100;
                p.level += 1;
            }
            if (p.level >= MAX_PLAYER_LEVEL) {
                p.level = MAX_PLAYER_LEVEL;
                p.xp = 0;
            }
        }
        try {
            sendTo(playerId, "PROGRESSION_UPDATED", buildProgressionPayload(p, reason));
        } catch (Exception ignored) {
        }
    }

    private void grantIdempotentReward(
            String playerId,
            String grantId,
            String mode,
            String sourceKind,
            String sourceId,
            String archetype,
            int xp,
            int coins,
            List<LootDropSpec> items,
            String reason,
            long now
    ) {
        if (room == null) return;
        PlayerRecord p = room.players.get(playerId);
        if (p == null) return;
        if (p.claimedRewardIds.contains(grantId)) return;
        p.claimedRewardIds.add(grantId);
        if (p.claimedRewardIds.size() > 256) {
            p.claimedRewardIds.subList(0, p.claimedRewardIds.size() - 256).clear();
        }

        int xpAmt = Math.max(0, xp);
        int coinsAmt = Math.max(0, coins);
        grantProgression(playerId, xpAmt, coinsAmt, reason);

        try {
            JSONArray grantedItems = new JSONArray();
            if (items != null) {
                for (LootDropSpec item : items) {
                    if (item == null || item.itemId == null || item.itemId.isEmpty() || item.count <= 0) continue;
                    JSONObject io = new JSONObject();
                    io.put("itemId", item.itemId);
                    io.put("count", item.count);
                    grantedItems.put(io);
                }
            }
            JSONObject loot = new JSONObject();
            loot.put("grantId", grantId);
            loot.put("playerId", playerId);
            loot.put("mode", mode);
            loot.put("sourceKind", sourceKind);
            loot.put("sourceId", sourceId);
            if (archetype != null && !archetype.isEmpty()) loot.put("archetype", archetype);
            loot.put("xp", xpAmt);
            loot.put("coins", coinsAmt);
            loot.put("items", grantedItems);
            loot.put("reason", reason);
            loot.put("timestamp", now);
            sendTo(playerId, "LOOT_GRANTED", loot);
        } catch (Exception ignored) {
        }
    }

    private JSONObject syncBossEncounterFromEntity(
            EntityRecord entity,
            String fallbackTargetId,
            boolean broadcastIfChanged,
            long now
    ) {
        if (room == null || !isBossArchetypeOrFlag(entity.kind, entity.archetype, entity.isBoss)) {
            return null;
        }
        entity.isBoss = true;
        int phase = entity.hp <= (entity.maxHp / 2) ? 2 : 1;
        entity.bossPhase = phase;
        JSONObject prev = room.bossEncounters.get(entity.id);
        String nextAttackState = entity.attackState != null
                ? entity.attackState
                : (prev != null ? prev.optString("attackState", "idle") : "idle");
        String nextTargetId = entity.targetPlayerId != null
                ? entity.targetPlayerId
                : (prev != null && !prev.isNull("targetPlayerId") ? prev.optString("targetPlayerId", null) : fallbackTargetId);

        try {
            JSONObject dmgObj = new JSONObject();
            for (Map.Entry<String, Integer> de : entity.damageByPlayer.entrySet()) {
                dmgObj.put(de.getKey(), de.getValue());
            }
            JSONObject next = new JSONObject();
            next.put("bossId", entity.id);
            next.put("archetype", entity.archetype);
            next.put("hp", entity.hp);
            next.put("maxHp", entity.maxHp);
            next.put("isDead", entity.isDead);
            next.put("state", entity.state);
            next.put("attackState", nextAttackState);
            next.put("phase", phase);
            next.put("targetPlayerId", entity.isDead || nextTargetId == null ? JSONObject.NULL : nextTargetId);
            next.put("damageByPlayer", dmgObj);
            next.put("x", entity.x);
            next.put("y", entity.y);
            next.put("z", entity.z);
            next.put("yaw", entity.yaw);
            next.put("killSeq", entity.killSeq);
            next.put("updatedAtMs", now);

            String prevTarget = (prev == null || prev.isNull("targetPlayerId")) ? null : prev.optString("targetPlayerId", null);
            String curTarget = entity.isDead ? null : nextTargetId;
            boolean changed = prev == null
                    || prev.optInt("hp", -1) != entity.hp
                    || prev.optInt("maxHp", -1) != entity.maxHp
                    || prev.optBoolean("isDead", false) != entity.isDead
                    || prev.optInt("phase", 1) != phase
                    || !nextAttackState.equals(prev.optString("attackState", ""))
                    || !String.valueOf(curTarget).equals(String.valueOf(prevTarget))
                    || !entity.state.equals(prev.optString("state", ""));

            room.bossEncounters.put(entity.id, next);
            if (broadcastIfChanged && changed) {
                broadcast("BOSS_STATE_UPDATED", room.hostId != null ? room.hostId : "server", new JSONObject(next.toString()), null);
            }
            return next;
        } catch (Exception e) {
            return null;
        }
    }

    private void resolveEnemyOrBossLoot(EntityRecord entity, String killerId, long now) {
        if (room == null) return;
        entity.killSeq += 1;
        int killSeq = entity.killSeq;
        EnemyLootTableSpec table = LAN_ENEMY_LOOT_TABLES.get(entity.archetype);
        if (table == null) table = LAN_ENEMY_LOOT_TABLES.get("bandit_scout");
        boolean isBoss = isBossArchetypeOrFlag(entity.kind, entity.archetype, entity.isBoss || table.isBoss);

        List<LootDropSpec> killerPersonalItems = new ArrayList<>();
        for (LootDropSpec drop : table.personalItems) {
            double roll = deterministicLootRoll(entity.id + ":k" + killSeq + ":" + drop.itemId + ":personal");
            if (roll <= drop.chance) {
                killerPersonalItems.add(drop);
            }
        }

        grantIdempotentReward(
                killerId,
                "loot:" + entity.id + ":k" + killSeq + ":" + killerId + ":personal",
                "personal",
                isBoss ? "boss" : "enemy",
                entity.id,
                entity.archetype,
                table.personalXp,
                table.personalCoins,
                killerPersonalItems,
                isBoss ? ("boss_killed:" + entity.archetype) : "enemy_killed",
                now
        );

        List<String> contributors = new ArrayList<>();
        for (Map.Entry<String, Integer> entry : entity.damageByPlayer.entrySet()) {
            if (entry.getValue() > 0 && room.players.containsKey(entry.getKey())) {
                contributors.add(entry.getKey());
            }
        }
        if (!contributors.contains(killerId)) {
            contributors.add(killerId);
        }

        if (isBoss) {
            for (String pid : contributors) {
                if (pid.equals(killerId)) continue;
                grantIdempotentReward(
                        pid,
                        "loot:" + entity.id + ":k" + killSeq + ":" + pid + ":personal",
                        "personal",
                        "boss",
                        entity.id,
                        entity.archetype,
                        Math.max(10, (int) Math.round(table.personalXp * 0.5)),
                        Math.max(5, (int) Math.round(table.personalCoins * 0.5)),
                        killerPersonalItems,
                        "boss_assist:" + entity.archetype,
                        now
                );
            }
        }

        if (table.hasShared && !contributors.isEmpty()) {
            PlayerRecord killer = room.players.get(killerId);
            PartyRecord party = (killer != null && killer.partyId != null) ? room.parties.get(killer.partyId) : null;
            Set<String> sharedRecipients = new LinkedHashSet<>(contributors);
            if (party != null) {
                for (String mid : party.memberIds) {
                    if (room.players.containsKey(mid)) sharedRecipients.add(mid);
                }
            }
            int divisor = Math.max(1, sharedRecipients.size());
            int sharedXpEach = Math.max(5, (int) Math.round((double) table.sharedXpPool / divisor));
            int sharedCoinsEach = Math.max(3, (int) Math.round((double) table.sharedCoinsPool / divisor));
            for (String pid : sharedRecipients) {
                grantIdempotentReward(
                        pid,
                        "loot:" + entity.id + ":k" + killSeq + ":" + pid + ":shared",
                        "shared",
                        isBoss ? "boss" : "enemy",
                        entity.id,
                        entity.archetype,
                        sharedXpEach,
                        sharedCoinsEach,
                        table.sharedItems,
                        "shared_loot:" + entity.archetype,
                        now
                );
            }
        }

        if (!table.worldDrops.isEmpty()) {
            for (int i = 0; i < table.worldDrops.size(); i++) {
                LootDropSpec wd = table.worldDrops.get(i);
                double roll = deterministicLootRoll(entity.id + ":k" + killSeq + ":" + wd.itemId + ":world:" + i);
                if (roll > wd.chance) continue;
                String dropId = "drop_loot_" + entity.id + "_k" + killSeq + "_" + i;
                if (dropId.length() > 64) dropId = dropId.substring(0, 64);
                if (room.droppedItems.containsKey(dropId)) continue;
                double offsetX = (i - (table.worldDrops.size() - 1) * 0.5) * 0.65;
                double dx = Math.round((entity.x + offsetX) * 100.0) / 100.0;
                double dy = Math.round(entity.y * 100.0) / 100.0;
                double dz = Math.round((entity.z + 0.35) * 100.0) / 100.0;
                String label = wd.label != null ? wd.label : wd.itemId;
                try {
                    JSONObject dropRec = new JSONObject();
                    dropRec.put("id", dropId);
                    dropRec.put("itemId", wd.itemId);
                    dropRec.put("count", wd.count);
                    dropRec.put("label", label);
                    dropRec.put("x", dx);
                    dropRec.put("y", dy);
                    dropRec.put("z", dz);
                    dropRec.put("droppedBy", entity.id);
                    room.droppedItems.put(dropId, dropRec);
                    if (room.droppedItems.size() > 200) {
                        String oldest = room.droppedItems.keySet().iterator().next();
                        room.droppedItems.remove(oldest);
                    }

                    JSONObject evData = new JSONObject();
                    evData.put("dropId", dropId);
                    evData.put("itemId", wd.itemId);
                    evData.put("count", wd.count);
                    evData.put("label", label);
                    evData.put("x", dx);
                    evData.put("y", dy);
                    evData.put("z", dz);
                    evData.put("droppedBy", entity.id);
                    evData.put("mode", "world_drop");

                    JSONObject env = new JSONObject();
                    env.put("event", "ITEM_DROPPED");
                    env.put("data", evData);
                    env.put("actorId", killerId);
                    env.put("serverTimestamp", now);
                    broadcast("GAME_EVENT", killerId, env, null);
                } catch (Exception ignored) {
                }
            }
        }
    }

    private boolean applyAuthoritativeDamage(
            String attackerId,
            String targetKind,
            String targetId,
            String archetype,
            int damage,
            boolean isCritOrHeadshot,
            double hitX,
            double hitY,
            double hitZ,
            long now
    ) {
        if (room == null) return false;
        PlayerRecord attacker = room.players.get(attackerId);
        if (attacker == null) return false;

        try {
            if ("player".equals(targetKind)) {
                if (targetId.equals(attackerId)) return false;
                PlayerRecord targetPlayer = room.players.get(targetId);
                if (targetPlayer == null || targetPlayer.isDead) return false;
                boolean sameParty = attacker.partyId != null && attacker.partyId.equals(targetPlayer.partyId);
                if (sameParty) {
                    if (!room.friendlyFire) {
                        JSONObject err = new JSONObject();
                        err.put("code", "FRIENDLY_FIRE_DISABLED");
                        err.put("message", "Friendly fire is disabled for party members.");
                        sendTo(attackerId, "ERROR", err);
                        return false;
                    }
                } else {
                    return false;
                }
                if (Math.hypot(hitX - targetPlayer.posX, hitZ - targetPlayer.posZ) > 6.5 || Math.abs(hitY - targetPlayer.posY) > 5.5) {
                    JSONObject err = new JSONObject();
                    err.put("code", "TARGET_POSITION_MISMATCH");
                    err.put("message", "Hit rejected: target player is not at that location.");
                    sendTo(attackerId, "ERROR", err);
                    return false;
                }
                targetPlayer.health = Math.max(0, targetPlayer.health - damage);
                targetPlayer.lastDamageAtMs = now;
                if (targetPlayer.health <= 0) {
                    targetPlayer.isDead = true;
                    targetPlayer.reviveAtMs = now + 2000L;
                }
                if (targetPlayer.state != null) {
                    targetPlayer.state.put("health", targetPlayer.health);
                    targetPlayer.state.put("isDead", targetPlayer.isDead);
                }
                broadcast("PLAYER_VITALS", targetId, buildPlayerVitalsPayload(targetPlayer), null);
                if (targetPlayer.isDead) {
                    JSONObject pd = new JSONObject();
                    pd.put("playerId", targetId);
                    pd.put("killerId", attackerId);
                    pd.put("displayName", targetPlayer.displayName);
                    pd.put("x", hitX);
                    pd.put("y", hitY);
                    pd.put("z", hitZ);
                    JSONObject env = new JSONObject();
                    env.put("event", "PLAYER_DIED");
                    env.put("data", pd);
                    env.put("actorId", attackerId);
                    env.put("serverTimestamp", now);
                    broadcast("GAME_EVENT", attackerId, env, null);
                }
                return true;
            }

            if (!"npc".equals(targetKind) && !"animal".equals(targetKind) && !"enemy".equals(targetKind)) {
                return false;
            }

            EntityRecord entity = room.entities.get(targetId);
            if (entity == null) {
                String resolvedArch = sanitizeText(archetype, 48, "default");
                int maxHp = resolveEntityMaxHp(targetKind, resolvedArch);
                entity = new EntityRecord();
                entity.id = targetId;
                entity.kind = targetKind;
                entity.archetype = resolvedArch;
                entity.maxHp = maxHp;
                entity.hp = maxHp;
                entity.isDead = false;
                entity.diedAtMs = 0;
                entity.x = hitX;
                entity.y = hitY;
                entity.z = hitZ;
                entity.yaw = 0;
                entity.state = "idle";
                entity.lastUpdatedAtMs = now;
                entity.killSeq = 0;
                entity.targetPlayerId = attackerId;
                entity.isBoss = isBossArchetypeOrFlag(targetKind, resolvedArch, false);
                entity.bossPhase = 1;
                entity.attackState = "idle";
                room.entities.put(targetId, entity);
            }

            if (!targetKind.equals(entity.kind)) return false;
            boolean syncStale = now - entity.lastUpdatedAtMs > 1500L;
            double horizDelta = Math.hypot(hitX - entity.x, hitZ - entity.z);
            double vertDelta = Math.abs(hitY - entity.y);
            if (syncStale && horizDelta <= 24.0 && vertDelta <= 10.0) {
                entity.x = hitX;
                entity.y = hitY;
                entity.z = hitZ;
                entity.lastUpdatedAtMs = now;
            } else if (horizDelta > 6.5 || vertDelta > 5.5) {
                return false;
            }
            if (entity.isDead) return false;

            int actualDamage = Math.min(entity.hp, Math.max(1, damage));
            entity.hp = Math.max(0, entity.hp - damage);
            entity.damageByPlayer.put(attackerId, entity.damageByPlayer.getOrDefault(attackerId, 0) + actualDamage);
            entity.targetPlayerId = attackerId;

            boolean killed = entity.hp <= 0;
            if (killed) {
                entity.isDead = true;
                entity.diedAtMs = now;
            }

            JSONObject bossEncounter = syncBossEncounterFromEntity(entity, attackerId, true, now);

            String damagedEvent = "npc".equals(targetKind) ? "NPC_DAMAGED" : ("animal".equals(targetKind) ? "ANIMAL_DAMAGED" : "ENEMY_DAMAGED");
            String diedEvent = "npc".equals(targetKind) ? "NPC_DIED" : ("animal".equals(targetKind) ? "ANIMAL_DIED" : "ENEMY_DIED");

            JSONObject dmgData = new JSONObject();
            dmgData.put("targetId", targetId);
            dmgData.put("archetype", entity.archetype);
            dmgData.put("attackerId", attackerId);
            dmgData.put("damage", damage);
            dmgData.put("hp", entity.hp);
            dmgData.put("maxHp", entity.maxHp);
            dmgData.put("isCrit", isCritOrHeadshot);
            dmgData.put("isBoss", bossEncounter != null);
            if (bossEncounter != null) dmgData.put("bossPhase", bossEncounter.optInt("phase", 1));
            dmgData.put("x", hitX);
            dmgData.put("y", hitY);
            dmgData.put("z", hitZ);
            JSONObject dmgOut = new JSONObject();
            dmgOut.put("event", damagedEvent);
            dmgOut.put("data", dmgData);
            dmgOut.put("actorId", attackerId);
            dmgOut.put("serverTimestamp", now);
            broadcast("GAME_EVENT", attackerId, dmgOut, null);

            if (killed) {
                if ("enemy".equals(targetKind)) {
                    resolveEnemyOrBossLoot(entity, attackerId, now);
                } else if ("animal".equals(targetKind)) {
                    grantProgression(attackerId, 12, 0, "animal_hunted");
                }
                JSONObject diedData = new JSONObject();
                diedData.put("targetId", targetId);
                diedData.put("archetype", entity.archetype);
                diedData.put("killerId", attackerId);
                if ("enemy".equals(targetKind)) diedData.put("isBoss", bossEncounter != null);
                diedData.put("x", entity.x);
                diedData.put("y", entity.y);
                diedData.put("z", entity.z);
                JSONObject diedOut = new JSONObject();
                diedOut.put("event", diedEvent);
                diedOut.put("data", diedData);
                diedOut.put("actorId", attackerId);
                diedOut.put("serverTimestamp", now);
                broadcast("GAME_EVENT", attackerId, diedOut, null);
            }
            return true;
        } catch (Exception e) {
            return false;
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
                        sendTo(playerId, "PLAYER_VITALS", buildPlayerVitalsPayload(player));
                        sendTo(playerId, "PROGRESSION_UPDATED", buildProgressionPayload(player, "reconnect"));
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
                        for (Map.Entry<String, PlayerRecord> entry : room.players.entrySet()) {
                            String pid = entry.getKey();
                            PlayerRecord pl = entry.getValue();
                            sendTo(pid, "PLAYER_VITALS", buildPlayerVitalsPayload(pl));
                            sendTo(pid, "PROGRESSION_UPDATED", buildProgressionPayload(pl, "start_game"));
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
                        double rx = Math.round(x * 1000.0) / 1000.0;
                        double ry = Math.round(y * 1000.0) / 1000.0;
                        double rz = Math.round(z * 1000.0) / 1000.0;
                        double ryaw = Math.round(payload.optDouble("yaw", 0.0) * 1000.0) / 1000.0;
                        player.posX = rx;
                        player.posY = ry;
                        player.posZ = rz;
                        player.posYaw = ryaw;
                        JSONObject flat = new JSONObject();
                        flat.put("x", rx);
                        flat.put("y", ry);
                        flat.put("z", rz);
                        flat.put("yaw", ryaw);
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
                        if (!"in-game".equals(room.status)) return;
                        JSONArray entitiesArr = payload.optJSONArray("entities");
                        if (entitiesArr == null) return;
                        long now = System.currentTimeMillis();
                        JSONArray relayedEntities = new JSONArray();

                        for (int i = 0; i < entitiesArr.length(); i++) {
                            JSONObject delta = entitiesArr.optJSONObject(i);
                            if (delta == null) continue;
                            String entId = delta.optString("id", "");
                            String kind = delta.optString("kind", "");
                            if (entId.isEmpty() || (!"enemy".equals(kind) && !"animal".equals(kind) && !"npc".equals(kind))) continue;
                            String archetype = sanitizeText(delta.optString("archetype", "default"), 48, "default");
                            int capMaxHp = resolveEntityMaxHp(kind, archetype);
                            boolean isBoss = isBossArchetypeOrFlag(kind, archetype, delta.optBoolean("isBoss", false));
                            double dx = delta.optDouble("x", 0.0);
                            double dy = delta.optDouble("y", 0.0);
                            double dz = delta.optDouble("z", 0.0);
                            if (Double.isNaN(dx)) dx = 0.0;
                            if (Double.isNaN(dy)) dy = 0.0;
                            if (Double.isNaN(dz)) dz = 0.0;
                            double dyaw = delta.optDouble("yaw", 0.0);
                            if (Double.isNaN(dyaw)) dyaw = 0.0;
                            String dstate = sanitizeText(delta.optString("state", "idle"), 32, "idle");

                            EntityRecord tracked = room.entities.get(entId);
                            if (tracked == null) {
                                int initMaxHp = delta.has("maxHp")
                                        ? Math.max(1, Math.min(capMaxHp, (int) Math.round(delta.optDouble("maxHp", capMaxHp))))
                                        : capMaxHp;
                                int initHp = delta.has("hp")
                                        ? Math.max(0, Math.min(initMaxHp, (int) Math.round(delta.optDouble("hp", initMaxHp))))
                                        : initMaxHp;
                                boolean deadInit = delta.optBoolean("isDead", false) || initHp <= 0;

                                tracked = new EntityRecord();
                                tracked.id = entId;
                                tracked.kind = kind;
                                tracked.archetype = archetype;
                                tracked.maxHp = initMaxHp;
                                tracked.hp = deadInit ? 0 : initHp;
                                tracked.isDead = deadInit;
                                tracked.diedAtMs = deadInit ? now : 0;
                                tracked.x = dx;
                                tracked.y = dy;
                                tracked.z = dz;
                                tracked.yaw = dyaw;
                                tracked.state = dstate;
                                tracked.lastUpdatedAtMs = now;
                                tracked.killSeq = 0;
                                if (delta.has("targetPlayerId") && !delta.isNull("targetPlayerId")) {
                                    tracked.targetPlayerId = delta.optString("targetPlayerId", null);
                                }
                                if (isBoss) {
                                    tracked.isBoss = true;
                                    tracked.bossPhase = delta.optInt("bossPhase", 1);
                                }
                                if (delta.has("attackState") && !delta.isNull("attackState")) tracked.attackState = delta.optString("attackState", null);
                                if (delta.has("dialogueState") && !delta.isNull("dialogueState")) tracked.dialogueState = delta.optString("dialogueState", null);
                                if (delta.has("dialoguePlayerId") && !delta.isNull("dialoguePlayerId")) tracked.dialoguePlayerId = delta.optString("dialoguePlayerId", null);
                                if (delta.has("questState") && !delta.isNull("questState")) tracked.questState = delta.optString("questState", null);
                                if (delta.has("schedulePeriod") && !delta.isNull("schedulePeriod")) tracked.schedulePeriod = delta.optString("schedulePeriod", null);
                                if (delta.has("worldId") && !delta.isNull("worldId")) tracked.worldId = delta.optString("worldId", null);
                                if (delta.has("chunkId") && !delta.isNull("chunkId")) tracked.chunkId = delta.optString("chunkId", null);
                                if (delta.has("loaded")) tracked.loaded = delta.optBoolean("loaded", true);
                                if (delta.optJSONObject("questTarget") != null) tracked.questTarget = delta.optJSONObject("questTarget");
                                room.entities.put(entId, tracked);
                            } else {
                                tracked.x = dx;
                                tracked.y = dy;
                                tracked.z = dz;
                                tracked.yaw = dyaw;
                                tracked.state = dstate;
                                tracked.lastUpdatedAtMs = now;
                                if (delta.has("worldId") && !delta.isNull("worldId")) tracked.worldId = delta.optString("worldId", null);
                                if (delta.has("chunkId") && !delta.isNull("chunkId")) tracked.chunkId = delta.optString("chunkId", null);
                                if (delta.has("loaded")) tracked.loaded = delta.optBoolean("loaded", true);
                                if (delta.optJSONObject("questTarget") != null) {
                                    JSONObject qt = new JSONObject(delta.optJSONObject("questTarget").toString());
                                    if (tracked.isDead) qt.put("lifecycle", "DEFEATED");
                                    tracked.questTarget = qt;
                                }
                                if (delta.has("targetPlayerId") && !delta.isNull("targetPlayerId")) {
                                    tracked.targetPlayerId = delta.optString("targetPlayerId", null);
                                } else if ("enemy".equals(kind) && "patrol".equals(dstate)) {
                                    tracked.targetPlayerId = null;
                                }
                                if (isBoss) {
                                    tracked.isBoss = true;
                                    if (delta.has("attackState") && !delta.isNull("attackState")) tracked.attackState = delta.optString("attackState", null);
                                }
                                if ("npc".equals(kind)) {
                                    if (delta.has("dialogueState") && !delta.isNull("dialogueState")) tracked.dialogueState = delta.optString("dialogueState", null);
                                    if (delta.has("dialoguePlayerId") && !delta.isNull("dialoguePlayerId")) tracked.dialoguePlayerId = delta.optString("dialoguePlayerId", null);
                                    if (delta.has("questState") && !delta.isNull("questState")) tracked.questState = delta.optString("questState", null);
                                    if (delta.has("schedulePeriod") && !delta.isNull("schedulePeriod")) tracked.schedulePeriod = delta.optString("schedulePeriod", null);
                                }
                                if (tracked.isDead
                                        && delta.has("isDead")
                                        && !delta.optBoolean("isDead", true)
                                        && (!delta.has("hp") || delta.optDouble("hp", 1.0) > 0)
                                        && now - tracked.diedAtMs >= 15000L) {
                                    tracked.isDead = false;
                                    tracked.hp = tracked.maxHp;
                                    tracked.diedAtMs = 0;
                                    tracked.damageByPlayer.clear();
                                }
                            }

                            if (tracked.isDead && tracked.questTarget != null) {
                                tracked.questTarget.put("lifecycle", "DEFEATED");
                            }
                            if (isBoss) {
                                syncBossEncounterFromEntity(tracked, tracked.targetPlayerId, true, now);
                            }

                            JSONObject relayed = new JSONObject(delta.toString());
                            relayed.put("hp", tracked.hp);
                            relayed.put("maxHp", tracked.maxHp);
                            relayed.put("isDead", tracked.isDead);
                            relayed.put("alive", !tracked.isDead);
                            relayed.put("loaded", tracked.loaded != null ? tracked.loaded : true);
                            if (tracked.worldId != null) relayed.put("worldId", tracked.worldId);
                            if (tracked.chunkId != null) relayed.put("chunkId", tracked.chunkId);
                            if (tracked.questTarget != null) relayed.put("questTarget", tracked.questTarget);
                            if (tracked.isBoss) {
                                relayed.put("isBoss", true);
                                relayed.put("bossPhase", tracked.bossPhase);
                            }
                            if (tracked.targetPlayerId != null) relayed.put("targetPlayerId", tracked.targetPlayerId);
                            if (tracked.attackState != null) relayed.put("attackState", tracked.attackState);
                            if (tracked.dialogueState != null) relayed.put("dialogueState", tracked.dialogueState);
                            if (tracked.dialoguePlayerId != null) relayed.put("dialoguePlayerId", tracked.dialoguePlayerId);
                            if (tracked.questState != null) relayed.put("questState", tracked.questState);
                            if (tracked.schedulePeriod != null) relayed.put("schedulePeriod", tracked.schedulePeriod);
                            relayedEntities.put(relayed);
                        }

                        JSONObject worldTime = materializeWorldTime(now);
                        JSONObject syncOut = new JSONObject();
                        syncOut.put("entities", relayedEntities);
                        syncOut.put("worldHours", worldTime.optDouble("worldHours", 8.5));
                        syncOut.put("weather", room.worldWeather.optString("currentState", "clear"));
                        broadcast("ENTITY_SYNC", playerId, syncOut, playerId);
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
                    case "ENEMY_ATTACK_PLAYER": {
                        if (!"in-game".equals(room.status)) return;
                        if (!playerId.equals(room.hostId)) {
                            JSONObject err = new JSONObject();
                            err.put("code", "FORBIDDEN_HOST_ONLY");
                            err.put("message", "Only the room host can submit NPC/enemy attacks.");
                            sendTo(playerId, "ERROR", err);
                            return;
                        }
                        if ("creative".equals(room.worldType)) return;
                        String targetPlayerId = payload.optString("targetPlayerId", "");
                        String sourceId = payload.optString("sourceId", "");
                        double rawDamage = payload.optDouble("damage", Double.NaN);
                        if (targetPlayerId.isEmpty() || sourceId.isEmpty() || Double.isNaN(rawDamage)) return;
                        PlayerRecord targetPlayer = room.players.get(targetPlayerId);
                        if (targetPlayer == null || targetPlayer.isDead) return;

                        long now = System.currentTimeMillis();
                        long lastSrcHit = targetPlayer.lastEnemyAttackAtBySource.getOrDefault(sourceId, 0L);
                        if (now - lastSrcHit < 650L) return;

                        EntityRecord sourceEntity = room.entities.get(sourceId);
                        if (sourceEntity != null && sourceEntity.isDead) return;

                        String resolvedArchetype = sourceEntity != null
                                ? sourceEntity.archetype
                                : payload.optString("archetype", "default");
                        int maxArchetypeDamage = LAN_ENEMY_ATTACK_MAX_DAMAGE.getOrDefault(resolvedArchetype, 30);
                        int damage = Math.max(1, Math.min(maxArchetypeDamage, (int) Math.round(rawDamage)));

                        if (payload.has("x") && payload.has("z")) {
                            double ax = payload.optDouble("x", Double.NaN);
                            double az = payload.optDouble("z", Double.NaN);
                            if (!Double.isNaN(ax) && !Double.isNaN(az)) {
                                boolean isBossSource = (sourceEntity != null && sourceEntity.isBoss) || "ancient_guardian".equals(resolvedArchetype);
                                double maxReach = isBossSource ? 13.5 : 9.5;
                                if (Math.hypot(ax - targetPlayer.posX, az - targetPlayer.posZ) > maxReach) return;
                                if (sourceEntity != null) {
                                    sourceEntity.targetPlayerId = targetPlayerId;
                                    if (isBossSource) {
                                        syncBossEncounterFromEntity(sourceEntity, targetPlayerId, true, now);
                                    }
                                }
                            }
                        }

                        targetPlayer.lastEnemyAttackAtBySource.put(sourceId, now);
                        targetPlayer.health = Math.max(0, targetPlayer.health - damage);
                        targetPlayer.lastDamageAtMs = now;
                        if (targetPlayer.health <= 0) {
                            targetPlayer.isDead = true;
                            targetPlayer.reviveAtMs = now + 2000L;
                        }
                        if (targetPlayer.state != null) {
                            targetPlayer.state.put("health", targetPlayer.health);
                            targetPlayer.state.put("isDead", targetPlayer.isDead);
                        }
                        broadcast("PLAYER_VITALS", targetPlayerId, buildPlayerVitalsPayload(targetPlayer), null);
                        if (targetPlayer.isDead) {
                            JSONObject pd = new JSONObject();
                            pd.put("playerId", targetPlayerId);
                            pd.put("killerId", sourceId);
                            pd.put("displayName", targetPlayer.displayName);
                            pd.put("x", targetPlayer.posX);
                            pd.put("y", targetPlayer.posY);
                            pd.put("z", targetPlayer.posZ);
                            JSONObject env = new JSONObject();
                            env.put("event", "PLAYER_DIED");
                            env.put("data", pd);
                            env.put("actorId", playerId);
                            env.put("serverTimestamp", now);
                            broadcast("GAME_EVENT", playerId, env, null);
                        }
                        break;
                    }
                    case "REPAIR_WEAPONS": {
                        if (!"in-game".equals(room.status)) return;
                        double rawCost = payload.optDouble("costCoins", Double.NaN);
                        if (Double.isNaN(rawCost) || rawCost <= 0) return;
                        int cost = "creative".equals(room.worldType) ? 0 : Math.max(1, Math.min(500, (int) Math.round(rawCost)));
                        if (player.coins < cost) {
                            JSONObject err = new JSONObject();
                            err.put("code", "INSUFFICIENT_COINS");
                            err.put("message", "Not enough coins to repair weapons.");
                            sendTo(playerId, "ERROR", err);
                            return;
                        }
                        grantProgression(playerId, 0, -cost, "weapons_repaired");
                        break;
                    }
                    case "GAME_EVENT": {
                        String ev = payload.optString("event", "");
                        if (ev.isEmpty() || !"in-game".equals(room.status)) return;
                        if (ev.length() > 64) ev = ev.substring(0, 64);
                        JSONObject eventData = payload.optJSONObject("data");
                        if (eventData == null) eventData = new JSONObject();
                        long now = System.currentTimeMillis();

                        if ("player:damage-taken".equals(ev)) {
                            if ("creative".equals(room.worldType) || player.isDead) return;
                            if (now - player.lastDamageAtMs < 240L) return;
                            double rawAmount = eventData.optDouble("amount", 0.0);
                            if (Double.isNaN(rawAmount) || Double.isInfinite(rawAmount)) rawAmount = 0.0;
                            int clampedDamage = Math.max(1, Math.min(55, (int) Math.round(rawAmount)));
                            player.health = Math.max(0, player.health - clampedDamage);
                            player.lastDamageAtMs = now;
                            if (player.health <= 0) {
                                player.isDead = true;
                                player.reviveAtMs = now + 2000L;
                            }
                            if (player.state != null) {
                                player.state.put("health", player.health);
                                player.state.put("isDead", player.isDead);
                            }
                            broadcast("PLAYER_VITALS", playerId, buildPlayerVitalsPayload(player), null);
                            if (player.isDead) {
                                JSONObject pd = new JSONObject();
                                pd.put("playerId", playerId);
                                pd.put("displayName", player.displayName);
                                pd.put("x", player.posX);
                                pd.put("y", player.posY);
                                pd.put("z", player.posZ);
                                JSONObject out = new JSONObject();
                                out.put("event", "PLAYER_DIED");
                                out.put("data", pd);
                                out.put("actorId", playerId);
                                out.put("serverTimestamp", now);
                                broadcast("GAME_EVENT", playerId, out, null);
                            }
                            break;
                        }

                        if ("player:respawn".equals(ev)) {
                            double spawnX = 0;
                            double spawnY = 0;
                            double spawnZ = 4;
                            player.health = player.maxHealth;
                            player.isDead = false;
                            player.reviveAtMs = null;
                            player.posX = spawnX;
                            player.posY = spawnY;
                            player.posZ = spawnZ;
                            if (player.state != null) {
                                player.state.put("x", spawnX);
                                player.state.put("y", spawnY);
                                player.state.put("z", spawnZ);
                                player.state.put("health", player.health);
                                player.state.put("isDead", false);
                            }
                            broadcast("PLAYER_VITALS", playerId, buildPlayerVitalsPayload(player), null);
                            JSONObject corr = new JSONObject();
                            corr.put("x", spawnX);
                            corr.put("y", spawnY);
                            corr.put("z", spawnZ);
                            corr.put("yaw", player.posYaw);
                            corr.put("reason", "RESPAWN");
                            sendTo(playerId, "POSITION_CORRECTION", corr);
                            break;
                        }

                        if ("ARROW_FIRED".equals(ev)) {
                            if (player.isDead) return;
                            String weaponId = eventData.optString("weaponId", "");
                            if (weaponId.isEmpty()) weaponId = "hunter-bow";
                            WeaponSpec spec = LAN_WEAPON_SPECS.get(weaponId);
                            if (spec == null || !spec.isRanged) {
                                JSONObject err = new JSONObject();
                                err.put("code", "INVALID_WEAPON");
                                err.put("message", "Weapon is not a ranged projectile weapon.");
                                sendTo(playerId, "ERROR", err);
                                return;
                            }
                            if (now - player.lastAttackAtMs < (long) (spec.cooldownMs * 0.65)) {
                                JSONObject err = new JSONObject();
                                err.put("code", "WEAPON_COOLDOWN");
                                err.put("message", "Bow fire rate exceeds weapon cooldown.");
                                sendTo(playerId, "ERROR", err);
                                return;
                            }
                            double originX = eventData.has("originX") && !Double.isNaN(eventData.optDouble("originX", Double.NaN))
                                    ? eventData.optDouble("originX") : player.posX;
                            double originY = eventData.has("originY") && !Double.isNaN(eventData.optDouble("originY", Double.NaN))
                                    ? eventData.optDouble("originY") : (player.posY + 1.45);
                            double originZ = eventData.has("originZ") && !Double.isNaN(eventData.optDouble("originZ", Double.NaN))
                                    ? eventData.optDouble("originZ") : player.posZ;
                            if (Math.hypot(originX - player.posX, originZ - player.posZ) > 4.2
                                    || Math.abs(originY - (player.posY + 1.45)) > 3.5) {
                                JSONObject err = new JSONObject();
                                err.put("code", "INVALID_ORIGIN");
                                err.put("message", "Arrow launch origin too far from player position.");
                                sendTo(playerId, "ERROR", err);
                                return;
                            }
                            double rawDirX = eventData.optDouble("dirX", 0.0);
                            double rawDirY = eventData.optDouble("dirY", 0.0);
                            double rawDirZ = eventData.optDouble("dirZ", 1.0);
                            double dirLen = Math.sqrt(rawDirX * rawDirX + rawDirY * rawDirY + rawDirZ * rawDirZ);
                            if (Double.isNaN(rawDirX) || Double.isNaN(rawDirY) || Double.isNaN(rawDirZ) || dirLen < 0.5 || dirLen > 1.5) {
                                JSONObject err = new JSONObject();
                                err.put("code", "INVALID_DIRECTION");
                                err.put("message", "Projectile launch direction vector is invalid.");
                                sendTo(playerId, "ERROR", err);
                                return;
                            }
                            double dirX = Math.round((rawDirX / dirLen) * 1000.0) / 1000.0;
                            double dirY = Math.round((rawDirY / dirLen) * 1000.0) / 1000.0;
                            double dirZ = Math.round((rawDirZ / dirLen) * 1000.0) / 1000.0;
                            String arrowId = eventData.optString("arrowId", "");
                            if (arrowId.isEmpty()) arrowId = "arr_" + playerId + "_" + now;
                            if (arrowId.length() > 48) arrowId = arrowId.substring(0, 48);
                            if (room.activeArrows.containsKey(arrowId)) {
                                JSONObject err = new JSONObject();
                                err.put("code", "DUPLICATE_ARROW_ID");
                                err.put("message", "Arrow network ID already exists.");
                                sendTo(playerId, "ERROR", err);
                                return;
                            }
                            double charge = eventData.optDouble("bowCharge", 1.0);
                            if (Double.isNaN(charge) || Double.isInfinite(charge)) charge = 1.0;
                            charge = Math.max(0.0, Math.min(1.0, charge));
                            double speed = spec.minSpeed + charge * (spec.maxSpeed - spec.minSpeed);
                            double gravity = spec.gravity;
                            player.lastAttackAtMs = now;

                            if (room.activeArrows.size() > 160) {
                                List<String> expired = new ArrayList<>();
                                for (Map.Entry<String, ActiveArrowRecord> ae : room.activeArrows.entrySet()) {
                                    if (ae.getValue().consumed || now - ae.getValue().createdAtMs > 6000L) {
                                        expired.add(ae.getKey());
                                    }
                                }
                                for (String ek : expired) room.activeArrows.remove(ek);
                            }

                            ActiveArrowRecord ar = new ActiveArrowRecord();
                            ar.arrowId = arrowId;
                            ar.shooterId = playerId;
                            ar.weaponId = weaponId;
                            ar.charge = charge;
                            ar.originX = originX;
                            ar.originY = originY;
                            ar.originZ = originZ;
                            ar.dirX = dirX;
                            ar.dirY = dirY;
                            ar.dirZ = dirZ;
                            ar.speed = speed;
                            ar.gravity = gravity;
                            ar.createdAtMs = now;
                            ar.consumed = false;
                            room.activeArrows.put(arrowId, ar);

                            JSONObject outData = new JSONObject();
                            outData.put("arrowId", arrowId);
                            outData.put("shooterId", playerId);
                            outData.put("weaponId", weaponId);
                            outData.put("originX", originX);
                            outData.put("originY", originY);
                            outData.put("originZ", originZ);
                            outData.put("dirX", dirX);
                            outData.put("dirY", dirY);
                            outData.put("dirZ", dirZ);
                            outData.put("speed", speed);
                            outData.put("gravity", gravity);
                            outData.put("bowCharge", charge);
                            JSONObject out = new JSONObject();
                            out.put("event", "ARROW_FIRED");
                            out.put("data", outData);
                            out.put("actorId", playerId);
                            out.put("serverTimestamp", now);
                            broadcast("GAME_EVENT", playerId, out, null);
                            break;
                        }

                        if ("PROJECTILE_HIT".equals(ev)) {
                            if (player.isDead) return;
                            String arrowId = eventData.optString("arrowId", "");
                            ActiveArrowRecord arrow = room.activeArrows.get(arrowId);
                            if (arrow == null || arrow.consumed || !playerId.equals(arrow.shooterId)) {
                                JSONObject err = new JSONObject();
                                err.put("code", "INVALID_PROJECTILE");
                                err.put("message", "Arrow does not exist or already resolved.");
                                sendTo(playerId, "ERROR", err);
                                return;
                            }
                            if (now - arrow.createdAtMs > 6500L) {
                                room.activeArrows.remove(arrowId);
                                return;
                            }
                            WeaponSpec spec = LAN_WEAPON_SPECS.get(arrow.weaponId);
                            if (spec == null) {
                                room.activeArrows.remove(arrowId);
                                return;
                            }
                            double hitX = eventData.has("x") && !Double.isNaN(eventData.optDouble("x", Double.NaN))
                                    ? eventData.optDouble("x") : arrow.originX;
                            double hitY = eventData.has("y") && !Double.isNaN(eventData.optDouble("y", Double.NaN))
                                    ? eventData.optDouble("y") : arrow.originY;
                            double hitZ = eventData.has("z") && !Double.isNaN(eventData.optDouble("z", Double.NaN))
                                    ? eventData.optDouble("z") : arrow.originZ;
                            double fdx = hitX - arrow.originX;
                            double fdy = hitY - arrow.originY;
                            double fdz = hitZ - arrow.originZ;
                            double flightDist = Math.sqrt(fdx * fdx + fdy * fdy + fdz * fdz);
                            if (flightDist > spec.range + 10.0) {
                                JSONObject err = new JSONObject();
                                err.put("code", "OUT_OF_RANGE");
                                err.put("message", "Projectile hit exceeds maximum weapon range.");
                                sendTo(playerId, "ERROR", err);
                                return;
                            }
                            if (flightDist > 2.0) {
                                double tEst = flightDist / Math.max(8.0, arrow.speed);
                                double dx = hitX - arrow.originX;
                                double dy = hitY - arrow.originY + 0.5 * arrow.gravity * tEst * tEst;
                                double dz = hitZ - arrow.originZ;
                                double compLen = Math.sqrt(dx * dx + dy * dy + dz * dz);
                                if (compLen < 1e-6) compLen = 1.0;
                                double dot = (dx / compLen) * arrow.dirX + (dy / compLen) * arrow.dirY + (dz / compLen) * arrow.dirZ;
                                if (dot < 0.15) {
                                    arrow.consumed = true;
                                    room.activeArrows.remove(arrowId);
                                    JSONObject err = new JSONObject();
                                    err.put("code", "INVALID_PROJECTILE_TRAJECTORY");
                                    err.put("message", "Projectile impact point contradicts launch direction.");
                                    sendTo(playerId, "ERROR", err);
                                    return;
                                }
                            }
                            arrow.consumed = true;
                            room.activeArrows.remove(arrowId);

                            String targetKind = eventData.optString("targetKind", "world");
                            String targetId = eventData.optString("targetId", "");
                            if ("world".equals(targetKind) || targetId.isEmpty()) {
                                JSONObject pd = new JSONObject();
                                pd.put("arrowId", arrowId);
                                pd.put("shooterId", playerId);
                                pd.put("targetKind", "world");
                                pd.put("targetId", "");
                                pd.put("x", hitX);
                                pd.put("y", hitY);
                                pd.put("z", hitZ);
                                pd.put("isHeadshot", false);
                                JSONObject out = new JSONObject();
                                out.put("event", "PROJECTILE_HIT");
                                out.put("data", pd);
                                out.put("actorId", playerId);
                                out.put("serverTimestamp", now);
                                broadcast("GAME_EVENT", playerId, out, null);
                                break;
                            }

                            boolean isHeadshot = false;
                            if (eventData.optBoolean("isHeadshot", false)) {
                                double targetBaseY = 0;
                                if ("player".equals(targetKind)) {
                                    PlayerRecord tp = room.players.get(targetId);
                                    if (tp != null) targetBaseY = tp.posY;
                                } else {
                                    EntityRecord tracked = room.entities.get(targetId);
                                    if (tracked != null) targetBaseY = tracked.y;
                                }
                                isHeadshot = hitY >= targetBaseY + 0.9;
                            }
                            double baseDmg = spec.minDamage + arrow.charge * (spec.maxDamage - spec.minDamage);
                            int damage = Math.max(1, (int) Math.round(baseDmg * (isHeadshot ? spec.headshotMult : 1.0)));

                            boolean applied = applyAuthoritativeDamage(
                                    playerId,
                                    targetKind,
                                    targetId,
                                    eventData.optString("archetype", "default"),
                                    damage,
                                    isHeadshot,
                                    hitX,
                                    hitY,
                                    hitZ,
                                    now
                            );
                            if (applied) {
                                JSONObject pd = new JSONObject();
                                pd.put("arrowId", arrowId);
                                pd.put("shooterId", playerId);
                                pd.put("targetKind", targetKind);
                                pd.put("targetId", targetId);
                                pd.put("x", hitX);
                                pd.put("y", hitY);
                                pd.put("z", hitZ);
                                pd.put("isHeadshot", isHeadshot);
                                JSONObject out = new JSONObject();
                                out.put("event", "PROJECTILE_HIT");
                                out.put("data", pd);
                                out.put("actorId", playerId);
                                out.put("serverTimestamp", now);
                                broadcast("GAME_EVENT", playerId, out, null);
                            }
                            break;
                        }

                        if ("COMBAT_HIT".equals(ev)) {
                            if (player.isDead) {
                                JSONObject err = new JSONObject();
                                err.put("code", "PLAYER_DEAD");
                                err.put("message", "Downed players cannot attack.");
                                sendTo(playerId, "ERROR", err);
                                return;
                            }
                            String weaponId = eventData.optString("weaponId", "");
                            if (weaponId.isEmpty()) weaponId = "unarmed";
                            WeaponSpec spec = LAN_WEAPON_SPECS.get(weaponId);
                            if (spec == null || spec.isRanged) {
                                JSONObject err = new JSONObject();
                                err.put("code", "INVALID_WEAPON");
                                err.put("message", "Invalid melee weapon for COMBAT_HIT.");
                                sendTo(playerId, "ERROR", err);
                                return;
                            }
                            String targetKind = eventData.optString("targetKind", "");
                            String targetId = eventData.optString("targetId", "");
                            if ((!"enemy".equals(targetKind) && !"animal".equals(targetKind) && !"npc".equals(targetKind) && !"player".equals(targetKind))
                                    || targetId.isEmpty()) {
                                return;
                            }
                            String attackId = eventData.optString("attackId", "");
                            if (attackId.length() > 64) attackId = attackId.substring(0, 64);
                            boolean isSameSwingCleave = !attackId.isEmpty()
                                    && attackId.equals(player.lastSwingId)
                                    && weaponId.equals(player.lastSwingWeaponId)
                                    && now - player.lastSwingAtMs <= 320L
                                    && !player.lastSwingTargetIds.contains(targetId)
                                    && player.lastSwingTargetIds.size() < 4;
                            if (!isSameSwingCleave && now - player.lastAttackAtMs < (long) (spec.cooldownMs * 0.65)) {
                                JSONObject err = new JSONObject();
                                err.put("code", "WEAPON_COOLDOWN");
                                err.put("message", "Attack speed exceeds weapon cooldown.");
                                sendTo(playerId, "ERROR", err);
                                return;
                            }
                            double hitX = eventData.has("x") && !Double.isNaN(eventData.optDouble("x", Double.NaN))
                                    ? eventData.optDouble("x") : player.posX;
                            double hitY = eventData.has("y") && !Double.isNaN(eventData.optDouble("y", Double.NaN))
                                    ? eventData.optDouble("y") : player.posY;
                            double hitZ = eventData.has("z") && !Double.isNaN(eventData.optDouble("z", Double.NaN))
                                    ? eventData.optDouble("z") : player.posZ;
                            double distToTarget = Math.hypot(hitX - player.posX, hitZ - player.posZ);
                            if (distToTarget > spec.range + 3.4) {
                                JSONObject err = new JSONObject();
                                err.put("code", "OUT_OF_RANGE");
                                err.put("message", "Target is out of melee reach.");
                                sendTo(playerId, "ERROR", err);
                                return;
                            }
                            if (isSameSwingCleave) {
                                player.lastSwingTargetIds.add(targetId);
                            } else {
                                player.lastAttackAtMs = now;
                                player.lastSwingId = attackId.isEmpty() ? null : attackId;
                                player.lastSwingWeaponId = weaponId;
                                player.lastSwingAtMs = now;
                                player.lastSwingTargetIds.clear();
                                player.lastSwingTargetIds.add(targetId);
                            }
                            boolean isCrit = rng.nextDouble() < spec.critChance;
                            int damage = Math.max(1, (int) Math.round(spec.baseDamage * (isCrit ? spec.critMult : 1.0)));

                            applyAuthoritativeDamage(
                                    playerId,
                                    targetKind,
                                    targetId,
                                    eventData.optString("archetype", "default"),
                                    damage,
                                    isCrit,
                                    hitX,
                                    hitY,
                                    hitZ,
                                    now
                            );
                            break;
                        }

                        recordWorldStateGameEvent(ev, eventData, playerId, now);

                        JSONObject out = new JSONObject();
                        out.put("event", ev);
                        out.put("data", eventData);
                        out.put("actorId", playerId);
                        out.put("serverTimestamp", now);
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
        if (room.modMetadata != null) {
            start.put("modMetadata", new JSONObject(room.modMetadata.toString()));
        }
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
        if (room.modMetadata != null) {
            gameState.put("modMetadata", new JSONObject(room.modMetadata.toString()));
        }
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
