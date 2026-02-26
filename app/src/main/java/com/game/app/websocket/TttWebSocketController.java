package com.game.app.websocket;

import java.security.Principal;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

import org.springframework.context.event.EventListener;
import org.springframework.messaging.handler.annotation.MessageMapping;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Controller;
import org.springframework.web.socket.messaging.SessionDisconnectEvent;

@Controller
public class TttWebSocketController {

  private static final String USER_QUEUE = "/queue/ttt.events";
  private static final String ROOM_TOPIC_PREFIX = "/topic/ttt.room.";

  private final SimpMessagingTemplate messagingTemplate;
  private final Map<String, RoomState> rooms = new ConcurrentHashMap<>();

  public TttWebSocketController(SimpMessagingTemplate messagingTemplate) {
    this.messagingTemplate = messagingTemplate;
  }

  @MessageMapping("/ttt.create")
  public void createRoom(TttCreateRequest payload, Principal principal) {
    String username = normalizeUsername(principal != null ? principal.getName() : null);
    if (username.isBlank()) {
      return;
    }

    int size = normalizeSize(payload != null ? payload.size() : null);
    String preferredId = payload != null ? payload.roomId() : null;
    String roomId = preferredId == null || preferredId.isBlank() ? generateRoomId() : sanitizeRoomId(preferredId);

    if (roomId.isBlank()) {
      sendUserError(username, null, "Invalid room id.");
      return;
    }

    RoomState state = new RoomState(roomId, size, username);
    RoomState existing = rooms.putIfAbsent(roomId, state);
    if (existing != null) {
      sendUserError(username, roomId, "Room id already exists. Try another code.");
      return;
    }

    sendUserEvent(username, "room_created", "Room created.", roomId, size, "X", snapshot(state));
    broadcastState(state, "Waiting for opponent to join.");
  }

