// ==========================================
// ====== ZapBot CacheManager (Quantum Core) ======
// ==========================================
// File: cacheManager.js
// Description: An in-memory, time-expiring cache for pre-fetched pool keys, 
//              routes, and pre-built transactions to enable zero-latency swaps.

const { shortenAddress } = require('./utils');

class CacheManager {
    constructor() {
        // Main cache: Maps a token's MINT ADDRESS to its trade-ready data packet
        // The packet can contain: poolKeys, platform, pre-built instructions, etc.
        this.tradeReadyCache = new Map();
         this.launchpadPoolCache = new Map();
            this.preSignedTxCache = new Map();

        // The "quantum superposition" part: cache of recent blockhashes and fees
        this.networkStateCache = {
            blockhash: null,
            priorityFee: null,
            lastUpdated: 0,
        };
        
        // How long to keep pre-fetched data before it's considered stale (e.g., 5 minutes)
        this.CACHE_LIFETIME_MS = 20 * 60 * 1000;
        
        console.log("CacheManager (Quantum Core) initialized.");
    }

    /**
     * Adds trade-ready data for a specific token mint to the cache.
     * The data will automatically be removed after CACHE_LIFETIME_MS.
     * @param {string} tokenMint The mint address of the token.
     * @param {object} tradeData The pre-fetched data packet (e.g., poolKeys).
     */
    addTradeData(tokenMint, tradeData) {
        this.tradeReadyCache.set(tokenMint, tradeData);
        console.log(`[QUANTUM CACHE] ⚡ PRE-BUILT state for token ${shortenAddress(tokenMint)} stored.`);

        // Set a timer to "decohere" or expire the cached state
        setTimeout(() => {
            if (this.tradeReadyCache.has(tokenMint)) {
                this.tradeReadyCache.delete(tokenMint);
                console.log(`[QUANTUM CACHE] ⏳ STALE state for token ${shortenAddress(tokenMint)} cleared.`);
            }
        }, this.CACHE_LIFETIME_MS);
    }

    pruneTradeData(tokenMint, reason) {
    if (this.tradeReadyCache.has(tokenMint)) {
        this.tradeReadyCache.delete(tokenMint);
         this.preSignedTxCache.delete(tokenMint);
        console.log(`[JANITOR] 🧹 PRUNED dead cache for token ${shortenAddress(tokenMint)}. Reason: ${reason}.`);
    }
}

