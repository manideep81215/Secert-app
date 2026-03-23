package com.game.app.service;

import java.io.ByteArrayInputStream;
import java.io.FileInputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.Base64;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.stream.Collectors;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import com.game.app.model.MobilePushTokenEntity;
import com.game.app.repository.MobilePushTokenRepository;
import com.google.auth.oauth2.GoogleCredentials;
import com.google.firebase.FirebaseApp;
import com.google.firebase.FirebaseOptions;
import com.google.firebase.messaging.AndroidConfig;
import com.google.firebase.messaging.AndroidNotification;
import com.google.firebase.messaging.FirebaseMessaging;
import com.google.firebase.messaging.FirebaseMessagingException;
import com.google.firebase.messaging.Message;
import com.google.firebase.messaging.MessagingErrorCode;

@Service
public class PushNotificationService {

  private static final Logger log = LoggerFactory.getLogger(PushNotificationService.class);
  private static final long FCM_TTL_MILLIS = 24L * 60L * 60L * 1000L;
  private static final String FCM_APP_NAME = "simp-games-quest-fcm";
  private static final String FCM_ANDROID_CHANNEL_ID = "chat_messages_v5";
  private static final String FCM_ANDROID_SMALL_ICON = "ic_stat_simp_games";

  private final MobilePushTokenRepository mobilePushTokenRepository;
  private final boolean fcmEnabled;
  private final String fcmCredentialsFile;
  private final String fcmCredentialsJson;
  private final String fcmCredentialsBase64;
  private volatile FirebaseMessaging firebaseMessaging;

  public PushNotificationService(
      MobilePushTokenRepository mobilePushTokenRepository,
      @Value("${app.push.fcm.enabled:true}") boolean fcmEnabled,
      @Value("${app.push.fcm.credentials-file:}") String fcmCredentialsFile,
      @Value("${app.push.fcm.credentials-json:}") String fcmCredentialsJson,
      @Value("${app.push.fcm.credentials-base64:}") String fcmCredentialsBase64) {
    this.mobilePushTokenRepository = mobilePushTokenRepository;
    this.fcmEnabled = fcmEnabled;
    this.fcmCredentialsFile = fcmCredentialsFile != null ? fcmCredentialsFile.trim() : "";
    this.fcmCredentialsJson = fcmCredentialsJson != null ? fcmCredentialsJson.trim() : "";
    this.fcmCredentialsBase64 = fcmCredentialsBase64 != null ? fcmCredentialsBase64.trim() : "";
  }

  // Browser/PWA web-push is disabled by design.
  public boolean isPushEnabled() {
    return false;
  }

  // Browser/PWA web-push is disabled by design.
  public String getVapidPublicKey() {
    return "";
  }

  public boolean isFcmEnabled() {
    return getFirebaseMessaging() != null;
  }

  // Browser/PWA web-push is disabled by design.
  public void saveSubscription(String username, String endpoint, String p256dh, String auth) {
    // No-op.
  }

  // Browser/PWA web-push is disabled by design.
  public void removeSubscription(String username, String endpoint) {
    // No-op.
  }

  // Browser/PWA web-push is disabled by design.
  public long countSubscriptions(String username) {
    return 0L;
  }

  public void saveMobileToken(String username, String token, String platform) {
    if (token == null || token.isBlank()) return;
    String normalizedUser = normalizeUsername(username);
    String normalizedPlatform = normalizePlatform(platform);
    Optional<MobilePushTokenEntity> existing = mobilePushTokenRepository.findByToken(token.trim());
    MobilePushTokenEntity entity = existing.orElseGet(MobilePushTokenEntity::new);
    entity.setUsername(normalizedUser);
    entity.setToken(token.trim());
    entity.setPlatform(normalizedPlatform);
    mobilePushTokenRepository.save(entity);
    // Keep exactly one active token row per user/platform (latest saved row).
    List<MobilePushTokenEntity> stale = mobilePushTokenRepository.findByUsername(normalizedUser).stream()
        .filter(row -> row != null && row.getId() != null)
        .filter(row -> normalizePlatform(row.getPlatform()).equals(normalizedPlatform))
        .filter(row -> !row.getId().equals(entity.getId()))
        .collect(Collectors.toList());
    if (!stale.isEmpty()) {
      mobilePushTokenRepository.deleteAllInBatch(stale);
    }
  }

