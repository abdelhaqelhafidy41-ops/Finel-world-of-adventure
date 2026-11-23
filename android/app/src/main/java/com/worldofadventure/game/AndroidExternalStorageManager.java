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
import androidx.core.content.ContextCompat;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
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

    private static final String PREFS_NAME = "woa_android_storage";
    private static final String PREF_SAF_TREE_URI = "saf_tree_uri";
    private static final String PREF_INITIALIZED_ONCE = "initialized_once";
    private static final String PREF_LAST_MODE = "last_storage_mode";
    private static final String PREF_ASKED_PERMISSION_ONCE = "asked_initial_permission";

    private static final String DIR_WORLDS = "Worlds";
    private static final String DIR_SETTINGS = "Settings";
    private static final String DIR_PROFILES = "Profiles";
    private static final String DIR_BACKUPS = "Backups";
    private static final String DIR_WORLD_BACKUPS = "backups";

    private static final String FILE_WORLD_DATA = "world-data.json";
    private static final String FILE_WORLD_SETTINGS = "world-settings.json";
    private static final String FILE_LEGACY_WORLD_SETTINGS = "settings.json";
    private static final String FILE_PLAYER_DATA = "player-data.json";
    private static final String FILE_WORLD_STATE = "world-state.json";
    private static final String FILE_PROFILE = "profile.json";

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
        return null;
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

                if (!root.exists()) root.mkdirs();
                if (!worldsDir.exists()) worldsDir.mkdirs();
                if (!settingsDir.exists()) settingsDir.mkdirs();
                if (!profilesDir.exists()) profilesDir.mkdirs();
                if (!backupsDir.exists()) backupsDir.mkdirs();

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
                return "{\"ok\":false,\"platform\":\"android\",\"state\":\"not_accessible\",\"path\":\"" + VISIBLE_TARGET_PATH + "\"}";
            }
        }
    }
}
