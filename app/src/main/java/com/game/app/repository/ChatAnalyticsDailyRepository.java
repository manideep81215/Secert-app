package com.game.app.repository;

import java.time.LocalDate;
import java.util.List;
import java.util.Optional;

import org.springframework.data.jpa.repository.JpaRepository;

import com.game.app.model.ChatAnalyticsDailyEntity;

public interface ChatAnalyticsDailyRepository extends JpaRepository<ChatAnalyticsDailyEntity, Long> {

  Optional<ChatAnalyticsDailyEntity> findByUserLowAndUserHighAndTalkDate(
      String userLow,
      String userHigh,
      LocalDate talkDate);

  List<ChatAnalyticsDailyEntity> findByUserLowAndUserHighOrderByTalkDateAsc(String userLow, String userHigh);
}
