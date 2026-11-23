package com.worldofadventure.game;

import android.Manifest;
import android.content.Intent;
import android.content.pm.ActivityInfo;
import android.content.res.Configuration;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.provider.DocumentsContract;
import android.provider.Settings;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebSettings;
import android.webkit.WebView;
import androidx.activity.OnBackPressedCallback;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;
import org.json.JSONObject;

public class MainActivity extends BridgeActivity {

    private LanMultiplayerServer lanServer;
    private AndroidExternalStorageManager storageManager;

    private ActivityResultLauncher<String[]> runtimePermissionLauncher;
    private ActivityResultLauncher<Intent> allFilesSettingsLauncher;
    private ActivityResultLauncher<Intent> safFolderLauncher;

    private void notifyWebStorageStatusChanged() {
        if (getBridge() == null || storageManager == null) return;
        final String statusJson = storageManager.getStorageStatusJson();
        runOnUiThread(() -> {
            if (getBridge() != null) {
                getBridge().eval(
                    "window.__onAndroidStorageStatusChanged && window.__onAndroidStorageStatusChanged(" +
                    JSONObject.quote(statusJson) +
                    ");",
                    null
                );
            }
        });
    }

    private void launchSafFolderPicker() {
        try {
            Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
            intent.addFlags(
                Intent.FLAG_GRANT_READ_URI_PERMISSION |
                Intent.FLAG_GRANT_WRITE_URI_PERMISSION |
                Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION |
                Intent.FLAG_GRANT_PREFIX_URI_PERMISSION
            );
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                Uri initialUri = DocumentsContract.buildRootUri(
                    "com.android.externalstorage.documents",
                    "primary"
                );
                intent.putExtra(DocumentsContract.EXTRA_INITIAL_URI, initialUri);
            }
            safFolderLauncher.launch(intent);
        } catch (Exception ignored) {
            notifyWebStorageStatusChanged();
        }
    }

    private void requestStoragePermissionInternal(boolean autoLaunchFallbackSaf) {
        if (storageManager == null) return;
        if (storageManager.hasDirectSharedStoragePermission() || storageManager.getPersistedSafTreeUri() != null) {
            storageManager.ensureInitialized();
            notifyWebStorageStatusChanged();
            return;
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            if (!Environment.isExternalStorageManager()) {
                try {
                    Intent intent = new Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION);
                    intent.setData(Uri.parse("package:" + getPackageName()));
                    allFilesSettingsLauncher.launch(intent);
                    return;
                } catch (Exception e) {
                    try {
                        Intent fallbackIntent = new Intent(Settings.ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION);
                        allFilesSettingsLauncher.launch(fallbackIntent);
                        return;
                    } catch (Exception ignored) {
                        if (autoLaunchFallbackSaf) {
                            launchSafFolderPicker();
                            return;
                        }
                    }
                }
            }
        } else {
            runtimePermissionLauncher.launch(
                new String[] {
                    Manifest.permission.READ_EXTERNAL_STORAGE,
                    Manifest.permission.WRITE_EXTERNAL_STORAGE,
                }
            );
            return;
        }

        if (autoLaunchFallbackSaf) {
            launchSafFolderPicker();
        }
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
            return storageManager != null
                ? storageManager.listSavedWorldIdsJson()
                : "{\"ok\":false,\"worldIds\":[]}";
        }

        @JavascriptInterface
        public String readWorldBundle(String worldId) {
            return storageManager != null
                ? storageManager.readWorldBundleJson(worldId)
                : "{\"ok\":false,\"error\":\"NOT_READY\"}";
        }

        @JavascriptInterface
        public String writeWorldBundle(String worldId, String bundleJson) {
            return storageManager != null
                ? storageManager.writeWorldBundleJson(worldId, bundleJson)
                : "{\"ok\":false,\"error\":\"NOT_READY\"}";
        }

        @JavascriptInterface
        public String deleteWorldBundle(String worldId) {
            return storageManager != null
                ? storageManager.deleteWorldBundleJson(worldId)
                : "{\"ok\":false,\"error\":\"NOT_READY\"}";
        }

        @JavascriptInterface
        public String getStorageStatus() {
            return storageManager != null
                ? storageManager.getStorageStatusJson()
                : "{\"ok\":false,\"platform\":\"android\",\"state\":\"not_accessible\"}";
        }

        @JavascriptInterface
        public void requestStoragePermission() {
            runOnUiThread(() -> requestStoragePermissionInternal(true));
        }

        @JavascriptInterface
        public void requestSafFolderAccess() {
            runOnUiThread(() -> launchSafFolderPicker());
        }

        @JavascriptInterface
        public String readAllSettings() {
            return storageManager != null
                ? storageManager.readAllSettingsJson()
                : "{\"ok\":false,\"writable\":false,\"hasAny\":false,\"settings\":{}}";
        }

        @JavascriptInterface
        public String writeSettingFile(String settingKey, String jsonContent) {
            return storageManager != null
                ? storageManager.writeSettingFileJson(settingKey, jsonContent)
                : "{\"ok\":false,\"error\":\"NOT_READY\"}";
        }

        @JavascriptInterface
        public String writeProfileFile(String jsonContent) {
            return storageManager != null
                ? storageManager.writeProfileFileJson(jsonContent)
                : "{\"ok\":false,\"error\":\"NOT_READY\"}";
        }

        @JavascriptInterface
        public String readProfileFile() {
            return storageManager != null
                ? storageManager.readProfileFileJson()
                : "{\"ok\":false,\"error\":\"NOT_READY\"}";
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
        runtimePermissionLauncher = registerForActivityResult(
            new ActivityResultContracts.RequestMultiplePermissions(),
            result -> {
                if (storageManager != null) {
                    storageManager.ensureInitialized();
                }
                notifyWebStorageStatusChanged();
            }
        );

        allFilesSettingsLauncher = registerForActivityResult(
            new ActivityResultContracts.StartActivityForResult(),
            result -> {
                if (storageManager != null) {
                    storageManager.ensureInitialized();
                }
                notifyWebStorageStatusChanged();
            }
        );

        safFolderLauncher = registerForActivityResult(
            new ActivityResultContracts.StartActivityForResult(),
            result -> {
                if (result != null && result.getResultCode() == RESULT_OK && result.getData() != null) {
                    Uri treeUri = result.getData().getData();
                    if (treeUri != null) {
                        int takeFlags = result.getData().getFlags() &
                            (Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
                        if (takeFlags == 0) {
                            takeFlags =
                                Intent.FLAG_GRANT_READ_URI_PERMISSION |
                                Intent.FLAG_GRANT_WRITE_URI_PERMISSION;
                        }
                        try {
                            getContentResolver().takePersistableUriPermission(treeUri, takeFlags);
                        } catch (Exception ignored) {
                        }
                        if (storageManager != null) {
                            storageManager.saveSafTreeUri(treeUri);
                        }
                    }
                }
                notifyWebStorageStatusChanged();
            }
        );

        super.onCreate(savedInstanceState);
        setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_SENSOR);
        lanServer = new LanMultiplayerServer(this);
        storageManager = new AndroidExternalStorageManager(this);
        storageManager.ensureInitialized();

        configureFullscreen();
        configureWebView();
        registerBackButtonHandler();
        handleJoinIntent(getIntent());

        if (
            !storageManager.hasDirectSharedStoragePermission() &&
            storageManager.getPersistedSafTreeUri() == null &&
            !storageManager.hasAskedInitialPermission()
        ) {
            storageManager.markAskedInitialPermission();
            new Handler(Looper.getMainLooper()).postDelayed(
                () -> {
                    if (!isFinishing() && !isDestroyed()) {
                        requestStoragePermissionInternal(false);
                    }
                },
                650
            );
        }
    }

    @Override
    public void onResume() {
        super.onResume();
        if (storageManager != null) {
            storageManager.ensureInitialized();
            notifyWebStorageStatusChanged();
        }
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
