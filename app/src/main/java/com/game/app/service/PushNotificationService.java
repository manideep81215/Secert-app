package com.game.app.service;

import java.math.BigInteger;
import java.io.ByteArrayInputStream;
import java.io.FileInputStream;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.nio.charset.StandardCharsets;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.interfaces.ECPrivateKey;
import java.security.interfaces.ECPublicKey;
import java.security.spec.ECGenParameterSpec;
import java.util.Base64;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.CompletableFuture;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import com.game.app.model.MobilePushTokenEntity;
import com.game.app.model.PushSubscriptionEntity;
import com.game.app.repository.MobilePushTokenRepository;
import com.game.app.repository.PushSubscriptionRepository;
import com.google.auth.oauth2.GoogleCredentials;
import com.google.firebase.FirebaseApp;
import com.google.firebase.FirebaseOptions;
import com.google.firebase.messaging.AndroidConfig;
import com.google.firebase.messaging.AndroidNotification;
import com.google.firebase.messaging.FirebaseMessaging;
import com.google.firebase.messaging.FirebaseMessagingException;
import com.google.firebase.messaging.Message;
import com.google.firebase.messaging.MessagingErrorCode;

import nl.martijndwars.webpush.Notification;
import nl.martijndwars.webpush.PushService;
import nl.martijndwars.webpush.Urgency;

@Service
public class PushNotificationService {

  private static final Logger log = LoggerFactory.getLogger(PushNotificationService.class);
  private static final int PUSH_TTL_SECONDS = 24 * 60 * 60;
  private static final Urgency PUSH_URGENCY = Urgency.HIGH;
  private static final long FCM_TTL_MILLIS = 24L * 60L * 60L * 1000L;
  private static final String FCM_APP_NAME = "simp-games-quest-fcm";
  private static final String FCM_ANDROID_CHANNEL_ID = "chat_messages";
  private static final String FCM_ANDROID_SMALL_ICON = "ic_stat_simp_games";

  private final PushSubscriptionRepository pushSubscriptionRepository;
  private final MobilePushTokenRepository mobilePushTokenRepository;
  private final String vapidPublicKey;
  private final String vapidPrivateKey;
  private final String vapidSubject;
  private final boolean fcmEnabled;
  private final String fcmCredentialsFile;
  private final String fcmCredentialsJson;
  private final String fcmCredentialsBase64;
  private volatile FirebaseMessaging firebaseMessaging;

  public PushNotificationService(
      PushSubscriptionRepository pushSubscriptionRepository,
      MobilePushTokenRepository mobilePushTokenRepository,
      @Value("${app.push.vapid.public-key:}") String vapidPublicKey,
      @Value("${app.push.vapid.private-key:}") String vapidPrivateKey,
      @Value("${app.push.vapid.subject:mailto:admin@example.com}") String vapidSubject,
      @Value("${app.push.fcm.enabled:true}") boolean fcmEnabled,
      @Value("${app.push.fcm.credentials-file:}") String fcmCredentialsFile,
      @Value("${app.push.fcm.credentials-json:}") String fcmCredentialsJson,
      @Value("${app.push.fcm.credentials-base64:}") String fcmCredentialsBase64) {
    this.pushSubscriptionRepository = pushSubscriptionRepository;
    this.mobilePushTokenRepository = mobilePushTokenRepository;
    String configuredPublic = vapidPublicKey != null ? vapidPublicKey.trim() : "";
    String configuredPrivate = vapidPrivateKey != null ? vapidPrivateKey.trim() : "";
    if (configuredPublic.isBlank() || configuredPrivate.isBlank()) {
      VapidKeyPair generated = generateVapidKeyPair();
      configuredPublic = generated.publicKey();
      configuredPrivate = generated.privateKey();
      log.warn("VAPID keys were not configured. Generated temporary runtime keys. For stable push after restart, set APP_PUSH_VAPID_PUBLIC_KEY and APP_PUSH_VAPID_PRIVATE_KEY.");
      log.warn("Generated runtime VAPID public key: {}", configuredPublic);
    }
    this.vapidPublicKey = configuredPublic;
    this.vapidPrivateKey = configuredPrivate;
    this.vapidSubject = vapidSubject != null ? vapidSubject.trim() : "mailto:admin@example.com";
    this.fcmEnabled = fcmEnabled;
    this.fcmCredentialsFile = fcmCredentialsFile != null ? fcmCredentialsFile.trim() : "";
    this.fcmCredentialsJson = fcmCredentialsJson != null ? fcmCredentialsJson.trim() : "";
    this.fcmCredentialsBase64 = fcmCredentialsBase64 != null ? fcmCredentialsBase64.trim() : "";
  }

