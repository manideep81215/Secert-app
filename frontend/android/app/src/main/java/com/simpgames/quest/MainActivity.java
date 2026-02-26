package com.simpgames.quest;

import android.graphics.Color;
import android.os.Bundle;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
  private static final int CHAT_HEADER_COLOR = Color.parseColor("#EBD0A2");

  @Override
  public void onCreate(Bundle savedInstanceState) {
    // Keep web content below system bars instead of drawing under the status bar.
    WindowCompat.setDecorFitsSystemWindows(getWindow(), true);
    getWindow().setStatusBarColor(CHAT_HEADER_COLOR);
    WindowInsetsControllerCompat insetsController =
        WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
    if (insetsController != null) {
      // Keep light icons off for better contrast on this tan status bar.
      insetsController.setAppearanceLightStatusBars(false);
    }
    super.onCreate(savedInstanceState);
  }
}
