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

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
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
  private static final int CONNECT_TIMEOUT_MS = 20000;
  private static final int READ_TIMEOUT_MS = 25000;

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
    if (notificationId == 0) {
      notificationId = ChatPushMessagingService.buildNotificationId(toUsername, chatUrl, senderLabel);
    }
    if (toUsername.isEmpty()) {
      toUsername = NotificationReplyStore.getToUsername(context, notificationId);
    }
    if (pushToken.isEmpty()) {
      pushToken = NotificationReplyStore.getPushToken(context, notificationId);
    }
    if (chatUrl.isEmpty()) {
      chatUrl = NotificationReplyStore.getChatUrl(context, notificationId);
    }
    if (senderLabel.isEmpty()) {
      senderLabel = NotificationReplyStore.getSenderLabel(context, notificationId);
    }
    final int resolvedNotificationId = notificationId;
    final String resolvedToUsername = toUsername;
    final String resolvedPushToken = pushToken;
    final String resolvedChatUrl = chatUrl;
    final String resolvedSenderLabel = senderLabel;
    final String resolvedNotificationTag = ChatPushMessagingService.buildNotificationTag(
        resolvedToUsername,
        resolvedChatUrl,
        resolvedSenderLabel);

    NotificationManager notificationManager = context.getSystemService(NotificationManager.class);
    if (notificationManager != null && resolvedNotificationId != 0) {
      replaceNotification(
          notificationManager,
          resolvedNotificationTag,
          resolvedNotificationId,
          buildStatusNotification(context, resolvedSenderLabel, resolvedChatUrl, "Sending reply..."));
    }

    PendingResult pendingResult = goAsync();
    Context appContext = context.getApplicationContext();
    new Thread(() -> {
      try {
        ReplyResult result = postReply(appContext, resolvedPushToken, resolvedToUsername, message);
        NotificationManager manager = appContext.getSystemService(NotificationManager.class);
        if (manager != null) {
          if (result.success()) {
            NotificationReplyStore.clear(appContext, resolvedNotificationId);
            replaceNotification(
                manager,
                resolvedNotificationTag,
                resolvedNotificationId,
                buildStatusNotification(appContext, resolvedSenderLabel, resolvedChatUrl, "Reply sent"));
          } else {
            replaceNotification(
                manager,
                resolvedNotificationTag,
                resolvedNotificationId,
                buildStatusNotification(appContext, resolvedSenderLabel, resolvedChatUrl, result.userMessage()));
          }
        }
      } finally {
        pendingResult.finish();
      }
    }).start();
  }

  private ReplyResult postReply(Context context, String pushToken, String toUsername, String message) {
    if (pushToken.isEmpty() || toUsername.isEmpty() || message.isEmpty()) {
      return new ReplyResult(false, "Reply failed. Missing notification data.");
    }
    String apiBase = resolveApiBaseUrl(context);
    if (apiBase.isEmpty()) {
      return new ReplyResult(false, "Reply failed. App server URL is missing.");
    }
    HttpURLConnection connection = null;
    try {
      URL endpoint = new URL(apiBase + "/api/app/messages/notification-reply");
      connection = (HttpURLConnection) endpoint.openConnection();
      connection.setRequestMethod("POST");
      connection.setConnectTimeout(CONNECT_TIMEOUT_MS);
      connection.setReadTimeout(READ_TIMEOUT_MS);
      connection.setDoOutput(true);
      connection.setDoInput(true);
      connection.setRequestProperty("Content-Type", "application/json; charset=UTF-8");
      connection.setRequestProperty("Accept", "application/json");

      JSONObject body = new JSONObject();
      body.put("mobilePushToken", pushToken);
      body.put("toUsername", toUsername);
      body.put("message", message);

      byte[] payload = body.toString().getBytes(StandardCharsets.UTF_8);
      try (OutputStream output = connection.getOutputStream()) {
        output.write(payload);
      }
      int responseCode = connection.getResponseCode();
      if (responseCode >= 200 && responseCode < 300) {
        return new ReplyResult(true, "Reply sent");
      }
      String errorBody = readStream(connection.getErrorStream());
      String detail = !errorBody.isEmpty() ? errorBody : ("HTTP " + responseCode);
      return new ReplyResult(false, "Reply failed: " + trimForNotification(detail));
    } catch (Exception error) {
      String detail = safeTrim(error.getMessage());
      if (detail.isEmpty()) {
        detail = "network error";
      }
      return new ReplyResult(false, "Reply failed: " + trimForNotification(detail));
    } finally {
      if (connection != null) {
        connection.disconnect();
      }
    }
  }

  private String readStream(InputStream stream) {
    if (stream == null) return "";
    try (InputStream input = stream; ByteArrayOutputStream buffer = new ByteArrayOutputStream()) {
      byte[] chunk = new byte[1024];
      int read;
      while ((read = input.read(chunk)) != -1) {
        buffer.write(chunk, 0, read);
      }
      return buffer.toString(StandardCharsets.UTF_8);
    } catch (Exception ignored) {
      return "";
    }
  }

  private String trimForNotification(String value) {
    String raw = safeTrim(value).replace('\n', ' ').replace('\r', ' ');
    if (raw.length() <= 72) return raw;
    return raw.substring(0, 69) + "...";
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

  private void replaceNotification(
      NotificationManager notificationManager,
      String notificationTag,
      int notificationId,
      android.app.Notification notification) {
    if (notificationManager == null || notificationId == 0 || notification == null) return;
    String safeTag = safeTrim(notificationTag);
    if (!safeTag.isEmpty()) {
      notificationManager.cancel(safeTag, notificationId);
      notificationManager.notify(safeTag, notificationId, notification);
      return;
    }
    notificationManager.cancel(notificationId);
    notificationManager.notify(notificationId, notification);
  }

  private String resolveApiBaseUrl(Context context) {
    String apiBase = safeTrim(BuildConfig.CHAT_API_BASE_URL);
    if (!apiBase.isEmpty()) {
      return trimTrailingSlash(apiBase);
    }
    try {
      String fallback = context == null ? "" : safeTrim(context.getString(R.string.chat_api_base_url));
      if (!fallback.isEmpty()) {
        return trimTrailingSlash(fallback);
      }
    } catch (Exception ignored) {
      // Resource fallback is best-effort.
    }
    return "";
  }

  private String trimTrailingSlash(String value) {
    String normalized = safeTrim(value);
    while (normalized.endsWith("/")) {
      normalized = normalized.substring(0, normalized.length() - 1).trim();
    }
    return normalized;
  }

  private String safeTrim(String value) {
    return value == null ? "" : value.trim();
  }

  private record ReplyResult(boolean success, String userMessage) {
  }
}
