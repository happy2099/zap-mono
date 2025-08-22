// ==========================================
// ========== ZapBot RedisManager ==========
// ==========================================
// File: redis/redisManager.js
// Description: Redis manager for flight data and real-time caching

const redis = require('redis');
const { promisify } = require('util');

class RedisManager {
    constructor() {
        this.client = null;
        this.isConnected = false;
        
        // TTL configurations (in seconds)
        this.TTL = {
            POSITIONS: 30 * 60,        // 30 minutes
            POOL_STATES: 5 * 60,       // 5 minutes
            TRANSACTION_CACHE: 60 * 60, // 1 hour
            USER_SESSIONS: 24 * 60 * 60, // 24 hours
            ACTIVE_TRADERS: 15 * 60,   // 15 minutes
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
        await this.del(key); // Clear existing
        if (traders.length > 0) {
            await this.sadd(key, ...traders);
            await this.expire(key, this.TTL.ACTIVE_TRADERS);
        }
    }

    async getActiveTraders(userId) {
        const key = `active_traders:${userId}`;
        return await this.smembers(key);
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
            'So11111111111111111111111111111111111111112', // WSOL
            'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
            // Add more common tokens as needed
        ];
        
        for (const tokenMint of commonTokens) {
            // This would typically fetch from your pool state API
            // For now, just set placeholder data
            await this.setPoolState(tokenMint, { 
                lastUpdated: Date.now(),
                placeholder: true 
            });
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
}

module.exports = { RedisManager };
