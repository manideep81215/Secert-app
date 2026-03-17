package com.simpgames.quest;

import android.content.Intent;
import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
  private String pendingNotificationUrl = "";

  @Override
  public void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
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
  protected void onResume() {
    super.onResume();
    deliverPendingNotificationRoute();
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
}
