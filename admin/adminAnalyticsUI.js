#!/usr/bin/env node

import { AnalyticsManager } from '../analytics/analyticsManager.js';
import { escapeMarkdownV2, safeEscapeMarkdownV2 } from '../utils.js';

/**
 * Admin Analytics UI for ZapBot
 * Provides rich analytics and monitoring interface for admins
 */
class AdminAnalyticsUI {
    constructor() {
        this.analyticsManager = null;
        this.isInitialized = false;
    }

    /**
     * Initialize the admin analytics UI
     */
    async initialize() {
        try {
            this.analyticsManager = new AnalyticsManager();
            await this.analyticsManager.initialize();
            this.isInitialized = true;
            console.log('📊 Admin Analytics UI initialized successfully');
        } catch (error) {
            console.error('Failed to initialize Admin Analytics UI:', error);
            throw error;
        }
    }

    /**
     * Get admin dashboard message
     */
    async getAdminDashboardMessage() {
        try {
            if (!this.isInitialized) {
                return this.createErrorMessage('Analytics system not initialized');
            }

            const dashboard = await this.analyticsManager.getAdminDashboard();
            if (!dashboard) {
                return this.createErrorMessage('Failed to load dashboard data');
            }

            return this.formatAdminDashboard(dashboard);
        } catch (error) {
            console.error('Failed to get admin dashboard:', error);
            return this.createErrorMessage('Failed to load admin dashboard');
        }
    }

    /**
     * Get user analytics message
     */
    async getUserAnalyticsMessage(userId, timeRange = '7d') {
        try {
            if (!this.isInitialized) {
                return this.createErrorMessage('Analytics system not initialized');
            }

            const analytics = await this.analyticsManager.getUserAnalytics(userId, timeRange);
            if (!analytics) {
                return this.createErrorMessage('Failed to load user analytics');
            }

            return this.formatUserAnalytics(analytics);
        } catch (error) {
            console.error('Failed to get user analytics:', error);
            return this.createErrorMessage('Failed to load user analytics');
        }
    }

    /**
     * Get system analytics message
     */
    async getSystemAnalyticsMessage(timeRange = '24h') {
        try {
            if (!this.isInitialized) {
                return this.createErrorMessage('Analytics system not initialized');
            }

            const analytics = await this.analyticsManager.getSystemAnalytics(timeRange);
            if (!analytics) {
                return this.createErrorMessage('Failed to load system analytics');
            }

            return this.formatSystemAnalytics(analytics);
        } catch (error) {
            console.error('Failed to get system analytics:', error);
            return this.createErrorMessage('Failed to load system analytics');
        }
    }

    /**
     * Format admin dashboard
     */
    formatAdminDashboard(dashboard) {
        const { userStats, tradingStats, systemHealth, summary } = dashboard;

        const message = `📊 *ADMIN DASHBOARD*

👥 *User Statistics*
• Total Users: \`${userStats.total_users}\`
• Admins: \`${userStats.admin_count}\`
• Regular Users: \`${userStats.user_count}\`

💰 *Trading Performance*
• Total Trades: \`${tradingStats.total_trades || 0}\`
• Success Rate: \`${summary.tradeSuccessRate}\`
• Total PnL: \`${tradingStats.total_pnl || 0} SOL\`
• Avg Execution: \`${summary.avgExecutionTime}ms\`

⚡ *System Health*
• Uptime: \`${summary.uptime}\`
• Memory Usage: \`${this.getMemoryUsage(systemHealth)}%\`
• CPU Usage: \`${this.getCPUUsage(systemHealth)}%\`
• Active Connections: \`${this.getActiveConnections(systemHealth)}\`

📈 *Recent Activity*
${this.formatRecentActivity(dashboard.recentActivity)}

🔧 *Quick Actions*
/analytics\\_users - User Analytics
/analytics\\_system - System Analytics
/analytics\\_realtime - Real-time Metrics
/analytics\\_cleanup - Clean Old Data`;

        return {
            text: message,
            parse_mode: 'MarkdownV2'
        };
    }

