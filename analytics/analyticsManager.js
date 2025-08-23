#!/usr/bin/env node

import { DatabaseDataManager } from '../database/databaseDataManager.js';
import { shortenAddress } from '../utils.js';

/**
 * Analytics Manager for ZapBot
 * Tracks user activity, trading performance, and system metrics
 */
class AnalyticsManager {
    constructor() {
        this.dataManager = null;
        this.isInitialized = false;
        this.metrics = {
            userActivity: new Map(),
            tradingPerformance: new Map(),
            systemHealth: new Map(),
            errorRates: new Map()
        };
        this.startTime = Date.now();
    }

    /**
     * Initialize the analytics manager
     */
    async initialize() {
        try {
            this.dataManager = new DatabaseDataManager();
            await this.dataManager.initialize();
            
            // Create analytics tables if they don't exist
            await this.createAnalyticsTables();
            
            this.isInitialized = true;
            console.log('📊 Analytics Manager initialized successfully');
        } catch (error) {
            console.error('Failed to initialize Analytics Manager:', error);
            throw error;
        }
    }

    /**
     * Create analytics tables in the database
     */
    async createAnalyticsTables() {
        const tables = [
            `CREATE TABLE IF NOT EXISTS user_activity (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id TEXT NOT NULL,
                action_type TEXT NOT NULL,
                action_details TEXT,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                success BOOLEAN DEFAULT 1,
                response_time INTEGER,
                FOREIGN KEY (user_id) REFERENCES users(chat_id)
            )`,
            
            `CREATE TABLE IF NOT EXISTS trading_performance (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id TEXT NOT NULL,
                trader_wallet TEXT NOT NULL,
                trade_signature TEXT,
                platform TEXT,
                token_address TEXT,
                amount REAL,
                direction TEXT,
                success BOOLEAN,
                profit_loss REAL,
                execution_time INTEGER,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(chat_id)
            )`,
            
            `CREATE TABLE IF NOT EXISTS system_health (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                metric_name TEXT NOT NULL,
                metric_value REAL,
                metric_unit TEXT,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
            )`,
            
            `CREATE TABLE IF NOT EXISTS error_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                error_type TEXT NOT NULL,
                error_message TEXT,
                user_id TEXT,
                stack_trace TEXT,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(chat_id)
            )`
        ];

        for (const table of tables) {
            await this.dataManager.database.run(table);
        }
    }

    /**
     * Track user activity
     */
    async trackUserActivity(userId, actionType, actionDetails = null, success = true, responseTime = null) {
        try {
            if (!this.isInitialized) return;

            const query = `
                INSERT INTO user_activity (user_id, action_type, action_details, success, response_time)
                VALUES (?, ?, ?, ?, ?)
            `;
            
            await this.dataManager.database.run(query, [
                userId,
                actionType,
                actionDetails ? JSON.stringify(actionDetails) : null,
                success ? 1 : 0,
                responseTime
            ]);

            // Update in-memory metrics
            this.updateUserActivityMetrics(userId, actionType, success, responseTime);
            
        } catch (error) {
            console.error('Failed to track user activity:', error);
        }
    }

    /**
     * Track trading performance
     */
    async trackTradingPerformance(userId, traderWallet, tradeData) {
        try {
            if (!this.isInitialized) return;

            const query = `
                INSERT INTO trading_performance (
                    user_id, trader_wallet, trade_signature, platform, token_address,
                    amount, direction, success, profit_loss, execution_time
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `;
            
            await this.dataManager.database.run(query, [
                userId,
                traderWallet,
                tradeData.signature || null,
                tradeData.platform || null,
                tradeData.tokenAddress || null,
                tradeData.amount || 0,
                tradeData.direction || null,
                tradeData.success ? 1 : 0,
                tradeData.profitLoss || 0,
                tradeData.executionTime || 0
            ]);

            // Update in-memory metrics
            this.updateTradingPerformanceMetrics(userId, traderWallet, tradeData);
            
        } catch (error) {
            console.error('Failed to track trading performance:', error);
        }
    }

    /**
     * Track system health metrics
     */
    async trackSystemHealth(metricName, metricValue, metricUnit = null) {
        try {
            if (!this.isInitialized) return;

            const query = `
                INSERT INTO system_health (metric_name, metric_value, metric_unit)
                VALUES (?, ?, ?)
            `;
            
            await this.dataManager.database.run(query, [
                metricName,
                metricValue,
                metricUnit
            ]);

            // Update in-memory metrics
            this.updateSystemHealthMetrics(metricName, metricValue, metricUnit);
            
        } catch (error) {
            console.error('Failed to track system health:', error);
        }
    }

