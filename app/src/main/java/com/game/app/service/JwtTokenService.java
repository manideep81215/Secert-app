package com.game.app.service;

import java.nio.charset.StandardCharsets;
import java.util.Date;

import javax.crypto.SecretKey;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

import com.game.app.model.UserEntity;

import io.jsonwebtoken.Claims;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;

@Service
public class JwtTokenService {

  private final SecretKey accessSigningKey;
  private final SecretKey refreshSigningKey;
  private final long accessExpirationMs;
  private final long refreshExpirationMs;

  public JwtTokenService(
      @Value("${app.auth.jwt-access-secret:change-this-access-jwt-secret-in-production-change-this}") String accessJwtSecret,
      @Value("${app.auth.jwt-refresh-secret:change-this-refresh-jwt-secret-in-production-change-this}") String refreshJwtSecret,
      @Value("${app.auth.jwt-access-expiration-ms:3600000}") long accessExpirationMs,
      @Value("${app.auth.jwt-refresh-expiration-ms:2592000000}") long refreshExpirationMs) {
    this.accessSigningKey = Keys.hmacShaKeyFor(accessJwtSecret.getBytes(StandardCharsets.UTF_8));
    this.refreshSigningKey = Keys.hmacShaKeyFor(refreshJwtSecret.getBytes(StandardCharsets.UTF_8));
    this.accessExpirationMs = accessExpirationMs;
    this.refreshExpirationMs = refreshExpirationMs;
  }

  public String issueAccessToken(UserEntity user) {
    long now = System.currentTimeMillis();
    return Jwts.builder()
        .subject(String.valueOf(user.getId()))
        .claim("username", user.getUsername())
        .claim("tokenType", "access")
        .issuedAt(new Date(now))
        .expiration(new Date(now + accessExpirationMs))
        .signWith(accessSigningKey)
        .compact();
  }

  public String issueRefreshToken(UserEntity user) {
    long now = System.currentTimeMillis();
    return Jwts.builder()
        .subject(String.valueOf(user.getId()))
        .claim("username", user.getUsername())
        .claim("tokenType", "refresh")
        .issuedAt(new Date(now))
        .expiration(new Date(now + refreshExpirationMs))
        .signWith(refreshSigningKey)
        .compact();
  }

  public Long extractAccessUserId(String rawToken) {
    Claims claims = parseClaims(rawToken, accessSigningKey);
    validateTokenType(claims, "access");
    return extractSubjectAsUserId(claims);
  }

  public Long extractRefreshUserId(String rawToken) {
    Claims claims = parseClaims(rawToken, refreshSigningKey);
    validateTokenType(claims, "refresh");
    return extractSubjectAsUserId(claims);
  }

  private Long extractSubjectAsUserId(Claims claims) {
    try {
      return Long.valueOf(claims.getSubject());
    } catch (NumberFormatException exception) {
      throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Invalid token subject");
    }
  }

  private void validateTokenType(Claims claims, String expectedType) {
    String tokenType = claims.get("tokenType", String.class);
    if (!expectedType.equals(tokenType)) {
      throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Invalid token type");
    }
  }

  private Claims parseClaims(String rawToken, SecretKey signingKey) {
    String token = extractToken(rawToken);
    try {
      return Jwts.parser()
          .verifyWith(signingKey)
          .build()
          .parseSignedClaims(token)
          .getPayload();
    } catch (Exception exception) {
      throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Invalid or expired token");
    }
  }

  private String extractToken(String rawToken) {
    if (rawToken == null || rawToken.isBlank()) {
      throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Authorization header is required");
    }
    if (rawToken.startsWith("Bearer ")) {
      return rawToken.substring(7).trim();
    }
    return rawToken.trim();
  }
}
