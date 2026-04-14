package com.game.app.config;

import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

/**
 * DISABLED: CORS is handled by SecurityConfig instead.
 * This class is kept for reference only and should not be used.
 * SecurityConfig provides dynamic, environment-based CORS configuration.
 */
// @Configuration - DISABLED TO PREVENT CORS CONFLICTS
public class CorsConfig implements WebMvcConfigurer {
    // Implementation removed - use SecurityConfig instead
}
