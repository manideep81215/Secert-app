package com.game.app.repository;

import org.springframework.data.jpa.repository.JpaRepository;

import com.game.app.model.ChatMediaEntity;

public interface ChatMediaRepository extends JpaRepository<ChatMediaEntity, Long> {
}