  public void removeMobileToken(String username, String token) {
    if (token == null || token.isBlank()) return;
    mobilePushTokenRepository.deleteByUsernameAndToken(normalizeUsername(username), token.trim());
  }

  public void notifyUser(String username, String title, String body, String url) {
    String normalizedUser = normalizeUsername(username);
    FirebaseMessaging messaging = getFirebaseMessaging();
    if (messaging == null) return;

    List<MobilePushTokenEntity> mobileTokens = collapseMobileTokens(
        mobilePushTokenRepository.findByUsername(normalizedUser));
    if (mobileTokens.isEmpty()) return;

    for (MobilePushTokenEntity mobileToken : mobileTokens) {
      sendToMobileToken(messaging, mobileToken, title, body, url);
    }
  }

  public long countMobileTokens(String username) {
    String normalizedUser = normalizeUsername(username);
    return collapseMobileTokens(mobilePushTokenRepository.findByUsername(normalizedUser)).size();
  }

  public PushSendResult sendTestNow(String username, String title, String body, String url) {
    String normalizedUser = normalizeUsername(username);
    FirebaseMessaging messaging = getFirebaseMessaging();
    if (messaging == null) {
      return new PushSendResult(false, 0, 0, "FCM push is not configured on server.");
    }

    List<MobilePushTokenEntity> mobileTokens = collapseMobileTokens(
        mobilePushTokenRepository.findByUsername(normalizedUser));
    if (mobileTokens.isEmpty()) {
      return new PushSendResult(false, 0, 0, "No active mobile push token for this user.");
    }

    int attempted = 0;
    int sent = 0;
    for (MobilePushTokenEntity mobileToken : mobileTokens) {
      attempted += 1;
      if (sendToMobileToken(messaging, mobileToken, title, body, url)) {
        sent += 1;
      }
    }

    if (sent > 0) {
      return new PushSendResult(true, attempted, sent, "Test push sent (" + sent + "/" + attempted + ").");
    }
    return new PushSendResult(false, attempted, sent, "Push send failed for all active mobile tokens.");
  }

  private String normalizeUsername(String username) {
    return username == null ? "" : username.trim().toLowerCase();
  }

  private String normalizePlatform(String platform) {
    if (platform == null || platform.isBlank()) return "android";
    return platform.trim().toLowerCase();
  }

  private FirebaseMessaging getFirebaseMessaging() {
    if (!fcmEnabled) return null;
    FirebaseMessaging current = firebaseMessaging;
    if (current != null) return current;
    synchronized (this) {
      if (firebaseMessaging != null) return firebaseMessaging;
      try (InputStream credentialsStream = openFcmCredentialsStream()) {
        if (credentialsStream == null) {
          log.warn("FCM credentials are not configured. Closed-app push notifications are disabled.");
          return null;
        }
        GoogleCredentials credentials = GoogleCredentials.fromStream(credentialsStream);
        FirebaseOptions options = FirebaseOptions.builder().setCredentials(credentials).build();
        FirebaseApp app;
        try {
          app = FirebaseApp.getInstance(FCM_APP_NAME);
        } catch (IllegalStateException missing) {
          app = FirebaseApp.initializeApp(options, FCM_APP_NAME);
        }
        firebaseMessaging = FirebaseMessaging.getInstance(app);
        log.info("FCM initialized for mobile push notifications.");
        return firebaseMessaging;
      } catch (Exception error) {
        log.error("Failed to initialize FCM mobile push", error);
        return null;
      }
    }
  }

  private InputStream openFcmCredentialsStream() {
    try {
      if (!fcmCredentialsBase64.isBlank()) {
        byte[] decoded = Base64.getDecoder().decode(fcmCredentialsBase64);
        return new ByteArrayInputStream(decoded);
      }
      if (!fcmCredentialsJson.isBlank()) {
        return new ByteArrayInputStream(fcmCredentialsJson.getBytes(StandardCharsets.UTF_8));
      }
      if (!fcmCredentialsFile.isBlank()) {
        return new FileInputStream(fcmCredentialsFile);
      }
      String fallback = readFallbackCredentials();
      if (!fallback.isBlank()) {
        String trimmed = fallback.trim();
        if (trimmed.startsWith("{")) {
          return new ByteArrayInputStream(trimmed.getBytes(StandardCharsets.UTF_8));
        }
        byte[] decoded = Base64.getDecoder().decode(trimmed);
        return new ByteArrayInputStream(decoded);
      }
    } catch (Exception error) {
      log.error("Unable to read FCM credentials", error);
    }
    return null;
  }

