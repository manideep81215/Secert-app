package com.game.app.repository;

import java.util.Optional;

import org.springframework.data.jpa.repository.JpaRepository;

import com.game.app.model.ChatStatsProgressEntity;

public interface ChatStatsProgressRepository extends JpaRepository<ChatStatsProgressEntity, Long> {

  Optional<ChatStatsProgressEntity> findByUserLowAndUserHighAndViewerUsername(
      String userLow,
      String userHigh,
      String viewerUsername);
}
