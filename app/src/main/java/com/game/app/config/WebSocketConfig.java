package com.game.app.config;

import java.util.Arrays;
import java.util.List;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Configuration;
import org.springframework.messaging.simp.config.ChannelRegistration;
import org.springframework.messaging.simp.config.MessageBrokerRegistry;
import org.springframework.web.socket.config.annotation.EnableWebSocketMessageBroker;
import org.springframework.web.socket.config.annotation.StompEndpointRegistry;
import org.springframework.web.socket.config.annotation.WebSocketMessageBrokerConfigurer;
import org.springframework.web.socket.config.annotation.WebSocketTransportRegistration;

@Configuration
@EnableWebSocketMessageBroker
public class WebSocketConfig implements WebSocketMessageBrokerConfigurer {

  private final WebSocketChannelInterceptor webSocketChannelInterceptor;
  private final List<String> allowedOriginPatterns;
  private final int messageSizeLimitBytes;
  private final int sendBufferSizeLimitBytes;
  private final int sendTimeLimitMs;
  private final int inboundCorePoolSize;
  private final int inboundMaxPoolSize;
  private final int inboundQueueCapacity;
  private final int outboundCorePoolSize;
  private final int outboundMaxPoolSize;
  private final int outboundQueueCapacity;

  public WebSocketConfig(
      WebSocketChannelInterceptor webSocketChannelInterceptor,
      @Value("${app.cors.allowed-origin-patterns:https://*.vercel.app,http://localhost:*}") String allowedOriginPatterns,
      @Value("${app.websocket.message-size-limit-bytes:262144}") int messageSizeLimitBytes,
      @Value("${app.websocket.send-buffer-size-limit-bytes:262144}") int sendBufferSizeLimitBytes,
      @Value("${app.websocket.send-time-limit-ms:15000}") int sendTimeLimitMs,
      @Value("${app.websocket.inbound-core-pool-size:4}") int inboundCorePoolSize,
      @Value("${app.websocket.inbound-max-pool-size:12}") int inboundMaxPoolSize,
      @Value("${app.websocket.inbound-queue-capacity:500}") int inboundQueueCapacity,
      @Value("${app.websocket.outbound-core-pool-size:4}") int outboundCorePoolSize,
      @Value("${app.websocket.outbound-max-pool-size:12}") int outboundMaxPoolSize,
      @Value("${app.websocket.outbound-queue-capacity:500}") int outboundQueueCapacity) {
    this.webSocketChannelInterceptor = webSocketChannelInterceptor;
    this.allowedOriginPatterns = Arrays.stream(allowedOriginPatterns.split(","))
        .map(String::trim)
        .filter(value -> !value.isEmpty())
        .toList();
    this.messageSizeLimitBytes = Math.max(16 * 1024, messageSizeLimitBytes);
    this.sendBufferSizeLimitBytes = Math.max(16 * 1024, sendBufferSizeLimitBytes);
    this.sendTimeLimitMs = Math.max(5_000, sendTimeLimitMs);
    this.inboundCorePoolSize = Math.max(2, inboundCorePoolSize);
    this.inboundMaxPoolSize = Math.max(this.inboundCorePoolSize, inboundMaxPoolSize);
    this.inboundQueueCapacity = Math.max(100, inboundQueueCapacity);
    this.outboundCorePoolSize = Math.max(2, outboundCorePoolSize);
    this.outboundMaxPoolSize = Math.max(this.outboundCorePoolSize, outboundMaxPoolSize);
    this.outboundQueueCapacity = Math.max(100, outboundQueueCapacity);
  }

  @Override
  public void registerStompEndpoints(StompEndpointRegistry registry) {
    String[] origins = allowedOriginPatterns.toArray(String[]::new);

    registry.addEndpoint("/ws")
        .setAllowedOriginPatterns(origins)
        .withSockJS()
        .setSuppressCors(false);  // ✅ FIXED: Two p's in "Suppress"

    registry.addEndpoint("/ws-chat")
        .setAllowedOriginPatterns(origins)
        .withSockJS()
        .setSuppressCors(false);  // ✅ FIXED: Two p's in "Suppress"
  }

  @Override
  public void configureMessageBroker(MessageBrokerRegistry registry) {
    registry.enableSimpleBroker("/topic", "/queue");
    registry.setApplicationDestinationPrefixes("/app");
    registry.setUserDestinationPrefix("/user");
  }

  @Override
  public void configureClientInboundChannel(ChannelRegistration registration) {
    registration
        .interceptors(webSocketChannelInterceptor)
        .taskExecutor()
        .corePoolSize(inboundCorePoolSize)
        .maxPoolSize(inboundMaxPoolSize)
        .queueCapacity(inboundQueueCapacity);
  }

  @Override
  public void configureClientOutboundChannel(ChannelRegistration registration) {
    registration
        .taskExecutor()
        .corePoolSize(outboundCorePoolSize)
        .maxPoolSize(outboundMaxPoolSize)
        .queueCapacity(outboundQueueCapacity);
  }

  @Override
  public void configureWebSocketTransport(WebSocketTransportRegistration registration) {
    registration
        .setMessageSizeLimit(messageSizeLimitBytes)
        .setSendBufferSizeLimit(sendBufferSizeLimitBytes)
        .setSendTimeLimit(sendTimeLimitMs);
  }
}
