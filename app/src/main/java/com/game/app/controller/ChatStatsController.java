package com.game.app.controller;

import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

import com.game.app.model.UserEntity;
import com.game.app.repository.UserRepository;
import com.game.app.service.ChatStatsService;
import com.game.app.service.ChatStatsService.ChatStatsDto;
import com.game.app.service.JwtTokenService;

@RestController
@RequestMapping({ "/api/chat", "/api/app/chat" })
public class ChatStatsController {

  private final ChatStatsService chatStatsService;
  private final UserRepository userRepository;
  private final JwtTokenService jwtTokenService;

  public ChatStatsController(
      ChatStatsService chatStatsService,
      UserRepository userRepository,
      JwtTokenService jwtTokenService) {
    this.chatStatsService = chatStatsService;
    this.userRepository = userRepository;
    this.jwtTokenService = jwtTokenService;
  }

  @GetMapping("/stats")
  public ChatStatsDto getChatStats(
      @RequestHeader(value = "Authorization", required = false) String authHeader,
      @RequestParam("peerUsername") String peerUsername) {
    UserEntity me = requireAuthUser(authHeader);
    String myUsername = normalizeUsername(me.getUsername());
    String peer = normalizeUsername(peerUsername);

    if (peer.isBlank()) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "peerUsername is required");
    }

    UserEntity peerUser = userRepository.findByUsername(peer)
        .orElseThrow(() -> new ResponseStatusException(HttpStatus.FORBIDDEN, "Forbidden"));
    if (!"chat".equalsIgnoreCase(peerUser.getRole())) {
      throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Forbidden");
    }

    return chatStatsService.getStats(myUsername, peer);
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
}
