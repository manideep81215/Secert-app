package com.game.app.service;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.game.app.model.ChatAnalyticsDailyEntity;
import com.game.app.repository.ChatAnalyticsDailyRepository;

@Service
public class ChatAnalyticsService {

  private final ChatAnalyticsDailyRepository chatAnalyticsDailyRepository;

  public ChatAnalyticsService(ChatAnalyticsDailyRepository chatAnalyticsDailyRepository) {
    this.chatAnalyticsDailyRepository = chatAnalyticsDailyRepository;
  }

  @Transactional
  public void recordMessage(String userOne, String userTwo, String type, Instant createdAt) {
    String[] pair = canonicalPair(userOne, userTwo);
    String low = pair[0];
    String high = pair[1];
    if (low.isBlank() || high.isBlank()) {
      return;
    }

    ZoneId zoneId = ZoneId.systemDefault();
    Instant safeInstant = createdAt != null ? createdAt : Instant.now();
    LocalDate talkDate = LocalDate.ofInstant(safeInstant, zoneId);

    ChatAnalyticsDailyEntity row = chatAnalyticsDailyRepository
        .findByUserLowAndUserHighAndTalkDate(low, high, talkDate)
        .orElseGet(() -> {
          ChatAnalyticsDailyEntity entity = new ChatAnalyticsDailyEntity();
          entity.setUserLow(low);
          entity.setUserHigh(high);
          entity.setTalkDate(talkDate);
          return entity;
        });

    row.increment(type);
    chatAnalyticsDailyRepository.save(row);
  }

  private String[] canonicalPair(String userOne, String userTwo) {
    String left = normalizeUsername(userOne);
    String right = normalizeUsername(userTwo);
    if (left.compareTo(right) <= 0) {
      return new String[] { left, right };
    }
    return new String[] { right, left };
  }

  private String normalizeUsername(String username) {
    return username == null ? "" : username.trim().toLowerCase();
  }
}
