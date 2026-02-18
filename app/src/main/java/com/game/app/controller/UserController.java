package com.game.app.controller;

import com.game.app.dto.SecretKeyRequestDto;
import com.game.app.model.UserEntity;
import com.game.app.repository.UserRepository;
import jakarta.validation.Valid;
import java.util.Map;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.http.HttpStatus;

import java.util.List;

@RestController
@RequestMapping("/api/app/users")
public class UserController {

  private final UserRepository userRepository;
  private final Map<String, Long> tokenStore;

  public UserController(UserRepository userRepository, Map<String, Long> tokenStore) {
    this.userRepository = userRepository;
    this.tokenStore = tokenStore;
  }

  @GetMapping
  public ResponseEntity<List<UserEntity>> getAllUsers() {
    List<UserEntity> users = userRepository.findAll();
    return ResponseEntity.ok(users);
  }

  @GetMapping("/search")
  public ResponseEntity<List<UserEntity>> searchByUsername(@RequestParam String username) {
    List<UserEntity> users = userRepository.findByUsernameContainingIgnoreCase(username);
    return ResponseEntity.ok(users);
  }

  @GetMapping("/{id}")
  public ResponseEntity<UserEntity> getUserById(@PathVariable Long id) {
    return userRepository.findById(id)
        .map(ResponseEntity::ok)
        .orElse(ResponseEntity.notFound().build());
  }

  @GetMapping("/username/{username}")
  public ResponseEntity<UserEntity> getUserByUsername(@PathVariable String username) {
    return userRepository.findByUsername(username)
        .map(ResponseEntity::ok)
        .orElse(ResponseEntity.notFound().build());
  }

  @GetMapping("/{id}/secret-key-exists")
  public ResponseEntity<Map<String, Boolean>> hasSecretKey(
      @PathVariable Long id,
      @RequestHeader(value = "Authorization", required = false) String authHeader) {
    authorizeUser(id, authHeader);

    UserEntity user = userRepository.findById(id)
        .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "User not found"));
    boolean exists = user.getSecretKey() != null && !user.getSecretKey().isBlank();
    return ResponseEntity.ok(Map.of("exists", exists));
  }

  @PostMapping("/{id}/secret-key")
  public ResponseEntity<Map<String, String>> setSecretKey(
      @PathVariable Long id,
      @RequestHeader(value = "Authorization", required = false) String authHeader,
      @Valid @RequestBody SecretKeyRequestDto request) {
    authorizeUser(id, authHeader);

    UserEntity user = userRepository.findById(id)
        .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "User not found"));
    user.setSecretKey(request.secretKey().trim());
    userRepository.save(user);
    return ResponseEntity.ok(Map.of("message", "Secret key saved"));
  }

  @PostMapping("/{id}/verify-secret-key")
  public ResponseEntity<Map<String, Boolean>> verifySecretKey(
      @PathVariable Long id,
      @RequestHeader(value = "Authorization", required = false) String authHeader,
      @Valid @RequestBody SecretKeyRequestDto request) {
    authorizeUser(id, authHeader);

    UserEntity user = userRepository.findById(id)
        .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "User not found"));
    boolean verified = user.getSecretKey() != null && user.getSecretKey().equals(request.secretKey().trim());
    return ResponseEntity.ok(Map.of("verified", verified));
  }

  private void authorizeUser(Long requestedUserId, String authHeader) {
    String token = extractToken(authHeader);
    Long tokenUserId = tokenStore.get(token);
    if (tokenUserId == null) {
      throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Invalid or expired token");
    }
    if (!requestedUserId.equals(tokenUserId)) {
      throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Cannot access another user's data");
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
