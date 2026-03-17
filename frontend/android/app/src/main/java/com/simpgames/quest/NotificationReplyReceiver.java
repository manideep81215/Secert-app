package com.simpgames.quest;

import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Bundle;

import androidx.core.app.NotificationCompat;
import androidx.core.app.RemoteInput;

import org.json.JSONObject;

import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

public class NotificationReplyReceiver extends BroadcastReceiver {
  public static final String EXTRA_NOTIFICATION_ID = "notif_id";
  public static final String EXTRA_TO_USERNAME = "to_username";
  public static final String EXTRA_PUSH_TOKEN = "push_token";
  public static final String EXTRA_URL = "chat_url";
  public static final String EXTRA_SENDER_LABEL = "sender_label";
  public static final String EXTRA_REPLY_KEY = "notification_reply_text";

  @Override
  public void onReceive(Context context, Intent intent) {
    if (context == null || intent == null) return;

    Bundle remoteInput = RemoteInput.getResultsFromIntent(intent);
    CharSequence replyText = remoteInput != null ? remoteInput.getCharSequence(EXTRA_REPLY_KEY) : null;
    String message = replyText != null ? replyText.toString().trim() : "";
    if (message.isEmpty()) {
      return;
    }

    int notificationId = intent.getIntExtra(EXTRA_NOTIFICATION_ID, 0);
    String toUsername = safeTrim(intent.getStringExtra(EXTRA_TO_USERNAME));
    String pushToken = safeTrim(intent.getStringExtra(EXTRA_PUSH_TOKEN));
    String chatUrl = safeTrim(intent.getStringExtra(EXTRA_URL));
    String senderLabel = safeTrim(intent.getStringExtra(EXTRA_SENDER_LABEL));

    NotificationManager notificationManager = context.getSystemService(NotificationManager.class);
    if (notificationManager != null && notificationId != 0) {
      notificationManager.notify(notificationId, buildStatusNotification(context, senderLabel, chatUrl, "Sending reply..."));
    }

    PendingResult pendingResult = goAsync();
    Context appContext = context.getApplicationContext();
    new Thread(() -> {
      try {
        boolean success = postReply(pushToken, toUsername, message);
        NotificationManager manager = appContext.getSystemService(NotificationManager.class);
        if (manager != null) {
          if (success) {
            manager.notify(notificationId, buildStatusNotification(appContext, senderLabel, chatUrl, "Reply sent"));
          } else {
            manager.notify(notificationId, buildStatusNotification(appContext, senderLabel, chatUrl, "Reply failed. Tap to continue in chat."));
          }
        }
      } finally {
        pendingResult.finish();
      }
    }).start();
  }

  private boolean postReply(String pushToken, String toUsername, String message) {
    if (pushToken.isEmpty() || toUsername.isEmpty() || message.isEmpty()) {
      return false;
    }
    String apiBase = safeTrim(BuildConfig.CHAT_API_BASE_URL);
    if (apiBase.isEmpty()) {
      return false;
    }
    HttpURLConnection connection = null;
    try {
      URL endpoint = new URL(apiBase + "/api/app/messages/notification-reply");
      connection = (HttpURLConnection) endpoint.openConnection();
      connection.setRequestMethod("POST");
      connection.setConnectTimeout(12000);
      connection.setReadTimeout(12000);
      connection.setDoOutput(true);
      connection.setRequestProperty("Content-Type", "application/json; charset=UTF-8");

      JSONObject body = new JSONObject();
      body.put("mobilePushToken", pushToken);
      body.put("toUsername", toUsername);
      body.put("message", message);

      byte[] payload = body.toString().getBytes(StandardCharsets.UTF_8);
      try (OutputStream output = connection.getOutputStream()) {
        output.write(payload);
      }
      int responseCode = connection.getResponseCode();
      return responseCode >= 200 && responseCode < 300;
    } catch (Exception ignored) {
      return false;
    } finally {
      if (connection != null) {
        connection.disconnect();
      }
    }
  }

  private NotificationCompat.Builder newBaseBuilder(Context context, String senderLabel, String statusText) {
    return new NotificationCompat.Builder(context, ChatPushMessagingService.CHANNEL_ID)
        .setSmallIcon(R.drawable.ic_stat_simp_games)
        .setContentTitle(senderLabel.isEmpty() ? "Chat" : senderLabel)
        .setContentText(statusText)
        .setAutoCancel(true)
        .setOnlyAlertOnce(true)
        .setPriority(NotificationCompat.PRIORITY_HIGH);
  }

  private android.app.Notification buildStatusNotification(Context context, String senderLabel, String chatUrl, String statusText) {
    NotificationCompat.Builder builder = newBaseBuilder(context, senderLabel, statusText);
    PendingIntent openIntent = ChatPushMessagingService.createOpenChatPendingIntent(context, chatUrl);
    if (openIntent != null) {
      builder.setContentIntent(openIntent);
    }
    return builder.build();
  }

  private String safeTrim(String value) {
    return value == null ? "" : value.trim();
  }
}
