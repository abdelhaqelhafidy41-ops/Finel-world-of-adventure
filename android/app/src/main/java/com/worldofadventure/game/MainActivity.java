package com.worldofadventure.game;

import android.content.Intent;
import android.content.pm.ActivityInfo;
import android.content.res.Configuration;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebSettings;
import android.webkit.WebView;
import androidx.activity.OnBackPressedCallback;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import org.json.JSONArray;
import org.json.JSONObject;

public class MainActivity extends BridgeActivity {

    private LanMultiplayerServer lanServer;
    private final Object worldStorageLock = new Object();

    private File getWorldsRootDir() {
        File gameData = new File(getFilesDir(), "GameData");
        return new File(gameData, "Worlds");
    }

    private File resolveSafeWorldDir(String worldId) {
        if (worldId == null) return null;
        String trimmed = worldId.trim();
        if (!trimmed.matches("^[A-Za-z0-9_-]{1,80}$")) return null;
        if (".".equals(trimmed) || "..".equals(trimmed)) return null;
        try {
            File root = getWorldsRootDir();
            File target = new File(root, trimmed);
            String rootCanonical = root.getCanonicalPath();
            String targetCanonical = target.getCanonicalPath();
            if (!targetCanonical.startsWith(rootCanonical + File.separator)) {
                return null;
            }
            return target;
        } catch (IOException e) {
            return null;
        }
    }

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

    private JSONObject readJsonFileWithBackup(File file) {
        File bak = new File(file.getParentFile(), file.getName() + ".bak");
        File[] candidates = new File[] { file, bak };
        for (File candidate : candidates) {
            if (!candidate.exists() || !candidate.isFile()) continue;
            try {
                String raw = readFileUtf8(candidate);
                if (raw.trim().isEmpty()) continue;
                JSONObject parsed = new JSONObject(raw);
                if (candidate == bak) {
                    try {
                        writeJsonFileAtomic(file, parsed);
                    } catch (Exception ignored) {
                    }
                }
                return parsed;
            } catch (Exception ignored) {
                // Fall back to .bak if primary is corrupted
            }
        }
        return null;
    }

    private void writeJsonFileAtomic(File file, JSONObject payload) throws Exception {
        if (payload == null) {
            throw new IllegalArgumentException("Null JSON payload");
        }
        String serialized = payload.toString();
        // Verify JSON parses cleanly before touching disk
        new JSONObject(serialized);

        File parent = file.getParentFile();
        if (parent != null && !parent.exists()) {
            parent.mkdirs();
        }

        File tmp = new File(parent, file.getName() + ".tmp");
        File bak = new File(parent, file.getName() + ".bak");
        byte[] bytes = serialized.getBytes(StandardCharsets.UTF_8);

        try (FileOutputStream fos = new FileOutputStream(tmp, false)) {
            fos.write(bytes);
            fos.flush();
            fos.getFD().sync();
        }

        if (file.exists() && file.isFile()) {
            try {
                String prevRaw = readFileUtf8(file);
                if (!prevRaw.trim().isEmpty()) {
                    new JSONObject(prevRaw);
                    try (FileOutputStream bakFos = new FileOutputStream(bak, false)) {
                        bakFos.write(prevRaw.getBytes(StandardCharsets.UTF_8));
                        bakFos.flush();
                        bakFos.getFD().sync();
                    }
                }
            } catch (Exception ignored) {
                // Existing file unreadable; skip backup overwrite
            }
        }

        if (file.exists() && !file.delete()) {
            // Try rename directly on POSIX; if failed on older FS, copy over
            if (!tmp.renameTo(file)) {
                throw new IOException("Unable to replace target world save file: " + file.getName());
            }
            return;
        }
        if (!tmp.renameTo(file)) {
            throw new IOException("Unable to commit atomic rename for: " + file.getName());
        }
    }

    private void deleteRecursive(File target) {
        if (target == null || !target.exists()) return;
        if (target.isDirectory()) {
            File[] children = target.listFiles();
            if (children != null) {
                for (File child : children) {
                    deleteRecursive(child);
                }
            }
        }
        target.delete();
    }

    private class AndroidNativeBridge {
        @JavascriptInterface
        public void exitApp() {
            runOnUiThread(() -> {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                    finishAndRemoveTask();
                } else {
                    finish();
                }
            });
        }

        @JavascriptInterface
        public void shareText(String title, String text, String url) {
            runOnUiThread(() -> {
                String body = (text != null && !text.isEmpty() ? text + "\n" : "") + (url != null ? url : "");
                Intent sendIntent = new Intent(Intent.ACTION_SEND);
                sendIntent.setType("text/plain");
                if (title != null && !title.isEmpty()) {
                    sendIntent.putExtra(Intent.EXTRA_SUBJECT, title);
                }
                sendIntent.putExtra(Intent.EXTRA_TEXT, body.trim());
                Intent chooser = Intent.createChooser(sendIntent, title != null && !title.isEmpty() ? title : "Share");
                startActivity(chooser);
            });
        }

