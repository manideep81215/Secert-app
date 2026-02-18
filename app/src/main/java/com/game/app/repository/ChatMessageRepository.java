package com.game.app.repository;

import java.util.List;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

import com.game.app.model.ChatMessageEntity;

public interface ChatMessageRepository extends JpaRepository<ChatMessageEntity, Long> {

  @Query("""
      SELECT m FROM ChatMessageEntity m
      WHERE (m.fromUsername = :userA AND m.toUsername = :userB)
         OR (m.fromUsername = :userB AND m.toUsername = :userA)
      ORDER BY m.createdAt ASC
      """)
  List<ChatMessageEntity> findConversation(String userA, String userB);
}
