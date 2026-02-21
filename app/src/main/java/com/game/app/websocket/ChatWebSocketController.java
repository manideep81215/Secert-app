package com.game.app.websocket;

import java.security.Principal;
import java.time.Instant;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.regex.Pattern;

import org.springframework.context.event.EventListener;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.messaging.handler.annotation.MessageMapping;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.messaging.simp.user.SimpUser;
import org.springframework.messaging.simp.user.SimpUserRegistry;
import org.springframework.stereotype.Controller;
import org.springframework.web.socket.messaging.SessionDisconnectEvent;

import com.game.app.model.ChatMessageEntity;
import com.game.app.model.ChatReadReceiptEntity;
import com.game.app.repository.ChatMessageRepository;
import com.game.app.repository.ChatReadReceiptRepository;
import com.game.app.service.PushNotificationService;

@Controller
public class ChatWebSocketController {
  private static final long EDIT_WINDOW_MILLIS = 15 * 60 * 1000L;
  private static final Pattern REACTION_PATTERN = Pattern.compile("^[\\p{So}\\p{Sk}\\uFE0F\\u200D]{1,16}$");

  private final SimpMessagingTemplate messagingTemplate;
  private final SimpUserRegistry simpUserRegistry;
  private final ChatMessageRepository chatMessageRepository;
  private final ChatReadReceiptRepository chatReadReceiptRepository;
  private final PushNotificationService pushNotificationService;
  private final boolean notifyWhenOnline;
  private final Set<String> onlineUsers = ConcurrentHashMap.newKeySet();
  private final Map<String, Long> lastSeenMap = new ConcurrentHashMap<>();

