import BaseWorker from './templates/baseWorker.js';
import { parentPort } from 'worker_threads';

class CacheManagerWorker extends BaseWorker {
    constructor() {
        super();
        this.cacheManager = null;
        this.cacheOperations = new Map();
        this.isInitialized = false;
    }

    async initialize() {
        await super.initialize();
        
        // Initialize cache manager
        await this.initializeCacheManager();
        
        // Register custom message handlers
        this.registerHandler('GET_CACHE', this.handleGetCache.bind(this));
        this.registerHandler('SET_CACHE', this.handleSetCache.bind(this));
        this.registerHandler('DELETE_CACHE', this.handleDeleteCache.bind(this));
        this.registerHandler('CLEAR_CACHE', this.handleClearCache.bind(this));
        this.registerHandler('CACHE_STATS', this.handleCacheStats.bind(this));
        
        console.log('CacheManagerWorker initialized');
    }

    async initializeCacheManager() {
        try {
            const { CacheManager } = await import('../cacheManager.js');
            this.cacheManager = new CacheManager();
            this.isInitialized = true;
            console.log('CacheManager initialized in worker');
        } catch (error) {
            console.error('Failed to initialize CacheManager in worker:', error);
            throw error;
        }
    }

    async handleGetCache(message) {
        const { key, defaultValue } = message.data;
        
        console.log(`Getting cache for key: ${key}`);
        
        try {
            const value = this.cacheManager.get(key, defaultValue);
            
            parentPort.postMessage({
                type: 'CACHE_RETRIEVED',
                key: key,
                value: value,
                timestamp: Date.now()
            });
        } catch (error) {
            console.error(`Error getting cache for key ${key}:`, error);
            
            parentPort.postMessage({
                type: 'CACHE_ERROR',
                key: key,
                error: error.message,
                timestamp: Date.now()
            });
        }
    }

    async handleSetCache(message) {
        const { key, value, ttl } = message.data;
        
        console.log(`Setting cache for key: ${key}`);
        
        try {
            this.cacheManager.set(key, value, ttl);
            
            parentPort.postMessage({
                type: 'CACHE_SET',
                key: key,
                success: true,
                timestamp: Date.now()
            });
        } catch (error) {
            console.error(`Error setting cache for key ${key}:`, error);
            
            parentPort.postMessage({
                type: 'CACHE_ERROR',
                key: key,
                error: error.message,
                timestamp: Date.now()
            });
        }
    }

    async handleDeleteCache(message) {
        const { key } = message.data;
        
        console.log(`Deleting cache for key: ${key}`);
        
        try {
            const deleted = this.cacheManager.delete(key);
            
            parentPort.postMessage({
                type: 'CACHE_DELETED',
                key: key,
                deleted: deleted,
                timestamp: Date.now()
            });
        } catch (error) {
            console.error(`Error deleting cache for key ${key}:`, error);
            
            parentPort.postMessage({
                type: 'CACHE_ERROR',
                key: key,
                error: error.message,
                timestamp: Date.now()
            });
        }
    }

    async handleClearCache(message) {
        console.log('Clearing all cache');
        
        try {
            this.cacheManager.clear();
            
            parentPort.postMessage({
                type: 'CACHE_CLEARED',
                success: true,
                timestamp: Date.now()
            });
        } catch (error) {
            console.error('Error clearing cache:', error);
            
            parentPort.postMessage({
                type: 'CACHE_ERROR',
                error: error.message,
                timestamp: Date.now()
            });
        }
    }

    async handleCacheStats(message) {
        console.log('Getting cache statistics');
        
        try {
            const stats = this.cacheManager.getStats();
            
            parentPort.postMessage({
                type: 'CACHE_STATS_RETRIEVED',
                stats: stats,
                timestamp: Date.now()
            });
        } catch (error) {
            console.error('Error getting cache stats:', error);
            
            parentPort.postMessage({
                type: 'CACHE_ERROR',
                error: error.message,
                timestamp: Date.now()
            });
        }
    }

    async cleanup() {
        console.log('Cleaning up CacheManagerWorker...');
        
        // Clear cache operations
        this.cacheOperations.clear();
        
        // Clear cache if needed
        if (this.cacheManager) {
            this.cacheManager.clear();
        }
        
        console.log('CacheManagerWorker cleanup complete');
    }
}

// Initialize worker
const worker = new CacheManagerWorker();
worker.initialize();

// Handle messages from main thread
parentPort.on('message', async (message) => {
    await worker.handleMessage(message);
});