  public boolean isPushEnabled() {
    return !vapidPublicKey.isBlank() && !vapidPrivateKey.isBlank();
  }

  public String getVapidPublicKey() {
    return vapidPublicKey;
  }

  public boolean isFcmEnabled() {
    return getFirebaseMessaging() != null;
  }

  public void saveSubscription(String username, String endpoint, String p256dh, String auth) {
    String normalizedUser = normalizeUsername(username);
    Optional<PushSubscriptionEntity> existing = pushSubscriptionRepository.findByEndpoint(endpoint);
    PushSubscriptionEntity entity = existing.orElseGet(PushSubscriptionEntity::new);
    entity.setUsername(normalizedUser);
    entity.setEndpoint(endpoint);
    entity.setP256dh(p256dh);
    entity.setAuth(auth);
    pushSubscriptionRepository.save(entity);
  }

  public void removeSubscription(String username, String endpoint) {
    if (endpoint == null || endpoint.isBlank()) return;
    pushSubscriptionRepository.deleteByUsernameAndEndpoint(normalizeUsername(username), endpoint.trim());
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
    // Keep one active token per user/platform to prevent duplicate mobile pushes.
    mobilePushTokenRepository.deleteByUsernameAndPlatformAndTokenNot(
        normalizedUser,
        normalizedPlatform,
        token.trim());
  }

  public void removeMobileToken(String username, String token) {
    if (token == null || token.isBlank()) return;
    mobilePushTokenRepository.deleteByUsernameAndToken(normalizeUsername(username), token.trim());
  }

  public void notifyUser(String username, String title, String body, String url) {
    String normalizedUser = normalizeUsername(username);
    boolean webPushEnabled = isPushEnabled();
    boolean nativePushEnabled = getFirebaseMessaging() != null;
    if (!webPushEnabled && !nativePushEnabled) return;

    List<PushSubscriptionEntity> subscriptions = webPushEnabled
        ? pushSubscriptionRepository.findByUsername(normalizedUser)
        : List.of();
    List<MobilePushTokenEntity> mobileTokens = collapseMobileTokens(
        mobilePushTokenRepository.findByUsername(normalizedUser));
    if (subscriptions.isEmpty() && mobileTokens.isEmpty()) return;

    String payload = buildPayload(title, body, url);

    // Send native mobile push immediately for lowest delivery latency.
    if (!mobileTokens.isEmpty()) {
      FirebaseMessaging messaging = getFirebaseMessaging();
      if (messaging != null) {
        for (MobilePushTokenEntity mobileToken : mobileTokens) {
          sendToMobileToken(messaging, mobileToken, title, body, url);
        }
      }
    }

    CompletableFuture.runAsync(() -> {
      // Avoid duplicate lock-screen notifications when a user has both
      // mobile token(s) and web-push subscriptions for the same account.
      if (!mobileTokens.isEmpty()) return;
      if (subscriptions.isEmpty()) return;
      try {
        PushService service = new PushService(vapidPublicKey, vapidPrivateKey, vapidSubject);
        for (PushSubscriptionEntity subscription : subscriptions) {
          sendToSubscription(service, subscription, payload);
        }
      } catch (Exception ignored) {
        // Ignore web-push broadcast failures.
      }
    });
  }

  public long countSubscriptions(String username) {
    String normalizedUser = normalizeUsername(username);
    return pushSubscriptionRepository.findByUsername(normalizedUser).size();
  }

  public PushSendResult sendTestNow(String username, String title, String body, String url) {
    if (!isPushEnabled()) {
      return new PushSendResult(false, 0, 0, "Push key not configured on server.");
    }

    String normalizedUser = normalizeUsername(username);
    List<PushSubscriptionEntity> subscriptions = pushSubscriptionRepository.findByUsername(normalizedUser);
    if (subscriptions.isEmpty()) {
      return new PushSendResult(false, 0, 0, "No active push subscription for this user.");
    }

    String payload = buildPayload(title, body, url);
    int attempted = 0;
    int sent = 0;
    try {
      PushService service = new PushService(vapidPublicKey, vapidPrivateKey, vapidSubject);
      for (PushSubscriptionEntity subscription : subscriptions) {
        attempted += 1;
        if (sendToSubscription(service, subscription, payload)) {
          sent += 1;
        }
      }
    } catch (Exception error) {
      return new PushSendResult(false, attempted, sent, error.getMessage() != null ? error.getMessage() : "Push service error");
    }

    if (sent > 0) {
      return new PushSendResult(true, attempted, sent, "Test push sent.");
    }
    return new PushSendResult(false, attempted, sent, "Push send failed for all subscriptions.");
  }

