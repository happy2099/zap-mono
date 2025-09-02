// File: laserstreamManager.js (FINAL - Aligned with modern Helius SDK)
// Description: Manages the Helius LaserStream connection using the correct API.

const { subscribe, CommitmentLevel } = require('helius-laserstream');
const { EventEmitter } = require('events');
const config = require('./config.js');
const { shortenAddress } = require('./utils.js');

class LaserStreamManager extends EventEmitter {
    constructor(tradingEngine) {
        super(); // This is required when extending a class
        if (!tradingEngine) {
            throw new Error("LaserStreamManager requires a tradingEngine instance.");
        }
        this.tradingEngine = tradingEngine;
        this.stream = null;
        this.activeTraderWallets = new Set();
        this.streamStatus = 'idle'; // To track the connection state
        console.log('[LASERSTREAM-MODERN] Manager initialized. Ready for modern Helius API.');
    }

    async startMonitoring() {
        if (this.stream) {
            console.log('[LASERSTREAM-PRO] Stream is already active. Restarting to apply latest trader list...');
            await this.stop();
        }
   
        try {
            const walletsToMonitor = await this.tradingEngine.getMasterTraderWallets();
            if (walletsToMonitor.length === 0) {
                console.log('[LASERSTREAM-PRO] No active traders to monitor.');
                // Even if no traders, the "service" is technically healthy.
                this.streamStatus = 'connected'; 
                this.emit('status_change', { status: 'connected', reason: 'No active traders' });
                return;
            }
   
            this.activeTraderWallets = new Set(walletsToMonitor);
            console.log(`[LASERSTREAM-PRO] Subscribing to ${this.activeTraderWallets.size} master trader wallets...`);
   
            const laserstreamConfig = {
                apiKey: config.HELIUS_API_KEY,
                endpoint: config.LASERSTREAM_ENDPOINT,
                maxReconnectAttempts: 10,
            };
   
            if (!laserstreamConfig.apiKey || !laserstreamConfig.endpoint) {
                const errorMsg = "Cannot subscribe: HELIUS_API_KEY or LASERSTREAM_ENDPOINT is missing.";
                console.error(`❌ [LASERSTREAM-PRO] ${errorMsg}`);
                this.streamStatus = 'error';
                this.emit('status_change', { status: 'disconnected', error: errorMsg });
                return;
            }
   
            const subscriptionRequest = {
                transactions: { "master-trader-swaps": { accountRequired: walletsToMonitor, vote: false, failed: false } },
                commitment: CommitmentLevel.PROCESSED,
            };
   
            const onData = (txData) => {
                if (!txData.transaction) return;
                const signature = txData.transaction.signature;
                const sourceWallet = txData.transaction.message.accountKeys.find(key => this.activeTraderWallets.has(key.pubkey) && key.signer)?.pubkey;
                if (sourceWallet && signature) {
                    this.tradingEngine.handleLaserStreamData(sourceWallet, signature, txData);
                }
            };
   
            const onError = (error) => {
                console.error('[LASERSTREAM-PRO] Stream encountered a critical error:', error);
                this.streamStatus = 'error';
                this.emit('status_change', { status: 'disconnected', error: error.message });
            };
   
            this.stream = await subscribe(laserstreamConfig, subscriptionRequest, onData, onError);
            
            console.log(`[LASERSTREAM-PRO] ✅ Stream connected and subscribed. ID: ${this.stream.id}`);
            this.streamStatus = 'connected';
            this.emit('status_change', { status: 'connected', reason: 'Stream successfully subscribed' });
   
        } catch (error) {
            const errorMsg = `Failed to subscribe: ${error.message || error}`;
            console.error('[LASERSTREAM-PRO] ❌', errorMsg);
            this.streamStatus = 'error';
            this.emit('status_change', { status: 'disconnected', error: errorMsg });
        }
    }

    async stop() {
        if (this.stream) {
            console.log('[LASERSTREAM-MODERN] Shutting down stream...');
            this.stream.cancel();
            this.stream = null;
            this.streamStatus = 'disconnected';
            this.emit('status_change', { status: 'disconnected', reason: 'Manual shutdown' });
        }
    }
}

module.exports = { LaserStreamManager };