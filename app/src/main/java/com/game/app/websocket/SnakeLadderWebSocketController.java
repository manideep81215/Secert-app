package com.game.app.websocket;

import java.security.Principal;
import java.time.Instant;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ThreadLocalRandom;

import org.springframework.context.event.EventListener;
import org.springframework.messaging.handler.annotation.MessageMapping;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Controller;
import org.springframework.web.socket.messaging.SessionDisconnectEvent;

@Controller
public class SnakeLadderWebSocketController {

  private static final String USER_QUEUE = "/queue/snl.events";
  private static final String ROOM_TOPIC_PREFIX = "/topic/snl.room.";

  private final SimpMessagingTemplate messagingTemplate;
  private final Map<String, RoomState> rooms = new ConcurrentHashMap<>();

  public SnakeLadderWebSocketController(SimpMessagingTemplate messagingTemplate) {
    this.messagingTemplate = messagingTemplate;
  }

  @MessageMapping("/snl.create")
  public void createRoom(SnlCreateRequest payload, Principal principal) {
    String username = normalizeUsername(principal != null ? principal.getName() : null);
    if (username.isBlank()) return;

    String difficulty = normalizeDifficulty(payload != null ? payload.difficulty() : null);
    String preferredRoomId = payload != null ? payload.roomId() : null;
    String roomId = preferredRoomId == null || preferredRoomId.isBlank() ? generateRoomId() : sanitizeRoomId(preferredRoomId);
    if (roomId.isBlank()) {
      sendUserError(username, null, "Invalid room code.");
      return;
    }

    RoomState state = new RoomState(roomId, difficulty, username);
    RoomState existing = rooms.putIfAbsent(roomId, state);
    if (existing != null) {
      sendUserError(username, roomId, "Room code already exists.");
      return;
    }

    sendUserEvent(username, "room_created", roomId, difficulty, "host", "Room created.");
    broadcastState(state, "Waiting for opponent to join.");
  }

  @MessageMapping("/snl.join")
  public void joinRoom(SnlJoinRequest payload, Principal principal) {
    String username = normalizeUsername(principal != null ? principal.getName() : null);
    if (username.isBlank()) return;

    String roomId = sanitizeRoomId(payload != null ? payload.roomId() : null);
    if (roomId.isBlank()) {
      sendUserError(username, null, "Enter a valid room code.");
      return;
    }

    RoomState state = rooms.get(roomId);
    if (state == null) {
      sendUserError(username, roomId, "Room not found.");
      return;
    }

    synchronized (state) {
      if (username.equals(state.hostUsername())) {
        sendUserEvent(username, "room_joined", roomId, state.difficulty(), "host", "Rejoined room.");
      } else if (username.equals(state.guestUsername())) {
        sendUserEvent(username, "room_joined", roomId, state.difficulty(), "guest", "Rejoined room.");
      } else if (state.guestUsername().isBlank()) {
        state.setGuestUsername(username);
        state.setUpdatedAt(Instant.now().toEpochMilli());
        sendUserEvent(username, "room_joined", roomId, state.difficulty(), "guest", "Joined room.");
      } else {
        sendUserError(username, roomId, "Room is full.");
        return;
      }

      if (!state.hostUsername().isBlank() && !state.guestUsername().isBlank()) {
        state.setTurnUsername(state.hostUsername());
        state.setMessage("Both players connected. Host rolls first.");
      }
      broadcastState(state, state.message());
    }
  }

  @MessageMapping("/snl.roll")
  public void rollDice(SnlRoomRequest payload, Principal principal) {
    String username = normalizeUsername(principal != null ? principal.getName() : null);
    if (username.isBlank()) return;

    String roomId = sanitizeRoomId(payload != null ? payload.roomId() : null);
    if (roomId.isBlank()) {
      sendUserError(username, null, "Invalid room code.");
      return;
    }

    RoomState state = rooms.get(roomId);
    if (state == null) {
      sendUserError(username, roomId, "Room not found.");
      return;
    }

    synchronized (state) {
      if (!username.equals(state.hostUsername()) && !username.equals(state.guestUsername())) {
        sendUserError(username, roomId, "You are not a player in this room.");
        return;
      }
      if (state.guestUsername().isBlank()) {
        sendUserError(username, roomId, "Waiting for opponent to join.");
        return;
      }
      if (!state.winnerUsername().isBlank()) {
        sendUserError(username, roomId, "Game already finished.");
        return;
      }
      if (!username.equals(state.turnUsername())) {
        sendUserError(username, roomId, "Not your turn.");
        return;
      }

      int roll = randomDice();
      int current = username.equals(state.hostUsername()) ? state.hostPosition() : state.guestPosition();
      int moved = current + roll;
      int landing = moved > 100 ? current : moved;
      int finalCell = state.jumpMap().getOrDefault(landing, landing);

      if (username.equals(state.hostUsername())) {
        state.setHostPosition(finalCell);
      } else {
        state.setGuestPosition(finalCell);
      }

      state.setLastRoll(roll);
      state.setRolledBy(username);
      state.setUpdatedAt(Instant.now().toEpochMilli());

      if (finalCell == 100) {
        state.setWinnerUsername(username);
        state.setTurnUsername("");
        state.setMessage(username + " won the game.");
      } else {
        String nextTurn = username.equals(state.hostUsername()) ? state.guestUsername() : state.hostUsername();
        state.setTurnUsername(nextTurn);
        if (moved > 100) {
          state.setMessage(username + " rolled " + roll + ". Need exact number for 100.");
        } else if (finalCell != landing) {
          state.setMessage(username + " rolled " + roll + ". Jumped from " + landing + " to " + finalCell + ".");
        } else {
          state.setMessage(username + " rolled " + roll + ". Moved to " + finalCell + ".");
        }
      }

      broadcastState(state, state.message());
    }
  }

