package com.game.app.service;

import java.lang.reflect.Proxy;

import com.zaxxer.hikari.HikariConfigMXBean;
import com.zaxxer.hikari.HikariDataSource;
import com.zaxxer.hikari.HikariPoolMXBean;
import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.slf4j.LoggerFactory;
import org.springframework.test.util.ReflectionTestUtils;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class DatabasePoolMonitorTest {

    private final Logger logger = (Logger) LoggerFactory.getLogger(DatabasePoolMonitor.class);
    private final ListAppender<ILoggingEvent> logAppender = new ListAppender<>();

    @AfterEach
    void tearDown() {
        logger.detachAppender(logAppender);
        logAppender.stop();
    }

    @Test
    void doesNotTreatSingleScalingIntervalAsConnectivityFailure() {
        MutablePoolState state = new MutablePoolState(2, 0, 2, 6, 1, 1);
        DatabasePoolMonitor monitor = createMonitor(state);

        monitor.monitorConnectionPool();

        assertTrue(hasLog(Level.WARN, "Connection pool is scaling under load"));
        assertFalse(hasLog(Level.ERROR, "DATABASE CONNECTIVITY ISSUE"));
    }

    @Test
    void reportsConnectivityIssueAfterRepeatedWaitingWhileBelowMaxPoolSize() {
        MutablePoolState state = new MutablePoolState(2, 0, 2, 6, 1, 1);
        DatabasePoolMonitor monitor = createMonitor(state);

        monitor.monitorConnectionPool();
        monitor.monitorConnectionPool();
        monitor.monitorConnectionPool();

        assertTrue(hasLog(Level.ERROR, "DATABASE CONNECTIVITY ISSUE"));
    }

    private DatabasePoolMonitor createMonitor(MutablePoolState state) {
        logAppender.start();
        logger.addAppender(logAppender);

        DatabasePoolMonitor monitor = new DatabasePoolMonitor();
        ReflectionTestUtils.setField(monitor, "dataSource", new StubHikariDataSource(state));
        return monitor;
    }

    private boolean hasLog(Level level, String text) {
        return logAppender.list.stream()
            .anyMatch(event -> event.getLevel().equals(level) && event.getFormattedMessage().contains(text));
    }

    private record MutablePoolState(int active, int idle, int total, int max, int min, int waiting) {
    }

    private static final class StubHikariDataSource extends HikariDataSource {
        private final HikariPoolMXBean poolBean;
        private final HikariConfigMXBean configBean;

        private StubHikariDataSource(MutablePoolState state) {
            this.poolBean = (HikariPoolMXBean) Proxy.newProxyInstance(
                HikariPoolMXBean.class.getClassLoader(),
                new Class<?>[]{HikariPoolMXBean.class},
                (proxy, method, args) -> switch (method.getName()) {
                    case "getActiveConnections" -> state.active();
                    case "getIdleConnections" -> state.idle();
                    case "getTotalConnections" -> state.total();
                    case "getThreadsAwaitingConnection" -> state.waiting();
                    default -> null;
                }
            );

            this.configBean = (HikariConfigMXBean) Proxy.newProxyInstance(
                HikariConfigMXBean.class.getClassLoader(),
                new Class<?>[]{HikariConfigMXBean.class},
                (proxy, method, args) -> switch (method.getName()) {
                    case "getMaximumPoolSize" -> state.max();
                    case "getMinimumIdle" -> state.min();
                    default -> null;
                }
            );
        }

        @Override
        public HikariPoolMXBean getHikariPoolMXBean() {
            return poolBean;
        }

        @Override
        public HikariConfigMXBean getHikariConfigMXBean() {
            return configBean;
        }
    }
}
