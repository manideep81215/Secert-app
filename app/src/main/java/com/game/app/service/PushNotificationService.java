package com.game.app.service;

import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Optional;
import java.util.concurrent.CompletableFuture;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import com.game.app.model.PushSubscriptionEntity;
import com.game.app.repository.PushSubscriptionRepository;

import nl.martijndwars.webpush.Notification;
import nl.martijndwars.webpush.PushService;

@Service
public class PushNotificationService {

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
    this.vapidPublicKey = vapidPublicKey != null ? vapidPublicKey.trim() : "";
    this.vapidPrivateKey = vapidPrivateKey != null ? vapidPrivateKey.trim() : "";
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
}
