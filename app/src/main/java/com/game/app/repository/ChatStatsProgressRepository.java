package com.game.app.repository;

import java.util.Optional;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import com.game.app.model.ChatStatsProgressEntity;

public interface ChatStatsProgressRepository extends JpaRepository<ChatStatsProgressEntity, Long> {

  Optional<ChatStatsProgressEntity> findByUserLowAndUserHighAndViewerUsername(
      String userLow,
      String userHigh,
      String viewerUsername);

  @Modifying
  @Query(value = """
      INSERT INTO chat_stats_progress (user_low, user_high, viewer_username, last_message_total, updated_at)
      VALUES (:low, :high, :viewer, :total, NOW())
      ON DUPLICATE KEY UPDATE last_message_total = VALUES(last_message_total), updated_at = NOW()
      """, nativeQuery = true)
  void upsert(
      @Param("low") String low,
      @Param("high") String high,
      @Param("viewer") String viewer,
      @Param("total") long total);
}
