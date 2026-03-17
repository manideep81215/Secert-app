package com.simpgames.quest;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.app.RemoteInput;

import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

import java.util.Map;

public class ChatPushMessagingService extends FirebaseMessagingService {
  public static final String CHANNEL_ID = "chat_messages_v5";
  private static final String EXTRA_URL = "chat_url";
  private static final String EXTRA_OPEN_FROM_NOTIFICATION = "open_from_notification";
  private static final String EXTRA_PEER_USERNAME = "peer_username";
  private static final String EXTRA_PUSH_TOKEN = "push_token";
  private static final String EXTRA_SENDER_LABEL = "sender_label";

  @Override
  public void onMessageReceived(RemoteMessage message) {
    if (message == null) return;
    Map<String, String> data = message.getData();
    if (data == null || data.isEmpty()) return;

    String title = safeTrim(data.get("title"));
    String body = safeTrim(data.get("body"));
    String url = safeTrim(data.get("url"));
    String peerUsername = safeTrim(data.get("peerUsername"));
    String pushToken = safeTrim(data.get("pushToken"));

    showChatNotification(title, body, url, peerUsername, pushToken);
  }

  private void showChatNotification(String title, String body, String url, String peerUsername, String pushToken) {
    ensureNotificationChannel();

    int notificationId = buildNotificationId(peerUsername, url, title);
    PendingIntent openIntent = createOpenChatPendingIntent(this, url);

    NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL_ID)
        .setSmallIcon(R.drawable.ic_stat_simp_games)
        .setContentTitle(title.isEmpty() ? "New message" : title)
        .setContentText(body.isEmpty() ? "Tap to open chat" : body)
        .setStyle(new NotificationCompat.BigTextStyle().bigText(body.isEmpty() ? "Tap to open chat" : body))
        .setCategory(NotificationCompat.CATEGORY_MESSAGE)
        .setPriority(NotificationCompat.PRIORITY_HIGH)
        .setAutoCancel(true)
        .setOnlyAlertOnce(true);

    if (openIntent != null) {
      builder.setContentIntent(openIntent);
    }

    if (!peerUsername.isEmpty() && !pushToken.isEmpty()) {
      Intent replyIntent = new Intent(this, NotificationReplyReceiver.class)
          .putExtra(NotificationReplyReceiver.EXTRA_NOTIFICATION_ID, notificationId)
          .putExtra(NotificationReplyReceiver.EXTRA_TO_USERNAME, peerUsername)
          .putExtra(NotificationReplyReceiver.EXTRA_PUSH_TOKEN, pushToken)
          .putExtra(NotificationReplyReceiver.EXTRA_URL, url)
          .putExtra(NotificationReplyReceiver.EXTRA_SENDER_LABEL, title);

      int pendingFlags = PendingIntent.FLAG_UPDATE_CURRENT;
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
        pendingFlags |= PendingIntent.FLAG_MUTABLE;
      }
      PendingIntent replyPendingIntent = PendingIntent.getBroadcast(
          this,
          notificationId,
          replyIntent,
          pendingFlags);

      RemoteInput remoteInput = new RemoteInput.Builder(NotificationReplyReceiver.EXTRA_REPLY_KEY)
          .setLabel("Type your reply")
          .build();

      NotificationCompat.Action replyAction = new NotificationCompat.Action.Builder(
          0,
          "Reply",
          replyPendingIntent)
          .addRemoteInput(remoteInput)
          .setAllowGeneratedReplies(true)
          .build();
      builder.addAction(replyAction);
    }

    NotificationManagerCompat.from(this).notify(notificationId, builder.build());
  }

  static PendingIntent createOpenChatPendingIntent(Context context, String url) {
    if (context == null) return null;
    Intent intent = new Intent(context, MainActivity.class)
        .putExtra(EXTRA_OPEN_FROM_NOTIFICATION, true)
        .putExtra(EXTRA_URL, safeTrim(url))
        .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);

    String peerUsername = extractPeerUsername(url);
    if (!peerUsername.isEmpty()) {
      intent.putExtra(EXTRA_PEER_USERNAME, peerUsername);
      intent.setData(Uri.parse("simpgames://chat/" + peerUsername));
    }

    int pendingFlags = PendingIntent.FLAG_UPDATE_CURRENT;
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
      pendingFlags |= PendingIntent.FLAG_IMMUTABLE;
    }
    return PendingIntent.getActivity(context, buildNotificationId(peerUsername, url, "open"), intent, pendingFlags);
  }

  static String extractChatUrl(Intent intent) {
    if (intent == null) return "";
    return safeTrim(intent.getStringExtra(EXTRA_URL));
  }

  static String extractPeerUsername(Intent intent) {
    if (intent == null) return "";
    return safeTrim(intent.getStringExtra(EXTRA_PEER_USERNAME));
  }

  static boolean isOpenedFromNotification(Intent intent) {
    return intent != null && intent.getBooleanExtra(EXTRA_OPEN_FROM_NOTIFICATION, false);
  }

  private void ensureNotificationChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
    NotificationChannel channel = new NotificationChannel(
        CHANNEL_ID,
        "Chat messages",
        NotificationManager.IMPORTANCE_HIGH);
    channel.setDescription("Incoming chat message alerts");
    NotificationManager manager = getSystemService(NotificationManager.class);
    if (manager != null) {
      manager.createNotificationChannel(channel);
    }
  }

  static int buildNotificationId(String peerUsername, String url, String title) {
    String seed = !safeTrim(peerUsername).isEmpty() ? peerUsername : (!safeTrim(url).isEmpty() ? url : title);
    return Math.max(1001, Math.abs(seed.hashCode()));
  }

  private static String extractPeerUsername(String url) {
    String raw = safeTrim(url);
    int marker = raw.indexOf("with=");
    if (marker < 0) return "";
    String peer = raw.substring(marker + 5);
    int end = peer.indexOf('&');
    if (end >= 0) {
      peer = peer.substring(0, end);
    }
    return peer.trim().toLowerCase();
  }

  private static String safeTrim(String value) {
    return value == null ? "" : value.trim();
  }
}
