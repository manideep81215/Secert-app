package com.game.app.controller;

import com.game.app.dto.SecretKeyRequestDto;
import com.game.app.model.UserEntity;
import com.game.app.repository.UserRepository;
import com.game.app.service.JwtTokenService;
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
  private final JwtTokenService jwtTokenService;

  public UserController(UserRepository userRepository, JwtTokenService jwtTokenService) {
    this.userRepository = userRepository;
    this.jwtTokenService = jwtTokenService;
  }

  @GetMapping
  public ResponseEntity<List<UserPublicDto>> getAllUsers(
      @RequestHeader(value = "Authorization", required = false) String authHeader) {
    requireAuthUser(authHeader);
    List<UserEntity> users = userRepository.findAll();
    return ResponseEntity.ok(users.stream().map(this::toPublicDto).toList());
  }

  @GetMapping("/search")
  public ResponseEntity<List<UserPublicDto>> searchByUsername(
      @RequestParam String username,
      @RequestHeader(value = "Authorization", required = false) String authHeader) {
    requireAuthUser(authHeader);
    List<UserEntity> users = userRepository.findByUsernameContainingIgnoreCase(username);
    return ResponseEntity.ok(users.stream().map(this::toPublicDto).toList());
  }

  @GetMapping("/{id}")
  public ResponseEntity<?> getUserById(
      @PathVariable Long id,
      @RequestHeader(value = "Authorization", required = false) String authHeader) {
    UserEntity me = requireAuthUser(authHeader);
    return userRepository.findById(id)
        .map((user) -> ResponseEntity.ok(id.equals(me.getId()) ? toPrivateDto(user) : toPublicDto(user)))
        .orElse(ResponseEntity.notFound().build());
  }

  @GetMapping("/username/{username}")
  public ResponseEntity<UserPublicDto> getUserByUsername(
      @PathVariable String username,
      @RequestHeader(value = "Authorization", required = false) String authHeader) {
    requireAuthUser(authHeader);
    return userRepository.findByUsername(username)
        .map((user) -> ResponseEntity.ok(toPublicDto(user)))
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
    UserEntity user = requireAuthUser(authHeader);
    if (!requestedUserId.equals(user.getId())) {
      throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Cannot access another user's data");
    }
  }

  private UserEntity requireAuthUser(String authHeader) {
    Long tokenUserId = jwtTokenService.extractAccessUserId(authHeader);
    return userRepository.findById(tokenUserId)
        .orElseThrow(() -> new ResponseStatusException(HttpStatus.UNAUTHORIZED, "User not found"));
  }

  private UserPublicDto toPublicDto(UserEntity user) {
    return new UserPublicDto(
        user.getId(),
        user.getUsername(),
        user.getName(),
        user.getRole());
  }

  private UserPrivateDto toPrivateDto(UserEntity user) {
    return new UserPrivateDto(
        user.getId(),
        user.getUsername(),
        user.getName(),
        user.getPhone(),
        user.getEmail(),
        user.getDob(),
        user.getRole());
  }

  public record UserPublicDto(Long id, String username, String name, String role) {}

  public record UserPrivateDto(
      Long id,
      String username,
      String name,
      String phone,
      String email,
      String dob,
      String role) {}
}
