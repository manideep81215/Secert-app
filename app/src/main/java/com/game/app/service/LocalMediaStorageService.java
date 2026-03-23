package com.game.app.service;

import java.io.InputStream;
import java.net.URI;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.Locale;
import java.util.UUID;
import java.util.regex.Pattern;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

@Service
public class LocalMediaStorageService {
  private static final Pattern SAFE_NAME_PATTERN = Pattern.compile("^[a-zA-Z0-9._()\\-]+$");
  private static final String LOCAL_MEDIA_ROUTE_PREFIX = "/api/app/messages/media/local/";

  private final Path localDirectory;

  public LocalMediaStorageService(@Value("${app.media.local-dir:uploads/media}") String localDirectory) {
    String normalized = localDirectory == null ? "" : localDirectory.trim();
    if (normalized.isBlank()) {
      normalized = "uploads/media";
    }
    this.localDirectory = Path.of(normalized).toAbsolutePath().normalize();
  }

  public StoredLocalMedia store(MultipartFile file, String mimeType) {
    if (file == null || file.isEmpty()) {
      throw new IllegalArgumentException("empty-upload-file");
    }

    try {
      Files.createDirectories(localDirectory);
      String storedName = buildStoredName(file.getOriginalFilename(), mimeType);
      Path target = resolveStoredPath(storedName);
      try (InputStream input = file.getInputStream()) {
        Files.copy(input, target, StandardCopyOption.REPLACE_EXISTING);
      }
      return new StoredLocalMedia(storedName, target, file.getSize());
    } catch (Exception exception) {
      throw new IllegalStateException("local-media-store-failed", exception);
    }
  }

  public Path resolveStoredPath(String storedName) {
    String safeName = normalizeStoredName(storedName);
    if (safeName.isBlank()) {
      throw new IllegalArgumentException("invalid-media-file-name");
    }
    Path resolved = localDirectory.resolve(safeName).normalize();
    if (!resolved.startsWith(localDirectory)) {
      throw new IllegalArgumentException("invalid-media-file-name");
    }
    return resolved;
  }

  public String extractStoredName(String mediaUrl) {
    String raw = mediaUrl == null ? "" : mediaUrl.trim();
    if (raw.isBlank()) {
      return null;
    }

    String path = raw;
    try {
      URI uri = URI.create(raw);
      if (uri.getPath() != null && !uri.getPath().isBlank()) {
        path = uri.getPath();
      }
    } catch (Exception ignored) {
      // Use raw value as-is when URI parsing fails.
    }

    int prefixIndex = path.indexOf(LOCAL_MEDIA_ROUTE_PREFIX);
    if (prefixIndex < 0) {
      return null;
    }
    String encodedName = path.substring(prefixIndex + LOCAL_MEDIA_ROUTE_PREFIX.length());
    if (encodedName.isBlank()) {
      return null;
    }

    String decodedName = URLDecoder.decode(encodedName, StandardCharsets.UTF_8);
    String safeName = normalizeStoredName(decodedName);
    return safeName.isBlank() ? null : safeName;
  }

  public String toLocalMediaRoute(String storedName) {
    return LOCAL_MEDIA_ROUTE_PREFIX + normalizeStoredName(storedName);
  }

  private String buildStoredName(String originalFileName, String mimeType) {
    String extension = extractExtension(originalFileName);
    if (extension.isBlank()) {
      extension = mimeToExtension(mimeType);
    }
    String uuid = UUID.randomUUID().toString().replace("-", "");
    if (extension.isBlank()) {
      return "media_" + uuid;
    }
    return "media_" + uuid + "." + extension;
  }

  private String extractExtension(String fileName) {
    String input = fileName == null ? "" : fileName.trim();
    int dotIndex = input.lastIndexOf('.');
    if (dotIndex < 0 || dotIndex == input.length() - 1) {
      return "";
    }
    String extension = input.substring(dotIndex + 1)
        .toLowerCase(Locale.ROOT)
        .replaceAll("[^a-z0-9]", "");
    if (extension.length() > 10) {
      return extension.substring(0, 10);
    }
    return extension;
  }

  private String mimeToExtension(String mimeType) {
    String input = mimeType == null ? "" : mimeType.trim().toLowerCase(Locale.ROOT);
    if (input.isBlank()) return "";
    if (input.contains("jpeg")) return "jpg";
    if (input.contains("png")) return "png";
    if (input.contains("gif")) return "gif";
    if (input.contains("webp")) return "webp";
    if (input.contains("heic")) return "heic";
    if (input.contains("heif")) return "heif";
    if (input.contains("mp4")) return "mp4";
    if (input.contains("quicktime")) return "mov";
    if (input.contains("webm")) return "webm";
    if (input.contains("mpeg")) return "mpeg";
    if (input.contains("audio")) return "m4a";
    if (input.contains("pdf")) return "pdf";
    return "";
  }

  private String normalizeStoredName(String storedName) {
    String candidate = storedName == null ? "" : storedName.trim();
    if (candidate.contains("/") || candidate.contains("\\") || candidate.contains("..")) {
      return "";
    }
    if (!SAFE_NAME_PATTERN.matcher(candidate).matches()) {
      return "";
    }
    return candidate;
  }

  public record StoredLocalMedia(String storedName, Path absolutePath, long size) {
  }
}