    /**
     * Track errors
     */
    async trackError(errorType, errorMessage, userId = null, stackTrace = null) {
        try {
            if (!this.isInitialized) return;

            const query = `
                INSERT INTO error_logs (error_type, error_message, user_id, stack_trace)
                VALUES (?, ?, ?, ?)
            `;
            
            await this.dataManager.database.run(query, [
                errorType,
                errorMessage,
                userId,
                stackTrace
            ]);

            // Update in-memory metrics
            this.updateErrorMetrics(errorType, userId);
            
        } catch (error) {
            console.error('Failed to track error:', error);
        }
    }

    /**
     * Get user analytics
     */
    async getUserAnalytics(userId, timeRange = '7d') {
        try {
            if (!this.isInitialized) return null;

            const timeFilter = this.getTimeFilter(timeRange);
            
            // Get user activity
            const activityQuery = `
                SELECT 
                    action_type,
                    COUNT(*) as count,
                    AVG(response_time) as avg_response_time,
                    SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as success_count,
                    SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) as failure_count
                FROM user_activity 
                WHERE user_id = ? AND timestamp >= ?
                GROUP BY action_type
            `;
            
            const activity = await this.dataManager.database.all(activityQuery, [userId, timeFilter]);

            // Get trading performance
            const tradingQuery = `
                SELECT 
                    COUNT(*) as total_trades,
                    SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as successful_trades,
                    SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) as failed_trades,
                    AVG(execution_time) as avg_execution_time,
                    SUM(profit_loss) as total_pnl,
                    AVG(profit_loss) as avg_pnl
                FROM trading_performance 
                WHERE user_id = ? AND timestamp >= ?
            `;
            
            const trading = await this.dataManager.database.get(tradingQuery, [userId, timeFilter]);

            return {
                userId,
                timeRange,
                activity,
                trading,
                summary: this.generateUserSummary(activity, trading)
            };
            
        } catch (error) {
            console.error('Failed to get user analytics:', error);
            return null;
        }
    }

    /**
     * Get system analytics
     */
    async getSystemAnalytics(timeRange = '24h') {
        try {
            if (!this.isInitialized) return null;

            const timeFilter = this.getTimeFilter(timeRange);
            
            // Get system health metrics
            const healthQuery = `
                SELECT 
                    metric_name,
                    AVG(metric_value) as avg_value,
                    MAX(metric_value) as max_value,
                    MIN(metric_value) as min_value,
                    COUNT(*) as data_points
                FROM system_health 
                WHERE timestamp >= ?
                GROUP BY metric_name
            `;
            
            const health = await this.dataManager.database.all(healthQuery, [timeFilter]);

            // Get error rates
            const errorQuery = `
                SELECT 
                    error_type,
                    COUNT(*) as count,
                    COUNT(DISTINCT user_id) as affected_users
                FROM error_logs 
                WHERE timestamp >= ?
                GROUP BY error_type
                ORDER BY count DESC
            `;
            
            const errors = await this.dataManager.database.all(errorQuery, [timeFilter]);

            // Get user activity summary
            const activityQuery = `
                SELECT 
                    COUNT(DISTINCT user_id) as active_users,
                    COUNT(*) as total_actions,
                    AVG(response_time) as avg_response_time
                FROM user_activity 
                WHERE timestamp >= ?
            `;
            
            const activity = await this.dataManager.database.get(activityQuery, [timeFilter]);

            return {
                timeRange,
                health,
                errors,
                activity,
                summary: this.generateSystemSummary(health, errors, activity)
            };
            
        } catch (error) {
            console.error('Failed to get system analytics:', error);
            return null;
        }
    }

