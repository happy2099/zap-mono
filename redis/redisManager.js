// ==========================================
// ========== ZapBot RedisManager ==========
// ==========================================
// File: redis/redisManager.js
// Description: Redis manager for flight data and real-time caching

const redis = require('redis');
const { promisify } = require('util');
const { PublicKey } = require('@solana/web3.js');
const config = require('../config.js');
const { shortenAddress } = require('../utils.js');

class RedisManager {
    constructor() {
        this.client = null;
        this.isConnected = false;
        
        // In-memory cache for trade-ready tokens (Quantum Cache target)
        this.tradeReadyCache = new Map();
        
        // TTL configurations (in seconds)
        this.TTL = {
            TRADE_DATA: 15 * 60,       // 15 minutes for pre-built trade info
            LAUNCHPAD_POOL: 20,        // 20 seconds for rapidly changing launchpad data
            PRESIGNED_TX: 5 * 60,      // 5 minutes for a ready-to-fire transaction
            POSITIONS: 30 * 60,        // 30 minutes
            POOL_STATES: 5 * 60,       // 5 minutes
            TRANSACTION_CACHE: 60 * 60, // 1 hour
            USER_SESSIONS: 24 * 60 * 60, // 24 hours
            ACTIVE_TRADERS: 24 * 60 * 60, // 24 hours (CRITICAL FIX: Prevent trader data expiration)
            TRADE_QUEUE: 10 * 60       // 10 minutes
        };
    }

    async initialize() {
        try {
            // Create Redis client
            this.client = redis.createClient({
                socket: {
                    host: process.env.REDIS_HOST || 'localhost',
                    port: process.env.REDIS_PORT || 6379,
                    reconnectStrategy: (retries) => {
                        if (retries > 10) {
                            return new Error('Retry time exhausted');
                        }
                        return Math.min(retries * 100, 3000);
                    }
                },
                password: process.env.REDIS_PASSWORD
            });

            // Redis v4+ uses promises natively, no need for promisify
            this.get = this.client.get.bind(this.client);
            this.set = this.client.set.bind(this.client);
            this.del = this.client.del.bind(this.client);
            this.exists = this.client.exists.bind(this.client);
            this.expire = this.client.expire.bind(this.client);
            this.hget = this.client.hGet.bind(this.client);
            this.hset = this.client.hSet.bind(this.client);
            this.hdel = this.client.hDel.bind(this.client);
            this.hgetall = this.client.hGetAll.bind(this.client);
            this.sadd = this.client.sAdd.bind(this.client);
            this.srem = this.client.sRem.bind(this.client);
            this.smembers = this.client.sMembers.bind(this.client);
            this.lpush = this.client.lPush.bind(this.client);
            this.rpop = this.client.rPop.bind(this.client);
            this.llen = this.client.lLen.bind(this.client);
            this.hIncrBy = this.client.hIncrBy.bind(this.client);
            this.hincrby = this.hIncrBy; // Alias for lowercase compatibility

            // Connect to Redis
            try {
                await this.client.connect();
                this.isConnected = true;
                console.log('✅ RedisManager initialized successfully');
            } catch (error) {
                console.warn('⚠️ Redis connection failed:', error.message);
                throw error; // Re-throw to be handled by startup script
            }
            
        } catch (error) {
            console.error('❌ RedisManager initialization failed:', error);
            throw error;
        }
    }

    // Position management (real-time trading positions)
    async setPosition(userId, tokenMint, positionData) {
        const key = `positions:${userId}:${tokenMint}`;
        await this.set(key, JSON.stringify(positionData), 'EX', this.TTL.POSITIONS);
    }

    async getPosition(userId, tokenMint) {
        const key = `positions:${userId}:${tokenMint}`;
        const data = await this.get(key);
        return data ? JSON.parse(data) : null;
    }

    async deletePosition(userId, tokenMint) {
        const key = `positions:${userId}:${tokenMint}`;
        await this.del(key);
    }

    async getAllUserPositions(userId) {
        const pattern = `positions:${userId}:*`;
        const keys = await this.client.keys(pattern);
        const positions = {};
        
        for (const key of keys) {
            const tokenMint = key.split(':')[2];
            const data = await this.get(key);
            if (data) {
                positions[tokenMint] = JSON.parse(data);
            }
        }
        
        return positions;
    }

    // ===== PORTFOLIO SYNC METHODS (NEW INTEGRATION) =====
    
