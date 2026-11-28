package com.worldofadventure.game;

import android.Manifest;
import android.content.ContentResolver;
import android.content.Context;
import android.content.SharedPreferences;
import android.content.UriPermission;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.media.MediaScannerConnection;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.DocumentsContract;
import android.provider.OpenableColumns;
import androidx.core.content.ContextCompat;
import android.util.Base64;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Manages user-visible shared Android storage under:
 *   /storage/emulated/0/World of Adventure/
 *     ├── Worlds/<worldId>/
 *     │     ├── world-data.json
 *     │     ├── world-settings.json
 *     │     ├── player-data.json
 *     │     ├── world-state.json
 *     │     └── backups/
 *     ├── Settings/
 *     │     ├── game-settings.json
 *     │     ├── graphics-settings.json
 *     │     ├── audio-settings.json
 *     │     ├── controls-settings.json
 *     │     └── language-settings.json
 *     ├── Profiles/
 *     └── Backups/
 *
 * Supports direct shared storage (MANAGE_EXTERNAL_STORAGE on Android 11+ / legacy
 * WRITE_EXTERNAL_STORAGE on Android 7-10), persisted SAF tree URI fallback, and
 * non-destructive migration from prior app-private storage (getFilesDir()/GameData/Worlds).
 */
public final class AndroidExternalStorageManager {

    public static final String APP_FOLDER_NAME = "World of Adventure";
    public static final String VISIBLE_TARGET_PATH = "/storage/emulated/0/" + APP_FOLDER_NAME + "/";
    public static final String VISIBLE_MODS_PATH = VISIBLE_TARGET_PATH + "Mods/";

    private static final String PREFS_NAME = "woa_android_storage";
    private static final String PREF_SAF_TREE_URI = "saf_tree_uri";
    private static final String PREF_INITIALIZED_ONCE = "initialized_once";
    private static final String PREF_LAST_MODE = "last_storage_mode";
    private static final String PREF_ASKED_PERMISSION_ONCE = "asked_initial_permission";

    private static final String DIR_WORLDS = "Worlds";
    private static final String DIR_SETTINGS = "Settings";
    private static final String DIR_PROFILES = "Profiles";
    private static final String DIR_BACKUPS = "Backups";
    private static final String DIR_MODS = "Mods";
    private static final String DIR_WORLD_BACKUPS = "backups";

    private static final String FILE_WORLD_DATA = "world-data.json";
    private static final String FILE_WORLD_SETTINGS = "world-settings.json";
    private static final String FILE_LEGACY_WORLD_SETTINGS = "settings.json";
    private static final String FILE_PLAYER_DATA = "player-data.json";
    private static final String FILE_WORLD_STATE = "world-state.json";
    private static final String FILE_PROFILE = "profile.json";
    private static final String FILE_MODS_CONFIG = "mods-config.json";

    private static final List<String> STANDARD_MOD_FOLDERS = Arrays.asList(
        "assets",
        "models",
        "textures",
        "sounds",
        "music",
        "items",
        "weapons",
        "armor",
        "tools",
        "consumables",
        "resources",
        "recipes",
        "characters",
        "animals",
        "creatures",
        "monsters",
        "npcs",
        "buildings",
        "decorations",
        "quests",
        "loot_tables",
        "localization",
        "spawns",
        "events"
    );

    private static final Set<String> MOD_CONTENT_FOLDERS = new HashSet<>(Arrays.asList(
        "items",
        "weapons",
        "armor",
        "tools",
        "consumables",
        "resources",
        "recipes",
        "characters",
        "animals",
        "creatures",
        "monsters",
        "npcs",
        "buildings",
        "decorations",
        "quests",
        "loot_tables",
        "localization",
        "spawns",
        "events"
    ));

    private static final Set<String> MOD_ASSET_FOLDERS = new HashSet<>(Arrays.asList(
        "assets",
        "models",
        "textures",
        "sounds",
        "music"
    ));

    private static String normalizeModFolderCategory(String rawFolder) {
        if (rawFolder == null) return "";
        String lower = rawFolder.trim().toLowerCase(Locale.ROOT);
        if ("spawn_locations".equals(lower)
            || "world_spawns".equals(lower)
            || "spawn_points".equals(lower)
            || "locations".equals(lower)
            || "placements".equals(lower)) {
            return "spawns";
        }
        return lower;
    }

    private static final String CURRENT_GAME_VERSION = "1.1.25";
    private static final Set<Integer> SUPPORTED_MOD_SCHEMA_VERSIONS = new HashSet<>(Arrays.asList(1, 2));
    private static final String FILE_WOAMOD_META = ".woamod-package.json";
    private static final String STAGING_DIR_PREFIX = ".woamod-staging-";

    private static final Set<String> FORBIDDEN_MOD_EXTENSIONS = new HashSet<>(Arrays.asList(
        ".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx", ".py", ".rb", ".pl", ".lua",
        ".sh", ".bash", ".zsh", ".bat", ".cmd", ".ps1", ".vbs", ".vbe", ".wsf", ".wsh",
        ".exe", ".msi", ".com", ".scr", ".pif", ".lnk", ".dll", ".so", ".dylib",
        ".sys", ".drv", ".ocx", ".cpl", ".node", ".dex", ".jar", ".apk", ".aab",
        ".class", ".wasm", ".php", ".html", ".htm", ".svg"
    ));

    private static final Map<String, String> ALLOWED_MOD_ASSET_MIME = createAllowedModMimeMap();

    private static Map<String, String> createAllowedModMimeMap() {
        Map<String, String> map = new HashMap<>();
        map.put(".json", "application/json");
        map.put(".txt", "text/plain");
        map.put(".png", "image/png");
        map.put(".jpg", "image/jpeg");
        map.put(".jpeg", "image/jpeg");
        map.put(".webp", "image/webp");
        map.put(".avif", "image/avif");
        map.put(".ogg", "audio/ogg");
        map.put(".mp3", "audio/mpeg");
        map.put(".wav", "audio/wav");
        map.put(".m4a", "audio/mp4");
        map.put(".glb", "model/gltf-binary");
        map.put(".gltf", "model/gltf+json");
        map.put(".obj", "text/plain");
        map.put(".mtl", "text/plain");
        map.put(".bin", "application/octet-stream");
        map.put(".woa3d", "application/json");
        return map;
    }

    private static final int MAX_MOD_ENTRIES = 1200;
    private static final int MAX_MOD_JSON_BYTES = 2 * 1024 * 1024;
    private static final int MAX_MOD_ASSET_BYTES = 32 * 1024 * 1024;
    private static final int MAX_MOD_PACKAGE_BYTES = 150 * 1024 * 1024;
    private static final long MAX_MOD_TOTAL_UNCOMPRESSED = 300L * 1024L * 1024L;

    public interface ModInstallProgressListener {
        void onProgress(String progressJson);
    }

    private final Context appContext;
    private final Object lock = new Object();
    private boolean externalWritableVerified = false;
    private int migratedWorldsCount = 0;
    private String lastError = null;

    public AndroidExternalStorageManager(Context context) {
        this.appContext = context.getApplicationContext();
    }

    public boolean hasAskedInitialPermission() {
        return getPrefs().getBoolean(PREF_ASKED_PERMISSION_ONCE, false);
    }

    public void markAskedInitialPermission() {
        getPrefs().edit().putBoolean(PREF_ASKED_PERMISSION_ONCE, true).apply();
    }

    private SharedPreferences getPrefs() {
        return appContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
    }

    private File getDirectRootDir() {
        File ext = Environment.getExternalStorageDirectory();
        if (ext == null) {
            return new File("/storage/emulated/0", APP_FOLDER_NAME);
        }
        return new File(ext, APP_FOLDER_NAME);
    }

    private File getPrivateWorldsRootDir() {
        File gameData = new File(appContext.getFilesDir(), "GameData");
        return new File(gameData, DIR_WORLDS);
    }

    public boolean hasDirectSharedStoragePermission() {
        String extState = Environment.getExternalStorageState();
        if (!Environment.MEDIA_MOUNTED.equals(extState)) {
            return false;
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            return Environment.isExternalStorageManager();
        }
        boolean writeGranted =
            ContextCompat.checkSelfPermission(
                appContext,
                Manifest.permission.WRITE_EXTERNAL_STORAGE
            ) == PackageManager.PERMISSION_GRANTED;
        boolean readGranted =
            ContextCompat.checkSelfPermission(
                appContext,
                Manifest.permission.READ_EXTERNAL_STORAGE
            ) == PackageManager.PERMISSION_GRANTED;
        if (!writeGranted || !readGranted) {
            return false;
        }
        if (Build.VERSION.SDK_INT == Build.VERSION_CODES.Q) {
            return Environment.isExternalStorageLegacy();
        }
        return true;
    }

    public Uri getPersistedSafTreeUri() {
        String raw = getPrefs().getString(PREF_SAF_TREE_URI, null);
        if (raw == null || raw.trim().isEmpty()) return null;
        try {
            Uri treeUri = Uri.parse(raw);
            List<UriPermission> perms = appContext.getContentResolver().getPersistedUriPermissions();
            for (UriPermission perm : perms) {
                if (perm.getUri().equals(treeUri) && perm.isReadPermission() && perm.isWritePermission()) {
                    return treeUri;
                }
            }
        } catch (Exception ignored) {
        }
        return null;
    }

    public boolean saveSafTreeUri(Uri treeUri) {
        if (treeUri == null) return false;
        synchronized (lock) {
            try {
                getPrefs()
                    .edit()
                    .putString(PREF_SAF_TREE_URI, treeUri.toString())
                    .apply();
                externalWritableVerified = false;
                ensureInitializedAndMigrateLocked();
                return externalWritableVerified;
            } catch (Exception e) {
                lastError = e.getMessage();
                return false;
            }
        }
    }

    private String sanitizeWorldId(String worldId) {
        if (worldId == null) return null;
        String trimmed = worldId.trim();
        if (!trimmed.matches("^[A-Za-z0-9_-]{1,80}$")) return null;
        if (".".equals(trimmed) || "..".equals(trimmed)) return null;
        return trimmed;
    }

    private String resolveSettingsFileName(String settingKey) {
        if ("game".equals(settingKey)) return "game-settings.json";
        if ("graphics".equals(settingKey)) return "graphics-settings.json";
        if ("audio".equals(settingKey)) return "audio-settings.json";
        if ("controls".equals(settingKey)) return "controls-settings.json";
        if ("language".equals(settingKey)) return "language-settings.json";
        if ("mods".equals(settingKey)) return FILE_MODS_CONFIG;
        return null;
    }

    private String sanitizeModSourceId(String sourceId) {
        if (sourceId == null) return null;
        String trimmed = sourceId.trim();
        if (trimmed.isEmpty() || ".".equals(trimmed) || "..".equals(trimmed)) return null;
        if (trimmed.contains("/") || trimmed.contains("\\") || trimmed.indexOf('\0') >= 0) return null;
        if (!trimmed.matches("^[A-Za-z0-9._ -]{1,120}$")) return null;
        return trimmed;
    }

