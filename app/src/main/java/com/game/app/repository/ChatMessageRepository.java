package com.game.app.repository;

import java.time.Instant;
import java.util.List;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import com.game.app.model.ChatMessageEntity;

public interface ChatMessageRepository extends JpaRepository<ChatMessageEntity, Long> {

  @Query("""
      SELECT m FROM ChatMessageEntity m
      WHERE (m.fromUsername = :userA AND m.toUsername = :userB)
         OR (m.fromUsername = :userB AND m.toUsername = :userA)
      ORDER BY m.createdAt ASC
      """)
  List<ChatMessageEntity> findConversation(String userA, String userB);

  @Modifying
  @Query("""
      DELETE FROM ChatMessageEntity m
      WHERE m.createdAt < :cutoff
        AND (m.type IS NULL OR TRIM(m.type) = '' OR LOWER(TRIM(m.type)) = 'text')
        AND (m.mediaUrl IS NULL OR TRIM(m.mediaUrl) = '')
      """)
  int deleteTextOnlyMessagesOlderThan(@Param("cutoff") Instant cutoff);
}
