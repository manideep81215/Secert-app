package com.game.app.service;

import java.io.ByteArrayInputStream;
import java.io.FileInputStream;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.charset.StandardCharsets;
import java.util.Locale;
import java.util.Base64;
import java.util.List;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

import com.google.api.client.googleapis.javanet.GoogleNetHttpTransport;
import com.google.api.client.http.InputStreamContent;
import com.google.api.client.json.gson.GsonFactory;
import com.google.api.services.drive.Drive;
import com.google.api.services.drive.DriveScopes;
import com.google.api.services.drive.model.Permission;
import com.google.auth.http.HttpCredentialsAdapter;
import com.google.auth.oauth2.GoogleCredentials;

@Service
public class DriveMediaService {

  private static final Logger log = LoggerFactory.getLogger(DriveMediaService.class);
  private static final String DRIVE_DOWNLOAD_URL_TEMPLATE = "https://drive.google.com/uc?export=download&id=%s";
  private static final String DRIVE_IMAGE_URL_TEMPLATE = "https://drive.google.com/uc?export=view&id=%s";
  private static final String DRIVE_VIDEO_PREVIEW_URL_TEMPLATE = "https://drive.google.com/file/d/%s/preview";
  private static final String FALLBACK_FILE_NAME_PREFIX = "media_";

  private final boolean enabled;
  private final String folderId;
  private final boolean publicRead;
  private final String credentialsFile;
  private final String credentialsJson;
  private final String credentialsBase64;
  private volatile Drive driveClient;

  public DriveMediaService(
      @Value("${app.media.drive.enabled:true}") boolean enabled,
      @Value("${app.media.drive.folder-id:}") String folderId,
      @Value("${app.media.drive.public-read:true}") boolean publicRead,
      @Value("${app.media.drive.credentials-file:}") String credentialsFile,
      @Value("${app.media.drive.credentials-json:}") String credentialsJson,
      @Value("${app.media.drive.credentials-base64:}") String credentialsBase64) {
    this.enabled = enabled;
    this.folderId = folderId != null ? folderId.trim() : "";
    this.publicRead = publicRead;
    this.credentialsFile = credentialsFile != null ? credentialsFile.trim() : "";
    this.credentialsJson = credentialsJson != null ? credentialsJson.trim() : "";
    this.credentialsBase64 = credentialsBase64 != null ? credentialsBase64.trim() : "";
  }

  public boolean isEnabled() {
    return enabled;
  }

  public boolean isConfigured() {
    return enabled
        && !folderId.isBlank()
        && (!credentialsBase64.isBlank() || !credentialsJson.isBlank() || !credentialsFile.isBlank());
  }

  public UploadResult uploadMedia(MultipartFile file, String mimeType, String mediaType) {
    if (file == null || file.isEmpty()) {
      throw new IllegalArgumentException("empty-upload-file");
    }
    String safeFileName = sanitizeFileName(file.getOriginalFilename());
    try (InputStream input = file.getInputStream()) {
      return uploadStream(input, file.getSize(), safeFileName, mimeType, mediaType);
    } catch (Exception exception) {
      log.error("Google Drive media upload failed", exception);
      throw new IllegalStateException("drive-media-upload-failed", exception);
    }
  }

  public UploadResult uploadLocalFile(Path localPath, String fileName, String mimeType, String mediaType) {
    if (localPath == null) {
      throw new IllegalArgumentException("local-file-path-required");
    }
    try (InputStream input = Files.newInputStream(localPath)) {
      long size = Files.exists(localPath) ? Files.size(localPath) : -1L;
      return uploadStream(input, size, fileName, mimeType, mediaType);
    } catch (Exception exception) {
      log.error("Google Drive local file upload failed: {}", localPath, exception);
      throw new IllegalStateException("drive-media-upload-failed", exception);
    }
  }

  public String buildMediaUrl(String driveFileId, String mediaType) {
    String normalizedType = normalizeMediaType(mediaType);
    if ("video".equals(normalizedType)) {
      return DRIVE_VIDEO_PREVIEW_URL_TEMPLATE.formatted(driveFileId);
    }
    if ("image".equals(normalizedType)) {
      return DRIVE_IMAGE_URL_TEMPLATE.formatted(driveFileId);
    }
    return DRIVE_DOWNLOAD_URL_TEMPLATE.formatted(driveFileId);
  }

