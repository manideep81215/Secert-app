package com.game.app.model;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;

@Entity
@Table(
    name = "chat_read_receipts",
    uniqueConstraints = @UniqueConstraint(columnNames = {"readerUsername", "peerUsername"}))
public class ChatReadReceiptEntity {

  @Id
  @GeneratedValue(strategy = GenerationType.IDENTITY)
  private Long id;

  @Column(nullable = false, length = 60)
  private String readerUsername;

  @Column(nullable = false, length = 60)
  private String peerUsername;

  @Column(nullable = false)
  private Long lastReadAt;

  public Long getId() {
    return id;
  }

  public String getReaderUsername() {
    return readerUsername;
  }

  public void setReaderUsername(String readerUsername) {
    this.readerUsername = readerUsername;
  }

  public String getPeerUsername() {
    return peerUsername;
  }

  public void setPeerUsername(String peerUsername) {
    this.peerUsername = peerUsername;
  }

  public Long getLastReadAt() {
    return lastReadAt;
  }

  public void setLastReadAt(Long lastReadAt) {
    this.lastReadAt = lastReadAt;
  }
}
