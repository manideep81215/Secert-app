package com.game.app.controller;

import java.sql.Connection;
import java.sql.SQLException;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;

import javax.sql.DataSource;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class HealthController {

    private final DataSource dataSource;

    public HealthController(DataSource dataSource) {
        this.dataSource = dataSource;
    }

    @GetMapping("/")
    public Map<String, Object> root() {
        return Map.of(
            "status", "ok",
            "service", "secert-app");
    }

    @GetMapping("/health")
    public ResponseEntity<Map<String, Object>> health() {
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("service", "secert-app");
        payload.put("timestamp", Instant.now().toString());

        try (Connection connection = dataSource.getConnection()) {
            if (!connection.isValid(2)) {
                payload.put("status", "degraded");
                payload.put("database", "down");
                payload.put("error", "Database connection validation failed");
                return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE).body(payload);
            }

            payload.put("status", "ok");
            payload.put("database", "up");
            return ResponseEntity.ok(payload);
        } catch (SQLException ex) {
            payload.put("status", "degraded");
            payload.put("database", "down");
            payload.put("error", summarizeSqlException(ex));
            return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE).body(payload);
        }
    }

    private String summarizeSqlException(SQLException ex) {
        String message = ex.getMessage();
        if (message == null || message.isBlank()) {
            return ex.getClass().getSimpleName();
        }
        return message;
    }
}
