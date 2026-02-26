package com.simpgames.quest;

import android.os.Bundle;
import androidx.core.view.WindowCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
  @Override
  public void onCreate(Bundle savedInstanceState) {
    // Keep web content below system bars instead of drawing under the status bar.
    WindowCompat.setDecorFitsSystemWindows(getWindow(), true);
    super.onCreate(savedInstanceState);
  }
}
