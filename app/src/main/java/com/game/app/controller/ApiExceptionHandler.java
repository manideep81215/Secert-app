package com.game.app.controller;

import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;

import org.hibernate.exception.JDBCConnectionException;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.transaction.CannotCreateTransactionException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

import jakarta.servlet.http.HttpServletRequest;

@RestControllerAdvice
public class ApiExceptionHandler {

    @ExceptionHandler({
        CannotCreateTransactionException.class,
        DataAccessResourceFailureException.class,
        JDBCConnectionException.class
    })
    public ResponseEntity<Map<String, Object>> handleDatabaseUnavailable(
        Exception exception,
        HttpServletRequest request
    ) {
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("timestamp", Instant.now().toString());
        payload.put("status", HttpStatus.SERVICE_UNAVAILABLE.value());
        payload.put("error", "database_unavailable");
        payload.put("message", "Database temporarily unavailable. Please retry shortly.");
        payload.put("path", request.getRequestURI());

        return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE).body(payload);
    }
}
