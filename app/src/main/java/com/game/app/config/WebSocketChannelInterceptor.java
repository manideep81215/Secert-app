package com.game.app.config;

import java.security.Principal;
import java.util.List;

import org.springframework.lang.NonNull;
import org.springframework.messaging.Message;
import org.springframework.messaging.MessageChannel;
import org.springframework.messaging.simp.stomp.StompCommand;
import org.springframework.messaging.simp.stomp.StompHeaderAccessor;
import org.springframework.messaging.support.ChannelInterceptor;
import org.springframework.messaging.support.MessageHeaderAccessor;
import org.springframework.stereotype.Component;

@Component
public class WebSocketChannelInterceptor implements ChannelInterceptor {

  @Override
  public Message<?> preSend(@NonNull Message<?> message, @NonNull MessageChannel channel) {
    StompHeaderAccessor accessor = MessageHeaderAccessor.getAccessor(message, StompHeaderAccessor.class);
    if (accessor == null || accessor.getCommand() != StompCommand.CONNECT) {
      return message;
    }

    List<String> usernames = accessor.getNativeHeader("username");
    String username = (usernames != null && !usernames.isEmpty()) ? usernames.get(0) : null;
    if (username != null && !username.isBlank()) {
      Principal user = new StompPrincipal(username);
      accessor.setUser(user);
    }

    return message;
  }
}