  public ChatWebSocketController(
      SimpMessagingTemplate messagingTemplate,
      SimpUserRegistry simpUserRegistry,
      ChatMessageRepository chatMessageRepository,
      ChatReadReceiptRepository chatReadReceiptRepository,
      PushNotificationService pushNotificationService,
      @Value("${app.push.notify-when-online:true}") boolean notifyWhenOnline) {
    this.messagingTemplate = messagingTemplate;
    this.simpUserRegistry = simpUserRegistry;
    this.chatMessageRepository = chatMessageRepository;
    this.chatReadReceiptRepository = chatReadReceiptRepository;
    this.pushNotificationService = pushNotificationService;
    this.notifyWhenOnline = notifyWhenOnline;
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
            entity.getId(),
            normalizedFrom,
            payload.message(),
            payload.type(),
            payload.fileName(),
            payload.mediaUrl(),
            payload.mimeType(),
            entity.getReaction(),
            payload.replyingTo() != null
                ? payload.replyingTo()
                : buildReplyPreview(payload.replyText(), payload.replySenderName()),
            payload.replyText(),
            payload.replySenderName(),
            entity.getCreatedAt() != null ? entity.getCreatedAt().toEpochMilli() : Instant.now().toEpochMilli(),
            entity.isEdited(),
            entity.getEditedAt() != null ? entity.getEditedAt().toEpochMilli() : null));

    messagingTemplate.convertAndSendToUser(
        normalizedFrom,
        "/queue/send-ack",
        new SendAck(
            payload.tempId(),
            true,
            entity.getId(),
            entity.getCreatedAt() != null ? entity.getCreatedAt().toEpochMilli() : Instant.now().toEpochMilli()));

    if (notifyWhenOnline || !isUserConnected(normalizedTo)) {
      String preview = messagePreview(payload.message(), payload.type(), payload.fileName());
      pushNotificationService.notifyUser(
          normalizedTo,
          "@" + normalizedFrom,
          preview,
          "/#/chat?with=" + normalizedFrom);
    }
  }

  @MessageMapping("/chat.edit")
  public void editMessage(EditMessage payload, Principal principal) {
    if (payload == null || payload.messageId() == null || payload.message() == null || payload.message().isBlank()) {
      return;
    }

    String editor = principal != null ? principal.getName() : payload.fromUsername();
    if (editor == null || editor.isBlank()) {
      return;
    }

    String normalizedEditor = normalizeUsername(editor);
    ChatMessageEntity entity = chatMessageRepository.findById(payload.messageId()).orElse(null);
    if (entity == null) {
      messagingTemplate.convertAndSendToUser(normalizedEditor, "/queue/edit-ack", new EditAck(payload.messageId(), false, "Message not found"));
      return;
    }

    String normalizedFrom = normalizeUsername(entity.getFromUsername());
    if (!normalizedEditor.equals(normalizedFrom)) {
      messagingTemplate.convertAndSendToUser(normalizedEditor, "/queue/edit-ack", new EditAck(payload.messageId(), false, "Not allowed"));
      return;
    }

    Instant createdAt = entity.getCreatedAt() != null ? entity.getCreatedAt() : Instant.now();
    long ageMillis = Math.max(0L, Instant.now().toEpochMilli() - createdAt.toEpochMilli());
    if (ageMillis > EDIT_WINDOW_MILLIS) {
      messagingTemplate.convertAndSendToUser(normalizedEditor, "/queue/edit-ack", new EditAck(payload.messageId(), false, "Edit window expired"));
      return;
    }

    entity.setMessage(payload.message());
    entity.setEdited(true);
    entity.setEditedAt(Instant.now());
    entity = chatMessageRepository.save(entity);

    String normalizedTo = normalizeUsername(entity.getToUsername());
    MessageEditPayload event = new MessageEditPayload(
        entity.getId(),
        normalizedFrom,
        entity.getMessage(),
        true,
        entity.getEditedAt() != null ? entity.getEditedAt().toEpochMilli() : Instant.now().toEpochMilli(),
        entity.getCreatedAt() != null ? entity.getCreatedAt().toEpochMilli() : Instant.now().toEpochMilli());

    messagingTemplate.convertAndSendToUser(normalizedTo, "/queue/message-edits", event);
    messagingTemplate.convertAndSendToUser(normalizedFrom, "/queue/message-edits", event);
    messagingTemplate.convertAndSendToUser(normalizedFrom, "/queue/edit-ack", new EditAck(entity.getId(), true, null));
  }

  @MessageMapping("/chat.read")
  public void readConversation(ReadReceiptMessage payload, Principal principal) {
    if (payload == null || payload.peerUsername() == null || payload.peerUsername().isBlank()) {
      return;
    }

    String reader = principal != null ? principal.getName() : payload.readerUsername();
    if (reader == null || reader.isBlank()) {
      return;
    }

    String normalizedReader = normalizeUsername(reader);
    String normalizedPeer = normalizeUsername(payload.peerUsername());
    if (normalizedPeer.isBlank() || normalizedPeer.equals(normalizedReader)) {
      return;
    }

    long now = Instant.now().toEpochMilli();
    long readAt = payload.readAt() != null && payload.readAt() > 0
        ? Math.min(payload.readAt(), now)
        : now;

    ChatReadReceiptEntity receipt = chatReadReceiptRepository
        .findByReaderUsernameAndPeerUsername(normalizedReader, normalizedPeer)
        .orElseGet(() -> {
          ChatReadReceiptEntity entity = new ChatReadReceiptEntity();
          entity.setReaderUsername(normalizedReader);
          entity.setPeerUsername(normalizedPeer);
          entity.setLastReadAt(0L);
          return entity;
        });

    long existing = receipt.getLastReadAt() != null ? receipt.getLastReadAt() : 0L;
    if (readAt <= existing) {
      return;
    }

    receipt.setLastReadAt(readAt);
    chatReadReceiptRepository.save(receipt);

    ReadReceiptPayload event = new ReadReceiptPayload(normalizedReader, normalizedPeer, readAt);
    messagingTemplate.convertAndSendToUser(normalizedPeer, "/queue/read-receipts", event);
  }

  @MessageMapping("/chat.react")
  public void reactToMessage(ReactionMessage payload, Principal principal) {
    if (payload == null || payload.messageId() == null) {
      return;
    }

    String reactor = principal != null ? principal.getName() : payload.fromUsername();
    if (reactor == null || reactor.isBlank()) {
      return;
    }

    String normalizedReactor = normalizeUsername(reactor);
    ChatMessageEntity entity = chatMessageRepository.findById(payload.messageId()).orElse(null);
    if (entity == null) {
      return;
    }

    String normalizedFrom = normalizeUsername(entity.getFromUsername());
    String normalizedTo = normalizeUsername(entity.getToUsername());
    if (!normalizedReactor.equals(normalizedFrom) && !normalizedReactor.equals(normalizedTo)) {
      return;
    }

    String normalizedReaction = normalizeReaction(payload.reaction());
    entity.setReaction(normalizedReaction);
    chatMessageRepository.save(entity);

    MessageReactionPayload event = new MessageReactionPayload(
        entity.getId(),
        normalizedReaction,
        normalizedReactor,
        Instant.now().toEpochMilli());

    messagingTemplate.convertAndSendToUser(normalizedFrom, "/queue/message-reactions", event);
    messagingTemplate.convertAndSendToUser(normalizedTo, "/queue/message-reactions", event);
  }

  @MessageMapping("/user.online")
  public void userOnline(UserStatusMessage payload, Principal principal) {
    String username = principal != null ? principal.getName() : (payload != null ? payload.username() : null);
    if (username == null || username.isBlank()) {
      return;
    }
    String normalized = normalizeUsername(username);
    onlineUsers.add(normalized);
    lastSeenMap.remove(normalized);
    broadcastUserStatus(normalized, "online", null);
    syncOnlineUsersFor(normalized);
    syncReadReceiptsFor(normalized);
  }

  @MessageMapping("/user.offline")
  public void userOffline(UserStatusMessage payload, Principal principal) {
    String username = principal != null ? principal.getName() : (payload != null ? payload.username() : null);
    if (username == null || username.isBlank()) {
      return;
    }
    String normalized = normalizeUsername(username);
    onlineUsers.remove(normalized);
    long lastSeenAt = Instant.now().toEpochMilli();
    lastSeenMap.put(normalized, lastSeenAt);
    broadcastUserStatus(normalized, "offline", lastSeenAt);
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
    String normalized = normalizeUsername(username);
    if (!normalized.isBlank() && onlineUsers.remove(normalized)) {
      long lastSeenAt = Instant.now().toEpochMilli();
      lastSeenMap.put(normalized, lastSeenAt);
      broadcastUserStatus(normalized, "offline", lastSeenAt);
    }
  }

  private boolean isUserConnected(String normalizedUsername) {
    if (normalizedUsername == null || normalizedUsername.isBlank()) return false;
    SimpUser user = simpUserRegistry.getUser(normalizedUsername);
    boolean connected = user != null && !user.getSessions().isEmpty();
    if (!connected) {
      onlineUsers.remove(normalizedUsername);
    }
    return connected;
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

  private void syncReadReceiptsFor(String username) {
    for (ChatReadReceiptEntity receipt : chatReadReceiptRepository.findByPeerUsername(username)) {
      messagingTemplate.convertAndSendToUser(
          username,
          "/queue/read-receipts",
          new ReadReceiptPayload(
              receipt.getReaderUsername(),
              receipt.getPeerUsername(),
              receipt.getLastReadAt()));
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

  private String normalizeReaction(String reaction) {
    if (reaction == null) return null;
    String trimmed = reaction.trim();
    if (trimmed.isBlank()) return null;
    if (trimmed.length() > 16) return null;
    if (!REACTION_PATTERN.matcher(trimmed).matches()) return null;
    return trimmed;
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
      Long id,
      String fromUsername,
      String message,
      String type,
      String fileName,
      String mediaUrl,
      String mimeType,
      String reaction,
      ReplyPreview replyingTo,
      String replyText,
      String replySenderName,
      Long createdAt,
      Boolean edited,
      Long editedAt) {}

  public record ReplyPreview(String text, String senderName) {}

  public record UserStatusMessage(String username) {}

  public record UserStatusPayload(String username, String status, Long lastSeenAt) {}

  public record TypingMessage(String toUsername, String fromUsername, Boolean typing) {}

  public record TypingPayload(String fromUsername, boolean typing) {}

  public record SendAck(String tempId, boolean success, Long messageId, Long createdAt) {}

  public record EditMessage(Long messageId, String message, String fromUsername) {}

  public record MessageEditPayload(Long messageId, String fromUsername, String message, boolean edited, Long editedAt,
      Long createdAt) {}

  public record EditAck(Long messageId, boolean success, String reason) {}

  public record ReadReceiptMessage(String peerUsername, String readerUsername, Long readAt) {}

  public record ReadReceiptPayload(String readerUsername, String peerUsername, Long readAt) {}

  public record ReactionMessage(Long messageId, String reaction, String fromUsername) {}

  public record MessageReactionPayload(Long messageId, String reaction, String reactedBy, Long reactedAt) {}
}
