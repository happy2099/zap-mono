// ==========================================
// ========== Cache Manager Worker ==========
// ==========================================
// File: workers/cacheManagerWorker.js
// Description: Handles cache operations in a separate thread

const { workerData } = require('worker_threads');
const BaseWorker = require('./templates/baseWorker');
const { CacheManager } = require('../cacheManager');

class CacheManagerWorker extends BaseWorker {
    constructor() {
        super();
        this.cacheManager = null;
        this.cacheStats = {
            hits: 0,
            misses: 0,
            sets: 0,
            deletes: 0,
            size: 0
        };
        this.cleanupInterval = null;
    }

    async customInitialize() {
        try {
            this.cacheManager = new CacheManager();
            
            // Start periodic cleanup
            this.startPeriodicCleanup();
            
            this.logInfo('Cache manager worker initialized successfully');
        } catch (error) {
            this.logError('Failed to initialize cache manager worker', { error: error.message });
            throw error;
        }
    }

    async handleMessage(message) {
        if (message.type === 'GET_CACHE') {
            await this.getCache(message.key);
        } else if (message.type === 'SET_CACHE') {
            await this.setCache(message.key, message.value, message.ttl);
        } else if (message.type === 'DELETE_CACHE') {
            await this.deleteCache(message.key);
        } else if (message.type === 'CLEAR_CACHE') {
            await this.clearCache();
        } else if (message.type === 'GET_CACHE_STATS') {
            await this.getCacheStats();
        } else if (message.type === 'ADD_TRADE_DATA') {
            await this.addTradeData(message.mint, message.tradeData);
        } else if (message.type === 'GET_TRADE_DATA') {
            await this.getTradeData(message.mint);
        } else if (message.type === 'ADD_LAUNCHPAD_POOL_DATA') {
            await this.addLaunchpadPoolData(message.poolId, message.data);
        } else if (message.type === 'GET_LAUNCHPAD_POOL_DATA') {
            await this.getLaunchpadPoolData(message.poolId);
        } else {
            await super.handleMessage(message);
        }
    }

    async getCache(key) {
        try {
            const value = this.cacheManager.get(key);
            if (value !== undefined) {
                this.cacheStats.hits++;
            } else {
                this.cacheStats.misses++;
            }
            
            this.signalMessage('CACHE_RETRIEVED', {
                key,
                value,
                hit: value !== undefined,
                timestamp: Date.now()
            });
        } catch (error) {
            this.logError('Failed to get cache', { key, error: error.message });
            this.signalMessage('CACHE_GET_ERROR', { key, error: error.message });
        }
    }

    async setCache(key, value, ttl = null) {
        try {
            this.cacheManager.set(key, value, ttl);
            this.cacheStats.sets++;
            this.cacheStats.size = this.cacheManager.size();
            
            this.signalMessage('CACHE_SET', {
                key,
                ttl,
                timestamp: Date.now()
            });
        } catch (error) {
            this.logError('Failed to set cache', { key, error: error.message });
            this.signalMessage('CACHE_SET_ERROR', { key, error: error.message });
        }
    }

    async deleteCache(key) {
        try {
            const deleted = this.cacheManager.delete(key);
            if (deleted) {
                this.cacheStats.deletes++;
                this.cacheStats.size = this.cacheManager.size();
            }
            
            this.signalMessage('CACHE_DELETED', {
                key,
                deleted,
                timestamp: Date.now()
            });
        } catch (error) {
            this.logError('Failed to delete cache', { key, error: error.message });
            this.signalMessage('CACHE_DELETE_ERROR', { key, error: error.message });
        }
    }

    async clearCache() {
        try {
            this.cacheManager.clear();
            this.cacheStats = {
                hits: 0,
                misses: 0,
                sets: 0,
                deletes: 0,
                size: 0
            };
            
            this.signalMessage('CACHE_CLEARED', {
                timestamp: Date.now()
            });
        } catch (error) {
            this.logError('Failed to clear cache', { error: error.message });
            this.signalMessage('CACHE_CLEAR_ERROR', { error: error.message });
        }
    }

    async getCacheStats() {
        try {
            const stats = {
                ...this.cacheStats,
                hitRate: this.cacheStats.hits / (this.cacheStats.hits + this.cacheStats.misses) || 0,
                currentSize: this.cacheManager.size(),
                timestamp: Date.now()
            };
            
            this.signalMessage('CACHE_STATS_RESPONSE', stats);
        } catch (error) {
            this.logError('Failed to get cache stats', { error: error.message });
        }
    }

