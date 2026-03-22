package com.game.app.controller;

import java.util.List;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;
import java.time.Instant;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestPart;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.servlet.support.ServletUriComponentsBuilder;
import org.springframework.messaging.simp.SimpMessagingTemplate;

import com.game.app.model.ChatMessageEntity;
import com.game.app.model.ChatMediaEntity;
import com.game.app.model.MobilePushTokenEntity;
import com.game.app.model.UserEntity;
import com.game.app.repository.ChatMessageRepository;
import com.game.app.repository.ChatMediaRepository;
import com.game.app.repository.MobilePushTokenRepository;
import com.game.app.repository.UserRepository;
import com.game.app.service.ChatAnalyticsService;
import com.game.app.service.ChatCheckEventService;
import com.game.app.service.JwtTokenService;
import com.game.app.service.PushNotificationService;
import com.game.app.websocket.ChatWebSocketController;

@RestController
@RequestMapping("/api/app/messages")
public class ChatMessageController {

  private final ChatMessageRepository chatMessageRepository;
  private final ChatMediaRepository chatMediaRepository;
  private final UserRepository userRepository;
  private final JwtTokenService jwtTokenService;
  private final MobilePushTokenRepository mobilePushTokenRepository;
  private final PushNotificationService pushNotificationService;
  private final ChatAnalyticsService chatAnalyticsService;
  private final ChatCheckEventService chatCheckEventService;
  private final SimpMessagingTemplate messagingTemplate;

  public ChatMessageController(ChatMessageRepository chatMessageRepository, ChatMediaRepository chatMediaRepository,
      UserRepository userRepository,
      JwtTokenService jwtTokenService,
      MobilePushTokenRepository mobilePushTokenRepository,
      PushNotificationService pushNotificationService,
      ChatAnalyticsService chatAnalyticsService,
      ChatCheckEventService chatCheckEventService,
      SimpMessagingTemplate messagingTemplate) {
    this.chatMessageRepository = chatMessageRepository;
    this.chatMediaRepository = chatMediaRepository;
    this.userRepository = userRepository;
    this.jwtTokenService = jwtTokenService;
    this.mobilePushTokenRepository = mobilePushTokenRepository;
    this.pushNotificationService = pushNotificationService;
    this.chatAnalyticsService = chatAnalyticsService;
    this.chatCheckEventService = chatCheckEventService;
    this.messagingTemplate = messagingTemplate;
  }

  @GetMapping("/conversation")
  public ConversationPageDto getConversation(
      @RequestHeader(value = "Authorization", required = false) String authHeader,
      @RequestParam("with") String withUsername,
      @RequestParam(value = "page", required = false) Integer page,
      @RequestParam(value = "size", required = false) Integer size) {
    UserEntity me = requireAuthUser(authHeader);
    String meUsername = normalizeUsername(me.getUsername());
    String otherUsername = normalizeUsername(withUsername);

    if (otherUsername.isBlank()) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Conversation username is required");
    }

    if (page == null && size == null) {
      List<ConversationMessageDto> allMessages = chatMessageRepository.findConversation(meUsername, otherUsername).stream()
          .map((row) -> toDto(row, meUsername))
          .toList();
      return new ConversationPageDto(
          allMessages,
          0,
          allMessages.size(),
          false,
          allMessages.size());
    }

    int safePage = Math.max(0, page == null ? 0 : page);
    int safeSize = Math.min(200, Math.max(1, size == null ? 50 : size));

    Page<ChatMessageEntity> conversationPage = chatMessageRepository.findConversationPage(
        meUsername,
        otherUsername,
        PageRequest.of(safePage, safeSize));

    List<ChatMessageEntity> content = new ArrayList<>(conversationPage.getContent());
    Collections.reverse(content);
    List<ConversationMessageDto> messages = content.stream()
        .map((row) -> toDto(row, meUsername))
        .toList();

