package com.simpgames.quest;

import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Bundle;
import android.view.WindowManager;

import com.getcapacitor.BridgeActivity;
import androidx.core.view.WindowCompat;

public class MainActivity extends BridgeActivity {
  private static final String CAPACITOR_STORAGE_GROUP = "CapacitorStorage";
  private static final String PREF_APP_IN_FOREGROUND = "chat_app_in_foreground_v1";
  private String pendingNotificationUrl = "";

  @Override
  public void onCreate(Bundle savedInstanceState) {
    registerPlugin(OpenFilePlugin.class);
    super.onCreate(savedInstanceState);
    WindowCompat.setDecorFitsSystemWindows(getWindow(), true);
    // Enable FLAG_SECURE to blur content in recent apps and prevent screenshots
    getWindow().setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE);
    captureNotificationIntent(getIntent());
    deliverPendingNotificationRoute();
  }

  @Override
  protected void onNewIntent(Intent intent) {
    super.onNewIntent(intent);
    setIntent(intent);
    captureNotificationIntent(intent);
    deliverPendingNotificationRoute();
  }

  @Override
  public void onResume() {
    super.onResume();
    WindowCompat.setDecorFitsSystemWindows(getWindow(), true);
    setAppForegroundState(true);
    deliverPendingNotificationRoute();
  }

  @Override
  public void onPause() {
    setAppForegroundState(false);
    super.onPause();
  }

  private void captureNotificationIntent(Intent intent) {
    if (!ChatPushMessagingService.isOpenedFromNotification(intent)) return;
    String route = ChatPushMessagingService.extractChatUrl(intent);
    String peerUsername = ChatPushMessagingService.extractPeerUsername(intent);
    if ((route == null || route.isBlank()) && peerUsername != null && !peerUsername.isBlank()) {
      route = "/#/chat?with=" + peerUsername;
    }
    pendingNotificationUrl = route == null ? "" : route.trim();
  }

  private void deliverPendingNotificationRoute() {
    if (pendingNotificationUrl == null || pendingNotificationUrl.isBlank()) return;
    if (bridge == null || bridge.getWebView() == null) return;

    final String route = pendingNotificationUrl;
    pendingNotificationUrl = "";
    bridge.getWebView().postDelayed(() -> {
      if (bridge == null || bridge.getWebView() == null) return;
      String jsRoute = route
          .replace("\\", "\\\\")
          .replace("'", "\\'");
      bridge.getWebView().evaluateJavascript(
          "(function(){"
              + "var route='" + jsRoute + "';"
              + "if(route.startsWith('/#')){window.location.hash=route.slice(2);return;}"
              + "if(route.startsWith('#')){window.location.hash=route;return;}"
              + "window.location.hash='#/chat';"
              + "})();",
          null);
    }, 180);
  }

  private void setAppForegroundState(boolean isForeground) {
    try {
      SharedPreferences prefs = getSharedPreferences(CAPACITOR_STORAGE_GROUP, MODE_PRIVATE);
      prefs.edit().putString(PREF_APP_IN_FOREGROUND, isForeground ? "1" : "0").apply();
    } catch (Exception ignored) {
      // Foreground tracking is best-effort only.
    }
  }
}