    // Fast portfolio position check with Redis-first approach
    async checkPortfolioPosition(tokenMint, userId = 'default') {
        try {
            const key = `portfolio:${tokenMint}`;
            const position = await this.get(key);
            
            if (position) {
                const positionData = JSON.parse(position);
                console.log(`[REDIS-PORTFOLIO] ⚡ Redis hit: ${positionData.amount} tokens (${positionData.symbol || 'Unknown'})`);
                return positionData.amount > 0;
            }
            
            console.log(`[REDIS-PORTFOLIO] ❌ No position found for token: ${tokenMint}`);
            return false;
            
        } catch (error) {
            console.error(`[REDIS-PORTFOLIO] ❌ Error checking portfolio position: ${error.message}`);
            return false;
        }
    }

    // Update portfolio position with Redis sync
    async updatePortfolioPosition(tokenMint, amount, action, price = null, userId = 'default') {
        try {
            console.log(`[REDIS-PORTFOLIO] 🔄 Updating position: ${action} ${amount} ${tokenMint}`);
            
            const key = `portfolio:${tokenMint}`;
            let position = await this.get(key);
            
            if (position) {
                position = JSON.parse(position);
            } else {
                position = {
                    amount: 0,
                    symbol: 'Unknown',
                    firstBought: new Date().toISOString(),
                    lastUpdated: new Date().toISOString()
                };
            }
            
            if (action === 'buy') {
                position.amount += amount;
                position.lastBought = new Date().toISOString();
                if (price) position.lastBuyPrice = price;
            } else if (action === 'sell') {
                position.amount -= amount;
                position.lastSold = new Date().toISOString();
                if (price) position.lastSellPrice = price;
            }
            
            position.lastUpdated = new Date().toISOString();
            
            if (position.amount > 0) {
                // Set position in Redis with 1 hour TTL
                await this.set(key, JSON.stringify(position), 'EX', 3600);
                console.log(`[REDIS-PORTFOLIO] ✅ Position updated: ${position.amount} ${tokenMint}`);
            } else {
                // Remove position if amount is 0 or negative
                await this.del(key);
                console.log(`[REDIS-PORTFOLIO] 🗑️ Removed position for ${tokenMint} (amount: ${position.amount})`);
            }
            
            return position;
            
        } catch (error) {
            console.error(`[REDIS-PORTFOLIO] ❌ Error updating portfolio: ${error.message}`);
            return null;
        }
    }

    // Get all portfolio positions
    async getAllPortfolioPositions() {
        try {
            const pattern = `portfolio:*`;
            const keys = await this.client.keys(pattern);
            const positions = {};
            
            for (const key of keys) {
                const tokenMint = key.split(':')[1];
                const data = await this.get(key);
                if (data) {
                    positions[tokenMint] = JSON.parse(data);
                }
            }
            
            return positions;
        } catch (error) {
            console.error(`[REDIS-PORTFOLIO] ❌ Error getting all portfolio positions: ${error.message}`);
            return {};
        }
    }

    // Sync portfolio from file to Redis
    async syncPortfolioFromFile(portfolioData) {
        try {
            console.log(`[REDIS-PORTFOLIO] 🔄 Syncing portfolio from file to Redis...`);
            
            for (const [tokenMint, position] of Object.entries(portfolioData.positions || {})) {
                const key = `portfolio:${tokenMint}`;
                if (position.amount > 0) {
                    await this.set(key, JSON.stringify(position), 'EX', 3600);
                } else {
                    await this.del(key);
                }
            }
            
            console.log(`[REDIS-PORTFOLIO] ✅ Portfolio synced to Redis`);
            
        } catch (error) {
            console.error(`[REDIS-PORTFOLIO] ❌ Error syncing portfolio: ${error.message}`);
        }
    }

    // --- Trade Data Cache (Replaces old CacheManager) ---
 async setTradeData(tokenMint, tradeData) {
    const key = `trade_data:${tokenMint}`;
    const dataString = JSON.stringify(tradeData, (key, value) =>
        typeof value === 'bigint' ? value.toString() : value
    );
    await this.set(key, dataString, { EX: this.TTL.TRADE_DATA });
}

async getTradeData(tokenMint) {
    const key = `trade_data:${tokenMint}`;
    const data = await this.get(key);
    if (!data) return null;
    return JSON.parse(data, (key, value) => {
        // Assuming amountRaw should be a BigInt, you can revive it here
        if (key === 'amountRaw' && value !== null) {
            try {
                return BigInt(value);
            } catch (e) {
                return value; // Keep as string if conversion fails
            }
        }
        return value;
    });
}

