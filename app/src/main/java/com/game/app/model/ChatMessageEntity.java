package com.game.app.model;

import java.time.Instant;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Lob;
import jakarta.persistence.PrePersist;
import jakarta.persistence.Table;

@Entity
@Table(name = "chat_messages")
public class ChatMessageEntity {

  @Id
  @GeneratedValue(strategy = GenerationType.IDENTITY)
  private Long id;

  @Column(nullable = false, length = 60)
  private String fromUsername;

  @Column(nullable = false, length = 60)
  private String toUsername;

  @Lob
  @Column(columnDefinition = "LONGTEXT", nullable = false)
  private String message;

  @Column(length = 20)
  private String type;

  @Column(length = 255)
  private String fileName;

  @Lob
  @Column(columnDefinition = "LONGTEXT")
  private String mediaUrl;

  @Column(length = 120)
  private String mimeType;

  @Lob
  @Column(columnDefinition = "LONGTEXT")
  private String replyText;

  @Column(length = 60)
  private String replySenderName;

  @Column(nullable = false, updatable = false)
  private Instant createdAt;

  @Column(nullable = false)
  private boolean edited = false;

  @Column
  private Instant editedAt;

  @PrePersist
  public void prePersist() {
    if (createdAt == null) {
      createdAt = Instant.now();
    }
  }

  public Long getId() {
    return id;
  }

  public String getFromUsername() {
    return fromUsername;
  }

  public void setFromUsername(String fromUsername) {
    this.fromUsername = fromUsername;
  }

  public String getToUsername() {
    return toUsername;
  }

  public void setToUsername(String toUsername) {
    this.toUsername = toUsername;
  }

  public String getMessage() {
    return message;
  }

  public void setMessage(String message) {
    this.message = message;
  }

  public String getType() {
    return type;
  }

  public void setType(String type) {
    this.type = type;
  }

  public String getFileName() {
    return fileName;
  }

  public void setFileName(String fileName) {
    this.fileName = fileName;
  }

  public String getMediaUrl() {
    return mediaUrl;
  }

  public void setMediaUrl(String mediaUrl) {
    this.mediaUrl = mediaUrl;
  }

  public String getMimeType() {
    return mimeType;
  }

  public void setMimeType(String mimeType) {
    this.mimeType = mimeType;
  }

  public String getReplyText() {
    return replyText;
  }

  public void setReplyText(String replyText) {
    this.replyText = replyText;
  }

  public String getReplySenderName() {
    return replySenderName;
  }

  public void setReplySenderName(String replySenderName) {
    this.replySenderName = replySenderName;
  }

  public Instant getCreatedAt() {
    return createdAt;
  }

  public boolean isEdited() {
    return edited;
  }

  public void setEdited(boolean edited) {
    this.edited = edited;
  }

  public Instant getEditedAt() {
    return editedAt;
  }

  public void setEditedAt(Instant editedAt) {
    this.editedAt = editedAt;
  }
}