    /**
     * Retrieves the pre-fetched trade data for a token mint.
     * Returns the data packet if it exists and is not stale, otherwise null.
     * @param {string} tokenMint The mint address of the token to look up.
     * @returns {object | null}
     */
 getTradeData(tokenMint) {
        if (this.tradeReadyCache.has(tokenMint)) {
            // No validation log needed here, we just return the data.
            return this.tradeReadyCache.get(tokenMint);
        }
        return null; // Return null on a miss.
    }

async getCachedPoolData(mintAddress) {
    const cacheKey = `pool:${mintAddress}`;
    const cached = this.launchpadPoolCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < config.BLOCKHASH_CACHE_EXPIRATION) {
        console.log(`[DIAG] Cache hit for pool data: ${mintAddress}`);
        utils.logPerformance('cache_hit', { key: cacheKey, timestamp: cached.timestamp });
        return cached.data;
    }
    console.log(`[DIAG] Cache miss or stale for pool data: ${mintAddress}`);
    utils.logPerformance('cache_miss', { key: cacheKey });
    return null;
}

    /**
     * Updates the cached network state (blockhash, priority fees).
     * @param {object} networkState - Contains blockhash and priorityFee.
     */
    updateNetworkState(networkState) {
        this.networkStateCache = {
            ...networkState,
            lastUpdated: Date.now()
        };
        // This log can be noisy, so keep it optional
        // console.log(`[QUANTUM CACHE] Network state refreshed. Fee: ${networkState.priorityFee} lamports.`);
    }

    /**
     * Retrieves the latest cached network state.
     * @returns {object}
     */
    getNetworkState() {
        return this.networkStateCache;
    }

        /**
     * Adds detailed Raydium Launchpad pool data to a dedicated cache.
     * @param {string} poolId The public key of the Launchpad pool.
     * @param {object} poolData The decoded poolInfo and configInfo from Raydium SDK.
     */
    addLaunchpadPoolData(poolId, poolData) {
        // We set a shorter lifetime for raw account data, maybe 15 seconds.
        const poolCacheLifetime = 15 * 1000; // 15 seconds, adjust as needed for optimal refresh rate
        this.launchpadPoolCache.set(poolId, { data: poolData, timestamp: Date.now() });
        console.log(`[QUANTUM CACHE] 📦 LP data for ${shortenAddress(poolId)} stored.`);

        // Set an auto-clear for this cache entry
        setTimeout(() => {
            if (this.launchpadPoolCache.has(poolId)) {
                this.launchpadPoolCache.delete(poolId);
                console.log(`[QUANTUM CACHE] 🗑️ STALE LP data for ${shortenAddress(poolId)} cleared.`);
            }
        }, poolCacheLifetime);
    }

    /**
     * Retrieves detailed Raydium Launchpad pool data from cache if fresh.
     * @param {string} poolId The public key of the Launchpad pool.
     * @returns {object | null} Decoded poolInfo/configInfo or null if stale/missing.
     */
    getLaunchpadPoolData(poolId) {
        if (this.launchpadPoolCache.has(poolId)) {
            const cached = this.launchpadPoolCache.get(poolId);
            const poolCacheLifetime = 15 * 1000; // Match the write lifetime

            if (Date.now() - cached.timestamp < poolCacheLifetime) {
                console.log(`[QUANTUM CACHE] ✅ LP data cache HIT for ${shortenAddress(poolId)}.`);
                return cached.data;
            } else {
                console.log(`[QUANTUM CACHE] ⏳ STALE LP data for ${shortenAddress(poolId)}. Clearing.`);
                this.launchpadPoolCache.delete(poolId);
            }
        }
        console.log(`[QUANTUM CACHE] ❌ LP data cache MISS for ${shortenAddress(poolId)}.`);
        return null;
    }

     /**
     * Adds a fully signed, serialized transaction string to the high-speed cache.
     * @param {string} tokenMint The mint address of the token this transaction is for.
     * @param {string} signedTxString The base64 encoded string of the signed transaction.
     */
    addPreSignedTx(tokenMint, signedTxString) {
        this.preSignedTxCache.set(tokenMint, signedTxString);
        console.log(`[PRE-SIGNED CACHE] 🗡️ DAGGER ARMED for token ${shortenAddress(tokenMint)}.`);

        // We use the same lifetime as our other cache for consistency.
        setTimeout(() => {
            if (this.preSignedTxCache.has(tokenMint)) {
                this.preSignedTxCache.delete(tokenMint);
                console.log(`[PRE-SIGNED CACHE] ⏳ STALE Dagger for token ${shortenAddress(tokenMint)} removed.`);
            }
        }, this.CACHE_LIFETIME_MS);
    }

    /**
     * Retrieves a ready-to-fire transaction string from the high-speed cache.
     * @param {string} tokenMint The mint address of the token.
     * @returns {string | null} The base64 transaction string or null if not found.
     */
    getPreSignedTx(tokenMint) {
        if (this.preSignedTxCache.has(tokenMint)) {
            console.log(`[PRE-SIGNED CACHE] ✅ DAGGER HIT for token ${shortenAddress(tokenMint)}. Ready to fire!`);
            return this.preSignedTxCache.get(tokenMint);
        }
        // No log on miss to keep console clean, the miss is logged by the tradingEngine.
        return null;
    }

    /**
     * Returns the total number of cached entries across all cache maps.
     * @returns {number} Total cache size
     */
    size() {
        return this.tradeReadyCache.size + this.launchpadPoolCache.size + this.preSignedTxCache.size;
    }

    /**
     * Performs cleanup of expired entries from all caches.
     */
    cleanup() {
        // The CacheManager uses setTimeout for automatic cleanup, so this method
        // can be used for manual cleanup if needed
        console.log(`[QUANTUM CACHE] 🧹 Manual cleanup performed. Current size: ${this.size()}`);
    }
}

module.exports = { CacheManager };