package com.game.app.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import com.game.app.model.ChatMediaEntity;

public interface ChatMediaRepository extends JpaRepository<ChatMediaEntity, Long> {
  @Query(value = "SELECT OCTET_LENGTH(data) FROM chat_media WHERE id = :id", nativeQuery = true)
  Number findDataSizeById(@Param("id") Long id);
}
