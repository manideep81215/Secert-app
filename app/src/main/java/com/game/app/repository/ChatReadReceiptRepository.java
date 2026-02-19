package com.game.app.repository;

import java.util.List;
import java.util.Optional;

import org.springframework.data.jpa.repository.JpaRepository;

import com.game.app.model.ChatReadReceiptEntity;

public interface ChatReadReceiptRepository extends JpaRepository<ChatReadReceiptEntity, Long> {

  Optional<ChatReadReceiptEntity> findByReaderUsernameAndPeerUsername(String readerUsername, String peerUsername);

  List<ChatReadReceiptEntity> findByPeerUsername(String peerUsername);
}
