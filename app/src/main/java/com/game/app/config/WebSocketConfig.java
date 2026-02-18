package com.game.app.config;

import java.util.Arrays;
import java.util.List;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Configuration;
import org.springframework.messaging.simp.config.ChannelRegistration;
import org.springframework.messaging.simp.config.MessageBrokerRegistry;
import org.springframework.web.socket.config.annotation.EnableWebSocketMessageBroker;
import org.springframework.web.socket.config.annotation.StompEndpointRegistry;
import org.springframework.web.socket.config.annotation.WebSocketTransportRegistration;
import org.springframework.web.socket.config.annotation.WebSocketMessageBrokerConfigurer;

@Configuration
@EnableWebSocketMessageBroker
public class WebSocketConfig implements WebSocketMessageBrokerConfigurer {

  private final WebSocketChannelInterceptor webSocketChannelInterceptor;
  private final List<String> allowedOriginPatterns;

  public WebSocketConfig(
      WebSocketChannelInterceptor webSocketChannelInterceptor,
      @Value("${app.cors.allowed-origin-patterns:https://*.vercel.app,http://localhost:*}") String allowedOriginPatterns) {
    this.webSocketChannelInterceptor = webSocketChannelInterceptor;
    this.allowedOriginPatterns = Arrays.stream(allowedOriginPatterns.split(","))
        .map(String::trim)
        .filter(value -> !value.isEmpty())
        .toList();
  }

  @Override
  public void registerStompEndpoints(StompEndpointRegistry registry) {
    String[] origins = allowedOriginPatterns.toArray(String[]::new);

    registry.addEndpoint("/ws")
        .setAllowedOriginPatterns(origins)
        .withSockJS()
        .setSupressCors(false);  // ✅ ADDED: Don't suppress CORS

    registry.addEndpoint("/ws-chat")
        .setAllowedOriginPatterns(origins)
        .withSockJS()
        .setSupressCors(false);  // ✅ ADDED: Don't suppress CORS
  }

  @Override
  public void configureMessageBroker(MessageBrokerRegistry registry) {
    registry.enableSimpleBroker("/topic", "/queue");
    registry.setApplicationDestinationPrefixes("/app");
    registry.setUserDestinationPrefix("/user");
  }

  @Override
  public void configureClientInboundChannel(ChannelRegistration registration) {
    registration.interceptors(webSocketChannelInterceptor);
  }

  @Override
  public void configureWebSocketTransport(WebSocketTransportRegistration registration) {
    registration
        .setMessageSizeLimit(15 * 1024 * 1024)
        .setSendBufferSizeLimit(15 * 1024 * 1024)
        .setSendTimeLimit(30_000);
  }
}