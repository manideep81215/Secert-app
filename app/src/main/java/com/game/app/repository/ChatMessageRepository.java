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

  boolean existsByMediaUrlEndingWith(String suffix);

  @Query("""
      SELECT m.mediaUrl FROM ChatMessageEntity m
      WHERE m.createdAt < :cutoff
        AND LOWER(COALESCE(m.type, '')) = 'voice'
        AND m.mediaUrl IS NOT NULL
        AND m.mediaUrl <> ''
      """)
  List<String> findVoiceMediaUrlsOlderThan(@Param("cutoff") Instant cutoff);

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
        AND LOWER(TRIM(COALESCE(m.type, 'text'))) <> 'secret-tap'
        AND m.id = (
          SELECT m2.id
          FROM chat_messages m2
          WHERE (m2.from_username = :username OR m2.to_username = :username)
            AND LOWER(TRIM(COALESCE(m2.type, 'text'))) <> 'secret-tap'
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

  @Query("""
      SELECT COUNT(m) FROM ChatMessageEntity m
      WHERE ((m.fromUsername = :u1 AND m.toUsername = :u2)
         OR (m.fromUsername = :u2 AND m.toUsername = :u1))
      """)
  Long countMessagesBetween(@Param("u1") String userOne, @Param("u2") String userTwo);

  @Query("""
      SELECT COUNT(m) FROM ChatMessageEntity m
      WHERE ((m.fromUsername = :u1 AND m.toUsername = :u2)
         OR (m.fromUsername = :u2 AND m.toUsername = :u1))
        AND m.createdAt >= :startDate
      """)
  Long countMessagesBetweenSince(
      @Param("u1") String userOne,
      @Param("u2") String userTwo,
      @Param("startDate") Instant startDate);

  @Query("""
      SELECT COUNT(m) FROM ChatMessageEntity m
      WHERE ((m.fromUsername = :u1 AND m.toUsername = :u2)
         OR (m.fromUsername = :u2 AND m.toUsername = :u1))
        AND m.createdAt >= :startDate
        AND m.createdAt < :endDate
      """)
  Long countMessagesBetweenRange(
      @Param("u1") String userOne,
      @Param("u2") String userTwo,
      @Param("startDate") Instant startDate,
      @Param("endDate") Instant endDate);

  @Query("""
      SELECT COUNT(m) FROM ChatMessageEntity m
      WHERE ((m.fromUsername = :u1 AND m.toUsername = :u2)
         OR (m.fromUsername = :u2 AND m.toUsername = :u1))
        AND LOWER(COALESCE(m.type, '')) = :type
      """)
  Long countMessagesByTypeBetween(
      @Param("u1") String userOne,
      @Param("u2") String userTwo,
      @Param("type") String type);

  @Query("""
      SELECT COUNT(m) FROM ChatMessageEntity m
      WHERE ((m.fromUsername = :u1 AND m.toUsername = :u2)
         OR (m.fromUsername = :u2 AND m.toUsername = :u1))
        AND LOWER(COALESCE(m.type, '')) = :type
        AND m.createdAt >= :startDate
      """)
  Long countMessagesByTypeBetweenSince(
      @Param("u1") String userOne,
      @Param("u2") String userTwo,
      @Param("type") String type,
      @Param("startDate") Instant startDate);

  @Query("""
      SELECT COUNT(m) FROM ChatMessageEntity m
      WHERE ((m.fromUsername = :u1 AND m.toUsername = :u2)
         OR (m.fromUsername = :u2 AND m.toUsername = :u1))
        AND LOWER(COALESCE(m.type, '')) = :type
        AND m.createdAt >= :startDate
        AND m.createdAt < :endDate
      """)
  Long countMessagesByTypeBetweenRange(
      @Param("u1") String userOne,
      @Param("u2") String userTwo,
      @Param("type") String type,
      @Param("startDate") Instant startDate,
      @Param("endDate") Instant endDate);

  @Query(value = """
      SELECT DISTINCT DATE(m.created_at)
      FROM chat_messages m
      WHERE ((m.from_username = :u1 AND m.to_username = :u2)
         OR (m.from_username = :u2 AND m.to_username = :u1))
      ORDER BY DATE(m.created_at) DESC
      """, nativeQuery = true)
  List<java.sql.Date> findDistinctTalkDates(
      @Param("u1") String userOne,
      @Param("u2") String userTwo);

  @Query("""
      SELECT MIN(m.createdAt) FROM ChatMessageEntity m
      WHERE ((m.fromUsername = :u1 AND m.toUsername = :u2)
         OR (m.fromUsername = :u2 AND m.toUsername = :u1))
      """)
  Instant findFirstMessageAt(
      @Param("u1") String userOne,
      @Param("u2") String userTwo);

  @Query(value = """
      SELECT YEAR(m.created_at) AS year_value, MONTH(m.created_at) AS month_value, COUNT(*) AS message_count
      FROM chat_messages m
      WHERE ((m.from_username = :u1 AND m.to_username = :u2)
         OR (m.from_username = :u2 AND m.to_username = :u1))
      GROUP BY YEAR(m.created_at), MONTH(m.created_at)
      ORDER BY YEAR(m.created_at) DESC, MONTH(m.created_at) DESC
      LIMIT 24
      """, nativeQuery = true)
  List<Object[]> findMonthlyMessageCounts(
      @Param("u1") String userOne,
      @Param("u2") String userTwo);

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
