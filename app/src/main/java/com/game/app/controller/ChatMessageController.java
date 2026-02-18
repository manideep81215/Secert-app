package com.game.app.controller;

import java.util.List;
import java.util.Map;

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

@RestController
@RequestMapping("/api/app/messages")
public class ChatMessageController {

  private final ChatMessageRepository chatMessageRepository;
  private final ChatMediaRepository chatMediaRepository;
  private final UserRepository userRepository;
  private final Map<String, Long> tokenStore;

  public ChatMessageController(ChatMessageRepository chatMessageRepository, ChatMediaRepository chatMediaRepository,
      UserRepository userRepository,
      Map<String, Long> tokenStore) {
    this.chatMessageRepository = chatMessageRepository;
    this.chatMediaRepository = chatMediaRepository;
    this.userRepository = userRepository;
    this.tokenStore = tokenStore;
  }

  @GetMapping("/conversation")
  public List<ConversationMessageDto> getConversation(
      @RequestHeader(value = "Authorization", required = false) String authHeader,
      @RequestParam("with") String withUsername) {
    UserEntity me = requireAuthUser(authHeader);
    String meUsername = normalizeUsername(me.getUsername());
    String otherUsername = normalizeUsername(withUsername);

    if (otherUsername.isBlank()) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Conversation username is required");
    }

    return chatMessageRepository.findConversation(meUsername, otherUsername).stream()
        .map((row) -> toDto(row, meUsername))
        .toList();
  }

  @PostMapping(value = "/media", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
  public MediaUploadResponse uploadMedia(
      @RequestHeader(value = "Authorization", required = false) String authHeader,
      @RequestPart("file") MultipartFile file) {
    requireAuthUser(authHeader);
    if (file == null || file.isEmpty()) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "File is required");
    }
    String mimeType = file.getContentType() != null ? file.getContentType() : MediaType.APPLICATION_OCTET_STREAM_VALUE;
    boolean isVideo = mimeType.startsWith("video/");
    long maxBytes = isVideo ? 20L * 1024L * 1024L : 8L * 1024L * 1024L;
    if (file.getSize() > maxBytes) {
      throw new ResponseStatusException(
          HttpStatus.PAYLOAD_TOO_LARGE,
          isVideo ? "Video exceeds 20MB limit" : "Photo/file exceeds 8MB limit");
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
  public ResponseEntity<byte[]> getMedia(@PathVariable Long id) {
    ChatMediaEntity media = chatMediaRepository.findById(id)
        .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Media not found"));
    return ResponseEntity.ok()
        .contentType(MediaType.parseMediaType(media.getMimeType()))
        .header(HttpHeaders.CACHE_CONTROL, "public, max-age=31536000")
        .body(media.getData());
  }

  private ConversationMessageDto toDto(ChatMessageEntity row, String meUsername) {
    boolean isSender = meUsername.equalsIgnoreCase(row.getFromUsername());
    return new ConversationMessageDto(
        isSender ? "user" : "other",
        row.getFromUsername(),
        row.getMessage(),
        row.getType(),
        row.getFileName(),
        row.getMediaUrl(),
        row.getMimeType(),
        row.getCreatedAt() != null ? row.getCreatedAt().toEpochMilli() : null,
        row.getReplyText(),
        row.getReplySenderName());
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

  private String normalizeUsername(String username) {
    return username == null ? "" : username.trim().toLowerCase();
  }

  public record ConversationMessageDto(
      String sender,
      String senderName,
      String text,
      String type,
      String fileName,
      String mediaUrl,
      String mimeType,
      Long createdAt,
      String replyText,
      String replySenderName) {
  }

  public record MediaUploadResponse(String mediaUrl, String fileName, String mimeType) {
  }
}
