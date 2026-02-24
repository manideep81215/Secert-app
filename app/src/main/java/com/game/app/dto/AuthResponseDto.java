package com.game.app.dto;

public record AuthResponseDto(
    Long userId,
    String username,
    String token,
    String refreshToken,
    String message
) {
}
