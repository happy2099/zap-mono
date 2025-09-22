const fs = require('fs');
const path = require('path');

class TransactionLogger {
    constructor() {
        this.transactionsDir = './transactions';
        this.ensureTransactionsDirectory();
    }

    ensureTransactionsDirectory() {
        if (!fs.existsSync(this.transactionsDir)) {
            fs.mkdirSync(this.transactionsDir, { recursive: true });
        }
    }

    /**
     * Log transaction analysis to JSON file
     */
    logTransactionAnalysis(signature, analysisData) {
        try {
            const timestamp = new Date().toISOString();
            const filename = `analysis_${signature}.json`;
            const filepath = path.join(this.transactionsDir, filename);
            
            const logData = {
                timestamp,
                signature,
                analysis: analysisData,
                logType: 'transaction_analysis'
            };

            fs.writeFileSync(filepath, JSON.stringify(logData, null, 2));
            console.log(`[TRANSACTION-LOGGER] 📝 Analysis logged to: ${filename}`);
            
            return filepath;
        } catch (error) {
            console.error(`[TRANSACTION-LOGGER] ❌ Failed to log analysis:`, error.message);
        }
    }

    /**
     * Log copy trade execution to JSON file
     */
    logCopyTradeExecution(signature, tradeDetails, executionResult) {
        try {
            const timestamp = new Date().toISOString();
            const filename = `copy_trade_${signature}.json`;
            const filepath = path.join(this.transactionsDir, filename);
            
            const logData = {
                timestamp,
                masterSignature: signature,
                tradeDetails,
                executionResult,
                logType: 'copy_trade_execution'
            };

            // Enhanced circular reference handling with comprehensive cleanup
            const cleanLogData = this._cleanCircularReferences(logData);
            
            fs.writeFileSync(filepath, JSON.stringify(cleanLogData, null, 2));
            console.log(`[TRANSACTION-LOGGER] 📝 Copy trade logged to: ${filename}`);
            
            return filepath;
        } catch (error) {
            console.error(`[TRANSACTION-LOGGER] ❌ Failed to log copy trade:`, error.message);
        }
    }

    /**
     * Enhanced circular reference cleaner
     */
    _cleanCircularReferences(obj, seen = new WeakSet()) {
        if (obj === null || typeof obj !== 'object') {
            return obj;
        }

        // Handle circular references
        if (seen.has(obj)) {
            return '[Circular Reference]';
        }
        seen.add(obj);

        // Handle different object types
        if (obj instanceof Error) {
            return {
                name: obj.name,
                message: obj.message,
                stack: obj.stack
            };
        }

        if (obj instanceof Date) {
            return obj.toISOString();
        }

        if (Buffer.isBuffer(obj)) {
            return `[Buffer: ${obj.length} bytes]`;
        }

        if (typeof obj === 'function') {
            return '[Function]';
        }

        if (Array.isArray(obj)) {
            return obj.map(item => this._cleanCircularReferences(item, seen));
        }

        // Handle objects
        const cleaned = {};
        for (const [key, value] of Object.entries(obj)) {
            // Skip problematic keys
            if (key === 'connection' || key === '_events' || key === 'context' || 
                key === 'solanaManager' || key === 'dataManager' || key === 'walletManager' ||
                key === 'apiManager' || key === 'redisManager' || key === 'notificationManager') {
                cleaned[key] = '[Manager Object]';
                continue;
            }

            // Skip large objects that aren't essential
            if (key === 'rawTransaction' || key === 'originalTransaction' || key === 'meta') {
                cleaned[key] = '[Large Object - Truncated]';
                continue;
            }

            try {
                cleaned[key] = this._cleanCircularReferences(value, seen);
            } catch (error) {
                cleaned[key] = `[Error cleaning: ${error.message}]`;
            }
        }

        return cleaned;
    }

