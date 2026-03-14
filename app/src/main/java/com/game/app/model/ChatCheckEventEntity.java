package com.game.app.model;

import java.time.Instant;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.PrePersist;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;

@Entity
@Table(
    name = "chat_check_events",
    uniqueConstraints = @UniqueConstraint(columnNames = { "sender_username", "receiver_username" }))
public class ChatCheckEventEntity {

  @Id
  @GeneratedValue(strategy = GenerationType.IDENTITY)
  private Long id;

  @Column(name = "sender_username", nullable = false, length = 60)
  private String senderUsername;

  @Column(name = "receiver_username", nullable = false, length = 60)
  private String receiverUsername;

  @Column(name = "check_count", nullable = false)
  private int checkCount = 0;

  @Column(name = "last_checked_at")
  private Instant lastCheckedAt;

  @Column(name = "last_offline_at")
  private Instant lastOfflineAt;

  @Column(name = "notified", nullable = false)
  private boolean notified = false;

  @Column(name = "consumed", nullable = false)
  private boolean consumed = false;

  @Column(name = "active", nullable = false)
  private boolean active = false;

  @Column(name = "created_at", nullable = false, updatable = false)
  private Instant createdAt;

  @PrePersist
  public void prePersist() {
    if (createdAt == null) {
      createdAt = Instant.now();
    }
  }

  public Long getId() {
    return id;
  }

  public String getSenderUsername() {
    return senderUsername;
  }

  public void setSenderUsername(String senderUsername) {
    this.senderUsername = senderUsername;
  }

  public String getReceiverUsername() {
    return receiverUsername;
  }

  public void setReceiverUsername(String receiverUsername) {
    this.receiverUsername = receiverUsername;
  }

  public int getCheckCount() {
    return checkCount;
  }

  public void setCheckCount(int checkCount) {
    this.checkCount = checkCount;
  }

  public Instant getLastCheckedAt() {
    return lastCheckedAt;
  }

  public void setLastCheckedAt(Instant lastCheckedAt) {
    this.lastCheckedAt = lastCheckedAt;
  }

  public Instant getLastOfflineAt() {
    return lastOfflineAt;
  }

  public void setLastOfflineAt(Instant lastOfflineAt) {
    this.lastOfflineAt = lastOfflineAt;
  }

  public boolean isNotified() {
    return notified;
  }

  public void setNotified(boolean notified) {
    this.notified = notified;
  }

  public boolean isConsumed() {
    return consumed;
  }

  public void setConsumed(boolean consumed) {
    this.consumed = consumed;
  }

  public boolean isActive() {
    return active;
  }

  public void setActive(boolean active) {
    this.active = active;
  }
}
