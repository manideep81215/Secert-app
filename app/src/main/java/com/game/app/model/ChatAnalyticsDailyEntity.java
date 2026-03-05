package com.game.app.model;

import java.time.Instant;
import java.time.LocalDate;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.PrePersist;
import jakarta.persistence.PreUpdate;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;

@Entity
@Table(
    name = "chat_analytics_daily",
    uniqueConstraints = @UniqueConstraint(columnNames = { "user_low", "user_high", "talk_date" }))
public class ChatAnalyticsDailyEntity {

  @Id
  @GeneratedValue(strategy = GenerationType.IDENTITY)
  private Long id;

  @Column(name = "user_low", nullable = false, length = 60)
  private String userLow;

  @Column(name = "user_high", nullable = false, length = 60)
  private String userHigh;

  @Column(name = "talk_date", nullable = false)
  private LocalDate talkDate;

  @Column(name = "message_count", nullable = false)
  private long messageCount = 0L;

  @Column(name = "image_count", nullable = false)
  private long imageCount = 0L;

  @Column(name = "video_count", nullable = false)
  private long videoCount = 0L;

  @Column(name = "voice_count", nullable = false)
  private long voiceCount = 0L;

  @Column(name = "created_at", nullable = false)
  private Instant createdAt;

  @Column(name = "updated_at", nullable = false)
  private Instant updatedAt;

  @PrePersist
  public void prePersist() {
    Instant now = Instant.now();
    if (createdAt == null) {
      createdAt = now;
    }
    updatedAt = now;
  }

  @PreUpdate
  public void preUpdate() {
    updatedAt = Instant.now();
  }

  public Long getId() {
    return id;
  }

  public String getUserLow() {
    return userLow;
  }

  public void setUserLow(String userLow) {
    this.userLow = userLow;
  }

  public String getUserHigh() {
    return userHigh;
  }

  public void setUserHigh(String userHigh) {
    this.userHigh = userHigh;
  }

  public LocalDate getTalkDate() {
    return talkDate;
  }

  public void setTalkDate(LocalDate talkDate) {
    this.talkDate = talkDate;
  }

  public long getMessageCount() {
    return messageCount;
  }

  public long getImageCount() {
    return imageCount;
  }

  public long getVideoCount() {
    return videoCount;
  }

  public long getVoiceCount() {
    return voiceCount;
  }

  public void increment(String type) {
    messageCount += 1L;
    String normalizedType = type == null ? "" : type.trim().toLowerCase();
    if ("image".equals(normalizedType)) {
      imageCount += 1L;
    } else if ("video".equals(normalizedType)) {
      videoCount += 1L;
    } else if ("voice".equals(normalizedType)) {
      voiceCount += 1L;
    }
  }
}
