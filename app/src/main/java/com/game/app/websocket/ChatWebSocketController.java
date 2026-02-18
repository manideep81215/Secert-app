package com.game.app.websocket;

import java.security.Principal;
import java.time.Instant;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

import org.springframework.context.event.EventListener;
import org.springframework.messaging.handler.annotation.MessageMapping;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Controller;
import org.springframework.web.socket.messaging.SessionDisconnectEvent;

import com.game.app.model.ChatMessageEntity;
import com.game.app.repository.ChatMessageRepository;
import com.game.app.service.PushNotificationService;

@Controller
public class ChatWebSocketController {

  private final SimpMessagingTemplate messagingTemplate;
  private final ChatMessageRepository chatMessageRepository;
  private final PushNotificationService pushNotificationService;
  private final Set<String> onlineUsers = ConcurrentHashMap.newKeySet();
  private final Map<String, Long> lastSeenMap = new ConcurrentHashMap<>();

  public ChatWebSocketController(
      SimpMessagingTemplate messagingTemplate,
      ChatMessageRepository chatMessageRepository,
      PushNotificationService pushNotificationService) {
    this.messagingTemplate = messagingTemplate;
    this.chatMessageRepository = chatMessageRepository;
    this.pushNotificationService = pushNotificationService;
  }

  @MessageMapping("/chat.send")
  public void sendMessage(ChatMessage payload, Principal principal) {
    if (payload == null || payload.toUsername() == null || payload.toUsername().isBlank()
        || payload.message() == null || payload.message().isBlank()) {
      return;
    }

    String fromUsername = principal != null ? principal.getName() : payload.fromUsername();
    if (fromUsername == null || fromUsername.isBlank()) {
      return;
    }

    String normalizedFrom = normalizeUsername(fromUsername);
    String normalizedTo = normalizeUsername(payload.toUsername());

    ChatMessageEntity entity = new ChatMessageEntity();
    entity.setFromUsername(normalizedFrom);
    entity.setToUsername(normalizedTo);
    entity.setMessage(payload.message());
    entity.setType(payload.type());
    entity.setFileName(payload.fileName());
    entity.setMediaUrl(payload.mediaUrl());
    entity.setMimeType(payload.mimeType());
    entity.setReplyText(payload.replyingTo() != null ? payload.replyingTo().text() : payload.replyText());
    entity.setReplySenderName(payload.replyingTo() != null ? payload.replyingTo().senderName() : payload.replySenderName());
    entity = chatMessageRepository.save(entity);

    messagingTemplate.convertAndSendToUser(
        normalizedTo,
        "/queue/messages",
        new IncomingMessage(
            normalizedFrom,
            payload.message(),
            payload.type(),
            payload.fileName(),
            payload.mediaUrl(),
            payload.mimeType(),
            payload.replyingTo() != null
                ? payload.replyingTo()
                : buildReplyPreview(payload.replyText(), payload.replySenderName()),
            payload.replyText(),
            payload.replySenderName(),
            entity.getCreatedAt() != null ? entity.getCreatedAt().toEpochMilli() : Instant.now().toEpochMilli()));

    messagingTemplate.convertAndSendToUser(
        normalizedFrom,
        "/queue/send-ack",
        new SendAck(
            payload.tempId(),
            true,
            entity.getId(),
            entity.getCreatedAt() != null ? entity.getCreatedAt().toEpochMilli() : Instant.now().toEpochMilli()));

    if (!onlineUsers.contains(normalizedTo)) {
      String preview = messagePreview(payload.message(), payload.type(), payload.fileName());
      pushNotificationService.notifyUser(
          normalizedTo,
          "@" + normalizedFrom,
          preview,
          "/#/chat?with=" + normalizedFrom);
    }
  }

  @MessageMapping("/user.online")
  public void userOnline(UserStatusMessage payload, Principal principal) {
    String username = principal != null ? principal.getName() : (payload != null ? payload.username() : null);
    if (username == null || username.isBlank()) {
      return;
    }
    onlineUsers.add(username);
    lastSeenMap.remove(username);
    broadcastUserStatus(username, "online", null);
    syncOnlineUsersFor(username);
  }

