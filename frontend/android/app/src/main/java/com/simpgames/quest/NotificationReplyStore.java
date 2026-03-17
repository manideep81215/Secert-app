package com.simpgames.quest;

import android.content.Context;
import android.content.SharedPreferences;

public final class NotificationReplyStore {
  private static final String PREFS_NAME = "chat_notification_reply_store";
  private static final String KEY_TO_USERNAME_PREFIX = "to_username:";
  private static final String KEY_PUSH_TOKEN_PREFIX = "push_token:";
  private static final String KEY_CHAT_URL_PREFIX = "chat_url:";
  private static final String KEY_SENDER_LABEL_PREFIX = "sender_label:";

  private NotificationReplyStore() {
  }

  public static void save(Context context, int notificationId, String toUsername, String pushToken, String chatUrl, String senderLabel) {
    SharedPreferences prefs = getPrefs(context);
    if (prefs == null || notificationId == 0) return;
    prefs.edit()
        .putString(KEY_TO_USERNAME_PREFIX + notificationId, safeTrim(toUsername))
        .putString(KEY_PUSH_TOKEN_PREFIX + notificationId, safeTrim(pushToken))
        .putString(KEY_CHAT_URL_PREFIX + notificationId, safeTrim(chatUrl))
        .putString(KEY_SENDER_LABEL_PREFIX + notificationId, safeTrim(senderLabel))
        .apply();
  }

  public static String getToUsername(Context context, int notificationId) {
    return read(context, KEY_TO_USERNAME_PREFIX, notificationId);
  }

  public static String getPushToken(Context context, int notificationId) {
    return read(context, KEY_PUSH_TOKEN_PREFIX, notificationId);
  }

  public static String getChatUrl(Context context, int notificationId) {
    return read(context, KEY_CHAT_URL_PREFIX, notificationId);
  }

  public static String getSenderLabel(Context context, int notificationId) {
    return read(context, KEY_SENDER_LABEL_PREFIX, notificationId);
  }

  public static void clear(Context context, int notificationId) {
    SharedPreferences prefs = getPrefs(context);
    if (prefs == null || notificationId == 0) return;
    prefs.edit()
        .remove(KEY_TO_USERNAME_PREFIX + notificationId)
        .remove(KEY_PUSH_TOKEN_PREFIX + notificationId)
        .remove(KEY_CHAT_URL_PREFIX + notificationId)
        .remove(KEY_SENDER_LABEL_PREFIX + notificationId)
        .apply();
  }

  private static String read(Context context, String prefix, int notificationId) {
    SharedPreferences prefs = getPrefs(context);
    if (prefs == null || notificationId == 0) return "";
    return safeTrim(prefs.getString(prefix + notificationId, ""));
  }

  private static SharedPreferences getPrefs(Context context) {
    if (context == null) return null;
    return context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
  }

  private static String safeTrim(String value) {
    return value == null ? "" : value.trim();
  }
}
