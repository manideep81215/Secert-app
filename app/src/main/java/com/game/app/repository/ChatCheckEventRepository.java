package com.game.app.repository;

import java.util.List;
import java.util.Optional;

import org.springframework.data.jpa.repository.JpaRepository;

import com.game.app.model.ChatCheckEventEntity;

public interface ChatCheckEventRepository extends JpaRepository<ChatCheckEventEntity, Long> {

  Optional<ChatCheckEventEntity> findBySenderUsernameAndReceiverUsername(String senderUsername, String receiverUsername);

  List<ChatCheckEventEntity> findByReceiverUsername(String receiverUsername);

  List<ChatCheckEventEntity> findByReceiverUsernameAndActiveTrue(String receiverUsername);
}