  @MessageMapping("/user.offline")
  public void userOffline(UserStatusMessage payload, Principal principal) {
    String username = principal != null ? principal.getName() : (payload != null ? payload.username() : null);
    if (username == null || username.isBlank()) {
      return;
    }
    onlineUsers.remove(username);
    long lastSeenAt = Instant.now().toEpochMilli();
    lastSeenMap.put(username, lastSeenAt);
    broadcastUserStatus(username, "offline", lastSeenAt);
  }

  @MessageMapping("/chat.typing")
  public void typing(TypingMessage payload, Principal principal) {
    if (payload == null || payload.toUsername() == null || payload.toUsername().isBlank()) {
      return;
    }

    String fromUsername = principal != null ? principal.getName() : payload.fromUsername();
    if (fromUsername == null || fromUsername.isBlank()) {
      return;
    }

    boolean typing = payload.typing() != null && payload.typing();
    messagingTemplate.convertAndSendToUser(
        payload.toUsername(),
        "/queue/typing",
        new TypingPayload(fromUsername, typing));
  }

  @EventListener
  public void onDisconnect(SessionDisconnectEvent event) {
    Principal principal = event.getUser();
    if (principal == null) {
      return;
    }

    String username = principal.getName();
    if (username != null && onlineUsers.remove(username)) {
      long lastSeenAt = Instant.now().toEpochMilli();
      lastSeenMap.put(username, lastSeenAt);
      broadcastUserStatus(username, "offline", lastSeenAt);
    }
  }

  private void broadcastUserStatus(String username, String status, Long lastSeenAt) {
    messagingTemplate.convertAndSend("/topic/user-status", new UserStatusPayload(username, status, lastSeenAt));
  }

  private void syncOnlineUsersFor(String username) {
    for (String onlineUsername : onlineUsers) {
      messagingTemplate.convertAndSendToUser(
          username,
          "/queue/user-status",
          new UserStatusPayload(onlineUsername, "online", null));
    }

    for (Map.Entry<String, Long> entry : lastSeenMap.entrySet()) {
      messagingTemplate.convertAndSendToUser(
          username,
          "/queue/user-status",
          new UserStatusPayload(entry.getKey(), "offline", entry.getValue()));
    }
  }

  private ReplyPreview buildReplyPreview(String replyText, String replySenderName) {
    if (replyText == null || replyText.isBlank()) {
      return null;
    }
    return new ReplyPreview(replyText, replySenderName);
  }

  private String normalizeUsername(String username) {
    return username == null ? "" : username.trim().toLowerCase();
  }

  private String messagePreview(String text, String type, String fileName) {
    if ("image".equalsIgnoreCase(type)) return "Sent an image";
    if ("video".equalsIgnoreCase(type)) return "Sent a video";
    if ("voice".equalsIgnoreCase(type)) return "Sent a voice message";
    if ("file".equalsIgnoreCase(type)) {
      return fileName != null && !fileName.isBlank() ? "Sent file: " + fileName : "Sent a file";
    }
    return text != null ? text : "New message";
  }

  public record ChatMessage(
      String toUsername,
      String message,
      String fromUsername,
      String tempId,
      String type,
      String fileName,
      String mediaUrl,
      String mimeType,
      ReplyPreview replyingTo,
      String replyText,
      String replySenderName) {}

  public record IncomingMessage(
      String fromUsername,
      String message,
      String type,
      String fileName,
      String mediaUrl,
      String mimeType,
      ReplyPreview replyingTo,
      String replyText,
      String replySenderName,
      Long createdAt) {}

  public record ReplyPreview(String text, String senderName) {}

  public record UserStatusMessage(String username) {}

  public record UserStatusPayload(String username, String status, Long lastSeenAt) {}

  public record TypingMessage(String toUsername, String fromUsername, Boolean typing) {}

  public record TypingPayload(String fromUsername, boolean typing) {}

  public record SendAck(String tempId, boolean success, Long messageId, Long createdAt) {}
}