    /**
     * Format user analytics
     */
    formatUserAnalytics(analytics) {
        const { userId, timeRange, activity, trading, summary } = analytics;

        const message = `📊 *USER ANALYTICS*

👤 *User ID*: \`${userId}\`
📅 *Time Range*: \`${timeRange}\`

📈 *Activity Summary*
• Total Actions: \`${summary.totalActions}\`
• Success Rate: \`${summary.successRate}\`
• Avg Response Time: \`${summary.avgResponseTime}ms\`

💰 *Trading Performance*
• Total Trades: \`${summary.totalTrades}\`
• Trade Success Rate: \`${summary.tradeSuccessRate}\`
• Total PnL: \`${summary.totalPnL} SOL\`
• Avg PnL: \`${summary.avgPnL} SOL\`

📋 *Activity Breakdown*
${this.formatActivityBreakdown(activity)}

🔧 *Actions*
/analytics\\_user\\_${userId}\\_24h - Last 24h
/analytics\\_user\\_${userId}\\_7d - Last 7 days
/analytics\\_user\\_${userId}\\_30d - Last 30 days`;

        return {
            text: message,
            parse_mode: 'MarkdownV2'
        };
    }

    /**
     * Format system analytics
     */
    formatSystemAnalytics(analytics) {
        const { timeRange, health, errors, activity, summary } = analytics;

        const message = `📊 *SYSTEM ANALYTICS*

📅 *Time Range*: \`${timeRange}\`

⚡ *System Performance*
• Active Users: \`${summary.activeUsers}\`
• Total Actions: \`${summary.totalActions}\`
• Avg Response Time: \`${summary.avgResponseTime}ms\`
• Error Rate: \`${summary.errorRate}\`
• Uptime: \`${summary.uptime}\`

🔧 *System Health*
${this.formatSystemHealth(health)}

❌ *Error Analysis*
${this.formatErrorAnalysis(errors)}

📊 *Performance Metrics*
${this.formatPerformanceMetrics(health)}

🔧 *Actions*
/analytics\\_system\\_1h - Last Hour
/analytics\\_system\\_24h - Last 24h
/analytics\\_system\\_7d - Last 7 days`;

        return {
            text: message,
            parse_mode: 'MarkdownV2'
        };
    }

    /**
     * Format recent activity
     */
    formatRecentActivity(activities) {
        if (!activities || activities.length === 0) {
            return '• No recent activity';
        }

        return activities.slice(0, 5).map(activity => {
            const status = activity.success ? '✅' : '❌';
            const time = new Date(activity.timestamp).toLocaleTimeString();
            const username = activity.username || 'Unknown';
            const action = activity.action_type.replace(/_/g, ' ').toUpperCase();
            
            return `• ${status} \`${username}\` - ${action} (${time})`;
        }).join('\n');
    }

    /**
     * Format activity breakdown
     */
    formatActivityBreakdown(activities) {
        if (!activities || activities.length === 0) {
            return '• No activity recorded';
        }

        return activities.map(activity => {
            const action = activity.action_type.replace(/_/g, ' ').toUpperCase();
            const count = activity.count;
            const successRate = activity.count > 0 ? 
                ((activity.success_count / activity.count) * 100).toFixed(1) : 0;
            
            return `• ${action}: \`${count}\` (${successRate}% success)`;
        }).join('\n');
    }

    /**
     * Format system health
     */
    formatSystemHealth(health) {
        if (!health || health.length === 0) {
            return '• No health data available';
        }

        return health.map(metric => {
            const name = metric.metric_name.replace(/_/g, ' ').toUpperCase();
            const value = metric.avg_value ? metric.avg_value.toFixed(2) : 'N/A';
            const unit = metric.metric_unit || '';
            
            return `• ${name}: \`${value}${unit}\``;
        }).join('\n');
    }

    /**
     * Format error analysis
     */
    formatErrorAnalysis(errors) {
        if (!errors || errors.length === 0) {
            return '• No errors recorded';
        }

        return errors.slice(0, 5).map(error => {
            const type = error.error_type.replace(/_/g, ' ').toUpperCase();
            const count = error.count;
            const users = error.affected_users;
            
            return `• ${type}: \`${count}\` (${users} users affected)`;
        }).join('\n');
    }

    /**
     * Format performance metrics
     */
    formatPerformanceMetrics(health) {
        const metrics = {
            'memory_usage': 'Memory Usage',
            'cpu_usage': 'CPU Usage',
            'response_time': 'Response Time',
            'active_connections': 'Active Connections',
            'database_queries': 'DB Queries/sec'
        };

        return Object.entries(metrics).map(([key, label]) => {
            const metric = health.find(h => h.metric_name === key);
            if (!metric) return `• ${label}: \`N/A\``;
            
            const value = metric.avg_value ? metric.avg_value.toFixed(2) : 'N/A';
            const unit = metric.metric_unit || '';
            
            return `• ${label}: \`${value}${unit}\``;
        }).join('\n');
    }

    /**
     * Get memory usage from system health
     */
    getMemoryUsage(systemHealth) {
        const memoryMetric = systemHealth.find(h => h.metric_name === 'memory_usage');
        return memoryMetric ? memoryMetric.metric_value.toFixed(1) : 'N/A';
    }

