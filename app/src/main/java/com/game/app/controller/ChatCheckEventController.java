package com.game.app.controller;

import java.time.Instant;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

import com.game.app.model.UserEntity;
import com.game.app.repository.UserRepository;
import com.game.app.service.ChatCheckEventService;
import com.game.app.service.JwtTokenService;

@RestController
@RequestMapping("/api/app/chat")
public class ChatCheckEventController {
  private final ChatCheckEventService chatCheckEventService;
  private final JwtTokenService jwtTokenService;
  private final UserRepository userRepository;

  public ChatCheckEventController(
      ChatCheckEventService chatCheckEventService,
      JwtTokenService jwtTokenService,
      UserRepository userRepository) {
    this.chatCheckEventService = chatCheckEventService;
    this.jwtTokenService = jwtTokenService;
    this.userRepository = userRepository;
  }

  @PostMapping("/check-open")
  public ResponseEntity<CheckOpenResponse> checkOpen(
      @RequestHeader(value = "Authorization", required = false) String authHeader,
      @RequestBody CheckOpenRequest request) {
    UserEntity me = requireAuthUser(authHeader);
    String opener = normalizeUsername(request.openerUsername());
    String conversationWith = normalizeUsername(request.conversationWithUsername());
    if (conversationWith.isBlank()) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Conversation username is required");
    }
    if (!normalizeUsername(me.getUsername()).equals(opener)) {
      throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Cannot report another user's chat open");
    }
    boolean counted = chatCheckEventService.recordQualifiedOpen(conversationWith, opener, Instant.now());
    return ResponseEntity.ok(new CheckOpenResponse(counted));
  }

  @PostMapping("/check-open/consume")
  public ResponseEntity<Void> consume(
      @RequestHeader(value = "Authorization", required = false) String authHeader,
      @RequestBody ConsumeCheckRequest request) {
    UserEntity me = requireAuthUser(authHeader);
    String sender = normalizeUsername(request.senderUsername());
    String checker = normalizeUsername(request.checkerUsername());
    if (!normalizeUsername(me.getUsername()).equals(sender)) {
      throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Cannot consume another user's notice");
    }
    if (checker.isBlank()) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Checker username is required");
    }
    chatCheckEventService.consume(sender, checker);
    return ResponseEntity.ok().build();
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

  public record CheckOpenRequest(String openerUsername, String conversationWithUsername) {}

  public record CheckOpenResponse(boolean counted) {}

  public record ConsumeCheckRequest(String senderUsername, String checkerUsername) {}
}