  @MessageMapping("/ttt.join")
  public void joinRoom(TttJoinRequest payload, Principal principal) {
    String username = normalizeUsername(principal != null ? principal.getName() : null);
    if (username.isBlank()) {
      return;
    }
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
      if (username.equals(state.xPlayer())) {
        sendUserEvent(username, "room_joined", "Rejoined room.", roomId, state.size(), "X", snapshot(state));
      } else if (username.equals(state.oPlayer())) {
        sendUserEvent(username, "room_joined", "Rejoined room.", roomId, state.size(), "O", snapshot(state));
      } else if (state.oPlayer() == null || state.oPlayer().isBlank()) {
        state.setOPlayer(username);
        state.setUpdatedAt(Instant.now().toEpochMilli());
        sendUserEvent(username, "room_joined", "Joined as O.", roomId, state.size(), "O", snapshot(state));
      } else {
        sendUserError(username, roomId, "Room is full.");
        return;
      }

      if (state.xPlayer() != null && !state.xPlayer().isBlank() && state.oPlayer() != null && !state.oPlayer().isBlank()) {
        broadcastState(state, "Both players connected.");
      } else {
        broadcastState(state, "Waiting for opponent to join.");
      }
    }
  }

  @MessageMapping("/ttt.move")
  public void makeMove(TttMoveRequest payload, Principal principal) {
    String username = normalizeUsername(principal != null ? principal.getName() : null);
    if (username.isBlank() || payload == null) {
      return;
    }

    String roomId = sanitizeRoomId(payload.roomId());
    Integer index = payload.index();
    if (roomId.isBlank() || index == null) {
      sendUserError(username, roomId, "Invalid move request.");
      return;
    }

    RoomState state = rooms.get(roomId);
    if (state == null) {
      sendUserError(username, roomId, "Room not found.");
      return;
    }

    synchronized (state) {
      if (state.oPlayer() == null || state.oPlayer().isBlank()) {
        sendUserError(username, roomId, "Waiting for opponent to join.");
        return;
      }
      String mark = markForUser(state, username);
      if (mark == null) {
        sendUserError(username, roomId, "You are not a player in this room.");
        return;
      }
      if (state.winner() != null && !state.winner().isBlank()) {
        sendUserError(username, roomId, "Game already finished. Start a new room.");
        return;
      }
      if (!Objects.equals(state.turn(), mark)) {
        sendUserError(username, roomId, "Not your turn.");
        return;
      }

      int maxIndex = state.size() * state.size() - 1;
      if (index < 0 || index > maxIndex) {
        sendUserError(username, roomId, "Move is out of range.");
        return;
      }
      if (state.board().get(index) != null && !state.board().get(index).isBlank()) {
        sendUserError(username, roomId, "Cell already used.");
        return;
      }

      state.board().set(index, mark);
      state.setLastMoveIndex(index);
      state.setUpdatedAt(Instant.now().toEpochMilli());

      String winner = getWinner(state.board(), state.size());
      if (!winner.isBlank()) {
        state.setWinner(winner);
        state.setTurn("");
        if ("draw".equals(winner)) {
          broadcastState(state, "Round ended in a draw.");
        } else {
          String winnerName = "X".equals(winner) ? state.xPlayer() : state.oPlayer();
          broadcastState(state, (winnerName == null || winnerName.isBlank() ? winner : winnerName) + " won this round.");
        }
        return;
      }

      state.setTurn("X".equals(mark) ? "O" : "X");
      broadcastState(state, "Turn switched.");
    }
  }

  @MessageMapping("/ttt.leave")
  public void leaveRoom(TttRoomRequest payload, Principal principal) {
    String username = normalizeUsername(principal != null ? principal.getName() : null);
    if (username.isBlank()) {
      return;
    }

    String roomId = sanitizeRoomId(payload != null ? payload.roomId() : null);
    if (roomId.isBlank()) {
      return;
    }

    RoomState state = rooms.get(roomId);
    if (state == null) {
      return;
    }

    synchronized (state) {
      removePlayerFromRoom(state, username);
    }
  }

  @MessageMapping("/ttt.replay")
  public void replayRoom(TttRoomRequest payload, Principal principal) {
    String username = normalizeUsername(principal != null ? principal.getName() : null);
    if (username.isBlank()) {
      return;
    }

    String roomId = sanitizeRoomId(payload != null ? payload.roomId() : null);
    if (roomId.isBlank()) {
      return;
    }

    RoomState state = rooms.get(roomId);
    if (state == null) {
      sendUserError(username, roomId, "Room not found.");
      return;
    }

    synchronized (state) {
      String mark = markForUser(state, username);
      if (mark == null) {
        sendUserError(username, roomId, "You are not a player in this room.");
        return;
      }
      if (state.oPlayer() == null || state.oPlayer().isBlank()) {
        sendUserError(username, roomId, "Waiting for opponent to join.");
        return;
      }

      state.resetBoard();
      state.setUpdatedAt(Instant.now().toEpochMilli());
      broadcastState(state, "New round started.");
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
    if (username.equals(state.xPlayer())) {
      state.setXPlayer("");
      changed = true;
    }
    if (username.equals(state.oPlayer())) {
      state.setOPlayer("");
      changed = true;
    }
    if (!changed) return;

    if ((state.xPlayer() == null || state.xPlayer().isBlank())
        && (state.oPlayer() == null || state.oPlayer().isBlank())) {
      rooms.remove(state.roomId());
      return;
    }

    state.resetBoard();
    state.setUpdatedAt(Instant.now().toEpochMilli());
    broadcastState(state, "A player left. Board reset.");
  }

  private String markForUser(RoomState state, String username) {
    if (username.equals(state.xPlayer())) return "X";
    if (username.equals(state.oPlayer())) return "O";
    return null;
  }

  private void broadcastState(RoomState state, String message) {
    messagingTemplate.convertAndSend(ROOM_TOPIC_PREFIX + state.roomId(),
        new TttStateEvent(
            "state",
            state.roomId(),
            state.size(),
            new ArrayList<>(state.board()),
            state.xPlayer(),
            state.oPlayer(),
            state.turn(),
            state.winner(),
            state.lastMoveIndex(),
            state.updatedAt(),
            message));
  }

  private List<String> snapshot(RoomState state) {
    return new ArrayList<>(state.board());
  }

  private void sendUserEvent(
      String username,
      String type,
      String message,
      String roomId,
      Integer size,
      String yourMark,
      List<String> board) {
    messagingTemplate.convertAndSendToUser(
        username,
        USER_QUEUE,
        new TttUserEvent(type, roomId, size, yourMark, board, message));
  }

  private void sendUserError(String username, String roomId, String message) {
    sendUserEvent(username, "error", message, roomId, null, null, null);
  }

  private String generateRoomId() {
    return UUID.randomUUID().toString().replace("-", "").substring(0, 6).toUpperCase(Locale.ROOT);
  }

  private String sanitizeRoomId(String roomId) {
    if (roomId == null) return "";
    return roomId.trim().toUpperCase(Locale.ROOT).replaceAll("[^A-Z0-9]", "");
  }

  private String normalizeUsername(String username) {
    return username == null ? "" : username.trim().toLowerCase(Locale.ROOT);
  }

  private int normalizeSize(Integer size) {
    if (size == null) return 3;
    if (size < 3) return 3;
    if (size > 5) return 5;
    return size;
  }

  private String getWinner(List<String> board, int size) {
    for (int row = 0; row < size; row += 1) {
      int start = row * size;
      String first = board.get(start);
      if (first == null || first.isBlank()) continue;
      boolean all = true;
      for (int col = 1; col < size; col += 1) {
        if (!first.equals(board.get(start + col))) {
          all = false;
          break;
        }
      }
      if (all) return first;
    }

    for (int col = 0; col < size; col += 1) {
      String first = board.get(col);
      if (first == null || first.isBlank()) continue;
      boolean all = true;
      for (int row = 1; row < size; row += 1) {
        if (!first.equals(board.get(row * size + col))) {
          all = false;
          break;
        }
      }
      if (all) return first;
    }

    String diagonal = board.getFirst();
    if (diagonal != null && !diagonal.isBlank()) {
      boolean all = true;
      for (int idx = 1; idx < size; idx += 1) {
        if (!diagonal.equals(board.get(idx * (size + 1)))) {
          all = false;
          break;
        }
      }
      if (all) return diagonal;
    }

    String antiDiagonal = board.get(size - 1);
    if (antiDiagonal != null && !antiDiagonal.isBlank()) {
      boolean all = true;
      for (int idx = 1; idx < size; idx += 1) {
        if (!antiDiagonal.equals(board.get((idx + 1) * (size - 1)))) {
          all = false;
          break;
        }
      }
      if (all) return antiDiagonal;
    }

    for (String cell : board) {
      if (cell == null || cell.isBlank()) {
        return "";
      }
    }
    return "draw";
  }

  public record TttCreateRequest(String roomId, Integer size) {}

  public record TttJoinRequest(String roomId) {}

  public record TttMoveRequest(String roomId, Integer index) {}

  public record TttRoomRequest(String roomId) {}

  public record TttUserEvent(
      String type,
      String roomId,
      Integer size,
      String yourMark,
      List<String> board,
      String message) {}

  public record TttStateEvent(
      String type,
      String roomId,
      Integer size,
      List<String> board,
      String xPlayer,
      String oPlayer,
      String turn,
      String winner,
      Integer lastMoveIndex,
      Long updatedAt,
      String message) {}

  private static final class RoomState {
    private final String roomId;
    private final int size;
    private final List<String> board;
    private String xPlayer;
    private String oPlayer;
    private String turn;
    private String winner;
    private Integer lastMoveIndex;
    private Long updatedAt;

    private RoomState(String roomId, int size, String xPlayer) {
      this.roomId = roomId;
      this.size = size;
      this.board = new ArrayList<>();
      for (int i = 0; i < size * size; i += 1) {
        this.board.add("");
      }
      this.xPlayer = xPlayer;
      this.oPlayer = "";
      this.turn = "X";
      this.winner = "";
      this.lastMoveIndex = null;
      this.updatedAt = Instant.now().toEpochMilli();
    }

    private void resetBoard() {
      for (int i = 0; i < board.size(); i += 1) {
        board.set(i, "");
      }
      this.turn = "X";
      this.winner = "";
      this.lastMoveIndex = null;
    }

    private String roomId() {
      return roomId;
    }

    private int size() {
      return size;
    }

    private List<String> board() {
      return board;
    }

    private String xPlayer() {
      return xPlayer == null ? "" : xPlayer;
    }

    private void setXPlayer(String xPlayer) {
      this.xPlayer = xPlayer;
    }

    private String oPlayer() {
      return oPlayer == null ? "" : oPlayer;
    }

    private void setOPlayer(String oPlayer) {
      this.oPlayer = oPlayer;
    }

    private String turn() {
      return turn == null ? "" : turn;
    }

    private void setTurn(String turn) {
      this.turn = turn;
    }

    private String winner() {
      return winner == null ? "" : winner;
    }

    private void setWinner(String winner) {
      this.winner = winner;
    }

    private Integer lastMoveIndex() {
      return lastMoveIndex;
    }

    private void setLastMoveIndex(Integer lastMoveIndex) {
      this.lastMoveIndex = lastMoveIndex;
    }

    private Long updatedAt() {
      return updatedAt;
    }

    private void setUpdatedAt(Long updatedAt) {
      this.updatedAt = updatedAt;
    }
  }
}