        @JavascriptInterface
        public String listSavedWorldIds() {
            synchronized (worldStorageLock) {
                try {
                    File root = getWorldsRootDir();
                    JSONArray arr = new JSONArray();
                    if (root.exists() && root.isDirectory()) {
                        File[] entries = root.listFiles();
                        if (entries != null) {
                            for (File entry : entries) {
                                if (!entry.isDirectory()) continue;
                                File safeDir = resolveSafeWorldDir(entry.getName());
                                if (safeDir == null) continue;
                                File wd = new File(safeDir, "world-data.json");
                                File wdBak = new File(safeDir, "world-data.json.bak");
                                if (wd.exists() || wdBak.exists()) {
                                    arr.put(safeDir.getName());
                                }
                            }
                        }
                    }
                    JSONObject res = new JSONObject();
                    res.put("ok", true);
                    res.put("worldIds", arr);
                    return res.toString();
                } catch (Exception e) {
                    return "{\"ok\":false,\"worldIds\":[]}";
                }
            }
        }

        @JavascriptInterface
        public String readWorldBundle(String worldId) {
            synchronized (worldStorageLock) {
                try {
                    File worldDir = resolveSafeWorldDir(worldId);
                    if (worldDir == null) {
                        return "{\"ok\":false,\"error\":\"INVALID_WORLD_ID\"}";
                    }
                    JSONObject worldData = readJsonFileWithBackup(new File(worldDir, "world-data.json"));
                    if (worldData == null) {
                        return "{\"ok\":false,\"error\":\"WORLD_NOT_FOUND\"}";
                    }
                    JSONObject settings = readJsonFileWithBackup(new File(worldDir, "settings.json"));
                    if (settings == null) settings = new JSONObject();
                    JSONObject playerData = readJsonFileWithBackup(new File(worldDir, "player-data.json"));
                    if (playerData == null) playerData = new JSONObject();
                    JSONObject worldState = readJsonFileWithBackup(new File(worldDir, "world-state.json"));
                    if (worldState == null) worldState = new JSONObject();

                    int saveVersion = worldData.optInt("saveVersion", 1);
                    JSONObject bundle = new JSONObject();
                    bundle.put("saveVersion", saveVersion);
                    bundle.put("worldData", worldData);
                    bundle.put("settings", settings);
                    bundle.put("playerData", playerData);
                    bundle.put("worldState", worldState);

                    JSONObject res = new JSONObject();
                    res.put("ok", true);
                    res.put("bundle", bundle);
                    return res.toString();
                } catch (Exception e) {
                    JSONObject err = new JSONObject();
                    try {
                        err.put("ok", false);
                        err.put("error", e.getMessage() != null ? e.getMessage() : "READ_FAILED");
                    } catch (Exception ignored) {
                    }
                    return err.toString();
                }
            }
        }

        @JavascriptInterface
        public String writeWorldBundle(String worldId, String bundleJson) {
            synchronized (worldStorageLock) {
                try {
                    File worldDir = resolveSafeWorldDir(worldId);
                    if (worldDir == null) {
                        return "{\"ok\":false,\"error\":\"INVALID_WORLD_ID\"}";
                    }
                    if (bundleJson == null || bundleJson.trim().isEmpty()) {
                        return "{\"ok\":false,\"error\":\"EMPTY_BUNDLE\"}";
                    }
                    JSONObject bundle = new JSONObject(bundleJson);
                    JSONObject worldData = bundle.optJSONObject("worldData");
                    JSONObject settings = bundle.optJSONObject("settings");
                    JSONObject playerData = bundle.optJSONObject("playerData");
                    JSONObject worldState = bundle.optJSONObject("worldState");
                    if (worldData == null || settings == null || playerData == null || worldState == null) {
                        return "{\"ok\":false,\"error\":\"INVALID_BUNDLE\"}";
                    }
                    if (!worldDir.exists()) {
                        worldDir.mkdirs();
                    }
                    int saveVersion = bundle.optInt("saveVersion", 1);
                    worldData.put("saveVersion", saveVersion);

                    writeJsonFileAtomic(new File(worldDir, "world-data.json"), worldData);
                    writeJsonFileAtomic(new File(worldDir, "settings.json"), settings);
                    writeJsonFileAtomic(new File(worldDir, "player-data.json"), playerData);
                    writeJsonFileAtomic(new File(worldDir, "world-state.json"), worldState);

                    return "{\"ok\":true}";
                } catch (Exception e) {
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

        @JavascriptInterface
        public String deleteWorldBundle(String worldId) {
            synchronized (worldStorageLock) {
                try {
                    File worldDir = resolveSafeWorldDir(worldId);
                    if (worldDir == null) {
                        return "{\"ok\":false,\"error\":\"INVALID_WORLD_ID\"}";
                    }
                    deleteRecursive(worldDir);
                    return "{\"ok\":true}";
                } catch (Exception e) {
                    return "{\"ok\":false,\"error\":\"DELETE_FAILED\"}";
                }
            }
        }

        @JavascriptInterface
        public String startLanHost(int port, String roomOptionsJson) {
            if (lanServer == null) {
                lanServer = new LanMultiplayerServer(MainActivity.this);
            }
            return lanServer.startHostJson(port, roomOptionsJson);
        }

        @JavascriptInterface
        public String stopLanHost() {
            if (lanServer == null) return "{\"ok\":true}";
            return lanServer.stopHostJson();
        }

        @JavascriptInterface
        public String getLanStatus() {
            if (lanServer == null) {
                lanServer = new LanMultiplayerServer(MainActivity.this);
            }
            return lanServer.getStatusJson();
        }

        @JavascriptInterface
        public String getLocalIp() {
            return LanMultiplayerServer.getPrimaryLanIp();
        }

        @JavascriptInterface
        public String discoverLanHosts(int timeoutMs) {
            if (lanServer == null) {
                lanServer = new LanMultiplayerServer(MainActivity.this);
            }
            return lanServer.discoverLanHostsJson(timeoutMs);
        }

        @JavascriptInterface
        public void setOrientation(String mode) {
            runOnUiThread(() -> {
                if ("landscape".equalsIgnoreCase(mode)) {
                    setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE);
                } else if ("portrait".equalsIgnoreCase(mode)) {
                    setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_SENSOR_PORTRAIT);
                } else {
                    setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_SENSOR);
                }
                hideSystemBars();
            });
        }

