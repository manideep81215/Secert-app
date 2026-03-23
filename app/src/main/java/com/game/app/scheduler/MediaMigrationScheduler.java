package com.game.app.scheduler;

import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import com.game.app.model.ChatMessageEntity;
import com.game.app.repository.ChatMessageRepository;
import com.game.app.service.DriveMediaService;
import com.game.app.service.LocalMediaStorageService;

@Service
public class MediaMigrationScheduler {
  private static final Logger logger = LoggerFactory.getLogger(MediaMigrationScheduler.class);
  private static final List<String> MIGRATABLE_MEDIA_TYPES = List.of("image", "video", "file");

  private final ChatMessageRepository chatMessageRepository;
  private final DriveMediaService driveMediaService;
  private final LocalMediaStorageService localMediaStorageService;
  private final boolean migrationEnabled;
  private final int migrationAgeDays;

  public MediaMigrationScheduler(
      ChatMessageRepository chatMessageRepository,
      DriveMediaService driveMediaService,
      LocalMediaStorageService localMediaStorageService,
      @Value("${app.media.migration.enabled:true}") boolean migrationEnabled,
      @Value("${app.media.migration.age-days:3}") int migrationAgeDays) {
    this.chatMessageRepository = chatMessageRepository;
    this.driveMediaService = driveMediaService;
    this.localMediaStorageService = localMediaStorageService;
    this.migrationEnabled = migrationEnabled;
    this.migrationAgeDays = Math.max(1, migrationAgeDays);
  }

  @Scheduled(cron = "${app.media.migration.cron:0 0 * * * *}")
  public void migrateEligibleMediaToDrive() {
    if (!migrationEnabled) {
      return;
    }
    if (!driveMediaService.isConfigured()) {
      logger.warn("Skipping media migration: Google Drive is not configured");
      return;
    }

    Instant cutoff = Instant.now().minus(migrationAgeDays, ChronoUnit.DAYS);
    List<ChatMessageEntity> candidates =
        chatMessageRepository.findTop200ByMovedToDriveFalseAndMediaTypeInAndCreatedAtBeforeOrderByCreatedAtAsc(
            MIGRATABLE_MEDIA_TYPES,
            cutoff);

    if (candidates.isEmpty()) {
      return;
    }

    for (ChatMessageEntity message : candidates) {
      migrateSingleMessage(message);
    }
  }

  private void migrateSingleMessage(ChatMessageEntity message) {
    String storedName = localMediaStorageService.extractStoredName(message.getMediaUrl());
    if (storedName == null || storedName.isBlank()) {
      message.setMovedToDrive(true);
      chatMessageRepository.save(message);
      logger.warn("Marked message {} as moved_to_drive=true because local media path is missing", message.getId());
      return;
    }

    Path localPath;
    try {
      localPath = localMediaStorageService.resolveStoredPath(storedName);
    } catch (Exception exception) {
      message.setMovedToDrive(true);
      chatMessageRepository.save(message);
      logger.warn("Marked message {} as moved_to_drive=true due to invalid local media path", message.getId());
      return;
    }

    if (!Files.exists(localPath)) {
      message.setMovedToDrive(true);
      chatMessageRepository.save(message);
      logger.warn("Marked message {} as moved_to_drive=true because local file does not exist: {}",
          message.getId(),
          localPath);
      return;
    }

    try {
      DriveMediaService.UploadResult uploaded = driveMediaService.uploadLocalFile(
          localPath,
          resolveDriveFileName(message, storedName),
          resolveMimeType(message, localPath),
          message.getMediaType());

      message.setDriveFileId(uploaded.driveFileId());
      message.setDriveUrl(uploaded.mediaUrl());
      message.setMediaUrl(uploaded.mediaUrl());
      message.setMovedToDrive(true);
      if (message.getMimeType() == null || message.getMimeType().isBlank()) {
        message.setMimeType(uploaded.mimeType());
      }
      if (message.getMediaType() == null || message.getMediaType().isBlank()) {
        message.setMediaType(uploaded.mediaType());
      }
      chatMessageRepository.save(message);

      Files.deleteIfExists(localPath);
      logger.info("Migrated media message {} to Drive file {}", message.getId(), uploaded.driveFileId());
    } catch (Exception exception) {
      logger.error("Failed to migrate media message {} to Drive", message.getId(), exception);
    }
  }

  private String resolveDriveFileName(ChatMessageEntity message, String fallbackStoredName) {
    String fileName = message.getFileName() == null ? "" : message.getFileName().trim();
    if (!fileName.isBlank()) {
      return fileName;
    }
    return fallbackStoredName;
  }

  private String resolveMimeType(ChatMessageEntity message, Path localPath) {
    String mimeType = message.getMimeType() == null ? "" : message.getMimeType().trim();
    if (!mimeType.isBlank()) {
      return mimeType;
    }
    try {
      String probed = Files.probeContentType(localPath);
      if (probed != null && !probed.isBlank()) {
        return probed;
      }
    } catch (Exception ignored) {
      // fall through
    }
    return "application/octet-stream";
  }
}
