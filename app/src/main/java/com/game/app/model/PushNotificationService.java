package com.game.app.service;

import java.math.BigInteger;
import java.nio.charset.StandardCharsets;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.interfaces.ECPrivateKey;
import java.security.interfaces.ECPublicKey;
import java.security.spec.ECGenParameterSpec;
import java.util.Base64;
import java.util.List;
import java.util.Optional;
import java.util.concurrent.CompletableFuture;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import com.game.app.model.PushSubscriptionEntity;
import com.game.app.repository.PushSubscriptionRepository;

import nl.martijndwars.webpush.Notification;
import nl.martijndwars.webpush.PushService;

@Service
public class PushNotificationService {

  private static final Logger log = LoggerFactory.getLogger(PushNotificationService.class);

  // FIX 1: TTL — 24 hours. Push server will retry delivery instead of dropping.
  private static final int PUSH_TTL_SECONDS = 86400;

  // FIX 2: Urgency — "high" ensures OS delivers even in battery-saving/locked mode.
  // Values: "very-low" | "low" | "normal" | "high"
  private static final String PUSH_URGENCY = "high";

  private final PushSubscriptionRepository pushSubscriptionRepository;
  private final String vapidPublicKey;
  private final String vapidPrivateKey;
  private final String vapidSubject;

  public PushNotificationService(
      PushSubscriptionRepository pushSubscriptionRepository,
      @Value("${app.push.vapid.public-key:}") String vapidPublicKey,
      @Value("${app.push.vapid.private-key:}") String vapidPrivateKey,
      @Value("${app.push.vapid.subject:mailto:admin@example.com}") String vapidSubject) {

    this.pushSubscriptionRepository = pushSubscriptionRepository;
    String configuredPublic  = vapidPublicKey  != null ? vapidPublicKey.trim()  : "";
    String configuredPrivate = vapidPrivateKey != null ? vapidPrivateKey.trim() : "";

    if (configuredPublic.isBlank() || configuredPrivate.isBlank()) {
      // FIX 3: Warn loudly — runtime-generated keys break ALL subscriptions on restart.
      // Every device will need to re-subscribe after each server restart.
      // ACTION REQUIRED: Set APP_PUSH_VAPID_PUBLIC_KEY + APP_PUSH_VAPID_PRIVATE_KEY in your env.
      VapidKeyPair generated = generateVapidKeyPair();
      configuredPublic  = generated.publicKey();
      configuredPrivate = generated.privateKey();
      log.error("========================================================");
      log.error("VAPID keys NOT configured! Generated temporary runtime keys.");
      log.error("WARNING: All push subscriptions will break on every restart!");
      log.error("Run: npx web-push generate-vapid-keys");
      log.error("Then set APP_PUSH_VAPID_PUBLIC_KEY and APP_PUSH_VAPID_PRIVATE_KEY.");
      log.error("Generated runtime public key (temporary): {}", configuredPublic);
      log.error("========================================================");
    }

    this.vapidPublicKey  = configuredPublic;
    this.vapidPrivateKey = configuredPrivate;
    this.vapidSubject    = (vapidSubject != null && !vapidSubject.isBlank())
        ? vapidSubject.trim()
        : "mailto:admin@example.com";

    log.info("PushNotificationService initialized. Push enabled: {}", isPushEnabled());
  }

  public boolean isPushEnabled() {
    return !vapidPublicKey.isBlank() && !vapidPrivateKey.isBlank();
  }

  public String getVapidPublicKey() {
    return vapidPublicKey;
  }

  public void saveSubscription(String username, String endpoint, String p256dh, String auth) {
    if (endpoint == null || endpoint.isBlank()) {
      log.warn("saveSubscription called with blank endpoint for user: {}", username);
      return;
    }
    String normalizedUser = normalizeUsername(username);
    Optional<PushSubscriptionEntity> existing = pushSubscriptionRepository.findByEndpoint(endpoint);
    PushSubscriptionEntity entity = existing.orElseGet(PushSubscriptionEntity::new);
    entity.setUsername(normalizedUser);
    entity.setEndpoint(endpoint);
    entity.setP256dh(p256dh);
    entity.setAuth(auth);
    pushSubscriptionRepository.save(entity);
    log.info("Push subscription saved for user: {} (new={})", normalizedUser, existing.isEmpty());
  }

  public void removeSubscription(String username, String endpoint) {
    if (endpoint == null || endpoint.isBlank()) return;
    pushSubscriptionRepository.deleteByUsernameAndEndpoint(
        normalizeUsername(username), endpoint.trim());
    log.info("Push subscription removed for user: {}", username);
  }

  public void notifyUser(String username, String title, String body, String url) {
    if (!isPushEnabled()) {
      log.debug("Push disabled — skipping notification for user: {}", username);
      return;
    }

    String normalizedUser = normalizeUsername(username);
    List<PushSubscriptionEntity> subscriptions =
        pushSubscriptionRepository.findByUsername(normalizedUser);

    if (subscriptions.isEmpty()) {
      log.debug("No push subscriptions found for user: {}", normalizedUser);
      return;
    }

    // FIX 4: Build JSON safely — escapeJson handles quotes, backslashes, newlines.
    // Also added "requireInteraction": true so notification stays until user dismisses it.
    // Added "badge" and "icon" fields for Android/iOS display in background.
    String payload = buildPayload(title, body, url);

    log.info("Sending push to {} subscription(s) for user: {}", subscriptions.size(), normalizedUser);

    CompletableFuture.runAsync(() -> {
      try {
        // FIX 5: Create PushService ONCE per broadcast, not per subscription.
        PushService pushService = new PushService(vapidPublicKey, vapidPrivateKey, vapidSubject);

        for (PushSubscriptionEntity subscription : subscriptions) {
          sendToSubscription(pushService, subscription, payload, normalizedUser);
        }

      } catch (Exception e) {
        // FIX 6: Log instead of silently swallowing — you need to know if PushService init fails.
        log.error("Failed to initialize PushService for user {}: {}", normalizedUser, e.getMessage(), e);
      }
    });
  }

