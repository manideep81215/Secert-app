package com.game.app.config;

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

  public WebSocketConfig(WebSocketChannelInterceptor webSocketChannelInterceptor) {
    this.webSocketChannelInterceptor = webSocketChannelInterceptor;
  }

  @Override
  public void registerStompEndpoints(StompEndpointRegistry registry) {
    registry.addEndpoint("/ws-chat")
        .setAllowedOriginPatterns("http://localhost:5173", "http://localhost:5174")
        .withSockJS()
        .setStreamBytesLimit(2 * 1024 * 1024)
        .setHttpMessageCacheSize(1000)
        .setDisconnectDelay(30_000);
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
