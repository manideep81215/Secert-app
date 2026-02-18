package com.game.app.service;

import com.game.app.dto.AuthRequestDto;
import com.game.app.dto.AuthResponseDto;
import com.game.app.model.UserEntity;
import com.game.app.repository.UserRepository;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

@Service
public class AuthService {

    private final UserRepository userRepository;
    private final PasswordEncoder passwordEncoder;
    private final Map<String, Long> tokenStore;

    public AuthService(UserRepository userRepository, PasswordEncoder passwordEncoder, Map<String, Long> tokenStore) {
        this.userRepository = userRepository;
        this.passwordEncoder = passwordEncoder;
        this.tokenStore = tokenStore;
    }

    public AuthResponseDto register(AuthRequestDto request) {
        String username = normalizeUsername(request.username());
        if (userRepository.existsByUsername(username)) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Username already exists");
        }

        UserEntity user = userRepository.save(new UserEntity(username, passwordEncoder.encode(request.password())));
        String token = issueToken(user.getId());
        return new AuthResponseDto(user.getId(), user.getUsername(), token, "Registration successful");
    }

    public AuthResponseDto login(AuthRequestDto request) {
        String username = normalizeUsername(request.username());
        UserEntity user = userRepository.findByUsername(username)
            .orElseThrow(() -> new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Invalid username or password"));

        if (!passwordEncoder.matches(request.password(), user.getPasswordHash())) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Invalid username or password");
        }

        String token = issueToken(user.getId());
        return new AuthResponseDto(user.getId(), user.getUsername(), token, "Login successful");
    }

    public AuthResponseDto me(String rawToken) {
        String token = extractToken(rawToken);
        Long userId = tokenStore.get(token);
        if (userId == null) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Invalid or expired token");
        }

        UserEntity user = userRepository.findById(userId)
            .orElseThrow(() -> new ResponseStatusException(HttpStatus.UNAUTHORIZED, "User not found"));

        return new AuthResponseDto(user.getId(), user.getUsername(), token, "Authenticated");
    }

    private String issueToken(Long userId) {
        String token = UUID.randomUUID().toString();
        tokenStore.put(token, userId);
        return token;
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

    private String normalizeUsername(String username) {
        return username == null ? "" : username.trim().toLowerCase();
    }
}
