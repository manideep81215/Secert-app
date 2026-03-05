package com.game.app.service;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.YearMonth;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.TreeSet;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.game.app.model.ChatStatsProgressEntity;
import com.game.app.repository.ChatMessageRepository;
import com.game.app.repository.ChatStatsProgressRepository;

@Service
public class ChatStatsService {

  private static final long MESSAGE_MILESTONE_STEP = 500L;

  private final ChatMessageRepository chatMessageRepository;
  private final ChatStatsProgressRepository chatStatsProgressRepository;

  public ChatStatsService(
      ChatMessageRepository chatMessageRepository,
      ChatStatsProgressRepository chatStatsProgressRepository) {
    this.chatMessageRepository = chatMessageRepository;
    this.chatStatsProgressRepository = chatStatsProgressRepository;
  }

  @Transactional
  public ChatStatsDto getStats(String userOne, String userTwo) {
    String u1 = normalizeUsername(userOne);
    String u2 = normalizeUsername(userTwo);
    ZoneId zoneId = ZoneId.systemDefault();

    YearMonth currentMonth = YearMonth.now(zoneId);
    Instant monthStart = currentMonth.atDay(1).atStartOfDay(zoneId).toInstant();
    YearMonth previousMonth = currentMonth.minusMonths(1);
    Instant previousMonthStart = previousMonth.atDay(1).atStartOfDay(zoneId).toInstant();

    long totalMessages = toLong(chatMessageRepository.countMessagesBetween(u1, u2));
    long thisMonthMessages = toLong(chatMessageRepository.countMessagesBetweenSince(u1, u2, monthStart));
    long thisMonthPhotos = toLong(chatMessageRepository.countMessagesByTypeBetweenSince(u1, u2, "image", monthStart));
    long thisMonthVideos = toLong(chatMessageRepository.countMessagesByTypeBetweenSince(u1, u2, "video", monthStart));
    long thisMonthVoices = toLong(chatMessageRepository.countMessagesByTypeBetweenSince(u1, u2, "voice", monthStart));
    Instant yesterdayStart = LocalDate.now(zoneId).minusDays(1).atStartOfDay(zoneId).toInstant();
    Instant todayStart = LocalDate.now(zoneId).atStartOfDay(zoneId).toInstant();
    long yesterdayMessages = toLong(
        chatMessageRepository.countMessagesBetweenRange(u1, u2, yesterdayStart, todayStart));
    long recapMessages = toLong(chatMessageRepository.countMessagesBetweenRange(u1, u2, previousMonthStart, monthStart));
    long recapPhotos = toLong(
        chatMessageRepository.countMessagesByTypeBetweenRange(u1, u2, "image", previousMonthStart, monthStart));
    long recapVideos = toLong(
        chatMessageRepository.countMessagesByTypeBetweenRange(u1, u2, "video", previousMonthStart, monthStart));
    long recapVoices = toLong(
        chatMessageRepository.countMessagesByTypeBetweenRange(u1, u2, "voice", previousMonthStart, monthStart));
    long totalPhotos = toLong(chatMessageRepository.countMessagesByTypeBetween(u1, u2, "image"));
    long totalVoices = toLong(chatMessageRepository.countMessagesByTypeBetween(u1, u2, "voice"));

    Instant firstMessageAt = chatMessageRepository.findFirstMessageAt(u1, u2);
    LocalDate firstMessageDate = firstMessageAt != null ? LocalDate.ofInstant(firstMessageAt, zoneId) : null;

    List<LocalDate> talkDates = chatMessageRepository.findDistinctTalkDates(u1, u2)
        .stream()
        .map(java.sql.Date::toLocalDate)
        .toList();
    long dailyAverage = !talkDates.isEmpty() ? totalMessages / talkDates.size() : 0L;

    StreakResult streakResult = calculateStreak(talkDates, LocalDate.now(zoneId));
    long previousTotal = trackAndGetPreviousTotal(u1, u2, totalMessages);
    MilestoneResult milestoneResult = checkMilestone(previousTotal, totalMessages);
    int thisMonthTalkDays = countMonthTalkDays(talkDates, currentMonth);
    int recapTalkDays = countMonthTalkDays(talkDates, previousMonth);

    return new ChatStatsDto(
        totalMessages,
        thisMonthMessages,
        thisMonthPhotos,
        thisMonthVideos,
        thisMonthVoices,
        streakResult.currentStreak(),
        streakResult.longestStreak(),
        firstMessageDate,
        totalPhotos,
        totalVoices,
        milestoneResult.reachedMilestone(),
        milestoneResult.justHit(),
        yesterdayMessages,
        dailyAverage,
        thisMonthTalkDays,
        currentMonth.lengthOfMonth(),
        String.format("%04d-%02d", previousMonth.getYear(), previousMonth.getMonthValue()),
        recapMessages,
        recapPhotos,
        recapVideos,
        recapVoices,
        recapTalkDays,
        previousMonth.lengthOfMonth(),
        mapTimeline(chatMessageRepository.findMonthlyMessageCounts(u1, u2)));
  }

