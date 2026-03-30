package com.game.app.config;

import java.security.Principal;
import java.util.List;

import org.springframework.lang.NonNull;
import org.springframework.http.HttpStatus;
import org.springframework.messaging.Message;
import org.springframework.messaging.MessageChannel;
import org.springframework.messaging.simp.stomp.StompCommand;
import org.springframework.messaging.simp.stomp.StompHeaderAccessor;
import org.springframework.messaging.support.ChannelInterceptor;
import org.springframework.messaging.support.MessageHeaderAccessor;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ResponseStatusException;

import com.game.app.service.JwtTokenService;

@Component
public class WebSocketChannelInterceptor implements ChannelInterceptor {
  private final JwtTokenService jwtTokenService;

  public WebSocketChannelInterceptor(JwtTokenService jwtTokenService) {
    this.jwtTokenService = jwtTokenService;
  }

  @Override
  public Message<?> preSend(@NonNull Message<?> message, @NonNull MessageChannel channel) {
    StompHeaderAccessor accessor = MessageHeaderAccessor.getAccessor(message, StompHeaderAccessor.class);
    if (accessor == null || accessor.getCommand() != StompCommand.CONNECT) {
      return message;
    }

    List<String> authHeaders = accessor.getNativeHeader("Authorization");
    String authHeader = (authHeaders != null && !authHeaders.isEmpty()) ? authHeaders.get(0) : null;
    if (authHeader == null || authHeader.isBlank()) {
      throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Authorization header is required");
    }

    String username = jwtTokenService.extractAccessUsername(authHeader);
    Principal user = new StompPrincipal(username);
    accessor.setUser(user);

    return message;
  }
}