    /**
     * Log platform detection to JSON file
     */
    logPlatformDetection(signature, platformData) {
        try {
            const timestamp = new Date().toISOString();
            const filename = `platform_${signature}.json`;
            const filepath = path.join(this.transactionsDir, filename);
            
            const logData = {
                timestamp,
                signature,
                platformDetection: platformData,
                logType: 'platform_detection'
            };

            fs.writeFileSync(filepath, JSON.stringify(logData, null, 2));
            console.log(`[TRANSACTION-LOGGER] 📝 Platform detection logged to: ${filename}`);
            
            return filepath;
        } catch (error) {
            console.error(`[TRANSACTION-LOGGER] ❌ Failed to log platform detection:`, error.message);
        }
    }

    /**
     * Log deep analysis results to JSON file with trader-specific naming
     */
    logDeepAnalysis(signature, deepAnalysisData, traderAddress = null) {
        try {
            const timestamp = new Date().toISOString();
            const filename = `deep_analysis_${signature}.json`;
            const filepath = path.join(this.transactionsDir, filename);
            
            const logData = {
                timestamp,
                signature,
                traderAddress: traderAddress || signature,
                ...deepAnalysisData, // Spread the analysis data directly
                logType: 'deep_analysis'
            };

            fs.writeFileSync(filepath, JSON.stringify(logData, null, 2));
            console.log(`[TRANSACTION-LOGGER] 📝 Deep analysis logged to: ${filename} for trader: ${traderAddress || signature}`);
            
            return filepath;
        } catch (error) {
            console.error(`[TRANSACTION-LOGGER] ❌ Failed to log deep analysis:`, error.message);
        }
    }

    /**
     * Log failed transaction analysis to JSON file
     */
    logFailedAnalysis(signature, failureReason, rawTransaction) {
        try {
            const timestamp = new Date().toISOString();
            const filename = `failed_analysis_${signature}.json`;
            const filepath = path.join(this.transactionsDir, filename);
            
            const logData = {
                timestamp,
                signature,
                failureReason,
                rawTransaction,
                logType: 'failed_analysis'
            };

            fs.writeFileSync(filepath, JSON.stringify(logData, null, 2));
            console.log(`[TRANSACTION-LOGGER] 📝 Failed analysis logged to: ${filename}`);
            
            return filepath;
        } catch (error) {
            console.error(`[TRANSACTION-LOGGER] ❌ Failed to log failed analysis:`, error.message);
        }
    }

    /**
     * Get all transaction logs for a specific signature
     */
    getTransactionLogs(signature) {
        try {
            const files = fs.readdirSync(this.transactionsDir);
            
            return files
                .filter(file => file.includes(signature))
                .map(file => {
                    const filepath = path.join(this.transactionsDir, file);
                    const content = fs.readFileSync(filepath, 'utf8');
                    return JSON.parse(content);
                })
                .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
        } catch (error) {
            console.error(`[TRANSACTION-LOGGER] ❌ Failed to get transaction logs:`, error.message);
            return [];
        }
    }

    /**
     * Clean up old log files (keep last 1000)
     */
    cleanupOldLogs() {
        try {
            const files = fs.readdirSync(this.transactionsDir);
            if (files.length > 1000) {
                const sortedFiles = files
                    .map(file => ({
                        name: file,
                        path: path.join(this.transactionsDir, file),
                        stats: fs.statSync(path.join(this.transactionsDir, file))
                    }))
                    .sort((a, b) => b.stats.mtime.getTime() - a.stats.mtime.getTime());

                const filesToDelete = sortedFiles.slice(1000);
                filesToDelete.forEach(file => {
                    fs.unlinkSync(file.path);
                });

                console.log(`[TRANSACTION-LOGGER] 🧹 Cleaned up ${filesToDelete.length} old log files`);
            }
        } catch (error) {
            console.error(`[TRANSACTION-LOGGER] ❌ Failed to cleanup old logs:`, error.message);
        }
    }
}

module.exports = TransactionLogger;