    /**
     * Get CPU usage from system health
     */
    getCPUUsage(systemHealth) {
        const cpuMetric = systemHealth.find(h => h.metric_name === 'cpu_usage');
        return cpuMetric ? cpuMetric.metric_value.toFixed(1) : 'N/A';
    }

    /**
     * Get active connections from system health
     */
    getActiveConnections(systemHealth) {
        const connectionMetric = systemHealth.find(h => h.metric_name === 'active_connections');
        return connectionMetric ? connectionMetric.metric_value.toFixed(0) : 'N/A';
    }

    /**
     * Create error message
     */
    createErrorMessage(message) {
        return {
            text: `❌ *ANALYTICS ERROR*\n\n${safeEscapeMarkdownV2(message)}`,
            parse_mode: 'MarkdownV2'
        };
    }

    /**
     * Get real-time metrics message
     */
    async getRealTimeMetricsMessage() {
        try {
            if (!this.isInitialized) {
                return this.createErrorMessage('Analytics system not initialized');
            }

            const metrics = this.analyticsManager.getRealTimeMetrics();
            return this.formatRealTimeMetrics(metrics);
        } catch (error) {
            console.error('Failed to get real-time metrics:', error);
            return this.createErrorMessage('Failed to load real-time metrics');
        }
    }

    /**
     * Format real-time metrics
     */
    formatRealTimeMetrics(metrics) {
        const message = `📊 *REAL-TIME METRICS*

👥 *User Activity*
• Active Sessions: \`${Object.keys(metrics.userActivity).length}\`
• Total Actions: \`${this.getTotalActions(metrics.userActivity)}\`

💰 *Trading Performance*
• Active Traders: \`${Object.keys(metrics.tradingPerformance).length}\`
• Total Trades: \`${this.getTotalTrades(metrics.tradingPerformance)}\`

⚡ *System Health*
• Metrics Tracked: \`${Object.keys(metrics.systemHealth).length}\`
• Error Types: \`${Object.keys(metrics.errorRates).length}\`

🔄 *Live Updates*
This data updates in real-time as users interact with the system.

🔧 *Actions*
/analytics\\_refresh - Refresh Metrics
/analytics\\_dashboard - Full Dashboard
/analytics\\_system - System Analytics`;

        return {
            text: message,
            parse_mode: 'MarkdownV2'
        };
    }

    /**
     * Get total actions from user activity
     */
    getTotalActions(userActivity) {
        return Object.values(userActivity).reduce((sum, activity) => sum + activity.count, 0);
    }

    /**
     * Get total trades from trading performance
     */
    getTotalTrades(tradingPerformance) {
        return Object.values(tradingPerformance).reduce((sum, performance) => sum + performance.totalTrades, 0);
    }

    /**
     * Clean up old analytics data
     */
    async cleanupOldData(daysToKeep = 30) {
        try {
            if (!this.isInitialized) {
                return this.createErrorMessage('Analytics system not initialized');
            }

            await this.analyticsManager.cleanupOldData(daysToKeep);
            
            return {
                text: `🧹 *DATA CLEANUP COMPLETE*\n\nCleaned up analytics data older than \`${daysToKeep}\` days.`,
                parse_mode: 'MarkdownV2'
            };
        } catch (error) {
            console.error('Failed to cleanup old data:', error);
            return this.createErrorMessage('Failed to cleanup old data');
        }
    }

    /**
     * Track user activity (wrapper for analytics manager)
     */
    async trackUserActivity(userId, actionType, actionDetails = null, success = true, responseTime = null) {
        if (this.isInitialized) {
            await this.analyticsManager.trackUserActivity(userId, actionType, actionDetails, success, responseTime);
        }
    }

    /**
     * Track trading performance (wrapper for analytics manager)
     */
    async trackTradingPerformance(userId, traderWallet, tradeData) {
        if (this.isInitialized) {
            await this.analyticsManager.trackTradingPerformance(userId, traderWallet, tradeData);
        }
    }

    /**
     * Track system health (wrapper for analytics manager)
     */
    async trackSystemHealth(metricName, metricValue, metricUnit = null) {
        if (this.isInitialized) {
            await this.analyticsManager.trackSystemHealth(metricName, metricValue, metricUnit);
        }
    }

    /**
     * Track error (wrapper for analytics manager)
     */
    async trackError(errorType, errorMessage, userId = null, stackTrace = null) {
        if (this.isInitialized) {
            await this.analyticsManager.trackError(errorType, errorMessage, userId, stackTrace);
        }
    }
}

export { AdminAnalyticsUI };
