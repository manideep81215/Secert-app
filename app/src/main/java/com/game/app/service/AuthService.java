package com.game.app.service;

import com.game.app.dto.AuthRequestDto;
import com.game.app.dto.AuthResponseDto;
import com.game.app.dto.RefreshTokenRequestDto;
import com.game.app.model.UserEntity;
import com.game.app.repository.UserRepository;
import org.springframework.http.HttpStatus;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

@Service
public class AuthService {

    private final UserRepository userRepository;
    private final PasswordEncoder passwordEncoder;
    private final JwtTokenService jwtTokenService;

    public AuthService(UserRepository userRepository, PasswordEncoder passwordEncoder, JwtTokenService jwtTokenService) {
        this.userRepository = userRepository;
        this.passwordEncoder = passwordEncoder;
        this.jwtTokenService = jwtTokenService;
    }

    public AuthResponseDto register(AuthRequestDto request) {
        String username = normalizeUsername(request.username());
        if (userRepository.existsByUsername(username)) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Username already exists");
        }
        String name = trimToNull(request.name());
        String phone = trimToNull(request.phone());
        String email = trimToNull(request.email());
        String dob = trimToNull(request.dob());

        if (name == null || phone == null || email == null || dob == null) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Name, phone, email and dob are required");
        }

        UserEntity user = new UserEntity(username, passwordEncoder.encode(request.password()));
        user.setRole("game");
        user.setName(name);
        user.setPhone(phone);
        user.setEmail(email);
        user.setDob(dob);
        user = userRepository.save(user);
        String token = issueAccessToken(user);
        String refreshToken = issueRefreshToken(user);
        return new AuthResponseDto(user.getId(), user.getUsername(), token, refreshToken, user.getRole(), "Registration successful");
    }

    public AuthResponseDto login(AuthRequestDto request) {
        String username = normalizeUsername(request.username());
        UserEntity user = userRepository.findByUsername(username)
            .orElseThrow(() -> new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Invalid email or password"));

        if (!passwordEncoder.matches(request.password(), user.getPasswordHash())) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Invalid email or password");
        }

        String token = issueAccessToken(user);
        String refreshToken = issueRefreshToken(user);
        return new AuthResponseDto(user.getId(), user.getUsername(), token, refreshToken, user.getRole(), "Login successful");
    }

    public AuthResponseDto me(String rawToken) {
        Long userId = jwtTokenService.extractAccessUserId(rawToken);
        String token = extractToken(rawToken);

        UserEntity user = userRepository.findById(userId)
            .orElseThrow(() -> new ResponseStatusException(HttpStatus.UNAUTHORIZED, "User not found"));

        return new AuthResponseDto(user.getId(), user.getUsername(), token, null, user.getRole(), "Authenticated");
    }

    public AuthResponseDto refresh(RefreshTokenRequestDto request) {
        String refreshToken = request.refreshToken().trim();
        Long userId = jwtTokenService.extractRefreshUserId(refreshToken);

        UserEntity user = userRepository.findById(userId)
            .orElseThrow(() -> new ResponseStatusException(HttpStatus.UNAUTHORIZED, "User not found"));

        String newAccessToken = issueAccessToken(user);
        String newRefreshToken = issueRefreshToken(user);
        return new AuthResponseDto(user.getId(), user.getUsername(), newAccessToken, newRefreshToken, user.getRole(), "Token refreshed");
    }

    private String issueAccessToken(UserEntity user) {
        return jwtTokenService.issueAccessToken(user);
    }

    private String issueRefreshToken(UserEntity user) {
        return jwtTokenService.issueRefreshToken(user);
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

    private String trimToNull(String value) {
        if (value == null) return null;
        String trimmed = value.trim();
        return trimmed.isEmpty() ? null : trimmed;
    }
}
