package com.game.app.service;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.net.URI;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.game.app.repository.ChatMediaRepository;
import com.game.app.repository.ChatMessageRepository;

@Service
public class ChatMessageCleanupService {
  private static final Logger logger = LoggerFactory.getLogger(ChatMessageCleanupService.class);

  private final ChatMessageRepository chatMessageRepository;
  private final ChatMediaRepository chatMediaRepository;
  private final int retentionDays;

  public ChatMessageCleanupService(
      ChatMessageRepository chatMessageRepository,
      ChatMediaRepository chatMediaRepository,
      @Value("${app.chat.text-retention-days:3}") int retentionDays) {
    this.chatMessageRepository = chatMessageRepository;
    this.chatMediaRepository = chatMediaRepository;
    this.retentionDays = retentionDays;
  }

  @Scheduled(cron = "${app.chat.cleanup.cron:0 0 * * * *}")
  @Transactional
  public void deleteOldTextAndVoiceMessages() {
    if (retentionDays <= 0) {
      return;
    }
    Instant cutoff = Instant.now().minus(retentionDays, ChronoUnit.DAYS);
    List<String> voiceMediaUrls = chatMessageRepository.findVoiceMediaUrlsOlderThan(cutoff);
    int deleted = chatMessageRepository.deleteTextAndVoiceMessagesOlderThan(cutoff);
    int mediaDeleted = cleanupOrphanedVoiceMedia(voiceMediaUrls);
    if (deleted > 0) {
      logger.info(
          "Deleted {} text/voice chat messages older than {} days (removed {} orphaned voice blobs)",
          deleted,
          retentionDays,
          mediaDeleted);
    }
  }

  private int cleanupOrphanedVoiceMedia(List<String> mediaUrls) {
    if (mediaUrls == null || mediaUrls.isEmpty()) {
      return 0;
    }
    Set<Long> candidateIds = new HashSet<>();
    for (String mediaUrl : mediaUrls) {
      Long mediaId = extractVoiceMediaId(mediaUrl);
      if (mediaId != null && mediaId > 0) {
        candidateIds.add(mediaId);
      }
    }
    if (candidateIds.isEmpty()) {
      return 0;
    }

    Set<Long> orphanedIds = new HashSet<>();
    for (Long mediaId : candidateIds) {
      String suffix = "/api/app/messages/media/" + mediaId;
      boolean stillReferenced = chatMessageRepository.existsByMediaUrlEndingWith(suffix);
      if (!stillReferenced) {
        orphanedIds.add(mediaId);
      }
    }
    if (orphanedIds.isEmpty()) {
      return 0;
    }

    chatMediaRepository.deleteAllByIdInBatch(orphanedIds);
    return orphanedIds.size();
  }

  private Long extractVoiceMediaId(String mediaUrl) {
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
      // Best-effort parsing.
    }

    int marker = path.lastIndexOf("/api/app/messages/media/");
    if (marker < 0) {
      return null;
    }
    String idPart = path.substring(marker + "/api/app/messages/media/".length()).trim();
    if (idPart.isBlank()) {
      return null;
    }
    try {
      return Long.parseLong(idPart);
    } catch (NumberFormatException ignored) {
      return null;
    }
  }
}
