package com.game.app.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record SecretKeyRequestDto(
    @NotBlank @Size(min = 3, max = 255) String secretKey
) {
}
