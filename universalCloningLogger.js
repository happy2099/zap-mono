// ==========================================
// Universal Cloning Engine - Comprehensive Logging System
// ==========================================
// File: universalCloningLogger.js
// Description: Advanced logging and monitoring for the Universal Cloning Engine

const fs = require('fs').promises;
const path = require('path');

class UniversalCloningLogger {
    constructor() {
        this.logsDir = './logs/universal-cloning';
        this.ensureLogsDirectory();
        this.metrics = {
            totalTransactions: 0,
            successfulClones: 0,
            failedClones: 0,
            platformBreakdown: {},
            averageProcessingTime: 0,
            errorTypes: {}
        };
    }

    async ensureLogsDirectory() {
        try {
            await fs.mkdir(this.logsDir, { recursive: true });
        } catch (error) {
            console.error('Failed to create logs directory:', error.message);
        }
    }

    async logTransactionAnalysis(transactionData) {
        const logEntry = {
            timestamp: new Date().toISOString(),
            type: 'transaction_analysis',
            signature: transactionData.signature,
            trader: transactionData.traderPublicKey,
            platform: transactionData.platform,
            tradeType: transactionData.tradeType,
            inputMint: transactionData.inputMint,
            outputMint: transactionData.outputMint,
            isCopyable: transactionData.isCopyable,
            reason: transactionData.reason,
            processingTime: transactionData.processingTime
        };

        await this.writeLog('analysis', logEntry);
        this.updateMetrics('analysis', logEntry);
    }

    async logCloningAttempt(cloningData) {
        const logEntry = {
            timestamp: new Date().toISOString(),
            type: 'cloning_attempt',
            signature: cloningData.signature,
            userChatId: cloningData.userChatId,
            platform: cloningData.platform,
            programId: cloningData.programId,
            accountCount: cloningData.accountCount,
            dataLength: cloningData.dataLength,
            processingTime: cloningData.processingTime
        };

        await this.writeLog('cloning', logEntry);
        this.updateMetrics('cloning', logEntry);
    }

    async logCloningResult(resultData) {
        const logEntry = {
            timestamp: new Date().toISOString(),
            type: 'cloning_result',
            signature: resultData.signature,
            userChatId: resultData.userChatId,
            success: resultData.success,
            instructionCount: resultData.instructionCount,
            error: resultData.error,
            processingTime: resultData.processingTime
        };

        await this.writeLog('results', logEntry);
        this.updateMetrics('result', logEntry);
    }

    async logExecutionResult(executionData) {
        const logEntry = {
            timestamp: new Date().toISOString(),
            type: 'execution_result',
            signature: executionData.signature,
            userChatId: executionData.userChatId,
            success: executionData.success,
            transactionSignature: executionData.transactionSignature,
            error: executionData.error,
            simulationPassed: executionData.simulationPassed,
            executionTime: executionData.executionTime
        };

        await this.writeLog('execution', logEntry);
        this.updateMetrics('execution', logEntry);
    }

    async logError(errorData) {
        const logEntry = {
            timestamp: new Date().toISOString(),
            type: 'error',
            signature: errorData.signature,
            userChatId: errorData.userChatId,
            errorType: errorData.errorType,
            errorMessage: errorData.errorMessage,
            stack: errorData.stack,
            context: errorData.context
        };

        await this.writeLog('errors', logEntry);
        this.updateMetrics('error', logEntry);
    }

    async logPerformanceMetrics(metricsData) {
        const logEntry = {
            timestamp: new Date().toISOString(),
            type: 'performance_metrics',
            ...metricsData
        };

        await this.writeLog('performance', logEntry);
    }

    async writeLog(logType, data) {
        try {
            const filename = `${logType}_${new Date().toISOString().split('T')[0]}.jsonl`;
            const filepath = path.join(this.logsDir, filename);
            const logLine = JSON.stringify(data) + '\n';
            
            await fs.appendFile(filepath, logLine);
        } catch (error) {
            console.error('Failed to write log:', error.message);
        }
    }

    updateMetrics(type, data) {
        this.metrics.totalTransactions++;

        if (type === 'result') {
            if (data.success) {
                this.metrics.successfulClones++;
            } else {
                this.metrics.failedClones++;
            }
        }

        if (type === 'error') {
            const errorType = data.errorType || 'unknown';
            this.metrics.errorTypes[errorType] = (this.metrics.errorTypes[errorType] || 0) + 1;
        }

        if (data.platform) {
            this.metrics.platformBreakdown[data.platform] = (this.metrics.platformBreakdown[data.platform] || 0) + 1;
        }

        if (data.processingTime) {
            this.metrics.averageProcessingTime = (this.metrics.averageProcessingTime + data.processingTime) / 2;
        }
    }