 // --- Launchpad Pool Data (Replaces old CacheManager) ---
 async addLaunchpadPoolData(poolId, poolData) {
    const key = `launchpad_pool:${poolId}`;
    const dataString = JSON.stringify(poolData);
    await this.set(key, dataString, { EX: this.TTL.LAUNCHPAD_POOL });
}

async getLaunchpadPoolData(poolId) {
    const key = `launchpad_pool:${poolId}`;
    const data = await this.get(key);
    return data ? JSON.parse(data) : null;
}

// --- Pre-Signed TX Cache (Replaces old CacheManager) ---
async addPreSignedTx(tokenMint, signedTxString) {
    const key = `presigned_tx:${tokenMint}`;
    await this.set(key, signedTxString, { EX: this.TTL.PRESIGNED_TX });
}

async getPreSignedTx(tokenMint) {
    const key = `presigned_tx:${tokenMint}`;
    return await this.get(key);
}

    // Pool state caching (for Pump.fun, Raydium, etc.)
    async setPoolState(tokenMint, poolData) {
        const key = `pool_state:${tokenMint}`;
        await this.set(key, JSON.stringify(poolData), 'EX', this.TTL.POOL_STATES);
    }

    async getPoolState(tokenMint) {
        const key = `pool_state:${tokenMint}`;
        const data = await this.get(key);
        return data ? JSON.parse(data) : null;
    }

    // Transaction cache (for deduplication and status tracking)
    async setTransactionCache(signature, txData) {
        const key = `tx_cache:${signature}`;
        await this.set(key, JSON.stringify(txData), 'EX', this.TTL.TRANSACTION_CACHE);
    }

    async getTransactionCache(signature) {
        const key = `tx_cache:${signature}`;
        const data = await this.get(key);
        return data ? JSON.parse(data) : null;
    }

    async isTransactionProcessed(signature) {
        return await this.exists(`tx_cache:${signature}`);
    }

    // Active traders (real-time monitoring)
    async setActiveTraders(userId, traders) {
        const key = `active_traders:${userId}`;
        
        try {
            // Clear existing
            await this.client.del(key);
            
            if (traders.length > 0) {
                // Add each trader individually (compatible with all Redis versions)
                for (const trader of traders) {
                    await this.client.sAdd(key, trader);
                }
                await this.client.expire(key, this.TTL.ACTIVE_TRADERS);
            }
            
            console.log(`[RedisManager] ✅ Set ${traders.length} active traders for user ${userId}: ${traders.join(', ')}`);
        } catch (error) {
            console.error(`[RedisManager] ❌ Failed to set active traders for user ${userId}:`, error.message);
        }
    }

    async getActiveTraders(userId) {
        const key = `active_traders:${userId}`;
        try {
            return await this.client.sMembers(key);
        } catch (error) {
            console.error(`[RedisManager] ❌ Failed to get active traders for user ${userId}:`, error.message);
            return [];
        }
    }

    async addActiveTrader(userId, traderWallet) {
        const key = `active_traders:${userId}`;
        await this.sadd(key, traderWallet);
        await this.expire(key, this.TTL.ACTIVE_TRADERS);
    }

    async removeActiveTrader(userId, traderWallet) {
        const key = `active_traders:${userId}`;
        await this.srem(key, traderWallet);
    }

    // Trade execution queue (for high-frequency trading)
    async addToTradeQueue(tradeData) {
        const key = 'trade_queue';
        await this.lpush(key, JSON.stringify(tradeData));
        await this.expire(key, this.TTL.TRADE_QUEUE);
    }

    async getNextTrade() {
        const key = 'trade_queue';
        const data = await this.rpop(key);
        return data ? JSON.parse(data) : null;
    }

    async getQueueLength() {
        const key = 'trade_queue';
        return await this.llen(key);
    }

    // User sessions (for real-time UI updates)
    async setUserSession(userId, sessionData) {
        const key = `user_session:${userId}`;
        await this.set(key, JSON.stringify(sessionData), 'EX', this.TTL.USER_SESSIONS);
    }

    async getUserSession(userId) {
        const key = `user_session:${userId}`;
        const data = await this.get(key);
        return data ? JSON.parse(data) : null;
    }

    // Real-time trade notifications
    async publishTradeNotification(userId, notification) {
        const channel = `trade_notifications:${userId}`;
        await this.client.publish(channel, JSON.stringify(notification));
    }

    async subscribeToTradeNotifications(userId, callback) {
        const channel = `trade_notifications:${userId}`;
        const subscriber = this.client.duplicate();
        await subscriber.connect();
        await subscriber.subscribe(channel, (message) => {
            callback(JSON.parse(message));
        });
        return subscriber;
    }

    // Performance metrics
    async incrementMetric(metricName, value = 1) {
        const key = `metrics:${metricName}`;
        await this.client.incrby(key, value);
        await this.expire(key, 3600); // 1 hour TTL for metrics
    }

    async getMetric(metricName) {
        const key = `metrics:${metricName}`;
        const value = await this.get(key);
        return value ? parseInt(value) : 0;
    }

