// File: leaderTracker.js (v2 - Proactive Caching Engine)
// Description: Monitors the current and upcoming Solana slot leaders using a proactive,
// cache-based approach with `getSlotLeaders` for maximum efficiency and reliability.

const { Connection } = require('@solana/web3.js');
const config = require('./config.js');

class LeaderTracker {
    constructor() {
        // Use the main RPC endpoint for leader tracking (more reliable than Singapore endpoint)
        this.connection = new Connection(config.HELIUS_ENDPOINTS.rpc);
        
        // --- Core State ---
        this.leaderSchedule = new Map(); // Maps slotNumber -> leaderPublicKeyString
        this.currentSlot = 0;
        this.lastScheduleRefreshSlot = 0;
        this.isMonitoring = false;

        // --- Control Mechanisms ---
        this.slotSubscriptionId = null; // Stores the ID for the WebSocket subscription
        this.refreshIntervalId = null;  // For periodic fallback refresh

        // --- Configuration ---
        this.SCHEDULE_FETCH_LIMIT = 5000; // Max allowed by RPC, fetches a long schedule
        this.SCHEDULE_REFRESH_THRESHOLD = this.SCHEDULE_FETCH_LIMIT / 2; // Refresh when we are halfway through the cache
        this.FALLBACK_REFRESH_INTERVAL_MS = 20 * 60 * 1000; // 20 minutes, a safety net if WebSocket fails

        console.log('[LEADER_TRACKER_V2] 🎯 Initialized. Ready for proactive leader tracking.');
    }

    /**
     * Starts the continuous, real-time monitoring of the slot and leader schedule.
     */
    async startMonitoring() {
        if (this.isMonitoring) {
            console.warn('[LEADER_TRACKER_V2] Monitoring is already active.');
            return;
        }

        console.log('[LEADER_TRACKER_V2] ✅ Activating proactive monitoring...');
        this.isMonitoring = true;

        try {
            // 1. Get the initial current slot
            this.currentSlot = await this.connection.getSlot('confirmed');

            // 2. Perform the initial fetch of the leader schedule
            await this._refreshLeaderSchedule();

            // 3. Subscribe to real-time slot updates via WebSocket (the most efficient method)
            this.slotSubscriptionId = this.connection.onSlotChange(
                (slotInfo) => this._handleSlotUpdate(slotInfo.slot)
            );
            console.log(`[LEADER_TRACKER_V2] 🛰️ Subscribed to real-time slot updates. (Sub ID: ${this.slotSubscriptionId})`);

            // 4. Set up a long-interval fallback refresh, just in case the WebSocket connection drops silently
            this.refreshIntervalId = setInterval(() => {
                this._refreshLeaderSchedule().catch(error => {
                    console.error('[LEADER_TRACKER_V2] ❌ Error during fallback schedule refresh:', error.message);
                });
            }, this.FALLBACK_REFRESH_INTERVAL_MS);

        } catch (error) {
            console.error('[LEADER_TRACKER_V2] ❌ FATAL: Could not start monitoring:', error.message);
            console.error('[LEADER_TRACKER_V2] ❌ Full error details:', error);
            this.isMonitoring = false;
            throw error; // Propagate error to halt startup if necessary
        }
    }

    /**
     * Stops all monitoring activities and cleans up resources.
     */
    async stopMonitoring() {
        if (!this.isMonitoring) {
            return;
        }
        this.isMonitoring = false;

        // Stop the fallback interval
        if (this.refreshIntervalId) {
            clearInterval(this.refreshIntervalId);
            this.refreshIntervalId = null;
        }

        // Unsubscribe from the WebSocket
        if (this.slotSubscriptionId) {
            await this.connection.removeSlotChangeListener(this.slotSubscriptionId).catch(err => {
                console.warn('[LEADER_TRACKER_V2] Warning: Could not remove slot change listener:', err.message);
            });
            this.slotSubscriptionId = null;
        }
        
        this.leaderSchedule.clear();
        console.log('[LEADER_TRACKER_V2] 🛑 Monitoring stopped and resources cleaned up.');
    }

    /**
     * Handles a real-time slot update from the WebSocket subscription.
     * @private
     */
    _handleSlotUpdate(newSlot) {
        this.currentSlot = newSlot;
        // As we get new slots, check if we need to refresh our leader schedule
        if (this.currentSlot > this.lastScheduleRefreshSlot + this.SCHEDULE_REFRESH_THRESHOLD) {
            console.log(`[LEADER_TRACKER_V2] 刷新... Reached refresh threshold, fetching new leader schedule.`);
            this._refreshLeaderSchedule().catch(error => {
                console.error('[LEADER_TRACKER_V2] ❌ Error refreshing schedule on slot update:', error.message);
            });
        }
    }

    /**
     * Fetches the upcoming leader schedule and populates the local cache.
     * This is the core proactive logic.
     * @private
     */
    async _refreshLeaderSchedule() {
        try {
            const startSlot = this.currentSlot;
            console.log(`[LEADER_TRACKER_V2]  fetching leader schedule for ${this.SCHEDULE_FETCH_LIMIT} slots starting from ${startSlot}...`);

            const leaders = await this.connection.getSlotLeaders(startSlot, this.SCHEDULE_FETCH_LIMIT);
            
            if (!leaders || leaders.length === 0) {
                console.warn('[LEADER_TRACKER_V2] ⚠️ `getSlotLeaders` returned an empty schedule. Will retry later.');
                return;
            }

            // Create a new map to ensure old data is purged
            const newSchedule = new Map();
            for (let i = 0; i < leaders.length; i++) {
                const slot = startSlot + i;
                newSchedule.set(slot, leaders[i].toString());
            }
            
            // Atomically swap to the new schedule
            this.leaderSchedule = newSchedule;
            this.lastScheduleRefreshSlot = startSlot;

            console.log(`[LEADER_TRACKER_V2] ✅ Leader schedule cache refreshed. Now tracking ${this.leaderSchedule.size} upcoming slots.`);

        } catch (error) {
            // This is a non-fatal error; the bot can continue with the existing (possibly stale) schedule.
            console.error('[LEADER_TRACKER_V2] ❌ Could not refresh leader schedule cache:', error.message);
        }
    }

    /**
     * Returns the public key of the current slot leader from the local cache.
     * This is an instant, in-memory lookup with zero network latency.
     * @returns {string | null} The base58 encoded public key of the current leader, or null if not available.
     */
    getCurrentLeader() {
        if (!this.isMonitoring || this.leaderSchedule.size === 0) {
            return null;
        }
        return this.leaderSchedule.get(this.currentSlot) || null;
    }

    /**
     * Checks if the tracker is currently healthy and monitoring.
     * @returns {boolean}
     */
    isHealthy() {
        return this.isMonitoring && this.leaderSchedule.has(this.currentSlot);
    }
}

// Export a single instance to ensure all parts of the app use the same tracker
module.exports = new LeaderTracker();