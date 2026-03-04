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
  @Query(value = """
      DELETE FROM chat_messages
      WHERE created_at < :cutoff
        AND (type IS NULL OR TRIM(type) = '' OR LOWER(TRIM(type)) = 'text')
        AND (media_url IS NULL OR media_url = '')
      """, nativeQuery = true)
  int deleteTextOnlyMessagesOlderThan(@Param("cutoff") Instant cutoff);
}