  private List<MonthCountDto> mapTimeline(List<Object[]> rows) {
    List<MonthCountDto> timeline = new ArrayList<>();
    for (Object[] row : rows) {
      if (row == null || row.length < 3) continue;
      int year = (int) toLong(row[0]);
      int month = (int) toLong(row[1]);
      long count = toLong(row[2]);
      if (year <= 0 || month <= 0 || month > 12) continue;
      timeline.add(new MonthCountDto(String.format("%04d-%02d", year, month), count));
    }
    return timeline;
  }

  private StreakResult calculateStreak(List<LocalDate> talkDates, LocalDate today) {
    if (talkDates == null || talkDates.isEmpty()) {
      return new StreakResult(0, 0);
    }

    Set<LocalDate> distinctDates = new TreeSet<>(talkDates);

    int currentStreak = 0;
    LocalDate cursor = today;
    while (distinctDates.contains(cursor)) {
      currentStreak += 1;
      cursor = cursor.minusDays(1);
    }

    int longestStreak = 0;
    int running = 0;
    LocalDate previous = null;
    for (LocalDate date : distinctDates) {
      if (previous != null && previous.plusDays(1).equals(date)) {
        running += 1;
      } else {
        running = 1;
      }
      if (running > longestStreak) {
        longestStreak = running;
      }
      previous = date;
    }

    return new StreakResult(currentStreak, longestStreak);
  }

  private int countMonthTalkDays(List<LocalDate> talkDates, YearMonth month) {
    if (talkDates == null || talkDates.isEmpty()) {
      return 0;
    }
    return (int) talkDates.stream().filter((date) -> YearMonth.from(date).equals(month)).distinct().count();
  }

  private MilestoneResult checkMilestone(long previousTotal, long totalMessages) {
    long reached = totalMessages >= MESSAGE_MILESTONE_STEP
        ? (totalMessages / MESSAGE_MILESTONE_STEP) * MESSAGE_MILESTONE_STEP
        : 0L;

    long previousBucket = previousTotal >= MESSAGE_MILESTONE_STEP
        ? previousTotal / MESSAGE_MILESTONE_STEP
        : 0L;
    long currentBucket = totalMessages >= MESSAGE_MILESTONE_STEP
        ? totalMessages / MESSAGE_MILESTONE_STEP
        : 0L;

    boolean crossed = totalMessages > previousTotal && currentBucket > previousBucket;
    return new MilestoneResult(reached, crossed);
  }

  private long trackAndGetPreviousTotal(String u1, String u2, long totalMessages) {
    String[] pair = canonicalPair(u1, u2);
    String low = pair[0];
    String high = pair[1];

    ChatStatsProgressEntity state = chatStatsProgressRepository
        .findByUserLowAndUserHigh(low, high)
        .orElse(null);

    if (state == null) {
      ChatStatsProgressEntity created = new ChatStatsProgressEntity();
      created.setUserLow(low);
      created.setUserHigh(high);
      created.setLastMessageTotal(totalMessages);
      chatStatsProgressRepository.save(created);
      return totalMessages;
    }

    long previous = state.getLastMessageTotal();
    state.setLastMessageTotal(totalMessages);
    chatStatsProgressRepository.save(state);
    return previous;
  }

  private String[] canonicalPair(String u1, String u2) {
    String left = normalizeUsername(u1);
    String right = normalizeUsername(u2);
    if (left.compareTo(right) <= 0) {
      return new String[] { left, right };
    }
    return new String[] { right, left };
  }

  private long toLong(Long value) {
    return value == null ? 0L : value;
  }

  private long toLong(Object value) {
    if (value == null) return 0L;
    if (value instanceof Number number) {
      return number.longValue();
    }
    try {
      return Long.parseLong(String.valueOf(value));
    } catch (NumberFormatException exception) {
      return 0L;
    }
  }

  private String normalizeUsername(String username) {
    return username == null ? "" : username.trim().toLowerCase();
  }

  private record StreakResult(int currentStreak, int longestStreak) {
  }

  private record MilestoneResult(long reachedMilestone, boolean justHit) {
  }

  public record MonthCountDto(String month, long messages) {
  }

  public record ChatStatsDto(
      long totalMessages,
      long thisMonthMessages,
      long thisMonthPhotos,
      long thisMonthVideos,
      long thisMonthVoices,
      int daysTrackedStreak,
      int longestStreak,
      LocalDate firstMessageDate,
      long totalPhotos,
      long totalVoices,
      long milestoneReached,
      boolean milestoneJustHit,
      long yesterdayMessages,
      long dailyAverage,
      int thisMonthTalkDays,
      int daysInMonth,
      String recapMonth,
      long recapMessages,
      long recapPhotos,
      long recapVideos,
      long recapVoices,
      int recapTalkDays,
      int recapDaysInMonth,
      List<MonthCountDto> monthlyTimeline) {
  }
}