    async addTradeData(mint, tradeData) {
        try {
            this.cacheManager.addTradeData(mint, tradeData);
            this.cacheStats.sets++;
            this.cacheStats.size = this.cacheManager.size();
            
            this.signalMessage('TRADE_DATA_ADDED', {
                mint,
                timestamp: Date.now()
            });
        } catch (error) {
            this.logError('Failed to add trade data', { mint, error: error.message });
            this.signalMessage('TRADE_DATA_ADD_ERROR', { mint, error: error.message });
        }
    }

    async getTradeData(mint) {
        try {
            const tradeData = this.cacheManager.getTradeData(mint);
            if (tradeData) {
                this.cacheStats.hits++;
            } else {
                this.cacheStats.misses++;
            }
            
            this.signalMessage('TRADE_DATA_RETRIEVED', {
                mint,
                tradeData,
                found: tradeData !== null,
                timestamp: Date.now()
            });
        } catch (error) {
            this.logError('Failed to get trade data', { mint, error: error.message });
            this.signalMessage('TRADE_DATA_GET_ERROR', { mint, error: error.message });
        }
    }

    async addLaunchpadPoolData(poolId, data) {
        try {
            this.cacheManager.addLaunchpadPoolData(poolId, data);
            this.cacheStats.sets++;
            this.cacheStats.size = this.cacheManager.size();
            
            this.signalMessage('LAUNCHPAD_POOL_DATA_ADDED', {
                poolId,
                timestamp: Date.now()
            });
        } catch (error) {
            this.logError('Failed to add launchpad pool data', { poolId, error: error.message });
            this.signalMessage('LAUNCHPAD_POOL_DATA_ADD_ERROR', { poolId, error: error.message });
        }
    }

    async getLaunchpadPoolData(poolId) {
        try {
            const poolData = this.cacheManager.getLaunchpadPoolData(poolId);
            if (poolData) {
                this.cacheStats.hits++;
            } else {
                this.cacheStats.misses++;
            }
            
            this.signalMessage('LAUNCHPAD_POOL_DATA_RETRIEVED', {
                poolId,
                poolData,
                found: poolData !== null,
                timestamp: Date.now()
            });
        } catch (error) {
            this.logError('Failed to get launchpad pool data', { poolId, error: error.message });
            this.signalMessage('LAUNCHPAD_POOL_DATA_GET_ERROR', { poolId, error: error.message });
        }
    }

    startPeriodicCleanup() {
        const CLEANUP_INTERVAL = 60000; // 1 minute
        
        this.cleanupInterval = setInterval(async () => {
            if (this.isShuttingDown) {
                return;
            }

            try {
                await this.performCleanup();
            } catch (error) {
                this.logError('Error in periodic cleanup', { error: error.message });
            }
        }, CLEANUP_INTERVAL);

        this.logInfo('Periodic cleanup started', { interval: CLEANUP_INTERVAL });
    }

    async performCleanup() {
        try {
            // Perform cache cleanup operations
            const beforeSize = this.cacheManager.size();
            
            // Clean expired entries
            this.cacheManager.cleanup();
            
            const afterSize = this.cacheManager.size();
            const cleaned = beforeSize - afterSize;
            
            if (cleaned > 0) {
                this.logInfo('Cache cleanup completed', { 
                    beforeSize, 
                    afterSize, 
                    cleaned 
                });
            }
        } catch (error) {
            this.logError('Cache cleanup failed', { error: error.message });
        }
    }

    async customCleanup() {
        try {
            if (this.cleanupInterval) {
                clearInterval(this.cleanupInterval);
                this.cleanupInterval = null;
            }

            this.logInfo('Cache manager worker cleanup completed');
        } catch (error) {
            this.logError('Error during cleanup', { error: error.message });
        }
    }

    async customHealthCheck() {
        try {
            return {
                healthy: true,
                cacheSize: this.cacheManager.size(),
                stats: this.cacheStats,
                hitRate: this.cacheStats.hits / (this.cacheStats.hits + this.cacheStats.misses) || 0
            };
        } catch (error) {
            this.logError('Health check failed', { error: error.message });
            return { healthy: false, error: error.message };
        }
    }
}

// Initialize worker if this file is run directly
if (require.main === module) {
    const worker = new CacheManagerWorker();
    worker.initialize().catch(error => {
        console.error('Cache manager worker failed to initialize:', error);
        process.exit(1);
    });
}

module.exports = CacheManagerWorker;