  private String readFallbackCredentials() {
    String[] candidates = new String[] {
        "firebase-service-account.base64.txt",
        "frontend/firebase-service-account.base64.txt",
        "../frontend/firebase-service-account.base64.txt"
    };
    for (String candidate : candidates) {
      try {
        Path path = Paths.get(candidate).toAbsolutePath().normalize();
        if (!Files.exists(path)) continue;
        String raw = Files.readString(path, StandardCharsets.UTF_8);
        if (raw != null && !raw.trim().isBlank()) {
          log.info("Loaded fallback FCM credentials from {}", path);
          return raw;
        }
      } catch (Exception ignored) {
        // Try next fallback candidate.
      }
    }
    return "";
  }

  private boolean sendToMobileToken(FirebaseMessaging messaging, MobilePushTokenEntity token, String title, String body, String url) {
    try {
      String normalizedPlatform = normalizePlatform(token.getPlatform());
      String safeTitle = title != null ? title : "";
      String safeBody = body != null ? body : "";
      String safeUrl = url != null ? url : "/#/chat";
      String peerUsername = extractPeerUsernameFromUrl(safeUrl);

      AndroidConfig.Builder androidConfig = AndroidConfig.builder()
          .setPriority(AndroidConfig.Priority.HIGH)
          .setTtl(FCM_TTL_MILLIS);
      if (!"android".equals(normalizedPlatform)) {
        androidConfig.setNotification(AndroidNotification.builder()
            .setChannelId(FCM_ANDROID_CHANNEL_ID)
            .setIcon(FCM_ANDROID_SMALL_ICON)
            .setSound("default")
            .build());
      }

      Message.Builder messageBuilder = Message.builder()
          .setToken(token.getToken())
          .putData("title", safeTitle)
          .putData("body", safeBody)
          .putData("url", safeUrl)
          .putData("peerUsername", peerUsername)
          .putData("pushToken", token.getToken())
          .setAndroidConfig(androidConfig.build());

      if (!"android".equals(normalizedPlatform)) {
        messageBuilder.setNotification(
            com.google.firebase.messaging.Notification.builder()
                .setTitle(safeTitle)
                .setBody(safeBody)
                .build());
      }

      Message message = messageBuilder.build();
      messaging.send(message);
      return true;
    } catch (FirebaseMessagingException error) {
      if (isInvalidTokenError(error)) {
        mobilePushTokenRepository.deleteById(token.getId());
      }
      log.warn("FCM send failed for user {}: {}", token.getUsername(), error.getMessage());
      return false;
    } catch (Exception error) {
      log.warn("Unexpected FCM send error for user {}: {}", token.getUsername(), error.getMessage());
      return false;
    }
  }

  private List<MobilePushTokenEntity> collapseMobileTokens(List<MobilePushTokenEntity> tokens) {
    if (tokens == null || tokens.isEmpty()) return List.of();
    Map<String, MobilePushTokenEntity> latestByPlatform = new LinkedHashMap<>();
    tokens.stream()
        .filter(token -> token != null && token.getToken() != null && !token.getToken().isBlank())
        .sorted(Comparator.comparing(
            MobilePushTokenEntity::getUpdatedAt,
            Comparator.nullsFirst(Comparator.naturalOrder())).reversed())
        .forEach(token -> {
          String platform = normalizePlatform(token.getPlatform());
          latestByPlatform.putIfAbsent(platform, token);
        });
    return List.copyOf(latestByPlatform.values());
  }

  private String extractPeerUsernameFromUrl(String url) {
    if (url == null || url.isBlank()) return "";
    int marker = url.indexOf("with=");
    if (marker < 0) return "";
    String peer = url.substring(marker + 5);
    int end = peer.indexOf('&');
    if (end >= 0) {
      peer = peer.substring(0, end);
    }
    return normalizeUsername(peer);
  }

  private boolean isInvalidTokenError(FirebaseMessagingException error) {
    if (error == null) return false;
    MessagingErrorCode code = error.getMessagingErrorCode();
    return code == MessagingErrorCode.UNREGISTERED
        || code == MessagingErrorCode.INVALID_ARGUMENT;
  }

  public record PushSendResult(boolean success, int attempted, int sent, String message) {}
}