  @MessageMapping("/snl.leave")
  public void leaveRoom(SnlRoomRequest payload, Principal principal) {
    String username = normalizeUsername(principal != null ? principal.getName() : null);
    if (username.isBlank()) return;

    String roomId = sanitizeRoomId(payload != null ? payload.roomId() : null);
    if (roomId.isBlank()) return;

    RoomState state = rooms.get(roomId);
    if (state == null) return;

    synchronized (state) {
      removePlayerFromRoom(state, username);
    }
  }

  @EventListener
  public void onDisconnect(SessionDisconnectEvent event) {
    Principal principal = event.getUser();
    if (principal == null) return;

    String username = normalizeUsername(principal.getName());
    if (username.isBlank()) return;

    for (RoomState state : rooms.values()) {
      synchronized (state) {
        removePlayerFromRoom(state, username);
      }
    }
  }

  private void removePlayerFromRoom(RoomState state, String username) {
    boolean changed = false;
    if (username.equals(state.hostUsername())) {
      if (!state.guestUsername().isBlank()) {
        state.setHostUsername(state.guestUsername());
        state.setGuestUsername("");
      } else {
        state.setHostUsername("");
      }
      changed = true;
    } else if (username.equals(state.guestUsername())) {
      state.setGuestUsername("");
      changed = true;
    }

    if (!changed) return;

    if (state.hostUsername().isBlank() && state.guestUsername().isBlank()) {
      rooms.remove(state.roomId());
      return;
    }

    state.resetGame();
    state.setUpdatedAt(Instant.now().toEpochMilli());
    state.setMessage("A player left. Waiting for opponent.");
    broadcastState(state, state.message());
  }

  private void broadcastState(RoomState state, String message) {
    messagingTemplate.convertAndSend(
        ROOM_TOPIC_PREFIX + state.roomId(),
        new SnlStateEvent(
            "state",
            state.roomId(),
            state.difficulty(),
            state.hostUsername(),
            state.guestUsername(),
            state.hostPosition(),
            state.guestPosition(),
            state.turnUsername(),
            state.winnerUsername(),
            state.lastRoll(),
            state.rolledBy(),
            state.updatedAt(),
            message));
  }

  private void sendUserEvent(String username, String type, String roomId, String difficulty, String role, String message) {
    messagingTemplate.convertAndSendToUser(
        username,
        USER_QUEUE,
        new SnlUserEvent(type, roomId, difficulty, role, message));
  }

  private void sendUserError(String username, String roomId, String message) {
    sendUserEvent(username, "error", roomId, null, null, message);
  }

  private int randomDice() {
    return ThreadLocalRandom.current().nextInt(1, 7);
  }

  private String normalizeUsername(String value) {
    return value == null ? "" : value.trim().toLowerCase(Locale.ROOT);
  }

  private String sanitizeRoomId(String roomId) {
    if (roomId == null) return "";
    return roomId.trim().toUpperCase(Locale.ROOT).replaceAll("[^A-Z0-9]", "");
  }

  private String generateRoomId() {
    return UUID.randomUUID().toString().replace("-", "").substring(0, 6).toUpperCase(Locale.ROOT);
  }

  private String normalizeDifficulty(String value) {
    if (value == null) return "medium";
    String normalized = value.trim().toLowerCase(Locale.ROOT);
    if (!"easy".equals(normalized) && !"medium".equals(normalized) && !"hard".equals(normalized)) {
      return "medium";
    }
    return normalized;
  }

