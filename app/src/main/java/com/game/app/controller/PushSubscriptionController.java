package com.game.app.controller;

import java.util.Map;

import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

import com.game.app.model.UserEntity;
import com.game.app.repository.UserRepository;
import com.game.app.service.PushNotificationService;

@RestController
@RequestMapping("/api/app/push")
public class PushSubscriptionController {

  private final PushNotificationService pushNotificationService;
  private final UserRepository userRepository;
  private final Map<String, Long> tokenStore;

  public PushSubscriptionController(
      PushNotificationService pushNotificationService,
      UserRepository userRepository,
      Map<String, Long> tokenStore) {
    this.pushNotificationService = pushNotificationService;
    this.userRepository = userRepository;
    this.tokenStore = tokenStore;
  }

  @GetMapping("/public-key")
  public PushPublicKeyResponse publicKey() {
    return new PushPublicKeyResponse(pushNotificationService.isPushEnabled(), pushNotificationService.getVapidPublicKey());
  }

  @PostMapping("/subscribe")
  public PushSubscribeResponse subscribe(
      @RequestHeader(value = "Authorization", required = false) String authHeader,
      @RequestBody PushSubscriptionRequest payload) {
    UserEntity me = requireAuthUser(authHeader);
    if (payload == null || payload.endpoint() == null || payload.endpoint().isBlank()
        || payload.keys() == null
        || payload.keys().p256dh() == null || payload.keys().p256dh().isBlank()
        || payload.keys().auth() == null || payload.keys().auth().isBlank()) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Invalid push subscription payload");
    }

    pushNotificationService.saveSubscription(
        me.getUsername(),
        payload.endpoint().trim(),
        payload.keys().p256dh().trim(),
        payload.keys().auth().trim());

    return new PushSubscribeResponse(true);
  }

  @DeleteMapping("/subscribe")
  public PushSubscribeResponse unsubscribe(
      @RequestHeader(value = "Authorization", required = false) String authHeader,
      @RequestBody(required = false) PushUnsubscribeRequest payload) {
    UserEntity me = requireAuthUser(authHeader);
    String endpoint = payload != null ? payload.endpoint() : null;
    if (endpoint != null && !endpoint.isBlank()) {
      pushNotificationService.removeSubscription(me.getUsername(), endpoint.trim());
    }
    return new PushSubscribeResponse(true);
  }

  @PostMapping("/test")
  public PushTestResponse testPush(
      @RequestHeader(value = "Authorization", required = false) String authHeader,
      @RequestBody(required = false) PushTestRequest payload) {
    UserEntity me = requireAuthUser(authHeader);
    String title = payload != null && payload.title() != null && !payload.title().isBlank()
        ? payload.title().trim()
        : "Test notification";
    String body = payload != null && payload.body() != null && !payload.body().isBlank()
        ? payload.body().trim()
        : "Push is working even when app is closed.";
    String url = payload != null && payload.url() != null && !payload.url().isBlank()
        ? payload.url().trim()
        : "/#/chat";

    PushNotificationService.PushSendResult result =
        pushNotificationService.sendTestNow(me.getUsername(), title, body, url);
    return new PushTestResponse(result.success(), result.message());
  }

  private UserEntity requireAuthUser(String authHeader) {
    String token = extractToken(authHeader);
    Long tokenUserId = tokenStore.get(token);
    if (tokenUserId == null) {
      throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Invalid or expired token");
    }
    return userRepository.findById(tokenUserId)
        .orElseThrow(() -> new ResponseStatusException(HttpStatus.UNAUTHORIZED, "User not found"));
  }

  private String extractToken(String rawToken) {
    if (rawToken == null || rawToken.isBlank()) {
      throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Authorization header is required");
    }
    if (rawToken.startsWith("Bearer ")) {
      return rawToken.substring(7).trim();
    }
    return rawToken.trim();
  }

  public record PushSubscriptionRequest(String endpoint, PushKeys keys) {}

  public record PushKeys(String p256dh, String auth) {}

  public record PushPublicKeyResponse(boolean enabled, String publicKey) {}

  public record PushSubscribeResponse(boolean success) {}

  public record PushUnsubscribeRequest(String endpoint) {}

  public record PushTestRequest(String title, String body, String url) {}

  public record PushTestResponse(boolean success, String message) {}
}
