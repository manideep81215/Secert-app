package com.game.app.controller;

import com.game.app.dto.AuthRequestDto;
import com.game.app.dto.AuthResponseDto;
import com.game.app.dto.RefreshTokenRequestDto;
import com.game.app.service.AuthService;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/app/auth")
public class AuthController {

    private final AuthService authService;

    public AuthController(AuthService authService) {
        this.authService = authService;
    }

    @PostMapping("/register")
    public AuthResponseDto register(@Valid @RequestBody AuthRequestDto request) {
        return authService.register(request);
    }

    @PostMapping("/login")
    public AuthResponseDto login(@Valid @RequestBody AuthRequestDto request) {
        return authService.login(request);
    }

    @PostMapping("/refresh")
    public AuthResponseDto refresh(@Valid @RequestBody RefreshTokenRequestDto request) {
        return authService.refresh(request);
    }

    @GetMapping("/me")
    public AuthResponseDto me(@RequestHeader("Authorization") String authHeader) {
        return authService.me(authHeader);
    }
}