  private synchronized Drive getDriveClient() {
    if (!enabled) {
      throw new IllegalStateException("drive-media-storage-disabled");
    }
    if (folderId.isBlank()) {
      throw new IllegalStateException("drive-folder-id-missing");
    }
    if (driveClient != null) {
      return driveClient;
    }

    try (InputStream credentialsStream = openCredentialsStream()) {
      if (credentialsStream == null) {
        throw new IllegalStateException("drive-credentials-missing");
      }
      GoogleCredentials credentials = GoogleCredentials.fromStream(credentialsStream)
          .createScoped(List.of(DriveScopes.DRIVE_FILE));
      credentials.refreshIfExpired();

      driveClient = new Drive.Builder(
          GoogleNetHttpTransport.newTrustedTransport(),
          GsonFactory.getDefaultInstance(),
          new HttpCredentialsAdapter(credentials))
          .setApplicationName("secert-app-media")
          .build();
      return driveClient;
    } catch (Exception exception) {
      throw new IllegalStateException("drive-client-init-failed", exception);
    }
  }

  private InputStream openCredentialsStream() {
    try {
      if (!credentialsBase64.isBlank()) {
        byte[] decoded = Base64.getDecoder().decode(credentialsBase64);
        return new ByteArrayInputStream(decoded);
      }
      if (!credentialsJson.isBlank()) {
        String trimmedJson = credentialsJson.trim();
        if (trimmedJson.startsWith("{")) {
          return new ByteArrayInputStream(trimmedJson.getBytes(StandardCharsets.UTF_8));
        }
        byte[] decoded = Base64.getDecoder().decode(trimmedJson);
        return new ByteArrayInputStream(decoded);
      }
      if (!credentialsFile.isBlank()) {
        return new FileInputStream(credentialsFile);
      }
    } catch (Exception exception) {
      log.error("Unable to read Drive credentials", exception);
    }
    return null;
  }

  private UploadResult uploadStream(
      InputStream input,
      long fileSize,
      String fileName,
      String mimeType,
      String mediaType) throws Exception {
    String safeMimeType = normalizeMimeType(mimeType);
    String safeFileName = sanitizeFileName(fileName);
    Drive client = getDriveClient();

    com.google.api.services.drive.model.File metadata = new com.google.api.services.drive.model.File();
    metadata.setName(safeFileName);
    metadata.setParents(List.of(folderId));

    InputStreamContent mediaContent = new InputStreamContent(safeMimeType, input);
    if (fileSize > 0) {
      mediaContent.setLength(fileSize);
    }

    com.google.api.services.drive.model.File uploaded = client.files()
        .create(metadata, mediaContent)
        .setFields("id,name,mimeType,size")
        .execute();

    if (uploaded == null || uploaded.getId() == null || uploaded.getId().isBlank()) {
      throw new IllegalStateException("drive-upload-no-file-id");
    }

    if (publicRead) {
      Permission permission = new Permission();
      permission.setType("anyone");
      permission.setRole("reader");
      client.permissions()
          .create(uploaded.getId(), permission)
          .setFields("id")
          .execute();
    }

    String resolvedName = sanitizeFileName(uploaded.getName());
    String resolvedMime = normalizeMimeType(uploaded.getMimeType());
    String resolvedMediaType = normalizeMediaType(mediaType);
    String mediaUrl = buildMediaUrl(uploaded.getId(), resolvedMediaType);
    return new UploadResult(uploaded.getId(), mediaUrl, resolvedName, resolvedMime, resolvedMediaType);
  }

  private String normalizeMimeType(String mimeType) {
    String safeMimeType = String.valueOf(mimeType == null ? "" : mimeType).trim();
    if (safeMimeType.isBlank()) {
      return "application/octet-stream";
    }
    return safeMimeType;
  }

  private String normalizeMediaType(String mediaType) {
    String normalized = mediaType == null ? "" : mediaType.trim().toLowerCase(Locale.ROOT);
    if ("photo".equals(normalized)) return "image";
    if ("audio".equals(normalized)) return "voice";
    if ("image".equals(normalized)
        || "video".equals(normalized)
        || "voice".equals(normalized)
        || "file".equals(normalized)) {
      return normalized;
    }
    return "file";
  }

  private String sanitizeFileName(String originalFileName) {
    String normalized = String.valueOf(originalFileName == null ? "" : originalFileName).trim();
    if (normalized.isBlank()) {
      return FALLBACK_FILE_NAME_PREFIX + System.currentTimeMillis();
    }

    String safe = normalized
        .replace("\\", "_")
        .replace("/", "_")
        .replaceAll("[\\r\\n\\t]+", "_")
        .replaceAll("[^a-zA-Z0-9._()-]", "_");
    if (safe.isBlank()) {
      return FALLBACK_FILE_NAME_PREFIX + System.currentTimeMillis();
    }
    if (safe.length() > 180) {
      return safe.substring(0, 180);
    }
    return safe;
  }

  public record UploadResult(
      String driveFileId,
      String mediaUrl,
      String fileName,
      String mimeType,
      String mediaType) {
  }
}
