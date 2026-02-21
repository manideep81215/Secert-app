package com.game.app.repository;

import java.util.List;
import java.util.Optional;

import org.springframework.data.jpa.repository.JpaRepository;

import com.game.app.model.MobilePushTokenEntity;

public interface MobilePushTokenRepository extends JpaRepository<MobilePushTokenEntity, Long> {

  List<MobilePushTokenEntity> findByUsername(String username);

  Optional<MobilePushTokenEntity> findByToken(String token);

  long deleteByUsernameAndToken(String username, String token);

  long deleteByUsernameAndPlatformAndTokenNot(String username, String platform, String token);
}