    getMetrics() {
        return {
            ...this.metrics,
            successRate: this.metrics.totalTransactions > 0 ? 
                (this.metrics.successfulClones / this.metrics.totalTransactions) * 100 : 0,
            failureRate: this.metrics.totalTransactions > 0 ? 
                (this.metrics.failedClones / this.metrics.totalTransactions) * 100 : 0
        };
    }

    async generateDailyReport() {
        const metrics = this.getMetrics();
        const report = {
            date: new Date().toISOString().split('T')[0],
            summary: {
                totalTransactions: metrics.totalTransactions,
                successfulClones: metrics.successfulClones,
                failedClones: metrics.failedClones,
                successRate: metrics.successRate.toFixed(2) + '%',
                failureRate: metrics.failureRate.toFixed(2) + '%',
                averageProcessingTime: metrics.averageProcessingTime.toFixed(2) + 'ms'
            },
            platformBreakdown: metrics.platformBreakdown,
            errorBreakdown: metrics.errorTypes,
            recommendations: this.generateRecommendations(metrics)
        };

        const reportPath = path.join(this.logsDir, `daily_report_${report.date}.json`);
        await fs.writeFile(reportPath, JSON.stringify(report, null, 2));
        
        console.log('📊 Daily report generated:', reportPath);
        return report;
    }

    generateRecommendations(metrics) {
        const recommendations = [];

        if (metrics.successRate < 80) {
            recommendations.push('Success rate is below 80%. Consider reviewing error patterns and improving error handling.');
        }

        if (metrics.averageProcessingTime > 1000) {
            recommendations.push('Average processing time is above 1 second. Consider optimizing performance.');
        }

        const topError = Object.entries(metrics.errorTypes).sort((a, b) => b[1] - a[1])[0];
        if (topError && topError[1] > metrics.totalTransactions * 0.1) {
            recommendations.push(`Most common error: ${topError[0]} (${topError[1]} occurrences). Consider addressing this issue.`);
        }

        return recommendations;
    }

    async cleanupOldLogs(daysToKeep = 30) {
        try {
            const files = await fs.readdir(this.logsDir);
            const cutoffDate = new Date();
            cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

            for (const file of files) {
                const filePath = path.join(this.logsDir, file);
                const stats = await fs.stat(filePath);
                
                if (stats.mtime < cutoffDate) {
                    await fs.unlink(filePath);
                    console.log(`🗑️ Cleaned up old log file: ${file}`);
                }
            }
        } catch (error) {
            console.error('Failed to cleanup old logs:', error.message);
        }
    }

    // Real-time monitoring methods
    startRealTimeMonitoring() {
        setInterval(() => {
            const metrics = this.getMetrics();
            console.log('📊 Real-time Universal Cloning Metrics:', {
                totalTransactions: metrics.totalTransactions,
                successRate: metrics.successRate.toFixed(1) + '%',
                averageProcessingTime: metrics.averageProcessingTime.toFixed(0) + 'ms',
                topPlatform: Object.entries(metrics.platformBreakdown).sort((a, b) => b[1] - a[1])[0]?.[0] || 'N/A'
            });
        }, 60000); // Every minute
    }

    // Alert system for critical issues
    async checkForAlerts() {
        const metrics = this.getMetrics();
        const alerts = [];

        if (metrics.successRate < 50) {
            alerts.push({
                type: 'critical',
                message: `Success rate critically low: ${metrics.successRate.toFixed(1)}%`,
                timestamp: new Date().toISOString()
            });
        }

        if (metrics.averageProcessingTime > 5000) {
            alerts.push({
                type: 'warning',
                message: `Processing time very high: ${metrics.averageProcessingTime.toFixed(0)}ms`,
                timestamp: new Date().toISOString()
            });
        }

        if (alerts.length > 0) {
            await this.writeLog('alerts', { alerts });
            console.log('🚨 Universal Cloning Alerts:', alerts);
        }

        return alerts;
    }
}

// Export for use in other modules
module.exports = { UniversalCloningLogger };

// Auto-cleanup and reporting if this module is used
if (require.main === module) {
    const logger = new UniversalCloningLogger();
    
    // Generate daily report
    logger.generateDailyReport();
    
    // Cleanup old logs
    logger.cleanupOldLogs();
    
    // Start real-time monitoring
    logger.startRealTimeMonitoring();
    
    // Check for alerts
    setInterval(() => logger.checkForAlerts(), 300000); // Every 5 minutes
}
