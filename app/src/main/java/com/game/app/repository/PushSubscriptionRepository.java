package com.game.app.repository;

import java.util.List;
import java.util.Optional;

import org.springframework.data.jpa.repository.JpaRepository;

import com.game.app.model.PushSubscriptionEntity;

public interface PushSubscriptionRepository extends JpaRepository<PushSubscriptionEntity, Long> {

  List<PushSubscriptionEntity> findByUsername(String username);

  Optional<PushSubscriptionEntity> findByEndpoint(String endpoint);

  long deleteByUsernameAndEndpoint(String username, String endpoint);
}
