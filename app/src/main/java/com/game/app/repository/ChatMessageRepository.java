package com.game.app.repository;

import java.time.Instant;
import java.util.List;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
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

  @Query("""
      SELECT m FROM ChatMessageEntity m
      WHERE (m.fromUsername = :userA AND m.toUsername = :userB)
         OR (m.fromUsername = :userB AND m.toUsername = :userA)
      ORDER BY m.createdAt DESC
      """)
  Page<ChatMessageEntity> findConversationPage(String userA, String userB, Pageable pageable);

  @Query(value = """
      SELECT m.*
      FROM chat_messages m
      WHERE (m.from_username = :username OR m.to_username = :username)
        AND m.id = (
          SELECT m2.id
          FROM chat_messages m2
          WHERE (m2.from_username = :username OR m2.to_username = :username)
            AND (
              CASE
                WHEN m2.from_username = :username THEN m2.to_username
                ELSE m2.from_username
              END
            ) = (
              CASE
                WHEN m.from_username = :username THEN m.to_username
                ELSE m.from_username
              END
            )
          ORDER BY m2.created_at DESC, m2.id DESC
          LIMIT 1
        )
      ORDER BY m.created_at DESC, m.id DESC
      """, nativeQuery = true)
  List<ChatMessageEntity> findLatestMessagesByPeer(@Param("username") String username);

  @Modifying
  @Query(value = """
      DELETE FROM chat_messages
      WHERE created_at < :cutoff
        AND (
          (
            type IS NULL
            OR TRIM(type) = ''
            OR LOWER(TRIM(type)) = 'text'
          )
          AND (media_url IS NULL OR media_url = '')
          OR LOWER(TRIM(type)) = 'voice'
        )
      """, nativeQuery = true)
  int deleteTextAndVoiceMessagesOlderThan(@Param("cutoff") Instant cutoff);
}
