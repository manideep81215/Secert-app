package com.game.app.service;

import java.time.Instant;
import java.time.temporal.ChronoUnit;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.game.app.repository.ChatMessageRepository;

@Service
public class ChatMessageCleanupService {
  private static final Logger logger = LoggerFactory.getLogger(ChatMessageCleanupService.class);

  private final ChatMessageRepository chatMessageRepository;
  private final int retentionDays;

  public ChatMessageCleanupService(
      ChatMessageRepository chatMessageRepository,
      @Value("${app.chat.text-retention-days:3}") int retentionDays) {
    this.chatMessageRepository = chatMessageRepository;
    this.retentionDays = retentionDays;
  }

  @Scheduled(cron = "${app.chat.cleanup.cron:0 0 * * * *}")
  @Transactional
  public void deleteOldTextOnlyMessages() {
    if (retentionDays <= 0) {
      return;
    }
    Instant cutoff = Instant.now().minus(retentionDays, ChronoUnit.DAYS);
    int deleted = chatMessageRepository.deleteTextOnlyMessagesOlderThan(cutoff);
    if (deleted > 0) {
      logger.info("Deleted {} text-only chat messages older than {} days", deleted, retentionDays);
    }
  }
}
