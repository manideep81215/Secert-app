package com.simpgames.quest;

import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.os.Bundle;
import android.app.ActivityManager;
import android.graphics.BitmapFactory;
import android.graphics.Bitmap;
import android.view.WindowManager;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.view.ViewGroup;
import android.graphics.Color;
import android.graphics.BlurMaskFilter;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.view.View;

import com.getcapacitor.BridgeActivity;
import androidx.core.view.WindowCompat;

public class MainActivity extends BridgeActivity {
  private static final String CAPACITOR_STORAGE_GROUP = "CapacitorStorage";
  private static final String PREF_APP_IN_FOREGROUND = "chat_app_in_foreground_v1";
  private String pendingNotificationUrl = "";
  private View privacyOverlay;

  @Override
  public void onCreate(Bundle savedInstanceState) {
    registerPlugin(OpenFilePlugin.class);
    super.onCreate(savedInstanceState);
    WindowCompat.setDecorFitsSystemWindows(getWindow(), true);
    // Enable FLAG_SECURE to blur content in recent apps and prevent screenshots
    getWindow().setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE);
    
    // Set custom task description for recent apps with app icon (no preview)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
      Bitmap icon = BitmapFactory.decodeResource(getResources(), R.mipmap.ic_launcher);
      ActivityManager.TaskDescription taskDesc = new ActivityManager.TaskDescription(
          getString(R.string.app_name),
          icon,
          getResources().getColor(android.R.color.black, getTheme())
      );
      setTaskDescription(taskDesc);
    }
    
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
    hidePrivacyOverlay();
    deliverPendingNotificationRoute();
  }

  @Override
  public void onPause() {
    setAppForegroundState(false);
    showPrivacyOverlay();
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

  private void showPrivacyOverlay() {
    if (privacyOverlay != null) {
      privacyOverlay.setVisibility(View.VISIBLE);
      return;
    }

    // Create blurred overlay with app logo
    FrameLayout overlay = new FrameLayout(this);
    overlay.setBackgroundColor(Color.parseColor("#F5F5F5")); // Light gray background
    
    // Add app icon in center
    ImageView iconView = new ImageView(this);
    iconView.setImageResource(R.mipmap.ic_launcher);
    iconView.setScaleType(ImageView.ScaleType.CENTER_INSIDE);
    
    FrameLayout.LayoutParams iconParams = new FrameLayout.LayoutParams(
        200, 200, android.view.Gravity.CENTER);
    overlay.addView(iconView, iconParams);
    
    // Get root view and add overlay
    ViewGroup rootView = (ViewGroup) getWindow().getDecorView().findViewById(android.R.id.content);
    FrameLayout.LayoutParams overlayParams = new FrameLayout.LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT,
        ViewGroup.LayoutParams.MATCH_PARENT);
    rootView.addView(overlay, overlayParams);
    
    privacyOverlay = overlay;
  }

  private void hidePrivacyOverlay() {
    if (privacyOverlay != null) {
      privacyOverlay.setVisibility(View.GONE);
    }
  }
}
