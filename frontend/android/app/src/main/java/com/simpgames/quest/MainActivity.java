package com.simpgames.quest;

import android.os.Build;
import android.os.Bundle;
import android.view.WindowManager;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
  private void setSecureWindow(boolean enabled) {
    if (enabled) {
      getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
    } else {
      getWindow().clearFlags(WindowManager.LayoutParams.FLAG_SECURE);
    }
  }

  @Override
  public void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    // Android 13+ can block Recents snapshots without disabling screenshots in foreground.
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      setRecentsScreenshotEnabled(false);
    }
    setSecureWindow(false);
  }

  @Override
  public void onPause() {
    // Older Android fallback: protect task snapshot while app goes background.
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
      setSecureWindow(true);
    }
    super.onPause();
  }

  @Override
  public void onResume() {
    super.onResume();
    // Keep screenshots/screen recording enabled in active app.
    setSecureWindow(false);
  }
}