  private Map<Integer, Integer> buildJumpMap(String difficulty) {
    Map<Integer, Integer> map = new HashMap<>();

    if ("easy".equals(difficulty)) {
      addPairs(map, new int[][] {
          {3, 21}, {8, 30}, {28, 55}, {36, 63}, {51, 72}, {71, 92},
          {25, 5}, {49, 29}, {67, 47}, {88, 66}, {96, 76},
      });
      return map;
    }

    if ("hard".equals(difficulty)) {
      addPairs(map, new int[][] {
          {2, 12}, {11, 26}, {22, 40}, {45, 64}, {70, 88},
          {17, 4}, {31, 10}, {43, 21}, {57, 36}, {69, 49}, {78, 54}, {87, 60}, {95, 72}, {99, 80},
      });
      return map;
    }

    addPairs(map, new int[][] {
        {4, 14}, {9, 31}, {21, 42}, {28, 50}, {40, 61}, {63, 84},
        {19, 7}, {35, 16}, {48, 27}, {66, 45}, {79, 58}, {93, 73}, {98, 79},
    });
    return map;
  }

  private void addPairs(Map<Integer, Integer> map, int[][] pairs) {
    for (int[] pair : pairs) {
      map.put(pair[0], pair[1]);
    }
  }

  public record SnlCreateRequest(String roomId, String difficulty) {}

  public record SnlJoinRequest(String roomId) {}

  public record SnlRoomRequest(String roomId) {}

  public record SnlUserEvent(String type, String roomId, String difficulty, String role, String message) {}

  public record SnlStateEvent(
      String type,
      String roomId,
      String difficulty,
      String hostUsername,
      String guestUsername,
      Integer hostPosition,
      Integer guestPosition,
      String turnUsername,
      String winnerUsername,
      Integer lastRoll,
      String rolledBy,
      Long updatedAt,
      String message) {}

  private final class RoomState {
    private final String roomId;
    private final String difficulty;
    private final Map<Integer, Integer> jumpMap;

    private String hostUsername;
    private String guestUsername;
    private int hostPosition;
    private int guestPosition;
    private String turnUsername;
    private String winnerUsername;
    private Integer lastRoll;
    private String rolledBy;
    private Long updatedAt;
    private String message;

    private RoomState(String roomId, String difficulty, String hostUsername) {
      this.roomId = roomId;
      this.difficulty = difficulty;
      this.jumpMap = buildJumpMap(difficulty);
      this.hostUsername = hostUsername;
      this.guestUsername = "";
      this.hostPosition = 1;
      this.guestPosition = 1;
      this.turnUsername = hostUsername;
      this.winnerUsername = "";
      this.lastRoll = null;
      this.rolledBy = "";
      this.updatedAt = Instant.now().toEpochMilli();
      this.message = "Room created.";
    }

    private void resetGame() {
      this.hostPosition = 1;
      this.guestPosition = 1;
      this.turnUsername = hostUsername;
      this.winnerUsername = "";
      this.lastRoll = null;
      this.rolledBy = "";
    }

    private String roomId() { return roomId; }

    private String difficulty() { return difficulty; }

    private Map<Integer, Integer> jumpMap() { return jumpMap; }

    private String hostUsername() { return hostUsername == null ? "" : hostUsername; }

    private void setHostUsername(String hostUsername) { this.hostUsername = hostUsername; }

    private String guestUsername() { return guestUsername == null ? "" : guestUsername; }

    private void setGuestUsername(String guestUsername) { this.guestUsername = guestUsername; }

    private int hostPosition() { return hostPosition; }

    private void setHostPosition(int hostPosition) { this.hostPosition = hostPosition; }

    private int guestPosition() { return guestPosition; }

    private void setGuestPosition(int guestPosition) { this.guestPosition = guestPosition; }

    private String turnUsername() { return turnUsername == null ? "" : turnUsername; }

    private void setTurnUsername(String turnUsername) { this.turnUsername = turnUsername; }

    private String winnerUsername() { return winnerUsername == null ? "" : winnerUsername; }

    private void setWinnerUsername(String winnerUsername) { this.winnerUsername = winnerUsername; }

    private Integer lastRoll() { return lastRoll; }

    private void setLastRoll(Integer lastRoll) { this.lastRoll = lastRoll; }

    private String rolledBy() { return rolledBy == null ? "" : rolledBy; }

    private void setRolledBy(String rolledBy) { this.rolledBy = rolledBy; }

    private Long updatedAt() { return updatedAt; }

    private void setUpdatedAt(Long updatedAt) { this.updatedAt = updatedAt; }

    private String message() { return message == null ? "" : message; }

    private void setMessage(String message) { this.message = message; }
  }
}
