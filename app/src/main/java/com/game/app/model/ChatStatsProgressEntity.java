package com.game.app.model;

import java.time.Instant;

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
    name = "chat_stats_progress",
    uniqueConstraints = @UniqueConstraint(columnNames = { "user_low", "user_high", "viewer_username" }))
public class ChatStatsProgressEntity {

  @Id
  @GeneratedValue(strategy = GenerationType.IDENTITY)
  private Long id;

  @Column(name = "user_low", nullable = false, length = 60)
  private String userLow;

  @Column(name = "user_high", nullable = false, length = 60)
  private String userHigh;

  @Column(name = "viewer_username", length = 60)
  private String viewerUsername;

  @Column(name = "last_message_total", nullable = false)
  private long lastMessageTotal = 0L;

  @Column(name = "updated_at", nullable = false)
  private Instant updatedAt;

  @PrePersist
  public void prePersist() {
    if (updatedAt == null) {
      updatedAt = Instant.now();
    }
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

  public long getLastMessageTotal() {
    return lastMessageTotal;
  }

  public String getViewerUsername() {
    return viewerUsername;
  }

  public void setViewerUsername(String viewerUsername) {
    this.viewerUsername = viewerUsername;
  }

  public void setLastMessageTotal(long lastMessageTotal) {
    this.lastMessageTotal = Math.max(0L, lastMessageTotal);
  }

  public Instant getUpdatedAt() {
    return updatedAt;
  }
}