    private String sanitizeModRelativePath(String relPath) {
        if (relPath == null) return null;
        String normalized = relPath.replace('\\', '/').replaceAll("^/+", "").trim();
        if (normalized.isEmpty() || normalized.indexOf('\0') >= 0) return null;
        String[] segments = normalized.split("/");
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < segments.length; i++) {
            String seg = segments[i];
            if (seg.isEmpty() || ".".equals(seg) || "..".equals(seg)) return null;
            if (i > 0) sb.append('/');
            sb.append(seg);
        }
        return sb.toString();
    }

    private boolean isArchiveModFileName(String name) {
        if (name == null) return false;
        String lower = name.toLowerCase(Locale.ROOT);
        return lower.endsWith(".zip") || lower.endsWith(".woamod");
    }

    private String getLowerExtension(String name) {
        if (name == null) return "";
        int slash = name.lastIndexOf('/');
        int dot = name.lastIndexOf('.');
        if (dot <= slash || dot < 0) return "";
        return name.substring(dot).toLowerCase(Locale.ROOT);
    }

    private boolean isCanonicalChild(File rootDir, File target) {
        try {
            String rootCanon = rootDir.getCanonicalPath();
            String targetCanon = target.getCanonicalPath();
            String prefix = rootCanon.endsWith(File.separator) ? rootCanon : rootCanon + File.separator;
            return targetCanon.startsWith(prefix);
        } catch (IOException e) {
            return false;
        }
    }

    // ---------- Direct java.io.File helpers ----------

    private String readFileUtf8(File file) throws IOException {
        try (FileInputStream fis = new FileInputStream(file);
             ByteArrayOutputStream baos = new ByteArrayOutputStream()) {
            byte[] buf = new byte[8192];
            int n;
            while ((n = fis.read(buf)) != -1) {
                baos.write(buf, 0, n);
            }
            return new String(baos.toByteArray(), StandardCharsets.UTF_8);
        }
    }

    private JSONObject parseValidJsonObject(String raw) {
        if (raw == null || raw.trim().isEmpty()) return null;
        try {
            return new JSONObject(raw);
        } catch (Exception e) {
            return null;
        }
    }

    private void scanMediaFile(File file) {
        if (file == null) return;
        try {
            MediaScannerConnection.scanFile(
                appContext,
                new String[] { file.getAbsolutePath() },
                null,
                null
            );
        } catch (Exception ignored) {
        }
    }

    private void writeJsonDirectAtomic(File targetFile, File backupDir, String backupName, JSONObject payload)
        throws Exception {
        if (payload == null) {
            throw new IllegalArgumentException("Null JSON payload");
        }
        String serialized = payload.toString(2);
        // Validate JSON round-trip before touching disk
        new JSONObject(serialized);

        File parent = targetFile.getParentFile();
        if (parent != null && !parent.exists() && !parent.mkdirs()) {
            if (!parent.exists()) {
                throw new IOException("Unable to create folder: " + parent.getAbsolutePath());
            }
        }
        if (backupDir != null && !backupDir.exists()) {
            backupDir.mkdirs();
        }

        // Preserve previous valid file in backup directory before replacing
        if (targetFile.exists() && targetFile.isFile() && backupDir != null) {
            try {
                String prevRaw = readFileUtf8(targetFile);
                if (parseValidJsonObject(prevRaw) != null) {
                    File bakFile = new File(backupDir, backupName + ".bak");
                    File bakTmp = new File(backupDir, backupName + ".bak.tmp");
                    byte[] prevBytes = prevRaw.getBytes(StandardCharsets.UTF_8);
                    try (FileOutputStream bfos = new FileOutputStream(bakTmp, false)) {
                        bfos.write(prevBytes);
                        bfos.flush();
                        bfos.getFD().sync();
                    }
                    if (bakFile.exists()) {
                        bakFile.delete();
                    }
                    bakTmp.renameTo(bakFile);
                }
            } catch (Exception ignored) {
                // Keep any older valid backup if existing primary cannot be read
            }
        }

        File tmpFile = new File(parent, targetFile.getName() + ".tmp");
        byte[] bytes = serialized.getBytes(StandardCharsets.UTF_8);
        try (FileOutputStream fos = new FileOutputStream(tmpFile, false)) {
            fos.write(bytes);
            fos.flush();
            fos.getFD().sync();
        }

        // Verify tmp file written cleanly before replacing target
        JSONObject check = parseValidJsonObject(readFileUtf8(tmpFile));
        if (check == null) {
            tmpFile.delete();
            throw new IOException("Verification failed for temporary file: " + tmpFile.getName());
        }

        if (targetFile.exists()) {
            if (!tmpFile.renameTo(targetFile)) {
                if (!targetFile.delete() || !tmpFile.renameTo(targetFile)) {
                    throw new IOException("Unable to replace target file: " + targetFile.getName());
                }
            }
        } else if (!tmpFile.renameTo(targetFile)) {
            throw new IOException("Unable to commit target file: " + targetFile.getName());
        }

        scanMediaFile(targetFile);
    }

    private JSONObject readJsonDirectWithBackups(File primary, File... fallbacks) {
        if (primary != null && primary.exists() && primary.isFile()) {
            try {
                JSONObject parsed = parseValidJsonObject(readFileUtf8(primary));
                if (parsed != null) return parsed;
            } catch (Exception ignored) {
            }
        }
        if (fallbacks != null) {
            for (File candidate : fallbacks) {
                if (candidate == null || !candidate.exists() || !candidate.isFile()) continue;
                try {
                    JSONObject parsed = parseValidJsonObject(readFileUtf8(candidate));
                    if (parsed != null) {
                        // Heal primary from valid backup if writable
                        try {
                            if (primary != null) {
                                writeJsonDirectAtomic(primary, null, primary.getName(), parsed);
                            }
                        } catch (Exception ignored) {
                        }
                        return parsed;
                    }
                } catch (Exception ignored) {
                }
            }
        }
        return null;
    }

    private void deleteRecursiveDirect(File target) {
        if (target == null || !target.exists()) return;
        if (target.isDirectory()) {
            File[] children = target.listFiles();
            if (children != null) {
                for (File child : children) {
                    deleteRecursiveDirect(child);
                }
            }
        }
        target.delete();
    }

    // ---------- SAF (DocumentsContract) helpers ----------

    private String findSafChildDocId(Uri treeUri, String parentDocId, String displayName) {
        ContentResolver cr = appContext.getContentResolver();
        Uri childrenUri = DocumentsContract.buildChildDocumentsUriUsingTree(treeUri, parentDocId);
        String[] projection = new String[] {
            DocumentsContract.Document.COLUMN_DOCUMENT_ID,
            DocumentsContract.Document.COLUMN_DISPLAY_NAME,
            DocumentsContract.Document.COLUMN_MIME_TYPE,
        };
        try (Cursor c = cr.query(childrenUri, projection, null, null, null)) {
            if (c == null) return null;
            int idIdx = c.getColumnIndex(DocumentsContract.Document.COLUMN_DOCUMENT_ID);
            int nameIdx = c.getColumnIndex(DocumentsContract.Document.COLUMN_DISPLAY_NAME);
            while (c.moveToNext()) {
                String name = nameIdx >= 0 ? c.getString(nameIdx) : null;
                if (displayName.equals(name) && idIdx >= 0) {
                    return c.getString(idIdx);
                }
            }
        } catch (Exception ignored) {
        }
        return null;
    }

    private String getOrCreateSafDirDocId(Uri treeUri, String parentDocId, String dirName) throws IOException {
        String existing = findSafChildDocId(treeUri, parentDocId, dirName);
        if (existing != null) return existing;
        ContentResolver cr = appContext.getContentResolver();
        Uri parentUri = DocumentsContract.buildDocumentUriUsingTree(treeUri, parentDocId);
        Uri created = DocumentsContract.createDocument(
            cr,
            parentUri,
            DocumentsContract.Document.MIME_TYPE_DIR,
            dirName
        );
        if (created == null) {
            throw new IOException("Failed to create SAF folder: " + dirName);
        }
        return DocumentsContract.getDocumentId(created);
    }

    private String resolveSafRootDocId(Uri treeUri, boolean createIfMissing) throws IOException {
        String treeDocId = DocumentsContract.getTreeDocumentId(treeUri);
        // Check if user already picked the "World of Adventure" directory itself
        if (treeDocId != null && (treeDocId.endsWith("/" + APP_FOLDER_NAME) || treeDocId.endsWith(":" + APP_FOLDER_NAME))) {
            return treeDocId;
        }
        if (createIfMissing) {
            return getOrCreateSafDirDocId(treeUri, treeDocId, APP_FOLDER_NAME);
        }
        return findSafChildDocId(treeUri, treeDocId, APP_FOLDER_NAME);
    }

    private String readSafDocUtf8(Uri treeUri, String docId) throws IOException {
        if (docId == null) return null;
        Uri docUri = DocumentsContract.buildDocumentUriUsingTree(treeUri, docId);
        try (InputStream is = appContext.getContentResolver().openInputStream(docUri);
             ByteArrayOutputStream baos = new ByteArrayOutputStream()) {
            if (is == null) return null;
            byte[] buf = new byte[8192];
            int n;
            while ((n = is.read(buf)) != -1) {
                baos.write(buf, 0, n);
            }
            return new String(baos.toByteArray(), StandardCharsets.UTF_8);
        }
    }

    private void writeSafDocText(Uri treeUri, String parentDocId, String fileName, String content) throws IOException {
        ContentResolver cr = appContext.getContentResolver();
        String existingId = findSafChildDocId(treeUri, parentDocId, fileName);
        Uri targetUri;
        if (existingId != null) {
            targetUri = DocumentsContract.buildDocumentUriUsingTree(treeUri, existingId);
        } else {
            Uri parentUri = DocumentsContract.buildDocumentUriUsingTree(treeUri, parentDocId);
            // Use application/octet-stream so Android document providers preserve exact ".json" / ".bak" filenames
            targetUri = DocumentsContract.createDocument(cr, parentUri, "application/octet-stream", fileName);
            if (targetUri == null) {
                throw new IOException("Unable to create SAF document: " + fileName);
            }
        }
        try (OutputStream os = cr.openOutputStream(targetUri, "wt")) {
            if (os == null) {
                throw new IOException("Unable to open SAF output stream: " + fileName);
            }
            os.write(content.getBytes(StandardCharsets.UTF_8));
            os.flush();
        }
    }

    private void writeJsonSafAtomic(
        Uri treeUri,
        String parentDocId,
        String backupDirDocId,
        String fileName,
        JSONObject payload
    ) throws Exception {
        if (payload == null) throw new IllegalArgumentException("Null JSON payload");
        String serialized = payload.toString(2);
        new JSONObject(serialized);

        // Save previous valid JSON into backup folder first
        String existingId = findSafChildDocId(treeUri, parentDocId, fileName);
        if (existingId != null && backupDirDocId != null) {
            try {
                String prevRaw = readSafDocUtf8(treeUri, existingId);
                if (parseValidJsonObject(prevRaw) != null) {
                    writeSafDocText(treeUri, backupDirDocId, fileName + ".bak", prevRaw);
                }
            } catch (Exception ignored) {
            }
        }

        // Write verified .tmp first, then update target, then clean .tmp
        String tmpName = fileName + ".tmp";
        writeSafDocText(treeUri, parentDocId, tmpName, serialized);
        String tmpDocId = findSafChildDocId(treeUri, parentDocId, tmpName);
        if (tmpDocId == null || parseValidJsonObject(readSafDocUtf8(treeUri, tmpDocId)) == null) {
            throw new IOException("SAF temporary verification failed for " + fileName);
        }
        writeSafDocText(treeUri, parentDocId, fileName, serialized);
        try {
            DocumentsContract.deleteDocument(
                appContext.getContentResolver(),
                DocumentsContract.buildDocumentUriUsingTree(treeUri, tmpDocId)
            );
        } catch (Exception ignored) {
        }
    }

    private JSONObject readJsonSafWithBackup(
        Uri treeUri,
        String primaryDirDocId,
        String primaryName,
        String backupDirDocId,
        String... fallbackNames
    ) {
        String primaryId = findSafChildDocId(treeUri, primaryDirDocId, primaryName);
        if (primaryId != null) {
            try {
                JSONObject parsed = parseValidJsonObject(readSafDocUtf8(treeUri, primaryId));
                if (parsed != null) return parsed;
            } catch (Exception ignored) {
            }
        }
        if (backupDirDocId != null) {
            String bakId = findSafChildDocId(treeUri, backupDirDocId, primaryName + ".bak");
            if (bakId != null) {
                try {
                    JSONObject parsed = parseValidJsonObject(readSafDocUtf8(treeUri, bakId));
                    if (parsed != null) return parsed;
                } catch (Exception ignored) {
                }
            }
        }
        if (fallbackNames != null) {
            for (String alt : fallbackNames) {
                String altId = findSafChildDocId(treeUri, primaryDirDocId, alt);
                if (altId != null) {
                    try {
                        JSONObject parsed = parseValidJsonObject(readSafDocUtf8(treeUri, altId));
                        if (parsed != null) return parsed;
                    } catch (Exception ignored) {
                    }
                }
            }
        }
        return null;
    }

    // ---------- Initialization & Migration ----------

    public void ensureInitialized() {
        synchronized (lock) {
            ensureInitializedAndMigrateLocked();
        }
    }

    private String getActiveExternalModeLocked() {
        if (hasDirectSharedStoragePermission()) {
            return "direct";
        }
        if (getPersistedSafTreeUri() != null) {
            return "saf";
        }
        return "none";
    }

    private void ensureInitializedAndMigrateLocked() {
        String mode = getActiveExternalModeLocked();
        if ("none".equals(mode)) {
            externalWritableVerified = false;
            return;
        }

        try {
            if ("direct".equals(mode)) {
                File root = getDirectRootDir();
                File worldsDir = new File(root, DIR_WORLDS);
                File settingsDir = new File(root, DIR_SETTINGS);
                File profilesDir = new File(root, DIR_PROFILES);
                File backupsDir = new File(root, DIR_BACKUPS);
                File modsDir = new File(root, DIR_MODS);

                if (!root.exists()) root.mkdirs();
                if (!worldsDir.exists()) worldsDir.mkdirs();
                if (!settingsDir.exists()) settingsDir.mkdirs();
                if (!profilesDir.exists()) profilesDir.mkdirs();
                if (!backupsDir.exists()) backupsDir.mkdirs();
                if (!modsDir.exists()) modsDir.mkdirs();

                // Verify actual write & read-back capability (do not assume mkdir succeeded)
                if (!externalWritableVerified) {
                    File probe = new File(root, ".woa_rw_probe.tmp");
                    String token = "woa_ok_" + System.currentTimeMillis();
                    try (FileOutputStream fos = new FileOutputStream(probe, false)) {
                        fos.write(token.getBytes(StandardCharsets.UTF_8));
                        fos.flush();
                        fos.getFD().sync();
                    }
                    String readBack = readFileUtf8(probe);
                    probe.delete();
                    if (!token.equals(readBack)) {
                        throw new IOException("Read-back verification mismatch on direct storage");
                    }
                    externalWritableVerified = true;
                }

                getPrefs()
                    .edit()
                    .putBoolean(PREF_INITIALIZED_ONCE, true)
                    .putString(PREF_LAST_MODE, "direct")
                    .apply();
                lastError = null;
                migratePrivateSavesToDirectLocked(worldsDir, backupsDir);
            } else if ("saf".equals(mode)) {
                Uri treeUri = getPersistedSafTreeUri();
                if (treeUri == null) {
                    externalWritableVerified = false;
                    return;
                }
                String rootDocId = resolveSafRootDocId(treeUri, true);
                getOrCreateSafDirDocId(treeUri, rootDocId, DIR_WORLDS);
                getOrCreateSafDirDocId(treeUri, rootDocId, DIR_SETTINGS);
                getOrCreateSafDirDocId(treeUri, rootDocId, DIR_PROFILES);
                getOrCreateSafDirDocId(treeUri, rootDocId, DIR_BACKUPS);
                getOrCreateSafDirDocId(treeUri, rootDocId, DIR_MODS);

                if (!externalWritableVerified) {
                    String token = "woa_ok_" + System.currentTimeMillis();
                    writeSafDocText(treeUri, rootDocId, ".woa_rw_probe.tmp", token);
                    String probeId = findSafChildDocId(treeUri, rootDocId, ".woa_rw_probe.tmp");
                    String readBack = readSafDocUtf8(treeUri, probeId);
                    if (probeId != null) {
                        try {
                            DocumentsContract.deleteDocument(
                                appContext.getContentResolver(),
                                DocumentsContract.buildDocumentUriUsingTree(treeUri, probeId)
                            );
                        } catch (Exception ignored) {
                        }
                    }
                    if (!token.equals(readBack)) {
                        throw new IOException("Read-back verification mismatch on SAF storage");
                    }
                    externalWritableVerified = true;
                }

                getPrefs()
                    .edit()
                    .putBoolean(PREF_INITIALIZED_ONCE, true)
                    .putString(PREF_LAST_MODE, "saf")
                    .apply();
                lastError = null;
                migratePrivateSavesToSafLocked(treeUri, rootDocId);
            }
        } catch (Exception e) {
            externalWritableVerified = false;
            lastError = e.getMessage() != null ? e.getMessage() : "STORAGE_INIT_FAILED";
        }
    }

    private long extractSavedAtMs(JSONObject worldData) {
        if (worldData == null) return 0L;
        JSONObject meta = worldData.optJSONObject("meta");
        return meta != null ? meta.optLong("savedAtMs", 0L) : 0L;
    }

    private JSONObject readWorldBundleFromPrivateDir(File worldDir) {
        JSONObject worldData = readJsonDirectWithBackups(
            new File(worldDir, FILE_WORLD_DATA),
            new File(worldDir, FILE_WORLD_DATA + ".bak"),
            new File(new File(worldDir, DIR_WORLD_BACKUPS), FILE_WORLD_DATA + ".bak")
        );
        if (worldData == null) return null;

        JSONObject worldSettings = readJsonDirectWithBackups(
            new File(worldDir, FILE_WORLD_SETTINGS),
            new File(worldDir, FILE_LEGACY_WORLD_SETTINGS),
            new File(worldDir, FILE_LEGACY_WORLD_SETTINGS + ".bak"),
            new File(new File(worldDir, DIR_WORLD_BACKUPS), FILE_WORLD_SETTINGS + ".bak")
        );
        if (worldSettings == null) worldSettings = new JSONObject();

        JSONObject playerData = readJsonDirectWithBackups(
            new File(worldDir, FILE_PLAYER_DATA),
            new File(worldDir, FILE_PLAYER_DATA + ".bak"),
            new File(new File(worldDir, DIR_WORLD_BACKUPS), FILE_PLAYER_DATA + ".bak")
        );
        if (playerData == null) playerData = new JSONObject();

        JSONObject worldState = readJsonDirectWithBackups(
            new File(worldDir, FILE_WORLD_STATE),
            new File(worldDir, FILE_WORLD_STATE + ".bak"),
            new File(new File(worldDir, DIR_WORLD_BACKUPS), FILE_WORLD_STATE + ".bak")
        );
        if (worldState == null) worldState = new JSONObject();

        try {
            JSONObject bundle = new JSONObject();
            bundle.put("saveVersion", worldData.optInt("saveVersion", 1));
            bundle.put("worldData", worldData);
            bundle.put("settings", worldSettings);
            bundle.put("playerData", playerData);
            bundle.put("worldState", worldState);
            return bundle;
        } catch (Exception e) {
            return null;
        }
    }

    private void migratePrivateSavesToDirectLocked(File externalWorldsDir, File globalBackupsDir) {
        File privateRoot = getPrivateWorldsRootDir();
        if (!privateRoot.exists() || !privateRoot.isDirectory()) return;
        File[] entries = privateRoot.listFiles();
        if (entries == null) return;

        for (File privDir : entries) {
            if (!privDir.isDirectory()) continue;
            String worldId = sanitizeWorldId(privDir.getName());
            if (worldId == null) continue;
            try {
                JSONObject privBundle = readWorldBundleFromPrivateDir(privDir);
                if (privBundle == null) continue;
                JSONObject privWd = privBundle.optJSONObject("worldData");
                long privTs = extractSavedAtMs(privWd);

                File extWorldDir = new File(externalWorldsDir, worldId);
                File extBackupsDir = new File(extWorldDir, DIR_WORLD_BACKUPS);
                JSONObject existingExtWd = readJsonDirectWithBackups(
                    new File(extWorldDir, FILE_WORLD_DATA),
                    new File(extBackupsDir, FILE_WORLD_DATA + ".bak")
                );
                if (existingExtWd != null && extractSavedAtMs(existingExtWd) >= privTs) {
                    continue;
                }

                // Write verified bundle to visible folder; keep private files untouched as fallback backup
                writeWorldBundleDirectLocked(extWorldDir, privBundle);
                JSONObject verified = readJsonDirectWithBackups(new File(extWorldDir, FILE_WORLD_DATA));
                if (verified != null) {
                    migratedWorldsCount++;
                }
            } catch (Exception ignored) {
                // Keep private original intact if single world fails migration
            }
        }
    }

    private void migratePrivateSavesToSafLocked(Uri treeUri, String rootDocId) {
        File privateRoot = getPrivateWorldsRootDir();
        if (!privateRoot.exists() || !privateRoot.isDirectory()) return;
        File[] entries = privateRoot.listFiles();
        if (entries == null) return;

        try {
            String worldsDocId = getOrCreateSafDirDocId(treeUri, rootDocId, DIR_WORLDS);
            for (File privDir : entries) {
                if (!privDir.isDirectory()) continue;
                String worldId = sanitizeWorldId(privDir.getName());
                if (worldId == null) continue;
                try {
                    JSONObject privBundle = readWorldBundleFromPrivateDir(privDir);
                    if (privBundle == null) continue;
                    long privTs = extractSavedAtMs(privBundle.optJSONObject("worldData"));

                    String extWorldDocId = findSafChildDocId(treeUri, worldsDocId, worldId);
                    if (extWorldDocId != null) {
                        String backupsDocId = findSafChildDocId(treeUri, extWorldDocId, DIR_WORLD_BACKUPS);
                        JSONObject existingWd = readJsonSafWithBackup(
                            treeUri,
                            extWorldDocId,
                            FILE_WORLD_DATA,
                            backupsDocId
                        );
                        if (existingWd != null && extractSavedAtMs(existingWd) >= privTs) {
                            continue;
                        }
                    }

                    String targetWorldDocId = getOrCreateSafDirDocId(treeUri, worldsDocId, worldId);
                    writeWorldBundleSafLocked(treeUri, targetWorldDocId, privBundle);
                    migratedWorldsCount++;
                } catch (Exception ignored) {
                }
            }
        } catch (Exception ignored) {
        }
    }

    // ---------- Public World Bundle Operations ----------

    public String listSavedWorldIdsJson() {
        synchronized (lock) {
            ensureInitializedAndMigrateLocked();
            Set<String> ids = new LinkedHashSet<>();

            // 1. Primary visible external folder
            if (externalWritableVerified) {
                String mode = getActiveExternalModeLocked();
                if ("direct".equals(mode)) {
                    File worldsDir = new File(getDirectRootDir(), DIR_WORLDS);
                    if (worldsDir.exists() && worldsDir.isDirectory()) {
                        File[] entries = worldsDir.listFiles();
                        if (entries != null) {
                            for (File entry : entries) {
                                if (!entry.isDirectory()) continue;
                                String worldId = sanitizeWorldId(entry.getName());
                                if (worldId == null) continue;
                                File wd = new File(entry, FILE_WORLD_DATA);
                                File wdBak = new File(new File(entry, DIR_WORLD_BACKUPS), FILE_WORLD_DATA + ".bak");
                                if (wd.exists() || wdBak.exists()) {
                                    ids.add(worldId);
                                }
                            }
                        }
                    }
                } else if ("saf".equals(mode)) {
                    Uri treeUri = getPersistedSafTreeUri();
                    if (treeUri != null) {
                        try {
                            String rootDocId = resolveSafRootDocId(treeUri, false);
                            String worldsDocId = rootDocId != null ? findSafChildDocId(treeUri, rootDocId, DIR_WORLDS) : null;
                            if (worldsDocId != null) {
                                ContentResolver cr = appContext.getContentResolver();
                                Uri childrenUri = DocumentsContract.buildChildDocumentsUriUsingTree(treeUri, worldsDocId);
                                try (Cursor c = cr.query(
                                    childrenUri,
                                    new String[] {
                                        DocumentsContract.Document.COLUMN_DOCUMENT_ID,
                                        DocumentsContract.Document.COLUMN_DISPLAY_NAME,
                                        DocumentsContract.Document.COLUMN_MIME_TYPE,
                                    },
                                    null,
                                    null,
                                    null
                                )) {
                                    if (c != null) {
                                        int idIdx = c.getColumnIndex(DocumentsContract.Document.COLUMN_DOCUMENT_ID);
                                        int nameIdx = c.getColumnIndex(DocumentsContract.Document.COLUMN_DISPLAY_NAME);
                                        int mimeIdx = c.getColumnIndex(DocumentsContract.Document.COLUMN_MIME_TYPE);
                                        while (c.moveToNext()) {
                                            String mime = mimeIdx >= 0 ? c.getString(mimeIdx) : "";
                                            if (!DocumentsContract.Document.MIME_TYPE_DIR.equals(mime)) continue;
                                            String worldId = sanitizeWorldId(nameIdx >= 0 ? c.getString(nameIdx) : null);
                                            if (worldId == null) continue;
                                            String wDocId = idIdx >= 0 ? c.getString(idIdx) : null;
                                            if (wDocId != null && findSafChildDocId(treeUri, wDocId, FILE_WORLD_DATA) != null) {
                                                ids.add(worldId);
                                            }
                                        }
                                    }
                                }
                            }
                        } catch (Exception ignored) {
                        }
                    }
                }
            }

            // 2. Also include any private fallback worlds not yet migrated (never hide/lose player worlds)
            File privRoot = getPrivateWorldsRootDir();
            if (privRoot.exists() && privRoot.isDirectory()) {
                File[] entries = privRoot.listFiles();
                if (entries != null) {
                    for (File entry : entries) {
                        if (!entry.isDirectory()) continue;
                        String worldId = sanitizeWorldId(entry.getName());
                        if (worldId == null) continue;
                        File wd = new File(entry, FILE_WORLD_DATA);
                        File wdBak = new File(entry, FILE_WORLD_DATA + ".bak");
                        if (wd.exists() || wdBak.exists()) {
                            ids.add(worldId);
                        }
                    }
                }
            }

            try {
                JSONArray arr = new JSONArray();
                for (String id : ids) arr.put(id);
                JSONObject res = new JSONObject();
                res.put("ok", true);
                res.put("worldIds", arr);
                return res.toString();
            } catch (Exception e) {
                return "{\"ok\":false,\"worldIds\":[]}";
            }
        }
    }

    public String readWorldBundleJson(String worldId) {
        synchronized (lock) {
            String safeId = sanitizeWorldId(worldId);
            if (safeId == null) {
                return "{\"ok\":false,\"error\":\"INVALID_WORLD_ID\"}";
            }
            ensureInitializedAndMigrateLocked();

            JSONObject bestBundle = null;
            if (externalWritableVerified) {
                String mode = getActiveExternalModeLocked();
                if ("direct".equals(mode)) {
                    File extWorldDir = new File(new File(getDirectRootDir(), DIR_WORLDS), safeId);
                    if (extWorldDir.exists() && extWorldDir.isDirectory()) {
                        bestBundle = readWorldBundleFromPrivateDir(extWorldDir);
                    }
                } else if ("saf".equals(mode)) {
                    Uri treeUri = getPersistedSafTreeUri();
                    if (treeUri != null) {
                        try {
                            String rootDocId = resolveSafRootDocId(treeUri, false);
                            String worldsDocId = rootDocId != null ? findSafChildDocId(treeUri, rootDocId, DIR_WORLDS) : null;
                            String worldDocId = worldsDocId != null ? findSafChildDocId(treeUri, worldsDocId, safeId) : null;
                            if (worldDocId != null) {
                                String backupsDocId = findSafChildDocId(treeUri, worldDocId, DIR_WORLD_BACKUPS);
                                JSONObject wd = readJsonSafWithBackup(treeUri, worldDocId, FILE_WORLD_DATA, backupsDocId);
                                if (wd != null) {
                                    JSONObject ws = readJsonSafWithBackup(
                                        treeUri,
                                        worldDocId,
                                        FILE_WORLD_SETTINGS,
                                        backupsDocId,
                                        FILE_LEGACY_WORLD_SETTINGS
                                    );
                                    if (ws == null) ws = new JSONObject();
                                    JSONObject pd = readJsonSafWithBackup(treeUri, worldDocId, FILE_PLAYER_DATA, backupsDocId);
                                    if (pd == null) pd = new JSONObject();
                                    JSONObject st = readJsonSafWithBackup(treeUri, worldDocId, FILE_WORLD_STATE, backupsDocId);
                                    if (st == null) st = new JSONObject();
                                    JSONObject b = new JSONObject();
                                    b.put("saveVersion", wd.optInt("saveVersion", 1));
                                    b.put("worldData", wd);
                                    b.put("settings", ws);
                                    b.put("playerData", pd);
                                    b.put("worldState", st);
                                    bestBundle = b;
                                }
                            }
                        } catch (Exception ignored) {
                        }
                    }
                }
            }

            if (bestBundle == null) {
                File privDir = new File(getPrivateWorldsRootDir(), safeId);
                if (privDir.exists() && privDir.isDirectory()) {
                    bestBundle = readWorldBundleFromPrivateDir(privDir);
                }
            }

            if (bestBundle == null) {
                return "{\"ok\":false,\"error\":\"WORLD_NOT_FOUND\"}";
            }

            try {
                JSONObject res = new JSONObject();
                res.put("ok", true);
                res.put("bundle", bestBundle);
                return res.toString();
            } catch (Exception e) {
                return "{\"ok\":false,\"error\":\"SERIALIZE_FAILED\"}";
            }
        }
    }

    private void writeWorldBundleDirectLocked(File worldDir, JSONObject bundle) throws Exception {
        JSONObject worldData = bundle.optJSONObject("worldData");
        JSONObject settings = bundle.optJSONObject("settings");
        JSONObject playerData = bundle.optJSONObject("playerData");
        JSONObject worldState = bundle.optJSONObject("worldState");
        if (worldData == null || settings == null || playerData == null || worldState == null) {
            throw new IllegalArgumentException("INVALID_BUNDLE");
        }
        int saveVersion = bundle.optInt("saveVersion", 1);
        worldData.put("saveVersion", saveVersion);

        if (!worldDir.exists()) worldDir.mkdirs();
        File backupsDir = new File(worldDir, DIR_WORLD_BACKUPS);
        if (!backupsDir.exists()) backupsDir.mkdirs();

        writeJsonDirectAtomic(new File(worldDir, FILE_WORLD_DATA), backupsDir, FILE_WORLD_DATA, worldData);
        writeJsonDirectAtomic(new File(worldDir, FILE_WORLD_SETTINGS), backupsDir, FILE_WORLD_SETTINGS, settings);
        writeJsonDirectAtomic(new File(worldDir, FILE_PLAYER_DATA), backupsDir, FILE_PLAYER_DATA, playerData);
        writeJsonDirectAtomic(new File(worldDir, FILE_WORLD_STATE), backupsDir, FILE_WORLD_STATE, worldState);
    }

    private void writeWorldBundleSafLocked(Uri treeUri, String worldDocId, JSONObject bundle) throws Exception {
        JSONObject worldData = bundle.optJSONObject("worldData");
        JSONObject settings = bundle.optJSONObject("settings");
        JSONObject playerData = bundle.optJSONObject("playerData");
        JSONObject worldState = bundle.optJSONObject("worldState");
        if (worldData == null || settings == null || playerData == null || worldState == null) {
            throw new IllegalArgumentException("INVALID_BUNDLE");
        }
        int saveVersion = bundle.optInt("saveVersion", 1);
        worldData.put("saveVersion", saveVersion);

        String backupsDocId = getOrCreateSafDirDocId(treeUri, worldDocId, DIR_WORLD_BACKUPS);
        writeJsonSafAtomic(treeUri, worldDocId, backupsDocId, FILE_WORLD_DATA, worldData);
        writeJsonSafAtomic(treeUri, worldDocId, backupsDocId, FILE_WORLD_SETTINGS, settings);
        writeJsonSafAtomic(treeUri, worldDocId, backupsDocId, FILE_PLAYER_DATA, playerData);
        writeJsonSafAtomic(treeUri, worldDocId, backupsDocId, FILE_WORLD_STATE, worldState);
    }

    public String writeWorldBundleJson(String worldId, String bundleJson) {
        synchronized (lock) {
            try {
                String safeId = sanitizeWorldId(worldId);
                if (safeId == null) {
                    return "{\"ok\":false,\"error\":\"INVALID_WORLD_ID\"}";
                }
                if (bundleJson == null || bundleJson.trim().isEmpty()) {
                    return "{\"ok\":false,\"error\":\"EMPTY_BUNDLE\"}";
                }
                JSONObject bundle = new JSONObject(bundleJson);
                ensureInitializedAndMigrateLocked();

                boolean wroteExternal = false;
                if (externalWritableVerified) {
                    String mode = getActiveExternalModeLocked();
                    if ("direct".equals(mode)) {
                        File extWorldDir = new File(new File(getDirectRootDir(), DIR_WORLDS), safeId);
                        writeWorldBundleDirectLocked(extWorldDir, bundle);
                        wroteExternal = true;
                    } else if ("saf".equals(mode)) {
                        Uri treeUri = getPersistedSafTreeUri();
                        if (treeUri != null) {
                            String rootDocId = resolveSafRootDocId(treeUri, true);
                            String worldsDocId = getOrCreateSafDirDocId(treeUri, rootDocId, DIR_WORLDS);
                            String worldDocId = getOrCreateSafDirDocId(treeUri, worldsDocId, safeId);
                            writeWorldBundleSafLocked(treeUri, worldDocId, bundle);
                            wroteExternal = true;
                        }
                    }
                }

                // Always keep/update private emergency fallback if external storage isn't granted yet
                if (!wroteExternal) {
                    File privWorldDir = new File(getPrivateWorldsRootDir(), safeId);
                    writeWorldBundleDirectLocked(privWorldDir, bundle);
                }

                JSONObject res = new JSONObject();
                res.put("ok", true);
                res.put("storedExternally", wroteExternal);
                return res.toString();
            } catch (Exception e) {
                lastError = e.getMessage();
                JSONObject err = new JSONObject();
                try {
                    err.put("ok", false);
                    err.put("error", e.getMessage() != null ? e.getMessage() : "WRITE_FAILED");
                } catch (Exception ignored) {
                }
                return err.toString();
            }
        }
    }

    public String deleteWorldBundleJson(String worldId) {
        synchronized (lock) {
            try {
                String safeId = sanitizeWorldId(worldId);
                if (safeId == null) {
                    return "{\"ok\":false,\"error\":\"INVALID_WORLD_ID\"}";
                }
                ensureInitializedAndMigrateLocked();

                if (externalWritableVerified) {
                    String mode = getActiveExternalModeLocked();
                    if ("direct".equals(mode)) {
                        File extWorldDir = new File(new File(getDirectRootDir(), DIR_WORLDS), safeId);
                        deleteRecursiveDirect(extWorldDir);
                    } else if ("saf".equals(mode)) {
                        Uri treeUri = getPersistedSafTreeUri();
                        if (treeUri != null) {
                            String rootDocId = resolveSafRootDocId(treeUri, false);
                            String worldsDocId = rootDocId != null ? findSafChildDocId(treeUri, rootDocId, DIR_WORLDS) : null;
                            String worldDocId = worldsDocId != null ? findSafChildDocId(treeUri, worldsDocId, safeId) : null;
                            if (worldDocId != null) {
                                DocumentsContract.deleteDocument(
                                    appContext.getContentResolver(),
                                    DocumentsContract.buildDocumentUriUsingTree(treeUri, worldDocId)
                                );
                            }
                        }
                    }
                }

                deleteRecursiveDirect(new File(getPrivateWorldsRootDir(), safeId));
                return "{\"ok\":true}";
            } catch (Exception e) {
                return "{\"ok\":false,\"error\":\"DELETE_FAILED\"}";
            }
        }
    }

    // ---------- Settings & Profile Storage Operations ----------

    public String readAllSettingsJson() {
        synchronized (lock) {
            ensureInitializedAndMigrateLocked();
            try {
                JSONObject settingsObj = new JSONObject();
                boolean hasAny = false;
                String[] keys = new String[] { "game", "graphics", "audio", "controls", "language" };

                if (externalWritableVerified) {
                    String mode = getActiveExternalModeLocked();
                    if ("direct".equals(mode)) {
                        File settingsDir = new File(getDirectRootDir(), DIR_SETTINGS);
                        File backupsDir = new File(getDirectRootDir(), DIR_BACKUPS);
                        for (String key : keys) {
                            String fname = resolveSettingsFileName(key);
                            JSONObject val = readJsonDirectWithBackups(
                                new File(settingsDir, fname),
                                new File(backupsDir, fname + ".bak")
                            );
                            if (val != null) {
                                settingsObj.put(key, val);
                                hasAny = true;
                            }
                        }
                    } else if ("saf".equals(mode)) {
                        Uri treeUri = getPersistedSafTreeUri();
                        if (treeUri != null) {
                            String rootDocId = resolveSafRootDocId(treeUri, false);
                            String settingsDocId = rootDocId != null ? findSafChildDocId(treeUri, rootDocId, DIR_SETTINGS) : null;
                            String backupsDocId = rootDocId != null ? findSafChildDocId(treeUri, rootDocId, DIR_BACKUPS) : null;
                            if (settingsDocId != null) {
                                for (String key : keys) {
                                    String fname = resolveSettingsFileName(key);
                                    JSONObject val = readJsonSafWithBackup(
                                        treeUri,
                                        settingsDocId,
                                        fname,
                                        backupsDocId
                                    );
                                    if (val != null) {
                                        settingsObj.put(key, val);
                                        hasAny = true;
                                    }
                                }
                            }
                        }
                    }
                }

                JSONObject res = new JSONObject();
                res.put("ok", true);
                res.put("writable", externalWritableVerified);
                res.put("hasAny", hasAny);
                res.put("settings", settingsObj);
                return res.toString();
            } catch (Exception e) {
                return "{\"ok\":false,\"writable\":false,\"hasAny\":false,\"settings\":{}}";
            }
        }
    }

    public String writeSettingFileJson(String settingKey, String jsonContent) {
        synchronized (lock) {
            try {
                String fileName = resolveSettingsFileName(settingKey);
                if (fileName == null) {
                    return "{\"ok\":false,\"error\":\"INVALID_SETTING_KEY\"}";
                }
                JSONObject payload = parseValidJsonObject(jsonContent);
                if (payload == null) {
                    return "{\"ok\":false,\"error\":\"INVALID_JSON\"}";
                }
                ensureInitializedAndMigrateLocked();
                if (!externalWritableVerified) {
                    return "{\"ok\":false,\"error\":\"PERMISSION_REQUIRED\"}";
                }

                String mode = getActiveExternalModeLocked();
                if ("direct".equals(mode)) {
                    File root = getDirectRootDir();
                    File settingsDir = new File(root, DIR_SETTINGS);
                    File backupsDir = new File(root, DIR_BACKUPS);
                    writeJsonDirectAtomic(new File(settingsDir, fileName), backupsDir, fileName, payload);
                    return "{\"ok\":true}";
                } else if ("saf".equals(mode)) {
                    Uri treeUri = getPersistedSafTreeUri();
                    if (treeUri != null) {
                        String rootDocId = resolveSafRootDocId(treeUri, true);
                        String settingsDocId = getOrCreateSafDirDocId(treeUri, rootDocId, DIR_SETTINGS);
                        String backupsDocId = getOrCreateSafDirDocId(treeUri, rootDocId, DIR_BACKUPS);
                        writeJsonSafAtomic(treeUri, settingsDocId, backupsDocId, fileName, payload);
                        return "{\"ok\":true}";
                    }
                }
                return "{\"ok\":false,\"error\":\"STORAGE_UNAVAILABLE\"}";
            } catch (Exception e) {
                return "{\"ok\":false,\"error\":\"WRITE_FAILED\"}";
            }
        }
    }

    public String writeProfileFileJson(String jsonContent) {
        synchronized (lock) {
            try {
                JSONObject payload = parseValidJsonObject(jsonContent);
                if (payload == null) {
                    return "{\"ok\":false,\"error\":\"INVALID_JSON\"}";
                }
                ensureInitializedAndMigrateLocked();
                if (!externalWritableVerified) {
                    return "{\"ok\":false,\"error\":\"PERMISSION_REQUIRED\"}";
                }
                String mode = getActiveExternalModeLocked();
                if ("direct".equals(mode)) {
                    File root = getDirectRootDir();
                    writeJsonDirectAtomic(
                        new File(new File(root, DIR_PROFILES), FILE_PROFILE),
                        new File(root, DIR_BACKUPS),
                        FILE_PROFILE,
                        payload
                    );
                    return "{\"ok\":true}";
                } else if ("saf".equals(mode)) {
                    Uri treeUri = getPersistedSafTreeUri();
                    if (treeUri != null) {
                        String rootDocId = resolveSafRootDocId(treeUri, true);
                        String profilesDocId = getOrCreateSafDirDocId(treeUri, rootDocId, DIR_PROFILES);
                        String backupsDocId = getOrCreateSafDirDocId(treeUri, rootDocId, DIR_BACKUPS);
                        writeJsonSafAtomic(treeUri, profilesDocId, backupsDocId, FILE_PROFILE, payload);
                        return "{\"ok\":true}";
                    }
                }
                return "{\"ok\":false,\"error\":\"STORAGE_UNAVAILABLE\"}";
            } catch (Exception e) {
                return "{\"ok\":false,\"error\":\"WRITE_FAILED\"}";
            }
        }
    }

    public String readProfileFileJson() {
        synchronized (lock) {
            ensureInitializedAndMigrateLocked();
            if (!externalWritableVerified) {
                return "{\"ok\":false,\"error\":\"PERMISSION_REQUIRED\"}";
            }
            try {
                String mode = getActiveExternalModeLocked();
                JSONObject profile = null;
                if ("direct".equals(mode)) {
                    File root = getDirectRootDir();
                    profile = readJsonDirectWithBackups(
                        new File(new File(root, DIR_PROFILES), FILE_PROFILE),
                        new File(new File(root, DIR_BACKUPS), FILE_PROFILE + ".bak")
                    );
                } else if ("saf".equals(mode)) {
                    Uri treeUri = getPersistedSafTreeUri();
                    if (treeUri != null) {
                        String rootDocId = resolveSafRootDocId(treeUri, false);
                        String profilesDocId = rootDocId != null ? findSafChildDocId(treeUri, rootDocId, DIR_PROFILES) : null;
                        String backupsDocId = rootDocId != null ? findSafChildDocId(treeUri, rootDocId, DIR_BACKUPS) : null;
                        if (profilesDocId != null) {
                            profile = readJsonSafWithBackup(treeUri, profilesDocId, FILE_PROFILE, backupsDocId);
                        }
                    }
                }
                if (profile == null) {
                    return "{\"ok\":false,\"error\":\"NOT_FOUND\"}";
                }
                JSONObject res = new JSONObject();
                res.put("ok", true);
                res.put("profile", profile);
                return res.toString();
            } catch (Exception e) {
                return "{\"ok\":false,\"error\":\"READ_FAILED\"}";
            }
        }
    }

    public String getStorageStatusJson() {
        synchronized (lock) {
            ensureInitializedAndMigrateLocked();
            String mode = getActiveExternalModeLocked();
            boolean extMounted = Environment.MEDIA_MOUNTED.equals(Environment.getExternalStorageState());
            String state;
            if (externalWritableVerified && getPrefs().getBoolean(PREF_INITIALIZED_ONCE, false)) {
                state = "initialized";
            } else if (externalWritableVerified) {
                state = "available";
            } else if (!extMounted) {
                state = "not_accessible";
            } else if ("none".equals(mode)) {
                state = "permission_required";
            } else {
                state = "not_accessible";
            }

            try {
                JSONObject res = new JSONObject();
                res.put("ok", true);
                res.put("platform", "android");
                res.put("state", state);
                res.put("mode", mode);
                res.put("path", VISIBLE_TARGET_PATH);
                res.put("modsPath", VISIBLE_MODS_PATH);
                res.put("writable", externalWritableVerified);
                res.put("initialized", externalWritableVerified && getPrefs().getBoolean(PREF_INITIALIZED_ONCE, false));
                res.put("sdkInt", Build.VERSION.SDK_INT);
                res.put("canRequestAllFiles", Build.VERSION.SDK_INT >= Build.VERSION_CODES.R);
                res.put("hasSafGrant", getPersistedSafTreeUri() != null);
                res.put("migratedWorldsCount", migratedWorldsCount);
                if (lastError != null) {
                    res.put("lastError", lastError);
                }
                return res.toString();
            } catch (Exception e) {
                return "{\"ok\":false,\"platform\":\"android\",\"state\":\"not_accessible\",\"path\":\"" + VISIBLE_TARGET_PATH + "\",\"modsPath\":\"" + VISIBLE_MODS_PATH + "\"}";
            }
        }
    }

    // ---------- Local Mods Directory (/storage/emulated/0/World of Adventure/Mods/) ----------

    public String getModsInfoJson() {
        synchronized (lock) {
            ensureInitializedAndMigrateLocked();
            String mode = getActiveExternalModeLocked();
            try {
                JSONObject res = new JSONObject();
                res.put("ok", true);
                res.put("platform", "android");
                res.put("modsDir", VISIBLE_MODS_PATH);
                res.put("mode", mode);
                res.put("writable", externalWritableVerified);
                return res.toString();
            } catch (Exception e) {
                return "{\"ok\":false,\"platform\":\"android\",\"modsDir\":\"" + VISIBLE_MODS_PATH + "\",\"writable\":false}";
            }
        }
    }

    private byte[] readStreamCapped(InputStream is, int maxBytes) throws IOException {
        ByteArrayOutputStream baos = new ByteArrayOutputStream();
        byte[] buf = new byte[8192];
        int total = 0;
        int n;
        while ((n = is.read(buf)) != -1) {
            total += n;
            if (total > maxBytes) {
                throw new IOException("FILE_TOO_LARGE");
            }
            baos.write(buf, 0, n);
        }
        return baos.toByteArray();
    }

    private JSONObject scanArchiveStreamToModEntry(
        String sourceId,
        String sourcePath,
        long modifiedAtMs,
        InputStream rawArchiveStream
    ) {
        try (ZipInputStream zis = new ZipInputStream(rawArchiveStream)) {
            List<String> rawNames = new ArrayList<>();
            Map<String, byte[]> jsonFiles = new HashMap<>();
            Map<String, Long> assetSizes = new HashMap<>();
            Set<String> dirEntries = new HashSet<>();

            ZipEntry entry;
            int count = 0;
            while ((entry = zis.getNextEntry()) != null) {
                count++;
                if (count > MAX_MOD_ENTRIES) {
                    throw new IOException("ARCHIVE_TOO_MANY_ENTRIES");
                }
                String cleanName = entry.getName()
                    .replace('\\', '/')
                    .replaceAll("^/+", "")
                    .replaceAll("/+$", "");
                if (cleanName.isEmpty()) continue;

                String[] segs = cleanName.split("/");
                for (String seg : segs) {
                    if (".".equals(seg) || "..".equals(seg) || seg.indexOf('\0') >= 0) {
                        throw new IOException("ARCHIVE_UNSAFE_PATH:" + cleanName);
                    }
                }

                rawNames.add(cleanName);
                if (entry.isDirectory()) {
                    dirEntries.add(cleanName);
                } else {
                    String ext = getLowerExtension(cleanName);
                    if ("mod.json".equals(cleanName) || cleanName.endsWith("/mod.json") || ".json".equals(ext) || ".woa3d".equals(ext)) {
                        byte[] bytes = readStreamCapped(zis, MAX_MOD_JSON_BYTES);
                        jsonFiles.put(cleanName, bytes);
                        if (".woa3d".equals(ext)) {
                            assetSizes.put(cleanName, (long) bytes.length);
                        }
                    } else {
                        long sz = entry.getSize();
                        if (sz < 0) {
                            byte[] bytes = readStreamCapped(zis, MAX_MOD_ASSET_BYTES);
                            sz = bytes.length;
                        } else if (sz > MAX_MOD_ASSET_BYTES) {
                            throw new IOException("ARCHIVE_ENTRY_TOO_LARGE:" + cleanName);
                        }
                        assetSizes.put(cleanName, sz);
                    }
                }
                zis.closeEntry();
            }

            if (rawNames.isEmpty()) {
                throw new IOException("ARCHIVE_EMPTY");
            }

            String stripPrefix = "";
            if (!jsonFiles.containsKey("mod.json")) {
                Set<String> roots = new HashSet<>();
                for (String n : rawNames) {
                    int slash = n.indexOf('/');
                    roots.add(slash >= 0 ? n.substring(0, slash) : n);
                }
                if (roots.size() == 1) {
                    String singleRoot = roots.iterator().next();
                    if (jsonFiles.containsKey(singleRoot + "/mod.json")) {
                        stripPrefix = singleRoot + "/";
                    }
                }
            }

            Set<String> presentFolders = new HashSet<>();
            JSONArray contentFiles = new JSONArray();
            JSONArray assetFiles = new JSONArray();
            JSONArray executableFiles = new JSONArray();
            String manifestRaw = null;
            String manifestError = "MANIFEST_MISSING";

            for (String rawName : rawNames) {
                String rel = rawName;
                if (!stripPrefix.isEmpty()) {
                    if (rawName.startsWith(stripPrefix)) {
                        rel = rawName.substring(stripPrefix.length());
                    } else if (rawName.equals(stripPrefix.substring(0, stripPrefix.length() - 1))) {
                        continue;
                    }
                }
                if (rel.isEmpty()) continue;

                String[] parts = rel.split("/");
                String rawTop = parts[0];
                String topFolder = normalizeModFolderCategory(rawTop);
                String rawSecond = "assets".equals(rawTop.toLowerCase(Locale.ROOT)) && parts.length > 1 ? parts[1] : null;
                String secondFolder = rawSecond != null ? normalizeModFolderCategory(rawSecond) : null;
                boolean isDirEntry = dirEntries.contains(rawName);
                if (STANDARD_MOD_FOLDERS.contains(topFolder) && (isDirEntry || parts.length > 1)) {
                    presentFolders.add(topFolder);
                }
                if (secondFolder != null && STANDARD_MOD_FOLDERS.contains(secondFolder)) {
                    presentFolders.add(secondFolder);
                }
                if (isDirEntry) continue;

                String ext = getLowerExtension(rel);
                if (FORBIDDEN_MOD_EXTENSIONS.contains(ext)) {
                    executableFiles.put(rel);
                    continue;
                }

                if ("mod.json".equalsIgnoreCase(rel)) {
                    byte[] mBytes = jsonFiles.get(rawName);
                    if (mBytes != null) {
                        manifestRaw = new String(mBytes, StandardCharsets.UTF_8);
                        manifestError = null;
                    }
                    continue;
                }

                String contentCat = MOD_CONTENT_FOLDERS.contains(topFolder)
                    ? topFolder
                    : (secondFolder != null && MOD_CONTENT_FOLDERS.contains(secondFolder) ? secondFolder : null);
                if (contentCat != null && ".json".equals(ext)) {
                    byte[] cBytes = jsonFiles.get(rawName);
                    JSONObject item = new JSONObject();
                    item.put("category", contentCat);
                    item.put("relativePath", rel);
                    item.put("rawText", cBytes != null ? new String(cBytes, StandardCharsets.UTF_8) : "");
                    contentFiles.put(item);
                } else {
                    String category = (secondFolder != null && MOD_ASSET_FOLDERS.contains(secondFolder))
                        ? secondFolder
                        : topFolder;
                    JSONObject asset = new JSONObject();
                    asset.put("category", category);
                    asset.put("relativePath", rel);
                    Long sz = assetSizes.get(rawName);
                    long actualSize = sz != null ? sz : 0L;
                    asset.put("sizeBytes", actualSize);
                    if (".woa3d".equals(ext) && jsonFiles.containsKey(rawName)) {
                        byte[] wBytes = jsonFiles.get(rawName);
                        if (wBytes != null) {
                            asset.put("rawText", new String(wBytes, StandardCharsets.UTF_8));
                        }
                    }
                    assetFiles.put(asset);
                }
            }

            JSONArray foldersArr = new JSONArray();
            for (String std : STANDARD_MOD_FOLDERS) {
                if (presentFolders.contains(std)) foldersArr.put(std);
            }

            JSONObject out = new JSONObject();
            out.put("sourceId", sourceId);
            out.put("sourceType", "archive");
            out.put("sourcePath", sourcePath);
            out.put("modifiedAtMs", modifiedAtMs);
            out.put("manifestRaw", manifestRaw != null ? manifestRaw : JSONObject.NULL);
            out.put("manifestError", manifestError != null ? manifestError : JSONObject.NULL);
            out.put("presentFolders", foldersArr);
            out.put("contentFiles", contentFiles);
            out.put("assetFiles", assetFiles);
            out.put("executableFiles", executableFiles);
            out.put("archiveCorrupt", false);
            return out;
        } catch (Exception e) {
            try {
                JSONObject err = new JSONObject();
                err.put("sourceId", sourceId);
                err.put("sourceType", "archive");
                err.put("sourcePath", sourcePath);
                err.put("modifiedAtMs", modifiedAtMs);
                err.put("manifestRaw", JSONObject.NULL);
                err.put("manifestError", e.getMessage() != null ? e.getMessage() : "ARCHIVE_CORRUPT");
                err.put("presentFolders", new JSONArray());
                err.put("contentFiles", new JSONArray());
                err.put("assetFiles", new JSONArray());
                err.put("executableFiles", new JSONArray());
                err.put("archiveCorrupt", true);
                err.put("archiveError", e.getMessage() != null ? e.getMessage() : "ARCHIVE_CORRUPT");
                return err;
            } catch (Exception ignored) {
                return null;
            }
        }
    }

    private void walkDirectModDir(
        File modRootDir,
        File currentDir,
        String relPrefix,
        int depth,
        JSONArray contentFiles,
        JSONArray assetFiles,
        JSONArray executableFiles
    ) {
        if (depth > 8) return;
        File[] children = currentDir.listFiles();
        if (children == null) return;
        for (File child : children) {
            if (contentFiles.length() + assetFiles.length() >= MAX_MOD_ENTRIES) break;
            if (!isCanonicalChild(modRootDir, child)) continue;
            if (FILE_WOAMOD_META.equals(child.getName())) continue;
            String rel = relPrefix.isEmpty() ? child.getName() : relPrefix + "/" + child.getName();
            if (child.isDirectory()) {
                walkDirectModDir(modRootDir, child, rel, depth + 1, contentFiles, assetFiles, executableFiles);
                continue;
            }
            if (!child.isFile()) continue;

            String ext = getLowerExtension(child.getName());
            if (FORBIDDEN_MOD_EXTENSIONS.contains(ext)) {
                executableFiles.put(rel);
                continue;
            }
            if ("mod.json".equalsIgnoreCase(rel)) continue;

            String[] parts = rel.split("/");
            String rawTop = parts[0];
            String topFolder = normalizeModFolderCategory(rawTop);
            String rawSecond = "assets".equals(rawTop.toLowerCase(Locale.ROOT)) && parts.length > 1 ? parts[1] : null;
            String secondFolder = rawSecond != null ? normalizeModFolderCategory(rawSecond) : null;
            String contentCat = MOD_CONTENT_FOLDERS.contains(topFolder)
                ? topFolder
                : (secondFolder != null && MOD_CONTENT_FOLDERS.contains(secondFolder) ? secondFolder : null);
            try {
                if (contentCat != null && ".json".equals(ext)) {
                    JSONObject item = new JSONObject();
                    item.put("category", contentCat);
                    item.put("relativePath", rel);
                    if (child.length() > MAX_MOD_JSON_BYTES) {
                        item.put("rawText", "");
                        item.put("readError", "FILE_TOO_LARGE");
                    } else {
                        item.put("rawText", readFileUtf8(child));
                    }
                    contentFiles.put(item);
                } else {
                    String category = (secondFolder != null && MOD_ASSET_FOLDERS.contains(secondFolder))
                        ? secondFolder
                        : topFolder;
                    JSONObject asset = new JSONObject();
                    asset.put("category", category);
                    asset.put("relativePath", rel);
                    asset.put("sizeBytes", child.length());
                    if (".woa3d".equals(ext) && child.length() <= MAX_MOD_JSON_BYTES) {
                        asset.put("rawText", readFileUtf8(child));
                    }
                    assetFiles.put(asset);
                }
            } catch (Exception ignored) {
            }
        }
    }

    private JSONObject scanDirectFolderMod(File modsDir, File modDir) {
        try {
            if (!isCanonicalChild(modsDir, modDir)) return null;
            Set<String> presentFolders = new HashSet<>();
            File assetsSub = null;
            File[] rootChildren = modDir.listFiles();
            if (rootChildren != null) {
                for (File child : rootChildren) {
                    if (child.isDirectory()) {
                        String norm = normalizeModFolderCategory(child.getName());
                        if (STANDARD_MOD_FOLDERS.contains(norm)) {
                            presentFolders.add(norm);
                        }
                        if ("assets".equalsIgnoreCase(child.getName())) {
                            assetsSub = child;
                        }
                    }
                }
            }
            if (assetsSub == null) assetsSub = new File(modDir, "assets");
            if (assetsSub.isDirectory() && isCanonicalChild(modDir, assetsSub)) {
                File[] assetsChildren = assetsSub.listFiles();
                if (assetsChildren != null) {
                    for (File ac : assetsChildren) {
                        if (ac.isDirectory()) {
                            String norm = normalizeModFolderCategory(ac.getName());
                            if (STANDARD_MOD_FOLDERS.contains(norm)) {
                                presentFolders.add(norm);
                            }
                        }
                    }
                }
            }

            String manifestRaw = null;
            String manifestError = "MANIFEST_MISSING";
            File manifestFile = new File(modDir, "mod.json");
            if (manifestFile.exists() && manifestFile.isFile() && isCanonicalChild(modDir, manifestFile)) {
                if (manifestFile.length() > MAX_MOD_JSON_BYTES) {
                    manifestError = "MANIFEST_TOO_LARGE_OR_INVALID";
                } else {
                    manifestRaw = readFileUtf8(manifestFile);
                    manifestError = null;
                }
            }

            JSONObject packageMeta = null;
            File pkgMetaFile = new File(modDir, FILE_WOAMOD_META);
            if (pkgMetaFile.exists() && pkgMetaFile.isFile() && isCanonicalChild(modDir, pkgMetaFile)) {
                try {
                    JSONObject parsedMeta = parseValidJsonObject(readFileUtf8(pkgMetaFile));
                    if (parsedMeta != null && "woamod".equals(parsedMeta.optString("format", ""))) {
                        packageMeta = parsedMeta;
                    }
                } catch (Exception ignored) {
                }
            }

            JSONArray contentFiles = new JSONArray();
            JSONArray assetFiles = new JSONArray();
            JSONArray executableFiles = new JSONArray();
            walkDirectModDir(modDir, modDir, "", 0, contentFiles, assetFiles, executableFiles);

            JSONArray foldersArr = new JSONArray();
            for (String std : STANDARD_MOD_FOLDERS) {
                if (presentFolders.contains(std)) foldersArr.put(std);
            }

            JSONObject out = new JSONObject();
            out.put("sourceId", modDir.getName());
            out.put("sourceType", "folder");
            out.put("installKind", packageMeta != null ? "woamod" : "development");
            if (packageMeta != null) {
                String pfn = packageMeta.optString("packageFileName", "");
                if (!pfn.isEmpty()) out.put("packageFileName", pfn);
                long instMs = packageMeta.optLong("installedAtMs", 0L);
                if (instMs > 0L) out.put("installedAtMs", instMs);
            }
            out.put("sourcePath", modDir.getAbsolutePath());
            out.put("modifiedAtMs", modDir.lastModified());
            out.put("manifestRaw", manifestRaw != null ? manifestRaw : JSONObject.NULL);
            out.put("manifestError", manifestError != null ? manifestError : JSONObject.NULL);
            out.put("presentFolders", foldersArr);
            out.put("contentFiles", contentFiles);
            out.put("assetFiles", assetFiles);
            out.put("executableFiles", executableFiles);
            out.put("archiveCorrupt", false);
            return out;
        } catch (Exception e) {
            return null;
        }
    }

    private void walkSafModDir(
        Uri treeUri,
        String dirDocId,
        String relPrefix,
        int depth,
        JSONArray contentFiles,
        JSONArray assetFiles,
        JSONArray executableFiles,
        Set<String> presentFolders,
        StringBuilder manifestRawOut
    ) {
        if (depth > 8 || contentFiles.length() + assetFiles.length() >= MAX_MOD_ENTRIES) return;
        ContentResolver cr = appContext.getContentResolver();
        Uri childrenUri = DocumentsContract.buildChildDocumentsUriUsingTree(treeUri, dirDocId);
        String[] proj = new String[] {
            DocumentsContract.Document.COLUMN_DOCUMENT_ID,
            DocumentsContract.Document.COLUMN_DISPLAY_NAME,
            DocumentsContract.Document.COLUMN_MIME_TYPE,
            DocumentsContract.Document.COLUMN_SIZE,
        };
        try (Cursor c = cr.query(childrenUri, proj, null, null, null)) {
            if (c == null) return;
            int idIdx = c.getColumnIndex(DocumentsContract.Document.COLUMN_DOCUMENT_ID);
            int nameIdx = c.getColumnIndex(DocumentsContract.Document.COLUMN_DISPLAY_NAME);
            int mimeIdx = c.getColumnIndex(DocumentsContract.Document.COLUMN_MIME_TYPE);
            int sizeIdx = c.getColumnIndex(DocumentsContract.Document.COLUMN_SIZE);
            while (c.moveToNext()) {
                String docId = idIdx >= 0 ? c.getString(idIdx) : null;
                String name = nameIdx >= 0 ? c.getString(nameIdx) : null;
                String mime = mimeIdx >= 0 ? c.getString(mimeIdx) : "";
                long size = sizeIdx >= 0 ? c.getLong(sizeIdx) : 0L;
                if (docId == null || name == null || ".".equals(name) || "..".equals(name)) continue;

                String rel = relPrefix.isEmpty() ? name : relPrefix + "/" + name;
                boolean isDir = DocumentsContract.Document.MIME_TYPE_DIR.equals(mime);
                if (isDir) {
                    String normDir = normalizeModFolderCategory(name);
                    if (depth == 0 && STANDARD_MOD_FOLDERS.contains(normDir)) {
                        presentFolders.add(normDir);
                    } else if (depth == 1 && "assets".equalsIgnoreCase(relPrefix) && STANDARD_MOD_FOLDERS.contains(normDir)) {
                        presentFolders.add(normDir);
                    }
                    walkSafModDir(
                        treeUri, docId, rel, depth + 1,
                        contentFiles, assetFiles, executableFiles, presentFolders, manifestRawOut
                    );
                    continue;
                }

                String ext = getLowerExtension(name);
                if (FORBIDDEN_MOD_EXTENSIONS.contains(ext)) {
                    executableFiles.put(rel);
                    continue;
                }
                if ("mod.json".equalsIgnoreCase(rel)) {
                    if (size <= MAX_MOD_JSON_BYTES) {
                        String txt = readSafDocUtf8(treeUri, docId);
                        if (txt != null) manifestRawOut.append(txt);
                    }
                    continue;
                }

                String[] parts = rel.split("/");
                String rawTop = parts[0];
                String topFolder = normalizeModFolderCategory(rawTop);
                String rawSecond = "assets".equals(rawTop.toLowerCase(Locale.ROOT)) && parts.length > 1 ? parts[1] : null;
                String secondFolder = rawSecond != null ? normalizeModFolderCategory(rawSecond) : null;
                String contentCat = MOD_CONTENT_FOLDERS.contains(topFolder)
                    ? topFolder
                    : (secondFolder != null && MOD_CONTENT_FOLDERS.contains(secondFolder) ? secondFolder : null);
                try {
                    if (contentCat != null && ".json".equals(ext)) {
                        JSONObject item = new JSONObject();
                        item.put("category", contentCat);
                        item.put("relativePath", rel);
                        if (size > MAX_MOD_JSON_BYTES) {
                            item.put("rawText", "");
                            item.put("readError", "FILE_TOO_LARGE");
                        } else {
                            String txt = readSafDocUtf8(treeUri, docId);
                            item.put("rawText", txt != null ? txt : "");
                        }
                        contentFiles.put(item);
                    } else {
                        String category = (secondFolder != null && MOD_ASSET_FOLDERS.contains(secondFolder))
                            ? secondFolder
                            : topFolder;
                        JSONObject asset = new JSONObject();
                        asset.put("category", category);
                        asset.put("relativePath", rel);
                        asset.put("sizeBytes", size);
                        if (".woa3d".equals(ext) && size <= MAX_MOD_JSON_BYTES) {
                            String txt = readSafDocUtf8(treeUri, docId);
                            if (txt != null) asset.put("rawText", txt);
                        }
                        assetFiles.put(asset);
                    }
                } catch (Exception ignored) {
                }
            }
        } catch (Exception ignored) {
        }
    }

    public String listLocalModsJson() {
        synchronized (lock) {
            ensureInitializedAndMigrateLocked();
            JSONArray entries = new JSONArray();
            String mode = getActiveExternalModeLocked();

            if (externalWritableVerified) {
                if ("direct".equals(mode)) {
                    File modsDir = new File(getDirectRootDir(), DIR_MODS);
                    File[] children = modsDir.exists() && modsDir.isDirectory() ? modsDir.listFiles() : null;
                    if (children != null) {
                        for (File child : children) {
                            if (child.getName().startsWith(STAGING_DIR_PREFIX)) {
                                if (isCanonicalChild(modsDir, child)) {
                                    deleteRecursiveDirect(child);
                                }
                                continue;
                            }
                            if (child.getName().startsWith(".")) continue;
                            String safeId = sanitizeModSourceId(child.getName());
                            if (safeId == null) continue;
                            if (child.isDirectory()) {
                                JSONObject modObj = scanDirectFolderMod(modsDir, child);
                                if (modObj != null) entries.put(modObj);
                            } else if (child.isFile() && isArchiveModFileName(safeId)) {
                                if (child.length() <= MAX_MOD_PACKAGE_BYTES) {
                                    try (FileInputStream fis = new FileInputStream(child)) {
                                        JSONObject modObj = scanArchiveStreamToModEntry(
                                            safeId,
                                            child.getAbsolutePath(),
                                            child.lastModified(),
                                            fis
                                        );
                                        if (modObj != null) entries.put(modObj);
                                    } catch (Exception ignored) {
                                    }
                                }
                            }
                        }
                    }
                } else if ("saf".equals(mode)) {
                    Uri treeUri = getPersistedSafTreeUri();
                    if (treeUri != null) {
                        try {
                            String rootDocId = resolveSafRootDocId(treeUri, false);
                            String modsDocId = rootDocId != null ? findSafChildDocId(treeUri, rootDocId, DIR_MODS) : null;
                            if (modsDocId != null) {
                                ContentResolver cr = appContext.getContentResolver();
                                Uri childrenUri = DocumentsContract.buildChildDocumentsUriUsingTree(treeUri, modsDocId);
                                String[] proj = new String[] {
                                    DocumentsContract.Document.COLUMN_DOCUMENT_ID,
                                    DocumentsContract.Document.COLUMN_DISPLAY_NAME,
                                    DocumentsContract.Document.COLUMN_MIME_TYPE,
                                    DocumentsContract.Document.COLUMN_SIZE,
                                    DocumentsContract.Document.COLUMN_LAST_MODIFIED,
                                };
                                try (Cursor c = cr.query(childrenUri, proj, null, null, null)) {
                                    if (c != null) {
                                        int idIdx = c.getColumnIndex(DocumentsContract.Document.COLUMN_DOCUMENT_ID);
                                        int nameIdx = c.getColumnIndex(DocumentsContract.Document.COLUMN_DISPLAY_NAME);
                                        int mimeIdx = c.getColumnIndex(DocumentsContract.Document.COLUMN_MIME_TYPE);
                                        int sizeIdx = c.getColumnIndex(DocumentsContract.Document.COLUMN_SIZE);
                                        int modIdx = c.getColumnIndex(DocumentsContract.Document.COLUMN_LAST_MODIFIED);
                                        while (c.moveToNext()) {
                                            String docId = idIdx >= 0 ? c.getString(idIdx) : null;
                                            String rawName = nameIdx >= 0 ? c.getString(nameIdx) : null;
                                            String mime = mimeIdx >= 0 ? c.getString(mimeIdx) : "";
                                            long size = sizeIdx >= 0 ? c.getLong(sizeIdx) : 0L;
                                            long lastMod = modIdx >= 0 ? c.getLong(modIdx) : System.currentTimeMillis();
                                            String safeId = sanitizeModSourceId(rawName);
                                            if (docId == null) continue;
                                            if (rawName != null && rawName.startsWith(STAGING_DIR_PREFIX)) {
                                                try {
                                                    DocumentsContract.deleteDocument(
                                                        cr,
                                                        DocumentsContract.buildDocumentUriUsingTree(treeUri, docId)
                                                    );
                                                } catch (Exception ignored) {
                                                }
                                                continue;
                                            }
                                            if (safeId == null || safeId.startsWith(".")) continue;

                                            if (DocumentsContract.Document.MIME_TYPE_DIR.equals(mime)) {
                                                Set<String> presentFolders = new HashSet<>();
                                                JSONArray contentFiles = new JSONArray();
                                                JSONArray assetFiles = new JSONArray();
                                                JSONArray executableFiles = new JSONArray();
                                                StringBuilder manifestBuf = new StringBuilder();
                                                walkSafModDir(
                                                    treeUri, docId, "", 0,
                                                    contentFiles, assetFiles, executableFiles, presentFolders, manifestBuf
                                                );
                                                JSONObject safPkgMeta = null;
                                                String metaDocId = findSafChildDocId(treeUri, docId, FILE_WOAMOD_META);
                                                if (metaDocId != null) {
                                                    safPkgMeta = parseValidJsonObject(readSafDocUtf8(treeUri, metaDocId));
                                                }
                                                boolean isWoamodPkg = safPkgMeta != null && "woamod".equals(safPkgMeta.optString("format", ""));
                                                JSONArray foldersArr = new JSONArray();
                                                for (String std : STANDARD_MOD_FOLDERS) {
                                                    if (presentFolders.contains(std)) foldersArr.put(std);
                                                }
                                                String manifestRaw = manifestBuf.length() > 0 ? manifestBuf.toString() : null;
                                                JSONObject out = new JSONObject();
                                                out.put("sourceId", safeId);
                                                out.put("sourceType", "folder");
                                                out.put("installKind", isWoamodPkg ? "woamod" : "development");
                                                if (isWoamodPkg) {
                                                    String pfn = safPkgMeta.optString("packageFileName", "");
                                                    if (!pfn.isEmpty()) out.put("packageFileName", pfn);
                                                    long instMs = safPkgMeta.optLong("installedAtMs", 0L);
                                                    if (instMs > 0L) out.put("installedAtMs", instMs);
                                                }
                                                out.put("sourcePath", VISIBLE_MODS_PATH + safeId + "/");
                                                out.put("modifiedAtMs", lastMod);
                                                out.put("manifestRaw", manifestRaw != null ? manifestRaw : JSONObject.NULL);
                                                out.put("manifestError", manifestRaw != null ? JSONObject.NULL : "MANIFEST_MISSING");
                                                out.put("presentFolders", foldersArr);
                                                out.put("contentFiles", contentFiles);
                                                out.put("assetFiles", assetFiles);
                                                out.put("executableFiles", executableFiles);
                                                out.put("archiveCorrupt", false);
                                                entries.put(out);
                                            } else if (isArchiveModFileName(safeId) && size <= MAX_MOD_PACKAGE_BYTES) {
                                                Uri docUri = DocumentsContract.buildDocumentUriUsingTree(treeUri, docId);
                                                try (InputStream is = cr.openInputStream(docUri)) {
                                                    if (is != null) {
                                                        JSONObject modObj = scanArchiveStreamToModEntry(
                                                            safeId,
                                                            VISIBLE_MODS_PATH + safeId,
                                                            lastMod,
                                                            is
                                                        );
                                                        if (modObj != null) entries.put(modObj);
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        } catch (Exception ignored) {
                        }
                    }
                }
            }

            try {
                JSONObject res = new JSONObject();
                res.put("ok", true);
                res.put("writable", externalWritableVerified);
                res.put("modsDir", VISIBLE_MODS_PATH);
                res.put("mode", mode);
                res.put("entries", entries);
                return res.toString();
            } catch (Exception e) {
                return "{\"ok\":false,\"writable\":false,\"modsDir\":\"" + VISIBLE_MODS_PATH + "\",\"entries\":[]}";
            }
        }
    }

    public String readModStateJson() {
        synchronized (lock) {
            ensureInitializedAndMigrateLocked();
            if (!externalWritableVerified) {
                return "{\"ok\":false,\"error\":\"PERMISSION_REQUIRED\"}";
            }
            try {
                String mode = getActiveExternalModeLocked();
                JSONObject state = null;
                if ("direct".equals(mode)) {
                    File root = getDirectRootDir();
                    state = readJsonDirectWithBackups(
                        new File(new File(root, DIR_SETTINGS), FILE_MODS_CONFIG),
                        new File(new File(root, DIR_BACKUPS), FILE_MODS_CONFIG + ".bak")
                    );
                } else if ("saf".equals(mode)) {
                    Uri treeUri = getPersistedSafTreeUri();
                    if (treeUri != null) {
                        String rootDocId = resolveSafRootDocId(treeUri, false);
                        String settingsDocId = rootDocId != null ? findSafChildDocId(treeUri, rootDocId, DIR_SETTINGS) : null;
                        String backupsDocId = rootDocId != null ? findSafChildDocId(treeUri, rootDocId, DIR_BACKUPS) : null;
                        if (settingsDocId != null) {
                            state = readJsonSafWithBackup(treeUri, settingsDocId, FILE_MODS_CONFIG, backupsDocId);
                        }
                    }
                }
                if (state == null) {
                    state = new JSONObject();
                    state.put("version", 1);
                    state.put("enabledByModId", new JSONObject());
                    state.put("priorityByModId", new JSONObject());
                }
                JSONObject res = new JSONObject();
                res.put("ok", true);
                res.put("state", state);
                return res.toString();
            } catch (Exception e) {
                return "{\"ok\":false,\"error\":\"MOD_STATE_READ_FAILED\"}";
            }
        }
    }

    public String writeModStateJson(String stateJson) {
        return writeSettingFileJson("mods", stateJson);
    }

    public String readModAssetJson(String sourceId, String relativePath) {
        synchronized (lock) {
            String safeSource = sanitizeModSourceId(sourceId);
            String safeRel = sanitizeModRelativePath(relativePath);
            if (safeSource == null || safeRel == null) {
                return "{\"ok\":false,\"error\":\"INVALID_MOD_ASSET_PATH\"}";
            }
            String ext = getLowerExtension(safeRel);
            String mimeType = ALLOWED_MOD_ASSET_MIME.get(ext);
            if (mimeType == null || FORBIDDEN_MOD_EXTENSIONS.contains(ext)) {
                return "{\"ok\":false,\"error\":\"UNSUPPORTED_OR_FORBIDDEN_ASSET_TYPE\"}";
            }
            ensureInitializedAndMigrateLocked();
            if (!externalWritableVerified) {
                return "{\"ok\":false,\"error\":\"PERMISSION_REQUIRED\"}";
            }

            try {
                byte[] assetBytes = null;
                String mode = getActiveExternalModeLocked();

                if ("direct".equals(mode)) {
                    File modsDir = new File(getDirectRootDir(), DIR_MODS);
                    File sourceFile = new File(modsDir, safeSource);
                    if (!isCanonicalChild(modsDir, sourceFile)) {
                        return "{\"ok\":false,\"error\":\"PATH_OUTSIDE_MODS_DIR\"}";
                    }
                    if (sourceFile.isDirectory()) {
                        File assetFile = new File(sourceFile, safeRel);
                        if (!isCanonicalChild(sourceFile, assetFile) || !assetFile.isFile()) {
                            return "{\"ok\":false,\"error\":\"ASSET_NOT_FOUND\"}";
                        }
                        if (assetFile.length() > MAX_MOD_ASSET_BYTES) {
                            return "{\"ok\":false,\"error\":\"ASSET_TOO_LARGE\"}";
                        }
                        try (FileInputStream fis = new FileInputStream(assetFile)) {
                            assetBytes = readStreamCapped(fis, MAX_MOD_ASSET_BYTES);
                        }
                    } else if (sourceFile.isFile() && isArchiveModFileName(safeSource)) {
                        try (FileInputStream fis = new FileInputStream(sourceFile)) {
                            assetBytes = extractZipEntryBytes(fis, safeRel);
                        }
                    }
                } else if ("saf".equals(mode)) {
                    Uri treeUri = getPersistedSafTreeUri();
                    if (treeUri != null) {
                        String rootDocId = resolveSafRootDocId(treeUri, false);
                        String modsDocId = rootDocId != null ? findSafChildDocId(treeUri, rootDocId, DIR_MODS) : null;
                        String srcDocId = modsDocId != null ? findSafChildDocId(treeUri, modsDocId, safeSource) : null;
                        if (srcDocId != null) {
                            if (isArchiveModFileName(safeSource)) {
                                Uri arcUri = DocumentsContract.buildDocumentUriUsingTree(treeUri, srcDocId);
                                try (InputStream is = appContext.getContentResolver().openInputStream(arcUri)) {
                                    if (is != null) assetBytes = extractZipEntryBytes(is, safeRel);
                                }
                            } else {
                                String curDocId = srcDocId;
                                String[] parts = safeRel.split("/");
                                for (String seg : parts) {
                                    curDocId = curDocId != null ? findSafChildDocId(treeUri, curDocId, seg) : null;
                                }
                                if (curDocId != null) {
                                    Uri fileUri = DocumentsContract.buildDocumentUriUsingTree(treeUri, curDocId);
                                    try (InputStream is = appContext.getContentResolver().openInputStream(fileUri)) {
                                        if (is != null) assetBytes = readStreamCapped(is, MAX_MOD_ASSET_BYTES);
                                    }
                                }
                            }
                        }
                    }
                }

                if (assetBytes == null) {
                    return "{\"ok\":false,\"error\":\"ASSET_NOT_FOUND\"}";
                }
                JSONObject res = new JSONObject();
                res.put("ok", true);
                res.put("mimeType", mimeType);
                res.put("base64", Base64.encodeToString(assetBytes, Base64.NO_WRAP));
                res.put("sizeBytes", assetBytes.length);
                return res.toString();
            } catch (Exception e) {
                return "{\"ok\":false,\"error\":\"ASSET_READ_FAILED\"}";
            }
        }
    }

    private byte[] extractZipEntryBytes(InputStream rawArchiveStream, String targetRelPath) throws IOException {
        try (ZipInputStream zis = new ZipInputStream(rawArchiveStream)) {
            ZipEntry entry;
            int count = 0;
            while ((entry = zis.getNextEntry()) != null) {
                count++;
                if (count > MAX_MOD_ENTRIES) break;
                if (entry.isDirectory()) {
                    zis.closeEntry();
                    continue;
                }
                String cleanName = entry.getName()
                    .replace('\\', '/')
                    .replaceAll("^/+", "")
                    .replaceAll("/+$", "");
                if (cleanName.equals(targetRelPath) || cleanName.endsWith("/" + targetRelPath)) {
                    String remainderPrefix = cleanName.equals(targetRelPath)
                        ? ""
                        : cleanName.substring(0, cleanName.length() - targetRelPath.length());
                    if (remainderPrefix.isEmpty() || !remainderPrefix.substring(0, remainderPrefix.length() - 1).contains("/")) {
                        return readStreamCapped(zis, MAX_MOD_ASSET_BYTES);
                    }
                }
                zis.closeEntry();
            }
        }
        return null;
    }

    public String deleteLocalModJson(String sourceId) {
        synchronized (lock) {
            String safeSource = sanitizeModSourceId(sourceId);
            if (safeSource == null) {
                return "{\"ok\":false,\"error\":\"INVALID_MOD_SOURCE_ID\"}";
            }
            ensureInitializedAndMigrateLocked();
            if (!externalWritableVerified) {
                return "{\"ok\":false,\"error\":\"PERMISSION_REQUIRED\"}";
            }
            try {
                String mode = getActiveExternalModeLocked();
                if ("direct".equals(mode)) {
                    File modsDir = new File(getDirectRootDir(), DIR_MODS);
                    File target = new File(modsDir, safeSource);
                    if (!isCanonicalChild(modsDir, target)) {
                        return "{\"ok\":false,\"error\":\"PATH_OUTSIDE_MODS_DIR\"}";
                    }
                    if (!target.exists()) {
                        return "{\"ok\":false,\"error\":\"MOD_NOT_FOUND\"}";
                    }
                    deleteRecursiveDirect(target);
                    return "{\"ok\":true}";
                } else if ("saf".equals(mode)) {
                    Uri treeUri = getPersistedSafTreeUri();
                    if (treeUri != null) {
                        String rootDocId = resolveSafRootDocId(treeUri, false);
                        String modsDocId = rootDocId != null ? findSafChildDocId(treeUri, rootDocId, DIR_MODS) : null;
                        String srcDocId = modsDocId != null ? findSafChildDocId(treeUri, modsDocId, safeSource) : null;
                        if (srcDocId == null) {
                            return "{\"ok\":false,\"error\":\"MOD_NOT_FOUND\"}";
                        }
                        DocumentsContract.deleteDocument(
                            appContext.getContentResolver(),
                            DocumentsContract.buildDocumentUriUsingTree(treeUri, srcDocId)
                        );
                        return "{\"ok\":true}";
                    }
                }
                return "{\"ok\":false,\"error\":\"STORAGE_UNAVAILABLE\"}";
            } catch (Exception e) {
                return "{\"ok\":false,\"error\":\"MOD_DELETE_FAILED\"}";
            }
        }
    }

    public String importModPackageJson(String fileName, String base64Content) {
        synchronized (lock) {
            String safeName = sanitizeModSourceId(fileName);
            if (safeName == null || !safeName.toLowerCase(Locale.ROOT).endsWith(".woamod")) {
                return "{\"ok\":false,\"error\":\"INVALID_MOD_PACKAGE_EXTENSION\"}";
            }
            if (base64Content == null || base64Content.trim().isEmpty()) {
                return "{\"ok\":false,\"error\":\"EMPTY_PACKAGE_DATA\"}";
            }
            try {
                byte[] data = Base64.decode(base64Content, Base64.DEFAULT);
                return saveValidatedModPackageBytesLocked(safeName, data, null);
            } catch (Exception e) {
                return "{\"ok\":false,\"error\":\"CORRUPT_MOD_ARCHIVE\"}";
            }
        }
    }

    public String importModPackageFromUriJson(Uri uri, String fallbackName) {
        return importModPackageFromUriJson(uri, fallbackName, null);
    }

    public String importModPackageFromUriJson(
        Uri uri,
        String fallbackName,
        ModInstallProgressListener progressListener
    ) {
        synchronized (lock) {
            if (uri == null) {
                return "{\"ok\":false,\"error\":\"IMPORT_CANCELLED\"}";
            }
            String resolvedName = fallbackName;
            long reportedSize = 0L;
            try (Cursor c = appContext.getContentResolver().query(
                uri,
                new String[] { OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE },
                null,
                null,
                null
            )) {
                if (c != null && c.moveToFirst()) {
                    int nameIdx = c.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                    int sizeIdx = c.getColumnIndex(OpenableColumns.SIZE);
                    if (nameIdx >= 0) {
                        String n = c.getString(nameIdx);
                        if (n != null && !n.trim().isEmpty()) {
                            resolvedName = n.trim();
                        }
                    }
                    if (sizeIdx >= 0) {
                        reportedSize = Math.max(0L, c.getLong(sizeIdx));
                    }
                }
            } catch (Exception ignored) {
            }

            String safeName = sanitizeModSourceId(resolvedName);
            if (safeName == null || !safeName.toLowerCase(Locale.ROOT).endsWith(".woamod")) {
                return "{\"ok\":false,\"error\":\"INVALID_MOD_PACKAGE_EXTENSION\"}";
            }

            emitInstallProgress(progressListener, "reading", safeName, 5, 0L, reportedSize, 0, 0, null, null);
            try (InputStream is = appContext.getContentResolver().openInputStream(uri)) {
                if (is == null) {
                    return "{\"ok\":false,\"error\":\"UNREADABLE_PACKAGE_FILE\"}";
                }
                ByteArrayOutputStream baos = new ByteArrayOutputStream();
                byte[] chunk = new byte[32768];
                int readTotal = 0;
                int n;
                int lastReportedPct = 5;
                while ((n = is.read(chunk)) != -1) {
                    readTotal += n;
                    if (readTotal > MAX_MOD_PACKAGE_BYTES) {
                        return "{\"ok\":false,\"error\":\"INVALID_PACKAGE_SIZE\"}";
                    }
                    baos.write(chunk, 0, n);
                    if (reportedSize > 0) {
                        int pct = 5 + (int) Math.min(30, (readTotal * 30L) / reportedSize);
                        if (pct >= lastReportedPct + 5) {
                            lastReportedPct = pct;
                            emitInstallProgress(
                                progressListener, "reading", safeName, pct,
                                readTotal, reportedSize, 0, 0, null, null
                            );
                        }
                    }
                }
                byte[] data = baos.toByteArray();
                return saveValidatedModPackageBytesLocked(safeName, data, progressListener);
            } catch (Exception e) {
                return "{\"ok\":false,\"error\":\"MOD_IMPORT_FAILED\"}";
            }
        }
    }

    private void emitInstallProgress(
        ModInstallProgressListener listener,
        String stage,
        String fileName,
        int percent,
        long processedBytes,
        long totalBytes,
        int entriesDone,
        int entriesTotal,
        String currentEntry,
        String message
    ) {
        if (listener == null) return;
        try {
            JSONObject p = new JSONObject();
            p.put("stage", stage);
            p.put("fileName", fileName);
            p.put("percent", Math.max(0, Math.min(100, percent)));
            p.put("processedBytes", processedBytes);
            p.put("totalBytes", totalBytes);
            if (entriesTotal > 0) {
                p.put("entriesDone", entriesDone);
                p.put("entriesTotal", entriesTotal);
            }
            if (currentEntry != null) p.put("currentEntry", currentEntry);
            if (message != null) p.put("message", message);
            listener.onProgress(p.toString());
        } catch (Exception ignored) {
        }
    }

    private static int[] parseBasicSemver(String raw) {
        if (raw == null) return null;
        String clean = raw.trim();
        if (clean.startsWith("v") || clean.startsWith("V")) clean = clean.substring(1).trim();
        int plus = clean.indexOf('+');
        if (plus >= 0) clean = clean.substring(0, plus);
        int dash = clean.indexOf('-');
        if (dash >= 0) clean = clean.substring(0, dash);
        String[] parts = clean.split("\\.");
        if (parts.length == 0 || parts.length > 3) return null;
        try {
            int major = Integer.parseInt(parts[0]);
            int minor = parts.length > 1 ? Integer.parseInt(parts[1]) : 0;
            int patch = parts.length > 2 ? Integer.parseInt(parts[2]) : 0;
            if (major < 0 || minor < 0 || patch < 0) return null;
            return new int[] { major, minor, patch };
        } catch (Exception e) {
            return null;
        }
    }

    private static int compareBasicSemver(int[] a, int[] b) {
        if (a[0] != b[0]) return Integer.compare(a[0], b[0]);
        if (a[1] != b[1]) return Integer.compare(a[1], b[1]);
        return Integer.compare(a[2], b[2]);
    }

    private static boolean satisfiesBasicSemverRange(String actualStr, String rangeExpr) {
        if (rangeExpr == null || rangeExpr.trim().isEmpty()) return false;
        String clean = rangeExpr.trim();
        if ("*".equals(clean)) return true;
        int[] actual = parseBasicSemver(actualStr);
        if (actual == null) return false;
        String[] tokens = clean.split("\\s+");
        for (String tok : tokens) {
            if (tok.isEmpty()) continue;
            if (tok.startsWith(">=")) {
                int[] v = parseBasicSemver(tok.substring(2));
                if (v == null || compareBasicSemver(actual, v) < 0) return false;
            } else if (tok.startsWith("<=")) {
                int[] v = parseBasicSemver(tok.substring(2));
                if (v == null || compareBasicSemver(actual, v) > 0) return false;
            } else if (tok.startsWith(">")) {
                int[] v = parseBasicSemver(tok.substring(1));
                if (v == null || compareBasicSemver(actual, v) <= 0) return false;
            } else if (tok.startsWith("<")) {
                int[] v = parseBasicSemver(tok.substring(1));
                if (v == null || compareBasicSemver(actual, v) >= 0) return false;
            } else if (tok.startsWith("^")) {
                int[] v = parseBasicSemver(tok.substring(1));
                if (v == null || compareBasicSemver(actual, v) < 0 || actual[0] != v[0]) return false;
            } else if (tok.startsWith("~")) {
                int[] v = parseBasicSemver(tok.substring(1));
                if (v == null || compareBasicSemver(actual, v) < 0 || actual[0] != v[0] || actual[1] != v[1]) return false;
            } else {
                String exactStr = tok.startsWith("=") ? tok.substring(1) : tok;
                int[] v = parseBasicSemver(exactStr);
                if (v == null || compareBasicSemver(actual, v) != 0) return false;
            }
        }
        return true;
    }

    private String getOrCreateSafNestedDir(Uri treeUri, String parentDocId, String relDirPath) throws Exception {
        String cur = parentDocId;
        String[] segs = relDirPath.split("/");
        for (String seg : segs) {
            if (seg == null || seg.isEmpty()) continue;
            cur = getOrCreateSafDirDocId(treeUri, cur, seg);
        }
        return cur;
    }

    private void writeSafBytes(Uri treeUri, String parentDocId, String fileName, byte[] data) throws Exception {
        String existingId = findSafChildDocId(treeUri, parentDocId, fileName);
        Uri targetUri = existingId != null
            ? DocumentsContract.buildDocumentUriUsingTree(treeUri, existingId)
            : DocumentsContract.createDocument(
                appContext.getContentResolver(),
                DocumentsContract.buildDocumentUriUsingTree(treeUri, parentDocId),
                "application/octet-stream",
                fileName
            );
        if (targetUri == null) {
            throw new IOException("SAF_CREATE_FAILED:" + fileName);
        }
        try (OutputStream os = appContext.getContentResolver().openOutputStream(targetUri, "wt")) {
            if (os == null) throw new IOException("SAF_WRITE_FAILED:" + fileName);
            os.write(data);
            os.flush();
        }
    }

    private String saveValidatedModPackageBytesLocked(
        String safeName,
        byte[] data,
        ModInstallProgressListener progressListener
    ) {
        ensureInitializedAndMigrateLocked();
        if (!externalWritableVerified) {
            return "{\"ok\":false,\"error\":\"PERMISSION_REQUIRED\"}";
        }
        if (safeName == null || !safeName.toLowerCase(Locale.ROOT).endsWith(".woamod")) {
            return "{\"ok\":false,\"error\":\"INVALID_MOD_PACKAGE_EXTENSION\"}";
        }

        File directStaging = null;
        boolean directCommitted = false;
        Uri safTreeUri = null;
        String safStagingDocId = null;
        boolean safCommitted = false;

        try {
            if (data == null || data.length < 22 || data.length > MAX_MOD_PACKAGE_BYTES) {
                return "{\"ok\":false,\"error\":\"INVALID_PACKAGE_SIZE\"}";
            }
            if (data[0] != 0x50 || data[1] != 0x4b || data[2] != 0x03 || data[3] != 0x04) {
                return "{\"ok\":false,\"error\":\"INVALID_ZIP_SIGNATURE\"}";
            }

            emitInstallProgress(progressListener, "validating", safeName, 38, data.length, data.length, 0, 0, null, null);

            // 1. Pre-scan & extract archive entries into memory-bounded map while checking path traversal, symlinks/executables & zip bombs
            List<String> allRawNames = new ArrayList<>();
            Set<String> rawDirSet = new HashSet<>();
            Map<String, byte[]> extractedFiles = new HashMap<>();
            long totalUncompressed = 0L;

            try (ZipInputStream zis = new ZipInputStream(new ByteArrayInputStream(data))) {
                ZipEntry e;
                int entryCount = 0;
                while ((e = zis.getNextEntry()) != null) {
                    entryCount++;
                    if (entryCount > MAX_MOD_ENTRIES) {
                        return "{\"ok\":false,\"error\":\"MOD_TOO_MANY_FILES\"}";
                    }
                    String rawName = e.getName();
                    if (rawName == null || rawName.indexOf('\0') >= 0) {
                        return "{\"ok\":false,\"error\":\"PATH_TRAVERSAL_BLOCKED\"}";
                    }
                    String unix = rawName.replace('\\', '/');
                    if (unix.startsWith("/") || (unix.length() >= 2 && Character.isLetter(unix.charAt(0)) && unix.charAt(1) == ':')) {
                        return "{\"ok\":false,\"error\":\"PATH_TRAVERSAL_BLOCKED\"}";
                    }
                    String cleanName = unix.replaceAll("/+$", "");
                    if (cleanName.isEmpty()) {
                        zis.closeEntry();
                        continue;
                    }
                    for (String seg : cleanName.split("/")) {
                        if (seg.isEmpty() || ".".equals(seg) || "..".equals(seg)) {
                            return "{\"ok\":false,\"error\":\"PATH_TRAVERSAL_BLOCKED\"}";
                        }
                    }

                    allRawNames.add(cleanName);
                    if (e.isDirectory()) {
                        rawDirSet.add(cleanName);
                    } else {
                        byte[] fileBytes = readStreamCapped(zis, MAX_MOD_ASSET_BYTES);
                        totalUncompressed += fileBytes.length;
                        if (totalUncompressed > MAX_MOD_TOTAL_UNCOMPRESSED) {
                            return "{\"ok\":false,\"error\":\"ZIP_TOTAL_SIZE_EXCEEDED\"}";
                        }
                        extractedFiles.put(cleanName, fileBytes);
                    }
                    zis.closeEntry();
                }
            } catch (IOException ioErr) {
                String msg = ioErr.getMessage();
                if ("FILE_TOO_LARGE".equals(msg)) {
                    return "{\"ok\":false,\"error\":\"ZIP_ENTRY_TOO_LARGE\"}";
                }
                return "{\"ok\":false,\"error\":\"CORRUPT_MOD_ARCHIVE\"}";
            }

            if (allRawNames.isEmpty() || extractedFiles.isEmpty()) {
                return "{\"ok\":false,\"error\":\"CORRUPT_MOD_ARCHIVE\"}";
            }

            // Detect single top-level wrapper folder when mod.json is nested 1 level down
            String stripPrefix = "";
            if (!extractedFiles.containsKey("mod.json")) {
                Set<String> roots = new HashSet<>();
                for (String n : allRawNames) {
                    int slash = n.indexOf('/');
                    roots.add(slash >= 0 ? n.substring(0, slash) : n);
                }
                if (roots.size() == 1) {
                    String singleRoot = roots.iterator().next();
                    if (extractedFiles.containsKey(singleRoot + "/mod.json")) {
                        stripPrefix = singleRoot + "/";
                    }
                }
            }

            Map<String, byte[]> finalFiles = new HashMap<>();
            Set<String> finalDirs = new HashSet<>();
            Set<String> presentStdFolders = new HashSet<>();
            byte[] manifestBytes = null;

            for (String rawName : allRawNames) {
                String rel = rawName;
                if (!stripPrefix.isEmpty()) {
                    if (rawName.startsWith(stripPrefix)) {
                        rel = rawName.substring(stripPrefix.length());
                    } else if (rawName.equals(stripPrefix.substring(0, stripPrefix.length() - 1))) {
                        continue;
                    }
                }
                if (rel.isEmpty()) continue;
                if (FILE_WOAMOD_META.equals(rel) || rel.endsWith("/" + FILE_WOAMOD_META)) {
                    return "{\"ok\":false,\"error\":\"PATH_TRAVERSAL_BLOCKED\"}";
                }
                String[] parts = rel.split("/");
                String topFolder = parts[0].toLowerCase(Locale.ROOT);
                boolean isDirEntry = rawDirSet.contains(rawName);
                if (STANDARD_MOD_FOLDERS.contains(topFolder) && (isDirEntry || parts.length > 1)) {
                    presentStdFolders.add(topFolder);
                }
                if ("assets".equals(topFolder) && parts.length > 1) {
                    String sub = parts[1].toLowerCase(Locale.ROOT);
                    if (STANDARD_MOD_FOLDERS.contains(sub)) presentStdFolders.add(sub);
                }

                if (isDirEntry) {
                    finalDirs.add(rel);
                    continue;
                }

                String ext = getLowerExtension(rel);
                if (FORBIDDEN_MOD_EXTENSIONS.contains(ext)) {
                    return "{\"ok\":false,\"error\":\"UNSAFE_EXECUTABLE_CONTENT\",\"detail\":" + JSONObject.quote(rel) + "}";
                }
                byte[] content = extractedFiles.get(rawName);
                if ("mod.json".equals(rel)) {
                    if (content.length > MAX_MOD_JSON_BYTES) {
                        return "{\"ok\":false,\"error\":\"MANIFEST_TOO_LARGE_OR_INVALID\"}";
                    }
                    manifestBytes = content;
                } else if ((MOD_CONTENT_FOLDERS.contains(topFolder) && ".json".equals(ext)) || ".woa3d".equals(ext)) {
                    if (content.length > MAX_MOD_JSON_BYTES) {
                        return "{\"ok\":false,\"error\":\"ZIP_ENTRY_TOO_LARGE\"}";
                    }
                    // Verify JSON content integrity before extracting
                    try {
                        new org.json.JSONTokener(new String(content, StandardCharsets.UTF_8)).nextValue();
                    } catch (Exception parseErr) {
                        return "{\"ok\":false,\"error\":\"CORRUPT_CONTENT_JSON\",\"detail\":" + JSONObject.quote(rel) + "}";
                    }
                }
                finalFiles.put(rel, content);
            }

            if (manifestBytes == null) {
                return "{\"ok\":false,\"error\":\"REQUIRED_FILES_MISSING\",\"detail\":\"mod.json missing\"}";
            }

            JSONObject manifest = parseValidJsonObject(new String(manifestBytes, StandardCharsets.UTF_8));
            if (manifest == null) {
                return "{\"ok\":false,\"error\":\"CORRUPT_MOD_ARCHIVE\",\"detail\":\"Invalid mod.json\"}";
            }
            String modId = manifest.optString("modId", "").trim();
            String modName = manifest.optString("name", "").trim();
            String modVersion = manifest.optString("version", "").trim();
            String modAuthor = manifest.optString("author", "").trim();
            String supportedGameVer = manifest.optString("supportedGameVersion", "").trim();
            if (!modId.matches("^[A-Za-z0-9][A-Za-z0-9._-]{1,63}$") ||
                modName.isEmpty() ||
                parseBasicSemver(modVersion) == null ||
                modAuthor.isEmpty() ||
                supportedGameVer.isEmpty() ||
                presentStdFolders.isEmpty()
            ) {
                return "{\"ok\":false,\"error\":\"REQUIRED_FILES_MISSING\",\"detail\":\"Missing required manifest fields or standard mod folders\"}";
            }

            if (!satisfiesBasicSemverRange(CURRENT_GAME_VERSION, supportedGameVer)) {
                return "{\"ok\":false,\"error\":\"UNSUPPORTED_GAME_VERSION\",\"detail\":" + JSONObject.quote("Requires " + supportedGameVer + ", current version is " + CURRENT_GAME_VERSION) + "}";
            }

            String minGameVer = manifest.optString("minGameVersion", "").trim();
            String maxGameVer = manifest.optString("maxGameVersion", "").trim();
            int[] curSem = parseBasicSemver(CURRENT_GAME_VERSION);
            if (!minGameVer.isEmpty()) {
                int[] minSem = parseBasicSemver(minGameVer);
                if (minSem == null || (curSem != null && compareBasicSemver(curSem, minSem) < 0)) {
                    return "{\"ok\":false,\"error\":\"UNSUPPORTED_GAME_VERSION\",\"detail\":" + JSONObject.quote("Requires >= " + minGameVer + ", current version is " + CURRENT_GAME_VERSION) + "}";
                }
            }
            if (!maxGameVer.isEmpty()) {
                int[] maxSem = parseBasicSemver(maxGameVer);
                if (maxSem == null || (curSem != null && compareBasicSemver(curSem, maxSem) > 0)) {
                    return "{\"ok\":false,\"error\":\"UNSUPPORTED_GAME_VERSION\",\"detail\":" + JSONObject.quote("Supports <= " + maxGameVer + ", current version is " + CURRENT_GAME_VERSION) + "}";
                }
            }

            int reqSchema = manifest.has("schemaVersion") && !manifest.isNull("schemaVersion")
                ? manifest.optInt("schemaVersion", -1)
                : 1;
            if (!SUPPORTED_MOD_SCHEMA_VERSIONS.contains(reqSchema)) {
                return "{\"ok\":false,\"error\":\"UNSUPPORTED_MOD_SCHEMA_VERSION\",\"detail\":" + JSONObject.quote("Unsupported schemaVersion v" + reqSchema) + "}";
            }

            // Collect installed mod versions for duplicate + dependency checks
            Map<String, String> installedVersionsByModId = new HashMap<>();
            Map<String, String> installedSourceByModId = new HashMap<>();
            try {
                JSONObject existingList = new JSONObject(listLocalModsJson());
                JSONArray existingArr = existingList.optJSONArray("entries");
                if (existingArr != null) {
                    for (int i = 0; i < existingArr.length(); i++) {
                        JSONObject item = existingArr.optJSONObject(i);
                        if (item == null) continue;
                        String mRaw = item.optString("manifestRaw", "");
                        JSONObject mObj = parseValidJsonObject(mRaw);
                        if (mObj == null) continue;
                        String existingModId = mObj.optString("modId", "").trim();
                        String existingVer = mObj.optString("version", "").trim();
                        if (!existingModId.isEmpty()) {
                            installedVersionsByModId.put(existingModId, existingVer);
                            installedSourceByModId.put(existingModId, item.optString("sourceId", existingModId));
                        }
                    }
                }
            } catch (Exception ignored) {
            }

            if (installedVersionsByModId.containsKey(modId)) {
                return "{\"ok\":false,\"error\":\"DUPLICATE_MOD_ID\",\"detail\":" +
                    JSONObject.quote("Conflicts with \"" + installedSourceByModId.get(modId) + "\"") + "}";
            }

            JSONArray deps = manifest.optJSONArray("dependencies");
            if (deps != null) {
                for (int i = 0; i < deps.length(); i++) {
                    Object depEntry = deps.opt(i);
                    String depId = null;
                    String depRange = null;
                    boolean optional = false;
                    if (depEntry instanceof String) {
                        depId = ((String) depEntry).trim();
                    } else if (depEntry instanceof JSONObject) {
                        JSONObject dObj = (JSONObject) depEntry;
                        depId = dObj.optString("modId", dObj.optString("id", "")).trim();
                        depRange = dObj.optString("versionRange", dObj.optString("version", "")).trim();
                        optional = dObj.optBoolean("optional", false);
                    }
                    if (depId == null || depId.isEmpty() || optional) continue;
                    String installedDepVer = installedVersionsByModId.get(depId);
                    if (installedDepVer == null) {
                        return "{\"ok\":false,\"error\":\"MISSING_DEPENDENCY\",\"detail\":" + JSONObject.quote(depId) + "}";
                    }
                    if (depRange != null && !depRange.isEmpty() && !satisfiesBasicSemverRange(installedDepVer, depRange)) {
                        return "{\"ok\":false,\"error\":\"DEPENDENCY_VERSION_MISMATCH\",\"detail\":" + JSONObject.quote(depId + " (" + depRange + ")") + "}";
                    }
                }
            }

            String safeFolder = sanitizeModSourceId(modId.replaceAll("[^A-Za-z0-9._-]", "_"));
            if (safeFolder == null || safeFolder.startsWith(".")) {
                return "{\"ok\":false,\"error\":\"INVALID_MOD_SOURCE_ID\"}";
            }

            long installedAtMs = System.currentTimeMillis();
            JSONObject pkgMeta = new JSONObject();
            pkgMeta.put("format", "woamod");
            pkgMeta.put("packageVersion", 1);
            pkgMeta.put("modId", modId);
            pkgMeta.put("version", modVersion);
            pkgMeta.put("packageFileName", safeName);
            pkgMeta.put("installedAtMs", installedAtMs);
            byte[] pkgMetaBytes = pkgMeta.toString(2).getBytes(StandardCharsets.UTF_8);

            String mode = getActiveExternalModeLocked();
            int totalFilesCount = Math.max(1, finalFiles.size());
            int doneFiles = 0;

            if ("direct".equals(mode)) {
                File modsDir = new File(getDirectRootDir(), DIR_MODS);
                if (!modsDir.exists()) modsDir.mkdirs();
                File finalTargetDir = new File(modsDir, safeFolder);
                if (!isCanonicalChild(modsDir, finalTargetDir)) {
                    return "{\"ok\":false,\"error\":\"PATH_TRAVERSAL_BLOCKED\"}";
                }
                if (finalTargetDir.exists()) {
                    return "{\"ok\":false,\"error\":\"TARGET_ALREADY_EXISTS\",\"detail\":" + JSONObject.quote(safeFolder) + "}";
                }

                directStaging = new File(modsDir, STAGING_DIR_PREFIX + System.currentTimeMillis());
                if (!isCanonicalChild(modsDir, directStaging) || !directStaging.mkdirs()) {
                    return "{\"ok\":false,\"error\":\"STAGING_CREATE_FAILED\"}";
                }

                for (String relDir : finalDirs) {
                    File d = new File(directStaging, relDir);
                    if (!isCanonicalChild(directStaging, d)) {
                        return "{\"ok\":false,\"error\":\"PATH_TRAVERSAL_BLOCKED\"}";
                    }
                    d.mkdirs();
                }

                for (Map.Entry<String, byte[]> entry : finalFiles.entrySet()) {
                    String relPath = entry.getKey();
                    File dest = new File(directStaging, relPath);
                    File parent = dest.getParentFile();
                    if (parent != null && !parent.exists()) parent.mkdirs();
                    if (!isCanonicalChild(directStaging, dest)) {
                        return "{\"ok\":false,\"error\":\"PATH_TRAVERSAL_BLOCKED\"}";
                    }
                    try (FileOutputStream fos = new FileOutputStream(dest, false)) {
                        fos.write(entry.getValue());
                        fos.flush();
                    }
                    doneFiles++;
                    if (doneFiles % 3 == 0 || doneFiles == totalFilesCount) {
                        int pct = 55 + (int) Math.round((doneFiles * 40.0) / totalFilesCount);
                        emitInstallProgress(
                            progressListener, "extracting", safeName, pct,
                            data.length, data.length, doneFiles, totalFilesCount, relPath, null
                        );
                    }
                }

                File metaFile = new File(directStaging, FILE_WOAMOD_META);
                if (!isCanonicalChild(directStaging, metaFile)) {
                    return "{\"ok\":false,\"error\":\"PATH_TRAVERSAL_BLOCKED\"}";
                }
                try (FileOutputStream fos = new FileOutputStream(metaFile, false)) {
                    fos.write(pkgMetaBytes);
                    fos.flush();
                    fos.getFD().sync();
                }

                if (finalTargetDir.exists()) {
                    return "{\"ok\":false,\"error\":\"TARGET_ALREADY_EXISTS\"}";
                }
                if (!directStaging.renameTo(finalTargetDir)) {
                    throw new IOException("Unable to commit .woamod staging folder");
                }
                directCommitted = true;
                scanMediaFile(finalTargetDir);

                JSONObject res = new JSONObject();
                res.put("ok", true);
                res.put("sourceId", safeFolder);
                res.put("modId", modId);
                res.put("sourcePath", finalTargetDir.getAbsolutePath());
                return res.toString();
            } else if ("saf".equals(mode)) {
                safTreeUri = getPersistedSafTreeUri();
                if (safTreeUri != null) {
                    String rootDocId = resolveSafRootDocId(safTreeUri, true);
                    String modsDocId = getOrCreateSafDirDocId(safTreeUri, rootDocId, DIR_MODS);
                    if (findSafChildDocId(safTreeUri, modsDocId, safeFolder) != null) {
                        return "{\"ok\":false,\"error\":\"TARGET_ALREADY_EXISTS\",\"detail\":" + JSONObject.quote(safeFolder) + "}";
                    }

                    String stagingName = STAGING_DIR_PREFIX + System.currentTimeMillis();
                    safStagingDocId = getOrCreateSafDirDocId(safTreeUri, modsDocId, stagingName);

                    for (String relDir : finalDirs) {
                        getOrCreateSafNestedDir(safTreeUri, safStagingDocId, relDir);
                    }

                    for (Map.Entry<String, byte[]> entry : finalFiles.entrySet()) {
                        String relPath = entry.getKey();
                        int slash = relPath.lastIndexOf('/');
                        String targetDirDocId = slash >= 0
                            ? getOrCreateSafNestedDir(safTreeUri, safStagingDocId, relPath.substring(0, slash))
                            : safStagingDocId;
                        String fileNameOnly = slash >= 0 ? relPath.substring(slash + 1) : relPath;
                        writeSafBytes(safTreeUri, targetDirDocId, fileNameOnly, entry.getValue());

                        doneFiles++;
                        if (doneFiles % 3 == 0 || doneFiles == totalFilesCount) {
                            int pct = 55 + (int) Math.round((doneFiles * 40.0) / totalFilesCount);
                            emitInstallProgress(
                                progressListener, "extracting", safeName, pct,
                                data.length, data.length, doneFiles, totalFilesCount, relPath, null
                            );
                        }
                    }

                    writeSafBytes(safTreeUri, safStagingDocId, FILE_WOAMOD_META, pkgMetaBytes);

                    Uri renamedUri = DocumentsContract.renameDocument(
                        appContext.getContentResolver(),
                        DocumentsContract.buildDocumentUriUsingTree(safTreeUri, safStagingDocId),
                        safeFolder
                    );
                    if (renamedUri == null) {
                        throw new IOException("SAF rename failed");
                    }
                    safCommitted = true;

                    JSONObject res = new JSONObject();
                    res.put("ok", true);
                    res.put("sourceId", safeFolder);
                    res.put("modId", modId);
                    res.put("sourcePath", VISIBLE_MODS_PATH + safeFolder + "/");
                    return res.toString();
                }
            }
            return "{\"ok\":false,\"error\":\"STORAGE_UNAVAILABLE\"}";
        } catch (Exception e) {
            return "{\"ok\":false,\"error\":\"MOD_IMPORT_FAILED\"}";
        } finally {
            if (!directCommitted && directStaging != null && directStaging.exists()) {
                emitInstallProgress(progressListener, "cleaning_up", safeName, 100, 0L, 0L, 0, 0, null, null);
                deleteRecursiveDirect(directStaging);
            }
            if (!safCommitted && safTreeUri != null && safStagingDocId != null) {
                emitInstallProgress(progressListener, "cleaning_up", safeName, 100, 0L, 0L, 0, 0, null, null);
                try {
                    DocumentsContract.deleteDocument(
                        appContext.getContentResolver(),
                        DocumentsContract.buildDocumentUriUsingTree(safTreeUri, safStagingDocId)
                    );
                } catch (Exception ignored) {
                }
            }
        }
    }
}
