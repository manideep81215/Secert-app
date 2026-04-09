package com.game.app.service;

import javax.sql.DataSource;
import java.util.concurrent.atomic.AtomicInteger;

import com.zaxxer.hikari.HikariConfigMXBean;
import com.zaxxer.hikari.HikariDataSource;
import com.zaxxer.hikari.HikariPoolMXBean;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * Monitors HikariCP connection pool health and logs warnings about potential issues.
 */
@Component
public class DatabasePoolMonitor {

    private static final Logger logger = LoggerFactory.getLogger(DatabasePoolMonitor.class);
    private static final int CONNECTIVITY_WARNING_THRESHOLD = 3;

    @Autowired
    private DataSource dataSource;

    private final AtomicInteger consecutiveWaitChecks = new AtomicInteger();

    /**
     * Check connection pool health every 30 seconds.
     */
    @Scheduled(fixedDelay = 30000, initialDelay = 60000)
    public void monitorConnectionPool() {
        PoolSnapshot snapshot = getPoolSnapshot();
        if (snapshot == null) {
            return;
        }

        if (snapshot.waiting() > 0 && snapshot.total() < snapshot.max() && snapshot.active() >= snapshot.total()) {
            int consecutiveChecks = consecutiveWaitChecks.incrementAndGet();

            if (consecutiveChecks >= CONNECTIVITY_WARNING_THRESHOLD) {
                logger.error("DATABASE CONNECTIVITY ISSUE: {}", snapshot.summary());
                logger.error(
                    "Threads have been waiting for {} consecutive checks while the pool is below max size. Verify DB_URL host/port, network access, and MySQL availability.",
                    consecutiveChecks
                );
            } else {
                logger.warn("Connection pool is scaling under load: {}", snapshot.summary());
            }
            return;
        }

        consecutiveWaitChecks.set(0);

        if (snapshot.active() > (snapshot.max() * 0.8)) {
            logger.warn("HIGH CONNECTION POOL USAGE: {}", snapshot.summary());
            logger.warn("Consider increasing DB_POOL_MAX_SIZE if this persists");
        } else if (snapshot.active() > (snapshot.max() * 0.5)) {
            logger.info(snapshot.summary());
        } else {
            logger.debug(snapshot.summary());
        }

        if (snapshot.active() >= snapshot.total() && snapshot.total() >= snapshot.max() && snapshot.waiting() > 0) {
            logger.error("CRITICAL: Connection pool exhausted - {}", snapshot.summary());
            logger.error("Application is likely to reject requests due to connection timeout");
            logger.error("Immediate action required: increase DB_POOL_MAX_SIZE or reduce concurrent DB usage");
        }
    }

    /**
     * Log connection pool stats every 5 minutes for debugging.
     */
    @Scheduled(fixedDelay = 300000, initialDelay = 60000)
    public void logPoolStats() {
        PoolSnapshot snapshot = getPoolSnapshot();
        if (snapshot == null) {
            return;
        }

        logger.info("Detailed connection pool statistics:");
        logger.info("Total Connections: {}", snapshot.total());
        logger.info("Active Connections: {}", snapshot.active());
        logger.info("Idle Connections: {}", snapshot.idle());
        logger.info("Max Pool Size: {}", snapshot.max());
        logger.info("Min Pool Size: {}", snapshot.min());
        logger.info("Threads Awaiting Connection: {}", snapshot.waiting());
    }

    private PoolSnapshot getPoolSnapshot() {
        if (!(dataSource instanceof HikariDataSource hikariDS)) {
            return null;
        }

        HikariPoolMXBean poolBean = hikariDS.getHikariPoolMXBean();
        HikariConfigMXBean configBean = hikariDS.getHikariConfigMXBean();

        if (poolBean == null || configBean == null) {
            return null;
        }

        return new PoolSnapshot(
            poolBean.getActiveConnections(),
            poolBean.getIdleConnections(),
            poolBean.getTotalConnections(),
            configBean.getMaximumPoolSize(),
            configBean.getMinimumIdle(),
            poolBean.getThreadsAwaitingConnection()
        );
    }

    private record PoolSnapshot(int active, int idle, int total, int max, int min, int waiting) {
        private String summary() {
            return String.format(
                "Connection pool status - Total: %d/%d, Active: %d, Idle: %d, Waiting: %d",
                total, max, active, idle, waiting
            );
        }
    }
}