    /**
     * Get admin dashboard data
     */
    async getAdminDashboard() {
        try {
            if (!this.isInitialized) return null;

            const now = new Date();
            const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
            const last7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
            const last30d = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

            // Get user statistics
            const userStats = await this.dataManager.database.get(`
                SELECT 
                    COUNT(*) as total_users,
                    COUNT(CASE WHEN role = 'admin' THEN 1 END) as admin_count,
                    COUNT(CASE WHEN role = 'user' THEN 1 END) as user_count
                FROM users
            `);

            // Get recent activity
            const recentActivity = await this.dataManager.database.all(`
                SELECT 
                    ua.user_id,
                    u.username,
                    ua.action_type,
                    ua.timestamp,
                    ua.success
                FROM user_activity ua
                JOIN users u ON ua.user_id = u.chat_id
                WHERE ua.timestamp >= ?
                ORDER BY ua.timestamp DESC
                LIMIT 20
            `, [last24h.toISOString()]);

            // Get trading statistics
            const tradingStats = await this.dataManager.database.get(`
                SELECT 
                    COUNT(*) as total_trades,
                    SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as successful_trades,
                    SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) as failed_trades,
                    AVG(execution_time) as avg_execution_time,
                    SUM(profit_loss) as total_pnl
                FROM trading_performance 
                WHERE timestamp >= ?
            `, [last7d.toISOString()]);

            // Get system health
            const systemHealth = await this.dataManager.database.all(`
                SELECT 
                    metric_name,
                    metric_value,
                    metric_unit,
                    timestamp
                FROM system_health 
                WHERE timestamp >= ?
                ORDER BY timestamp DESC
                LIMIT 50
            `, [last24h.toISOString()]);

            return {
                userStats,
                recentActivity,
                tradingStats,
                systemHealth,
                uptime: Date.now() - this.startTime,
                summary: this.generateAdminSummary(userStats, tradingStats, systemHealth)
            };
            
        } catch (error) {
            console.error('Failed to get admin dashboard:', error);
            return null;
        }
    }

    /**
     * Update in-memory user activity metrics
     */
    updateUserActivityMetrics(userId, actionType, success, responseTime) {
        const key = `${userId}_${actionType}`;
        const current = this.metrics.userActivity.get(key) || {
            count: 0,
            successCount: 0,
            failureCount: 0,
            totalResponseTime: 0,
            avgResponseTime: 0
        };

        current.count++;
        if (success) {
            current.successCount++;
        } else {
            current.failureCount++;
        }

        if (responseTime) {
            current.totalResponseTime += responseTime;
            current.avgResponseTime = current.totalResponseTime / current.count;
        }

        this.metrics.userActivity.set(key, current);
    }

    /**
     * Update in-memory trading performance metrics
     */
    updateTradingPerformanceMetrics(userId, traderWallet, tradeData) {
        const key = `${userId}_${traderWallet}`;
        const current = this.metrics.tradingPerformance.get(key) || {
            totalTrades: 0,
            successfulTrades: 0,
            failedTrades: 0,
            totalPnL: 0,
            avgExecutionTime: 0,
            totalExecutionTime: 0
        };

        current.totalTrades++;
        if (tradeData.success) {
            current.successfulTrades++;
        } else {
            current.failedTrades++;
        }

        if (tradeData.profitLoss) {
            current.totalPnL += tradeData.profitLoss;
        }

        if (tradeData.executionTime) {
            current.totalExecutionTime += tradeData.executionTime;
            current.avgExecutionTime = current.totalExecutionTime / current.totalTrades;
        }

        this.metrics.tradingPerformance.set(key, current);
    }

    /**
     * Update in-memory system health metrics
     */
    updateSystemHealthMetrics(metricName, metricValue, metricUnit) {
        const current = this.metrics.systemHealth.get(metricName) || {
            values: [],
            avgValue: 0,
            maxValue: -Infinity,
            minValue: Infinity,
            unit: metricUnit
        };

        current.values.push(metricValue);
        current.avgValue = current.values.reduce((a, b) => a + b, 0) / current.values.length;
        current.maxValue = Math.max(current.maxValue, metricValue);
        current.minValue = Math.min(current.minValue, metricValue);

        // Keep only last 100 values
        if (current.values.length > 100) {
            current.values = current.values.slice(-100);
        }

        this.metrics.systemHealth.set(metricName, current);
    }

    /**
     * Update in-memory error metrics
     */
    updateErrorMetrics(errorType, userId) {
        const current = this.metrics.errorRates.get(errorType) || {
            count: 0,
            affectedUsers: new Set()
        };

        current.count++;
        if (userId) {
            current.affectedUsers.add(userId);
        }

        this.metrics.errorRates.set(errorType, current);
    }

