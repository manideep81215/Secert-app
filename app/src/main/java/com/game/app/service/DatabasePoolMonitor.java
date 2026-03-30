package com.game.app.service;

import javax.sql.DataSource;

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

    @Autowired
    private DataSource dataSource;

    /**
     * Check connection pool health every 30 seconds.
     */
    @Scheduled(fixedDelay = 30000, initialDelay = 60000)
    public void monitorConnectionPool() {
        if (!(dataSource instanceof HikariDataSource)) {
            return;
        }

        HikariDataSource hikariDS = (HikariDataSource) dataSource;
        HikariPoolMXBean poolBean = hikariDS.getHikariPoolMXBean();
        HikariConfigMXBean configBean = hikariDS.getHikariConfigMXBean();

        if (poolBean == null || configBean == null) {
            return;
        }

        int active = poolBean.getActiveConnections();
        int idle = poolBean.getIdleConnections();
        int total = poolBean.getTotalConnections();
        int max = configBean.getMaximumPoolSize();
        int waiting = poolBean.getThreadsAwaitingConnection();

        String message = String.format(
            "Connection pool status - Total: %d/%d, Active: %d, Idle: %d, Waiting: %d",
            total, max, active, idle, waiting
        );

        if (waiting > 0 && total < max) {
            logger.error("DATABASE CONNECTIVITY ISSUE: {}", message);
            logger.error("Pool demand exists, but new connections are not being established. Verify DB_URL host/port, network access, and MySQL availability.");
            return;
        }

        if (active > (max * 0.8)) {
            logger.warn("HIGH CONNECTION POOL USAGE: {}", message);
            logger.warn("Consider increasing DB_POOL_MAX_SIZE if this persists");
        } else if (active > (max * 0.5)) {
            logger.info(message);
        } else {
            logger.debug(message);
        }

        if (active >= total && total >= max && waiting > 0) {
            logger.error("CRITICAL: Connection pool exhausted - {}", message);
            logger.error("Application is likely to reject requests due to connection timeout");
            logger.error("Immediate action required: increase DB_POOL_MAX_SIZE or reduce concurrent DB usage");
        }
    }

    /**
     * Log connection pool stats every 5 minutes for debugging.
     */
    @Scheduled(fixedDelay = 300000, initialDelay = 60000)
    public void logPoolStats() {
        if (!(dataSource instanceof HikariDataSource)) {
            return;
        }

        HikariDataSource hikariDS = (HikariDataSource) dataSource;
        HikariPoolMXBean poolBean = hikariDS.getHikariPoolMXBean();
        HikariConfigMXBean configBean = hikariDS.getHikariConfigMXBean();

        if (poolBean == null || configBean == null) {
            return;
        }

        logger.info("Detailed connection pool statistics:");
        logger.info("Total Connections: {}", poolBean.getTotalConnections());
        logger.info("Active Connections: {}", poolBean.getActiveConnections());
        logger.info("Idle Connections: {}", poolBean.getIdleConnections());
        logger.info("Max Pool Size: {}", configBean.getMaximumPoolSize());
        logger.info("Min Pool Size: {}", configBean.getMinimumIdle());
        logger.info("Threads Awaiting Connection: {}", poolBean.getThreadsAwaitingConnection());
    }
}