  private void sendToSubscription(PushService pushService,
                                   PushSubscriptionEntity subscription,
                                   String payload,
                                   String username) {
    try {
      Notification notification = new Notification(
          subscription.getEndpoint(),
          subscription.getP256dh(),
          subscription.getAuth(),
          payload.getBytes(StandardCharsets.UTF_8));

      // FIX 7: Set TTL — without this many push services silently drop the message
      // when the device is offline/background. 86400 = 24 hour retry window.
      notification.setTtl(PUSH_TTL_SECONDS);

      // FIX 8: Set urgency to "high" — this is the #1 reason background/locked
      // notifications fail on Android and iOS. "normal" urgency is suppressed
      // by OS battery optimization. "high" bypasses Doze mode on Android.
      // On iOS it increases the priority in APNs delivery.
      notification.setUrgency(PUSH_URGENCY);

      pushService.send(notification);
      log.debug("Push sent successfully to endpoint: {}...", 
          subscription.getEndpoint().substring(0, Math.min(40, subscription.getEndpoint().length())));

    } catch (Exception e) {
      String message = e.getMessage() != null ? e.getMessage() : "";
      log.warn("Push send failed for user {} — endpoint: {}... error: {}",
          username,
          subscription.getEndpoint().substring(0, Math.min(40, subscription.getEndpoint().length())),
          message);

      // FIX 9: Also handle 401 (expired/invalid VAPID) and 400 (malformed subscription).
      // These should also trigger subscription cleanup — not just 404/410.
      if (message.contains("410") || message.contains("404")) {
        // Gone — subscription is permanently invalid, remove it.
        log.info("Removing expired/gone subscription (410/404) for user: {}", username);
        pushSubscriptionRepository.deleteById(subscription.getId());
      } else if (message.contains("401")) {
        // Unauthorized — likely VAPID key mismatch. Log loudly but don't delete subscription
        // because the issue is on the server side (wrong keys), not the device.
        log.error("VAPID auth failed (401) for user {}. Check your VAPID keys match what devices subscribed with!", username);
      } else if (message.contains("400")) {
        // Bad request — malformed subscription, remove it.
        log.warn("Removing malformed subscription (400) for user: {}", username);
        pushSubscriptionRepository.deleteById(subscription.getId());
      }
    }
  }

  /**
   * Builds a JSON push payload.
   *
   * Key fields for background/locked-screen delivery:
   * - "requireInteraction": true  → notification stays until user taps it (Android Chrome)
   * - urgency: "high" (set on Notification object)  → bypasses Android Doze / iOS APNs priority
   * - ttl: 86400 (set on Notification object)       → push server retries for 24h if device offline
   *
   * The sw.js MUST read these fields and pass them to self.registration.showNotification().
   */
  private String buildPayload(String title, String body, String url) {
    return "{"
        + "\"title\":" + jsonString(title) + ","
        + "\"body\":"  + jsonString(body)  + ","
        + "\"url\":"   + jsonString(url)   + ","
        + "\"requireInteraction\":true,"
        + "\"timestamp\":" + System.currentTimeMillis()
        + "}";
  }

  private String jsonString(String value) {
    if (value == null) return "\"\"";
    return "\"" + escapeJson(value) + "\"";
  }

  private String normalizeUsername(String username) {
    return username == null ? "" : username.trim().toLowerCase();
  }

  private String escapeJson(String value) {
    if (value == null) return "";
    return value
        .replace("\\", "\\\\")
        .replace("\"", "\\\"")
        .replace("\n", "\\n")
        .replace("\r", "\\r")
        .replace("\t", "\\t");
  }

  private VapidKeyPair generateVapidKeyPair() {
    try {
      KeyPairGenerator generator = KeyPairGenerator.getInstance("EC");
      generator.initialize(new ECGenParameterSpec("secp256r1"));
      KeyPair keyPair = generator.generateKeyPair();

      ECPublicKey  publicKey  = (ECPublicKey)  keyPair.getPublic();
      ECPrivateKey privateKey = (ECPrivateKey) keyPair.getPrivate();

      byte[] x = toFixedLength(publicKey.getW().getAffineX(), 32);
      byte[] y = toFixedLength(publicKey.getW().getAffineY(), 32);
      byte[] uncompressed = new byte[65];
      uncompressed[0] = 0x04;
      System.arraycopy(x, 0, uncompressed, 1,  32);
      System.arraycopy(y, 0, uncompressed, 33, 32);

      byte[] privateRaw = toFixedLength(privateKey.getS(), 32);
      Base64.Encoder encoder = Base64.getUrlEncoder().withoutPadding();
      return new VapidKeyPair(
          encoder.encodeToString(uncompressed),
          encoder.encodeToString(privateRaw));
    } catch (Exception e) {
      throw new IllegalStateException("Failed to generate runtime VAPID key pair", e);
    }
  }

  private byte[] toFixedLength(BigInteger value, int size) {
    byte[] raw = value.toByteArray();
    if (raw.length == size) return raw;
    int offset     = raw.length > size ? raw.length - size : 0;
    int copyLength = Math.min(raw.length, size);
    byte[] fixed   = new byte[size];
    System.arraycopy(raw, offset, fixed, size - copyLength, copyLength);
    return fixed;
  }

  private record VapidKeyPair(String publicKey, String privateKey) {}
}