    /**
     * Generate time filter for queries
     */
    getTimeFilter(timeRange) {
        const now = new Date();
        let filterDate;

        switch (timeRange) {
            case '1h':
                filterDate = new Date(now.getTime() - 60 * 60 * 1000);
                break;
            case '24h':
                filterDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
                break;
            case '7d':
                filterDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
                break;
            case '30d':
                filterDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
                break;
            default:
                filterDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        }

        return filterDate.toISOString();
    }

    /**
     * Generate user summary
     */
    generateUserSummary(activity, trading) {
        const totalActions = activity.reduce((sum, a) => sum + a.count, 0);
        const successRate = totalActions > 0 ? 
            (activity.reduce((sum, a) => sum + a.success_count, 0) / totalActions * 100).toFixed(2) : 0;
        
        const tradeSuccessRate = trading.total_trades > 0 ? 
            (trading.successful_trades / trading.total_trades * 100).toFixed(2) : 0;

        return {
            totalActions,
            successRate: `${successRate}%`,
            avgResponseTime: activity.length > 0 ? 
                (activity.reduce((sum, a) => sum + (a.avg_response_time || 0), 0) / activity.length).toFixed(2) : 0,
            totalTrades: trading.total_trades || 0,
            tradeSuccessRate: `${tradeSuccessRate}%`,
            totalPnL: trading.total_pnl || 0,
            avgPnL: trading.total_trades > 0 ? (trading.total_pnl / trading.total_trades).toFixed(4) : 0
        };
    }

    /**
     * Generate system summary
     */
    generateSystemSummary(health, errors, activity) {
        const totalErrors = errors.reduce((sum, e) => sum + e.count, 0);
        const errorRate = activity.total_actions > 0 ? 
            (totalErrors / activity.total_actions * 100).toFixed(2) : 0;

        return {
            activeUsers: activity.active_users || 0,
            totalActions: activity.total_actions || 0,
            avgResponseTime: activity.avg_response_time ? activity.avg_response_time.toFixed(2) : 0,
            totalErrors,
            errorRate: `${errorRate}%`,
            uptime: this.formatUptime(Date.now() - this.startTime)
        };
    }

    /**
     * Generate admin summary
     */
    generateAdminSummary(userStats, tradingStats, systemHealth) {
        const tradeSuccessRate = tradingStats.total_trades > 0 ? 
            (tradingStats.successful_trades / tradingStats.total_trades * 100).toFixed(2) : 0;

        return {
            totalUsers: userStats.total_users,
            adminCount: userStats.admin_count,
            userCount: userStats.user_count,
            totalTrades: tradingStats.total_trades,
            tradeSuccessRate: `${tradeSuccessRate}%`,
            totalPnL: tradingStats.total_pnl,
            avgExecutionTime: tradingStats.avg_execution_time ? tradingStats.avg_execution_time.toFixed(2) : 0,
            uptime: this.formatUptime(Date.now() - this.startTime)
        };
    }

    /**
     * Format uptime
     */
    formatUptime(ms) {
        const seconds = Math.floor(ms / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);
        const days = Math.floor(hours / 24);

        if (days > 0) return `${days}d ${hours % 24}h ${minutes % 60}m`;
        if (hours > 0) return `${hours}h ${minutes % 60}m`;
        if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
        return `${seconds}s`;
    }

    /**
     * Get real-time metrics
     */
    getRealTimeMetrics() {
        return {
            userActivity: Object.fromEntries(this.metrics.userActivity),
            tradingPerformance: Object.fromEntries(this.metrics.tradingPerformance),
            systemHealth: Object.fromEntries(this.metrics.systemHealth),
            errorRates: Object.fromEntries(
                Array.from(this.metrics.errorRates.entries()).map(([key, value]) => [
                    key, 
                    { count: value.count, affectedUsers: value.affectedUsers.size }
                ])
            )
        };
    }

    /**
     * Clean up old analytics data
     */
    async cleanupOldData(daysToKeep = 30) {
        try {
            if (!this.isInitialized) return;

            const cutoffDate = new Date(Date.now() - daysToKeep * 24 * 60 * 60 * 1000);
            
            const tables = ['user_activity', 'trading_performance', 'system_health', 'error_logs'];
            
            for (const table of tables) {
                await this.dataManager.database.run(
                    `DELETE FROM ${table} WHERE timestamp < ?`,
                    [cutoffDate.toISOString()]
                );
            }

            console.log(`🧹 Cleaned up analytics data older than ${daysToKeep} days`);
            
        } catch (error) {
            console.error('Failed to cleanup old analytics data:', error);
        }
    }
}

export { AnalyticsManager };
