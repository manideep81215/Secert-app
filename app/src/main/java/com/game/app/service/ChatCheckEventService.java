package com.game.app.service;

import java.time.Duration;
import java.time.Instant;
import java.util.List;

import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.game.app.model.ChatCheckEventEntity;
import com.game.app.repository.ChatCheckEventRepository;

@Service
public class ChatCheckEventService {
  private static final Duration OFFLINE_GAP_REQUIRED = Duration.ofSeconds(30);
  private static final Duration CHECK_DEBOUNCE = Duration.ofSeconds(30);

  private final ChatCheckEventRepository chatCheckEventRepository;
  private final SimpMessagingTemplate messagingTemplate;

  public ChatCheckEventService(
      ChatCheckEventRepository chatCheckEventRepository,
      SimpMessagingTemplate messagingTemplate) {
    this.chatCheckEventRepository = chatCheckEventRepository;
    this.messagingTemplate = messagingTemplate;
  }

  @Transactional
  public void trackOutgoingMessage(String senderUsername, String receiverUsername, Instant receiverOfflineAt) {
    ChatCheckEventEntity event = chatCheckEventRepository
        .findBySenderUsernameAndReceiverUsername(senderUsername, receiverUsername)
        .orElseGet(() -> {
          ChatCheckEventEntity created = new ChatCheckEventEntity();
          created.setSenderUsername(senderUsername);
          created.setReceiverUsername(receiverUsername);
          return created;
        });

    boolean startingNewCycle = !event.isActive() || event.isConsumed() || event.isNotified();
    if (startingNewCycle) {
      event.setCheckCount(0);
      event.setLastCheckedAt(null);
    }
    event.setActive(true);
    event.setConsumed(false);
    event.setNotified(false);
    if (receiverOfflineAt != null && (startingNewCycle || event.getLastOfflineAt() == null)) {
      event.setLastOfflineAt(receiverOfflineAt);
    }
    chatCheckEventRepository.save(event);
  }

  @Transactional
  public boolean recordQualifiedOpen(String senderUsername, String receiverUsername, Instant now) {
    ChatCheckEventEntity event = chatCheckEventRepository
        .findBySenderUsernameAndReceiverUsername(senderUsername, receiverUsername)
        .orElse(null);
    if (event == null || !event.isActive()) {
      return false;
    }
    Instant lastOfflineAt = event.getLastOfflineAt();
    if (lastOfflineAt == null || Duration.between(lastOfflineAt, now).compareTo(OFFLINE_GAP_REQUIRED) < 0) {
      return false;
    }
    Instant lastCheckedAt = event.getLastCheckedAt();
    if (lastCheckedAt != null && Duration.between(lastCheckedAt, now).compareTo(CHECK_DEBOUNCE) < 0) {
      return false;
    }
    event.setCheckCount(event.getCheckCount() + 1);
    event.setLastCheckedAt(now);
    event.setConsumed(false);
    event.setNotified(false);
    chatCheckEventRepository.save(event);
    messagingTemplate.convertAndSendToUser(
        receiverUsername,
        "/queue/check-count-notices",
        new CheckCountNoticePayload(
            "CHECK_COUNT_NOTIFY",
            senderUsername,
            event.getCheckCount(),
            now.toEpochMilli()));
    return true;
  }

  @Transactional
  public void pushPendingNoticesFor(String receiverUsername) {
    List<ChatCheckEventEntity> rows = chatCheckEventRepository.findByReceiverUsernameAndActiveTrue(receiverUsername);
    for (ChatCheckEventEntity event : rows) {
      if (event.getCheckCount() <= 0 || event.isNotified()) {
        continue;
      }
      messagingTemplate.convertAndSendToUser(
          receiverUsername,
          "/queue/check-count-notices",
          new CheckCountNoticePayload(
              "CHECK_COUNT_NOTIFY",
              event.getSenderUsername(),
              event.getCheckCount(),
              Instant.now().toEpochMilli()));
      event.setNotified(true);
      chatCheckEventRepository.save(event);
    }
  }

  @Transactional
  public void markUserOffline(String receiverUsername, Instant offlineAt) {
    List<ChatCheckEventEntity> rows = chatCheckEventRepository.findByReceiverUsername(receiverUsername);
    for (ChatCheckEventEntity event : rows) {
      if (!event.isActive()) {
        continue;
      }
      event.setLastOfflineAt(offlineAt);
    }
    chatCheckEventRepository.saveAll(rows);
  }

  @Transactional
  public void notifySenderIfNeeded(String senderUsername, String receiverUsername, Instant engagedAt) {
    ChatCheckEventEntity event = chatCheckEventRepository
        .findBySenderUsernameAndReceiverUsername(senderUsername, receiverUsername)
        .orElse(null);
    if (event == null) {
      return;
    }
    event.setActive(false);
    if (event.getCheckCount() > 0 && !event.isNotified()) {
      messagingTemplate.convertAndSendToUser(
          senderUsername,
          "/queue/check-count-notices",
          new CheckCountNoticePayload(
              "CHECK_COUNT_NOTIFY",
              receiverUsername,
              event.getCheckCount(),
              engagedAt != null ? engagedAt.toEpochMilli() : Instant.now().toEpochMilli()));
      event.setNotified(true);
      event.setConsumed(false);
    }
    chatCheckEventRepository.save(event);
  }

  @Transactional
  public void consume(String senderUsername, String receiverUsername) {
    ChatCheckEventEntity event = chatCheckEventRepository
        .findBySenderUsernameAndReceiverUsername(senderUsername, receiverUsername)
        .orElse(null);
    if (event == null) {
      return;
    }
    event.setCheckCount(0);
    event.setLastCheckedAt(null);
    event.setNotified(false);
    event.setConsumed(true);
    event.setActive(false);
    chatCheckEventRepository.save(event);
  }

  public record CheckCountNoticePayload(
      String type,
      String checkerUsername,
      int checkCount,
      long triggeredAt) {}
}
