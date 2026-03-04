package com.game.app.controller;

import java.util.List;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;

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
import org.springframework.web.bind.annotation.RequestPart;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.servlet.support.ServletUriComponentsBuilder;

import com.game.app.model.ChatMessageEntity;
import com.game.app.model.ChatMediaEntity;
import com.game.app.model.UserEntity;
import com.game.app.repository.ChatMessageRepository;
import com.game.app.repository.ChatMediaRepository;
import com.game.app.repository.UserRepository;
import com.game.app.service.JwtTokenService;

@RestController
@RequestMapping("/api/app/messages")
public class ChatMessageController {

  private final ChatMessageRepository chatMessageRepository;
  private final ChatMediaRepository chatMediaRepository;
  private final UserRepository userRepository;
  private final JwtTokenService jwtTokenService;

  public ChatMessageController(ChatMessageRepository chatMessageRepository, ChatMediaRepository chatMediaRepository,
      UserRepository userRepository,
      JwtTokenService jwtTokenService) {
    this.chatMessageRepository = chatMessageRepository;
    this.chatMediaRepository = chatMediaRepository;
    this.userRepository = userRepository;
    this.jwtTokenService = jwtTokenService;
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
          .queryParam("v", System.currentTimeMillis())
          .buildAndExpand(media.getId())
          .toUriString();
      return new MediaUploadResponse(mediaUrl, media.getFileName(), media.getMimeType());
    } catch (Exception exception) {
      throw new ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR, "Unable to store media");
    }
  }

  @GetMapping("/media/{id}")
  public ResponseEntity<byte[]> getMedia(@PathVariable Long id) {
    ChatMediaEntity media = chatMediaRepository.findById(id)
        .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Media not found"));
    String mimeType = media.getMimeType() != null && !media.getMimeType().isBlank()
        ? media.getMimeType()
        : MediaType.APPLICATION_OCTET_STREAM_VALUE;
    MediaType contentType = MediaType.parseMediaType(mimeType);
    boolean inline = mimeType.startsWith("image/") || mimeType.startsWith("video/") || mimeType.startsWith("audio/");

    ResponseEntity.BodyBuilder response = ResponseEntity.ok()
        .contentType(contentType)
        .header(HttpHeaders.CACHE_CONTROL, "no-store, no-cache, must-revalidate, max-age=0")
        .header(HttpHeaders.PRAGMA, "no-cache")
        .header(HttpHeaders.EXPIRES, "0");

    if (!inline) {
      String fileName = media.getFileName() != null && !media.getFileName().isBlank()
          ? media.getFileName()
          : "attachment";
      response.header(
          HttpHeaders.CONTENT_DISPOSITION,
          ContentDisposition.attachment().filename(fileName, StandardCharsets.UTF_8).build().toString());
    }

    return response.body(media.getData());
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
        row.getReplySenderName());
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

  private String normalizeMimeType(String contentType, String originalFilename) {
    String rawType = contentType != null ? contentType.trim().toLowerCase() : "";
    if (rawType.startsWith("video/") || rawType.startsWith("image/") || rawType.startsWith("audio/")) {
      return rawType;
    }

    String name = originalFilename != null ? originalFilename.trim().toLowerCase() : "";
    if (name.matches(".*\\.(apk)$")) {
      return "application/vnd.android.package-archive";
    }
    if (name.matches(".*\\.(mp4|mov|m4v|webm|mkv|avi|3gp)$")) {
      return "video/mp4";
    }
    if (name.matches(".*\\.(jpg|jpeg|png|gif|webp|heic|heif|bmp|svg)$")) {
      return "image/jpeg";
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
      String replySenderName) {
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

  public record MediaUploadResponse(String mediaUrl, String fileName, String mimeType) {
  }
}
