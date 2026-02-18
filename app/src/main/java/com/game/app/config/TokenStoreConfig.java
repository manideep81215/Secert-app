package com.game.app.config;

import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class TokenStoreConfig {

    @Bean
    public Map<String, Long> tokenStore() {
        return new ConcurrentHashMap<>();
    }
}