        @JavascriptInterface
        public String getOrientation() {
            int current = getResources().getConfiguration().orientation;
            return current == Configuration.ORIENTATION_LANDSCAPE ? "landscape" : "portrait";
        }
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_SENSOR);
        lanServer = new LanMultiplayerServer(this);
        configureFullscreen();
        configureWebView();
        registerBackButtonHandler();
        handleJoinIntent(getIntent());
    }

    @Override
    public void onConfigurationChanged(Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
        hideSystemBars();
    }

    @Override
    public void onDestroy() {
        if (lanServer != null) {
            lanServer.stopHostJson();
        }
        super.onDestroy();
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleJoinIntent(intent);
    }

    private void handleJoinIntent(Intent intent) {
        if (intent == null || getBridge() == null) {
            return;
        }
        Uri data = intent.getData();
        if (data == null) {
            return;
        }
        String urlStr = data.toString();
        if (!urlStr.contains("/join/") && !urlStr.contains("join=")) {
            return;
        }
        String quoted = JSONObject.quote(urlStr);
        getBridge().eval(
            "window.__handleMultiplayerJoinLink && window.__handleMultiplayerJoinLink(" + quoted + ");",
            null
        );
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) {
            hideSystemBars();
        }
    }

    private void configureFullscreen() {
        Window window = getWindow();
        WindowCompat.setDecorFitsSystemWindows(window, false);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            WindowManager.LayoutParams lp = window.getAttributes();
            lp.layoutInDisplayCutoutMode =
                WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
            window.setAttributes(lp);
        }
        hideSystemBars();
    }

    private void hideSystemBars() {
        Window window = getWindow();
        WindowInsetsControllerCompat controller =
            WindowCompat.getInsetsController(window, window.getDecorView());
        if (controller != null) {
            controller.setSystemBarsBehavior(
                WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            );
            controller.hide(WindowInsetsCompat.Type.systemBars());
        }
    }

    private void configureWebView() {
        if (getBridge() == null) {
            return;
        }
        WebView webView = getBridge().getWebView();
        if (webView == null) {
            return;
        }
        webView.setOverScrollMode(View.OVER_SCROLL_NEVER);
        webView.setHorizontalScrollBarEnabled(false);
        webView.setVerticalScrollBarEnabled(false);
        webView.addJavascriptInterface(new AndroidNativeBridge(), "AndroidNativeBridge");

        WebSettings settings = webView.getSettings();
        settings.setDomStorageEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
    }

    private void registerBackButtonHandler() {
        getOnBackPressedDispatcher().addCallback(
            this,
            new OnBackPressedCallback(true) {
                @Override
                public void handleOnBackPressed() {
                    if (getBridge() == null) {
                        moveTaskToBack(true);
                        return;
                    }
                    getBridge().eval(
                        "window.__handleAndroidBack ? Boolean(window.__handleAndroidBack()) : false",
                        result -> {
                            if (!"true".equals(result)) {
                                runOnUiThread(() -> moveTaskToBack(true));
                            }
                        }
                    );
                }
            }
        );
    }
}