  private boolean sendToSubscription(PushService service, PushSubscriptionEntity subscription, String payload) {
    try {
      Notification notification = Notification.builder()
          .endpoint(subscription.getEndpoint())
          .userPublicKey(subscription.getP256dh())
          .userAuth(subscription.getAuth())
          .payload(payload.getBytes(StandardCharsets.UTF_8))
          .ttl(PUSH_TTL_SECONDS)
          .urgency(PUSH_URGENCY)
          .build();
      service.send(notification);
      return true;
    } catch (Exception sendError) {
      String message = sendError.getMessage() != null ? sendError.getMessage() : "";
      if (message.contains("410") || message.contains("404")) {
        pushSubscriptionRepository.deleteById(subscription.getId());
      }
      return false;
    }
  }

  private String buildPayload(String title, String body, String url) {
    return "{\"title\":\"" + escapeJson(title)
        + "\",\"body\":\"" + escapeJson(body)
        + "\",\"url\":\"" + escapeJson(url) + "\"}";
  }

  private String normalizeUsername(String username) {
    return username == null ? "" : username.trim().toLowerCase();
  }

  private String normalizePlatform(String platform) {
    if (platform == null || platform.isBlank()) return "android";
    return platform.trim().toLowerCase();
  }

  private String escapeJson(String value) {
    if (value == null) return "";
    return value
        .replace("\\", "\\\\")
        .replace("\"", "\\\"")
        .replace("\n", "\\n")
        .replace("\r", "\\r");
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

  private void sendToMobileToken(FirebaseMessaging messaging, MobilePushTokenEntity token, String title, String body, String url) {
    try {
      Message message = Message.builder()
          .setToken(token.getToken())
          .setNotification(com.google.firebase.messaging.Notification.builder().setTitle(title).setBody(body).build())
          .putData("title", title != null ? title : "")
          .putData("body", body != null ? body : "")
          .putData("url", url != null ? url : "/#/chat")
          .setAndroidConfig(AndroidConfig.builder()
              .setPriority(AndroidConfig.Priority.HIGH)
              .setTtl(FCM_TTL_MILLIS)
              .setNotification(AndroidNotification.builder()
                  .setChannelId(FCM_ANDROID_CHANNEL_ID)
                  .setIcon(FCM_ANDROID_SMALL_ICON)
                  .setSound("default")
                  .build())
              .build())
          .build();
      messaging.send(message);
    } catch (FirebaseMessagingException error) {
      if (isInvalidTokenError(error)) {
        mobilePushTokenRepository.deleteById(token.getId());
      }
      log.warn("FCM send failed for user {}: {}", token.getUsername(), error.getMessage());
    } catch (Exception error) {
      log.warn("Unexpected FCM send error for user {}: {}", token.getUsername(), error.getMessage());
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

  private boolean isInvalidTokenError(FirebaseMessagingException error) {
    if (error == null) return false;
    MessagingErrorCode code = error.getMessagingErrorCode();
    return code == MessagingErrorCode.UNREGISTERED
        || code == MessagingErrorCode.INVALID_ARGUMENT;
  }

  private VapidKeyPair generateVapidKeyPair() {
    try {
      KeyPairGenerator generator = KeyPairGenerator.getInstance("EC");
      generator.initialize(new ECGenParameterSpec("secp256r1"));
      KeyPair keyPair = generator.generateKeyPair();

      ECPublicKey publicKey = (ECPublicKey) keyPair.getPublic();
      ECPrivateKey privateKey = (ECPrivateKey) keyPair.getPrivate();

      byte[] x = toFixedLength(publicKey.getW().getAffineX(), 32);
      byte[] y = toFixedLength(publicKey.getW().getAffineY(), 32);
      byte[] uncompressed = new byte[65];
      uncompressed[0] = 0x04;
      System.arraycopy(x, 0, uncompressed, 1, 32);
      System.arraycopy(y, 0, uncompressed, 33, 32);

      byte[] privateRaw = toFixedLength(privateKey.getS(), 32);
      Base64.Encoder encoder = Base64.getUrlEncoder().withoutPadding();
      return new VapidKeyPair(
          encoder.encodeToString(uncompressed),
          encoder.encodeToString(privateRaw));
    } catch (Exception error) {
      throw new IllegalStateException("Failed to generate runtime VAPID key pair", error);
    }
  }

  private byte[] toFixedLength(BigInteger value, int size) {
    byte[] raw = value.toByteArray();
    if (raw.length == size) return raw;
    int offset = raw.length > size ? raw.length - size : 0;
    int copyLength = Math.min(raw.length, size);
    byte[] fixed = new byte[size];
    System.arraycopy(raw, offset, fixed, size - copyLength, copyLength);
    return fixed;
  }

  private record VapidKeyPair(String publicKey, String privateKey) {}

  public record PushSendResult(boolean success, int attempted, int sent, String message) {}
}
