package com.simpgames.quest;

import android.content.Context;
import android.content.SharedPreferences;
import org.json.JSONArray;
import org.json.JSONObject;
import java.util.ArrayList;
import java.util.List;

public class NotificationMessageStore {
  private static final String PREFS_NAME = "notification_messages_store";
  private static final String MESSAGE_KEY_PREFIX = "messages_";
  private static final int MAX_MESSAGES_PER_PEER = 5; // Store last 5 messages

  public static void addMessage(Context context, String peerUsername, String senderLabel, String messageBody) {
    if (context == null || peerUsername.isEmpty()) return;

    try {
      SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
      String key = MESSAGE_KEY_PREFIX + peerUsername;
      String existing = prefs.getString(key, "[]");
      JSONArray messages = new JSONArray(existing);

      // Create new message object
      JSONObject msg = new JSONObject();
      msg.put("sender", senderLabel);
      msg.put("body", messageBody);
      msg.put("timestamp", System.currentTimeMillis());

      // Add to front of list
      JSONArray newMessages = new JSONArray();
      newMessages.put(msg);
      for (int i = 0; i < messages.length() && i < MAX_MESSAGES_PER_PEER - 1; i++) {
        newMessages.put(messages.get(i));
      }

      prefs.edit().putString(key, newMessages.toString()).apply();
    } catch (Exception ignored) {
    }
  }

  public static List<String> getMessages(Context context, String peerUsername) {
    List<String> result = new ArrayList<>();
    if (context == null || peerUsername.isEmpty()) return result;

    try {
      SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
      String key = MESSAGE_KEY_PREFIX + peerUsername;
      String existing = prefs.getString(key, "[]");
      JSONArray messages = new JSONArray(existing);

      // Iterate in reverse order (oldest first, newest last)
      for (int i = messages.length() - 1; i >= 0; i--) {
        JSONObject msg = messages.getJSONObject(i);
        String sender = msg.optString("sender", "");
        String body = msg.optString("body", "");
        // Clean up sender name - remove @ if present
        if (sender.startsWith("@")) {
          sender = sender.substring(1);
        }
        result.add(sender + ": " + body);
      }
    } catch (Exception ignored) {
    }

    return result;
  }

  public static void clearMessages(Context context, String peerUsername) {
    if (context == null || peerUsername.isEmpty()) return;

    try {
      SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
      String key = MESSAGE_KEY_PREFIX + peerUsername;
      prefs.edit().remove(key).apply();
    } catch (Exception ignored) {
    }
  }
}
