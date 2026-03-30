package com.game.app.service;

import com.zaxxer.hikari.HikariDataSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import javax.sql.DataSource;

/**
 * Monitors HikariCP connection pool health and logs warnings about potential issues.
 */
@Component
public class DatabasePoolMonitor {

    private static final Logger logger = LoggerFactory.getLogger(DatabasePoolMonitor.class);

    @Autowired
    private DataSource dataSource;

    /**
     * Check connection pool health every 30 seconds
     */
    @Scheduled(fixedDelay = 30000, initialDelay = 60000)
    public void monitorConnectionPool() {
        if (!(dataSource instanceof HikariDataSource)) {
            return;
        }

        HikariDataSource hikariDS = (HikariDataSource) dataSource;
        int active = hikariDS.getHikariPoolMXBean().getActiveConnections();
        int idle = hikariDS.getHikariPoolMXBean().getIdleConnections();
        int total = hikariDS.getHikariPoolMXBean().getTotalConnections();
        int max = hikariDS.getHikariPoolMXBean().getMaxPoolSize();

        String message = String.format(
            "Connection Pool Status - Total: %d/%d, Active: %d, Idle: %d",
            total, max, active, idle
        );

        // Warn if pool is more than 80% utilized
        if (active > (max * 0.8)) {
            logger.warn("⚠️  HIGH CONNECTION POOL USAGE: {}", message);
            logger.warn("   Consider increasing DB_POOL_MAX_SIZE environment variable");
        } else if (active > (max * 0.5)) {
            logger.info(message);
        } else {
            logger.debug(message);
        }

        // Alert if all connections are active
        if (active >= total && total >= max) {
            logger.error("🔴 CRITICAL: Connection pool EXHAUSTED - {}", message);
            logger.error("   Application will start rejecting requests due to timeout");
            logger.error("   Immediate action required: Increase DB_POOL_MAX_SIZE or reduce concurrent usage");
        }
    }

    /**
     * Log connection pool stats every 5 minutes for debugging
     */
    @Scheduled(fixedDelay = 300000, initialDelay = 60000)
    public void logPoolStats() {
        if (!(dataSource instanceof HikariDataSource)) {
            return;
        }

        HikariDataSource hikariDS = (HikariDataSource) dataSource;
        logger.info("📊 Detailed Connection Pool Statistics:");
        logger.info("   Total Connections: {}", hikariDS.getHikariPoolMXBean().getTotalConnections());
        logger.info("   Active Connections: {}", hikariDS.getHikariPoolMXBean().getActiveConnections());
        logger.info("   Idle Connections: {}", hikariDS.getHikariPoolMXBean().getIdleConnections());
        logger.info("   Max Pool Size: {}", hikariDS.getHikariPoolMXBean().getMaxPoolSize());
        logger.info("   Min Pool Size: {}", hikariDS.getHikariPoolMXBean().getMinPoolSize());
        logger.info("   Pending Thread Count: {}", hikariDS.getHikariPoolMXBean().getPendingThreadCount());
    }
}