    // Cache warming (for frequently accessed data)
    async warmCache() {
        console.log('🔥 Warming up Redis cache...');
        
        // Pre-load common pool states
        const commonTokens = [
            config.NATIVE_SOL_MINT, // WSOL
            'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
            // Add more common tokens as needed
        ];
        
        for (const tokenMint of commonTokens) {
            // This would typically fetch from your pool state API
            // For now, just set placeholder data - COMMENTED OUT
            // await this.setPoolState(tokenMint, { 
            //     lastUpdated: Date.now(),
            //     placeholder: true 
            // });
        }
        
        console.log('✅ Cache warming completed');
    }

    // Health check
    async healthCheck() {
        try {
            await this.client.ping();
            return { status: 'healthy', connected: this.isConnected };
        } catch (error) {
            return { status: 'unhealthy', error: error.message, connected: this.isConnected };
        }
    }

    // Cleanup
    async cleanup() {
        if (this.client && this.isConnected) {
            try {
                await this.client.quit();
            } catch (error) {
                console.warn('Redis cleanup warning:', error.message);
            }
            this.isConnected = false;
        }
    }

    // INSIDE RedisManager class in redisManager.js

    async getOrCacheTokenDecimals(mintAddress, solanaManager) {
        const key = `token_meta:${mintAddress}`;
        
        // 1. Check Redis first
        const cachedData = await this.get(key);
        if (cachedData) {
            // console.log(`[CACHE HIT] 🚀 Decimals for ${shortenAddress(mintAddress)}`); // Optional: can be noisy
            return parseInt(cachedData);
        }

        // 2. On miss, fetch from Solana
        console.log(`[CACHE MISS] 🐢 Fetching decimals for ${shortenAddress(mintAddress)} from RPC.`);
        const mintInfo = await solanaManager.connection.getParsedAccountInfo(new PublicKey(mintAddress));
        const decimals = mintInfo?.value?.data?.parsed?.info?.decimals;

        if (typeof decimals !== 'number') {
            throw new Error(`Could not fetch decimals for mint ${mintAddress}`);
        }

        // 3. Store in Redis for next time (decimals never change, so a long TTL is fine)
        await this.set(key, decimals.toString(), { EX: 86400 }); // Cache for 24 hours
        console.log(`[CACHE SET] ✅ Saved decimals for ${shortenAddress(mintAddress)} to Redis.`);
        return decimals;
    }

    async shutdown() {
        console.log('[Redis] Shutting down Redis manager...');
        await this.cleanup();
        console.log('[Redis] Redis manager shutdown complete');
    }

    // Missing methods for testing compatibility
    async setWithExpiry(key, value, ttlSeconds) {
        return await this.set(key, value, { EX: ttlSeconds });
    }

    async close() {
        return await this.cleanup();
    }

    // --- Trade Ready Cache Management (Quantum Cache) ---
    addToTradeReadyCache(tokenMint, tradeData) {
        this.tradeReadyCache.set(tokenMint, {
            ...tradeData,
            timestamp: Date.now(),
            dexPlatform: tradeData.dexPlatform || 'Unknown'
        });
    }

    getFromTradeReadyCache(tokenMint) {
        return this.tradeReadyCache.get(tokenMint);
    }

    removeFromTradeReadyCache(tokenMint) {
        return this.tradeReadyCache.delete(tokenMint);
    }

    getAllTradeReadyTokens() {
        return Array.from(this.tradeReadyCache.keys());
    }

    clearTradeReadyCache() {
        this.tradeReadyCache.clear();
    }

    getTradeReadyCacheSize() {
        return this.tradeReadyCache.size;
    }

    // ===== SETTINGS CACHING METHODS =====
    
    async setObject(key, object, ttlSeconds) {
        try {
            const dataString = JSON.stringify(object);
            await this.set(key, dataString, { EX: ttlSeconds });
            return true;
        } catch (error) {
            console.error(`[Redis] ❌ Failed to set object for key ${key}:`, error);
            return false;
        }
    }

    async getObject(key) {
        try {
            const dataString = await this.get(key);
            return dataString ? JSON.parse(dataString) : null;
        } catch (error) {
            console.error(`[Redis] ❌ Failed to get object for key ${key}:`, error);
            return null;
        }
    }

    async updateTokenStatusInRedis(tokenMint, statusData) {
        try {
            const key = `status:${tokenMint}`;
            // Use setObject to store the whole status object. Cache for 1 hour.
            await this.setObject(key, statusData, 3600); 
            // console.log(`[REDIS-STATUS] ✅ Updated status for ${tokenMint}`); // Optional: Can be noisy
        } catch (error) {
            console.error(`[REDIS-STATUS] ❌ Error updating status for ${tokenMint}:`, error);
        }
    }
}



module.exports = { RedisManager };
