package com.game.app.service;

import java.time.Instant;
import java.time.LocalDate;
import java.time.YearMonth;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.TreeSet;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.game.app.model.ChatAnalyticsDailyEntity;
import com.game.app.model.ChatStatsProgressEntity;
import com.game.app.repository.ChatAnalyticsDailyRepository;
import com.game.app.repository.ChatMessageRepository;
import com.game.app.repository.ChatStatsProgressRepository;

@Service
public class ChatStatsService {

  private static final long MESSAGE_MILESTONE_STEP = 500L;

  private final ChatAnalyticsDailyRepository chatAnalyticsDailyRepository;
  private final ChatMessageRepository chatMessageRepository;
  private final ChatStatsProgressRepository chatStatsProgressRepository;

  public ChatStatsService(
      ChatAnalyticsDailyRepository chatAnalyticsDailyRepository,
      ChatMessageRepository chatMessageRepository,
      ChatStatsProgressRepository chatStatsProgressRepository) {
    this.chatAnalyticsDailyRepository = chatAnalyticsDailyRepository;
    this.chatMessageRepository = chatMessageRepository;
    this.chatStatsProgressRepository = chatStatsProgressRepository;
  }

  @Transactional
  public ChatStatsDto getStats(String userOne, String userTwo, boolean trackMilestone) {
    String[] pair = canonicalPair(userOne, userTwo);
    String low = pair[0];
    String high = pair[1];
    String viewer = normalizeUsername(userOne);

    ZoneId zoneId = ZoneId.systemDefault();
    LocalDate today = LocalDate.now(zoneId);
    LocalDate yesterday = today.minusDays(1);
    YearMonth currentMonth = YearMonth.from(today);
    YearMonth previousMonth = currentMonth.minusMonths(1);

    List<ChatAnalyticsDailyEntity> dailyRows = chatAnalyticsDailyRepository
        .findByUserLowAndUserHighOrderByTalkDateAsc(low, high);
    long globalTotalMessages = chatMessageRepository.count();

    long totalMessages = 0L;
    long totalPhotos = 0L;
    long totalVoices = 0L;
    long thisMonthMessages = 0L;
    long thisMonthPhotos = 0L;
    long thisMonthVideos = 0L;
    long thisMonthVoices = 0L;
    long recapMessages = 0L;
    long recapPhotos = 0L;
    long recapVideos = 0L;
    long recapVoices = 0L;
    long todayMessages = 0L;
    long yesterdayMessages = 0L;
    LocalDate firstMessageDate = null;
    Set<LocalDate> talkDatesSet = new TreeSet<>();
    Map<YearMonth, Long> monthlyCounts = new TreeMap<>();

    for (ChatAnalyticsDailyEntity row : dailyRows) {
      LocalDate talkDate = row.getTalkDate();
      if (talkDate == null) continue;

      long dayMessages = row.getMessageCount();
      long dayPhotos = row.getImageCount();
      long dayVideos = row.getVideoCount();
      long dayVoices = row.getVoiceCount();

      totalMessages += dayMessages;
      totalPhotos += dayPhotos;
      totalVoices += dayVoices;

      if (dayMessages > 0) {
        if (firstMessageDate == null || talkDate.isBefore(firstMessageDate)) {
          firstMessageDate = talkDate;
        }
        talkDatesSet.add(talkDate);
      }

      YearMonth month = YearMonth.from(talkDate);
      monthlyCounts.put(month, monthlyCounts.getOrDefault(month, 0L) + dayMessages);

      if (currentMonth.equals(month)) {
        thisMonthMessages += dayMessages;
        thisMonthPhotos += dayPhotos;
        thisMonthVideos += dayVideos;
        thisMonthVoices += dayVoices;
      }

      if (previousMonth.equals(month)) {
        recapMessages += dayMessages;
        recapPhotos += dayPhotos;
        recapVideos += dayVideos;
        recapVoices += dayVoices;
      }

      if (talkDate.equals(today)) {
        todayMessages += dayMessages;
      }

      if (talkDate.equals(yesterday)) {
        yesterdayMessages += dayMessages;
      }
    }

    List<LocalDate> talkDates = new ArrayList<>(talkDatesSet);
    long dailyAverage = !talkDates.isEmpty() ? totalMessages / talkDates.size() : 0L;
    int thisMonthTalkDays = countMonthTalkDays(talkDates, currentMonth);
    int recapTalkDays = countMonthTalkDays(talkDates, previousMonth);

    StreakResult streakResult = calculateStreak(talkDates, today);
    MilestoneResult milestoneResult = trackMilestone
        ? checkMilestone(trackAndGetPreviousTotal(low, high, viewer, totalMessages), totalMessages)
        : new MilestoneResult(0L, false);

    return new ChatStatsDto(
        globalTotalMessages,
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
        todayMessages,
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
        mapTimeline(monthlyCounts));
  }

  private List<MonthCountDto> mapTimeline(Map<YearMonth, Long> monthToCount) {
    return monthToCount.entrySet().stream()
        .sorted((left, right) -> right.getKey().compareTo(left.getKey()))
        .map((entry) -> new MonthCountDto(
            String.format("%04d-%02d", entry.getKey().getYear(), entry.getKey().getMonthValue()),
            entry.getValue()))
        .toList();
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

  private long trackAndGetPreviousTotal(String low, String high, String viewer, long totalMessages) {
    ChatStatsProgressEntity state = chatStatsProgressRepository
        .findByUserLowAndUserHighAndViewerUsername(low, high, viewer)
        .orElse(null);

    if (state == null) {
      ChatStatsProgressEntity created = new ChatStatsProgressEntity();
      created.setUserLow(low);
      created.setUserHigh(high);
      created.setViewerUsername(viewer);
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
      long globalTotalMessages,
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
      long todayMessages,
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