    return new ConversationPageDto(
        messages,
        safePage,
        safeSize,
        conversationPage.hasNext(),
        conversationPage.getTotalElements());
  }

  @GetMapping("/conversation-summaries")
  public List<ConversationSummaryDto> getConversationSummaries(
      @RequestHeader(value = "Authorization", required = false) String authHeader) {
    UserEntity me = requireAuthUser(authHeader);
    String meUsername = normalizeUsername(me.getUsername());

    List<ChatMessageEntity> latestMessages = chatMessageRepository.findLatestMessagesByPeer(meUsername);
    Map<String, ConversationSummaryDto> byPeer = new LinkedHashMap<>();
    for (ChatMessageEntity row : latestMessages) {
      String peerUsername = meUsername.equalsIgnoreCase(row.getFromUsername())
          ? normalizeUsername(row.getToUsername())
          : normalizeUsername(row.getFromUsername());
      if (peerUsername.isBlank() || byPeer.containsKey(peerUsername)) continue;
      byPeer.put(peerUsername, new ConversationSummaryDto(
          peerUsername,
          row.getMessage(),
          row.getType(),
          row.getFileName(),
          row.getCreatedAt() != null ? row.getCreatedAt().toEpochMilli() : null));
    }

    return new ArrayList<>(byPeer.values());
  }

  @PostMapping(value = "/media", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
  public MediaUploadResponse uploadMedia(
      @RequestHeader(value = "Authorization", required = false) String authHeader,
      @RequestPart("file") MultipartFile file) {
    requireAuthUser(authHeader);
    if (file == null || file.isEmpty()) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "File is required");
    }
    String mimeType = normalizeMimeType(file.getContentType(), file.getOriginalFilename());
    long maxBytes = 200L * 1024L * 1024L;
    if (file.getSize() > maxBytes) {
      throw new ResponseStatusException(
          HttpStatus.PAYLOAD_TOO_LARGE,
          "Media exceeds 200MB limit");
    }

    try {
      ChatMediaEntity media = new ChatMediaEntity();
      media.setFileName(file.getOriginalFilename() != null ? file.getOriginalFilename() : "media");
      media.setMimeType(mimeType);
      media.setData(file.getBytes());
      media = chatMediaRepository.save(media);

      String mediaUrl = ServletUriComponentsBuilder.fromCurrentContextPath()
          .path("/api/app/messages/media/{id}")
          .buildAndExpand(media.getId())
          .toUriString();
      return new MediaUploadResponse(mediaUrl, media.getFileName(), media.getMimeType());
    } catch (Exception exception) {
      throw new ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR, "Unable to store media");
    }
  }

  @GetMapping("/media/{id}")
  public ResponseEntity<byte[]> getMedia(
      @PathVariable Long id,
      @RequestHeader(value = HttpHeaders.IF_NONE_MATCH, required = false) String ifNoneMatch) {
    ChatMediaEntity media = chatMediaRepository.findById(id)
        .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Media not found"));
    String mimeType = media.getMimeType() != null && !media.getMimeType().isBlank()
        ? media.getMimeType()
        : MediaType.APPLICATION_OCTET_STREAM_VALUE;
    MediaType contentType = MediaType.parseMediaType(mimeType);
    boolean inline = mimeType.startsWith("image/") || mimeType.startsWith("video/") || mimeType.startsWith("audio/");
    byte[] data = media.getData() != null ? media.getData() : new byte[0];
    String etag = "\"chat-media-" + id + "-" + data.length + "\"";
    String cacheControl = "private, max-age=2592000, immutable";

    if (ifNoneMatch != null && ifNoneMatch.contains(etag)) {
      return ResponseEntity.status(HttpStatus.NOT_MODIFIED)
          .header(HttpHeaders.CACHE_CONTROL, cacheControl)
          .header(HttpHeaders.ETAG, etag)
          .build();
    }

    ResponseEntity.BodyBuilder response = ResponseEntity.ok()
        .contentType(contentType)
        .header(HttpHeaders.CACHE_CONTROL, cacheControl)
        .header(HttpHeaders.ETAG, etag);

    if (!inline) {
      String fileName = media.getFileName() != null && !media.getFileName().isBlank()
          ? media.getFileName()
          : "attachment";
      response.header(
          HttpHeaders.CONTENT_DISPOSITION,
          ContentDisposition.attachment().filename(fileName, StandardCharsets.UTF_8).build().toString());
    }

    return response.body(data);
  }

  @PostMapping("/notification-reply")
  public NotificationReplyResponse replyFromNotification(@RequestBody NotificationReplyRequest request) {
    String mobilePushToken = request != null ? normalizePushToken(request.mobilePushToken()) : "";
    String toUsername = request != null ? normalizeUsername(request.toUsername()) : "";
    String text = request != null && request.message() != null ? request.message().trim() : "";

    if (mobilePushToken.isBlank() || toUsername.isBlank() || text.isBlank()) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Notification reply requires token, recipient, and message");
    }
    if (text.length() > 4000) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Reply is too long");
    }

    MobilePushTokenEntity pushToken = mobilePushTokenRepository.findByToken(mobilePushToken)
        .orElseThrow(() -> new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Unknown mobile push token"));

    String fromUsername = normalizeUsername(pushToken.getUsername());
    if (fromUsername.isBlank()) {
      throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Push token is not linked to a user");
    }
    if (fromUsername.equalsIgnoreCase(toUsername)) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Cannot send notification reply to yourself");
    }

    requireChatUser(fromUsername);
    requireChatUser(toUsername);

    ChatMessageEntity entity = new ChatMessageEntity();
    entity.setFromUsername(fromUsername);
    entity.setToUsername(toUsername);
    entity.setMessage(text);
    entity.setType("text");
    entity = chatMessageRepository.save(entity);

    Instant createdAt = entity.getCreatedAt() != null ? entity.getCreatedAt() : Instant.now();
    chatCheckEventService.trackOutgoingMessage(fromUsername, toUsername, null);
    try {
      chatAnalyticsService.recordMessage(fromUsername, toUsername, entity.getType(), createdAt);
    } catch (Exception ignored) {
      // Keep notification reply delivery non-blocking if analytics write fails.
    }

    messagingTemplate.convertAndSendToUser(
        toUsername,
        "/queue/messages",
        new ChatWebSocketController.IncomingMessage(
            entity.getId(),
            fromUsername,
            entity.getMessage(),
            entity.getType(),
            entity.getFileName(),
            entity.getMediaUrl(),
            entity.getMimeType(),
            entity.getReaction(),
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            createdAt.toEpochMilli(),
            entity.isEdited(),
            entity.getEditedAt() != null ? entity.getEditedAt().toEpochMilli() : null));

    pushNotificationService.notifyUser(
        toUsername,
        "@" + fromUsername,
        text,
        "/#/chat?with=" + fromUsername);

    return new NotificationReplyResponse(true, entity.getId(), createdAt.toEpochMilli());
  }

  private ConversationMessageDto toDto(ChatMessageEntity row, String meUsername) {
    boolean isSender = meUsername.equalsIgnoreCase(row.getFromUsername());
    return new ConversationMessageDto(
        row.getId(),
        isSender ? "user" : "other",
        row.getFromUsername(),
        row.getMessage(),
        row.getType(),
        row.getFileName(),
        row.getMediaUrl(),
        row.getMimeType(),
        row.getReaction(),
        row.getCreatedAt() != null ? row.getCreatedAt().toEpochMilli() : null,
        row.isEdited(),
        row.getEditedAt() != null ? row.getEditedAt().toEpochMilli() : null,
        row.getReplyText(),
        row.getReplySenderName(),
        row.getReplyMessageId(),
        row.getReplyType(),
        row.getReplyMediaUrl(),
        row.getReplyMimeType(),
        row.getReplyFileName());
  }

  private UserEntity requireAuthUser(String authHeader) {
    Long tokenUserId = jwtTokenService.extractAccessUserId(authHeader);
    UserEntity user = userRepository.findById(tokenUserId)
        .orElseThrow(() -> new ResponseStatusException(HttpStatus.UNAUTHORIZED, "User not found"));
    if (!"chat".equalsIgnoreCase(user.getRole())) {
      throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Chat access is allowed only for chat role users");
    }
    return user;
  }

  private String normalizeUsername(String username) {
    return username == null ? "" : username.trim().toLowerCase();
  }

  private String normalizePushToken(String token) {
    return token == null ? "" : token.trim();
  }

  private UserEntity requireChatUser(String username) {
    String normalized = normalizeUsername(username);
    UserEntity user = userRepository.findByUsername(normalized)
        .orElseThrow(() -> new ResponseStatusException(HttpStatus.UNAUTHORIZED, "User not found"));
    if (!"chat".equalsIgnoreCase(user.getRole())) {
      throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Chat access is allowed only for chat role users");
    }
    return user;
  }

  private String normalizeMimeType(String contentType, String originalFilename) {
    String rawType = contentType != null ? contentType.trim().toLowerCase() : "";
    if (rawType.startsWith("video/x-quicktime")) {
      return "video/quicktime";
    }
    if (rawType.startsWith("video/") || rawType.startsWith("image/") || rawType.startsWith("audio/")) {
      return rawType;
    }

    String name = originalFilename != null ? originalFilename.trim().toLowerCase() : "";
    if (name.matches(".*\\.(apk)$")) {
      return "application/vnd.android.package-archive";
    }
    if (name.matches(".*\\.(mp4|m4v)$")) {
      return "video/mp4";
    }
    if (name.matches(".*\\.(mov|qt)$")) {
      return "video/quicktime";
    }
    if (name.matches(".*\\.(3g2)$")) {
      return "video/3gpp2";
    }
    if (name.matches(".*\\.(webm)$")) {
      return "video/webm";
    }
    if (name.matches(".*\\.(mkv)$")) {
      return "video/x-matroska";
    }
    if (name.matches(".*\\.(avi)$")) {
      return "video/x-msvideo";
    }
    if (name.matches(".*\\.(3gp)$")) {
      return "video/3gpp";
    }
    if (name.matches(".*\\.(heic|heics)$")) {
      return "image/heic";
    }
    if (name.matches(".*\\.(heif|heifs|hif)$")) {
      return "image/heif";
    }
    if (name.matches(".*\\.(jpg|jpeg)$")) {
      return "image/jpeg";
    }
    if (name.matches(".*\\.(png)$")) {
      return "image/png";
    }
    if (name.matches(".*\\.(gif)$")) {
      return "image/gif";
    }
    if (name.matches(".*\\.(webp)$")) {
      return "image/webp";
    }
    if (name.matches(".*\\.(bmp)$")) {
      return "image/bmp";
    }
    if (name.matches(".*\\.(svg)$")) {
      return "image/svg+xml";
    }
    if (!rawType.isBlank()) {
      return rawType;
    }

    return MediaType.APPLICATION_OCTET_STREAM_VALUE;
  }

  public record ConversationMessageDto(
      Long id,
      String sender,
      String senderName,
      String text,
      String type,
      String fileName,
      String mediaUrl,
      String mimeType,
      String reaction,
      Long createdAt,
      Boolean edited,
      Long editedAt,
      String replyText,
      String replySenderName,
      Long replyMessageId,
      String replyType,
      String replyMediaUrl,
      String replyMimeType,
      String replyFileName) {
  }

  public record ConversationPageDto(
      List<ConversationMessageDto> messages,
      int page,
      int size,
      boolean hasMore,
      long totalElements) {
  }

  public record ConversationSummaryDto(
      String peerUsername,
      String text,
      String type,
      String fileName,
      Long createdAt) {
  }

  public record NotificationReplyRequest(
      String mobilePushToken,
      String toUsername,
      String message) {
  }

  public record NotificationReplyResponse(
      boolean success,
      Long messageId,
      Long createdAt) {
  }

  public record MediaUploadResponse(String mediaUrl, String fileName, String mimeType) {
  }
}
