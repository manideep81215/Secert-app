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
  }

  public boolean isPushEnabled() {
    return !vapidPublicKey.isBlank() && !vapidPrivateKey.isBlank();
  }

  public String getVapidPublicKey() {
    return vapidPublicKey;
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

  public void notifyUser(String username, String title, String body, String url) {
    if (!isPushEnabled()) return;
    String normalizedUser = normalizeUsername(username);
    List<PushSubscriptionEntity> subscriptions = pushSubscriptionRepository.findByUsername(normalizedUser);
    if (subscriptions.isEmpty()) return;

    String payload = "{\"title\":\"" + escapeJson(title) + "\",\"body\":\"" + escapeJson(body) + "\",\"url\":\"" + escapeJson(url) + "\"}";

    CompletableFuture.runAsync(() -> {
      try {
        PushService service = new PushService(vapidPublicKey, vapidPrivateKey, vapidSubject);
        for (PushSubscriptionEntity subscription : subscriptions) {
          try {
            Notification notification = new Notification(
                subscription.getEndpoint(),
                subscription.getP256dh(),
                subscription.getAuth(),
                payload.getBytes(StandardCharsets.UTF_8));
            service.send(notification);
          } catch (Exception sendError) {
            String message = sendError.getMessage() != null ? sendError.getMessage() : "";
            if (message.contains("410") || message.contains("404")) {
              pushSubscriptionRepository.deleteById(subscription.getId());
            }
          }
        }
      } catch (Exception ignored) {
        // Ignore push broadcast failures.
      }
    });
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
        .replace("\r", "\\r");
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
}
