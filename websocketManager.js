// ==========================================
// ======== ZapBot WebSocketManager =========
// ==========================================
// File: websocketManager.js
// Description: Manages the WebSocket connection, subscriptions, and message handling for trader activity.

const WebSocket = require('ws');
const { shortenAddress } = require('./utils.js');
const { WS_URL } = require('./config.js'); // Import the WebSocket URL from config

class WebSocketManager {
    constructor() {
        this.ws = null;
        this.wsUrl = WS_URL;
        this.wsSubscriptions = new Map(); // Stores { id: { type, wallet, traderName } }
        this.wsHeartbeatInterval = null;
        this.isShuttingDown = false;
        
        // This function will be set by the main bot instance to trigger trade processing
        this.tradeActivityProcessor = null; 

        console.log("WebSocketManager initialized.");
    }

    /**
     * Initializes the WebSocket connection.
     * @param {function} tradeActivityProcessor - The function to call when trader activity is detected.
     */
    initialize(tradeActivityProcessor) {
        if (typeof tradeActivityProcessor !== 'function') {
            throw new Error("WebSocketManager requires a valid tradeActivityProcessor function.");
        }
        this.tradeActivityProcessor = tradeActivityProcessor;
        this.setupWebSocketConnection();
    }

    setupWebSocketConnection() {
        if (this.isShuttingDown || (this.ws && this.ws.readyState === WebSocket.CONNECTING)) {
            return;
        }

        this.stopWsHeartbeat();
        console.log(`📡 Attempting WebSocket connection to: ${this.wsUrl}`);
        this.ws = new WebSocket(this.wsUrl);

        this.ws.on('open', () => {
            console.log('✅ WebSocket connected successfully.');
            this.startWsHeartbeat();
            // Resubscribing will be handled by the main sync logic, which should be called after 'open'.
        });

        this.ws.on('message', (data) => {
            this._handleWebSocketMessage(data).catch(e => {
                console.error("Error in WebSocket message handler:", e);
            });
        });

        this.ws.on('close', (code, reason) => {
            console.warn(`⚠️ WebSocket disconnected. Code: ${code}, Reason: ${reason?.toString() || 'N/A'}`);
            this.stopWsHeartbeat();
            const oldSubCount = this.wsSubscriptions.size;
            if (oldSubCount > 0) this.wsSubscriptions.clear();

            if (this.ws) {
                this.ws.removeAllListeners();
                this.ws = null;
            }

            if (!this.isShuttingDown) {
                console.log('♻️ Reconnecting in 0s...');
                // Immediate reconnection for better responsiveness
                setTimeout(() => this.setupWebSocketConnection(), 1000);
            }
        });

        this.ws.on('error', (error) => {
            console.error('❌ WebSocket encountered an error:', error.message);
        });
    }

    async _handleWebSocketMessage(data) {
        const message = JSON.parse(data.toString());

        // Handle Account Update Notifications
        if (message.method === 'accountNotification' && message.params?.subscription) {
            const subId = message.params.subscription;
            const subInfo = this.wsSubscriptions.get(subId);

            if (subInfo && this.tradeActivityProcessor) {
                // Call the injected processor function from the main bot
                await this.tradeActivityProcessor(subInfo.traderName, subInfo.wallet, message.params);
            }
        }
        // Handle Subscription Confirmations
        else if (message.id?.startsWith('sub-') && typeof message.result === 'number') {
            const requestId = message.id;
            const subscriptionId = message.result;
            const pendingKey = `pending_${requestId}`;
            const subData = this.wsSubscriptions.get(pendingKey);

            if (subData) {
                subData.subscriptionId = subscriptionId;
                this.wsSubscriptions.delete(pendingKey);
                this.wsSubscriptions.set(subscriptionId, subData);
                console.log(`   ✅ WS Sub confirmed for ${subData.traderName} (${shortenAddress(subData.wallet)}) -> ID: ${subscriptionId}`);
            }
        }
        // Handle Unsubscribe Confirmations
        else if (message.id?.startsWith('unsub-')) {
             console.log(`   [WS Confirm] Unsubscribe result for ReqID ${message.id}: ${message.result === true}`);
        }
    }
    
    /**
     * Updates the WebSocket subscriptions to match the provided list of active traders.
     * @param {Array<{name: string, wallet: string}>} activeTraders - An array of active trader objects.
     */
    syncSubscriptions(activeTraders = []) {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            console.warn("[WSSync] Skipped: WebSocket is not connected.");
            return;
        }

        const configuredActiveWallets = new Set(activeTraders.map(t => t.wallet));
        const currentSubscribedWallets = new Map(); // wallet -> subId
        const subsToClose = [];

        // Analyze current subscriptions
        for (const [id, subInfo] of this.wsSubscriptions.entries()) {
            if (typeof id === 'number' && subInfo.type === 'account' && subInfo.wallet) {
                if (configuredActiveWallets.has(subInfo.wallet)) {
                    currentSubscribedWallets.set(subInfo.wallet, id);
                } else {
                    subsToClose.push(id); // Mark for unsubscription
                }
            }
        }

        // Unsubscribe from deactivated traders
        subsToClose.forEach(subId => this.unsubscribeFromAccount(subId));

        // Subscribe to newly activated traders
        activeTraders.forEach(trader => {
            if (!currentSubscribedWallets.has(trader.wallet)) {
                this.subscribeToTraderAccount(trader.name, trader.wallet);
            }
        });
    }

    subscribeToTraderAccount(traderName, walletAddress) {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

        const requestId = `sub-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
        const pendingKey = `pending_${requestId}`;
        
        this.wsSubscriptions.set(pendingKey, { type: 'account', wallet: walletAddress, traderName, requestId, subscriptionId: null });
        console.log(`   [WS Send] Requesting Acct Sub for ${traderName} (${shortenAddress(walletAddress)})`);

        this.ws.send(JSON.stringify({
            jsonrpc: '2.0',
            id: requestId,
            method: 'accountSubscribe',
            params: [ walletAddress, { encoding: 'jsonParsed', commitment: 'confirmed' } ]
        }));
    }

    unsubscribeFromAccount(subscriptionId) {
        const subInfo = this.wsSubscriptions.get(subscriptionId);
        if (subInfo) this.wsSubscriptions.delete(subscriptionId);

        if (!this.ws || this.ws.readyState !== WebSocket.OPEN || typeof subscriptionId !== 'number') {
            return;
        }
        
        const unsubRequestId = `unsub-${Date.now()}`;
        this.ws.send(JSON.stringify({
            jsonrpc: '2.0', id: unsubRequestId, method: 'accountUnsubscribe', params: [subscriptionId]
        }));
    }

    startWsHeartbeat() {
        this.stopWsHeartbeat();
        this.wsHeartbeatInterval = setInterval(() => {
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                try {
                    this.ws.ping();
                } catch (error) {
                    console.warn('[WS] Heartbeat ping failed:', error.message);
                }
            }
        }, 30000); // 30 second heartbeat
        this.wsHeartbeatInterval.unref();
    }

    stopWsHeartbeat() {
        if (this.wsHeartbeatInterval) {
            clearInterval(this.wsHeartbeatInterval);
            this.wsHeartbeatInterval = null;
        }
    }
    
    stop() {
        this.isShuttingDown = true;
        this.stopWsHeartbeat();
        for (const subId of this.wsSubscriptions.keys()) {
            if (typeof subId === 'number') this.unsubscribeFromAccount(subId);
        }
        if (this.ws) {
            this.ws.close(1000, "Bot shutting down.");
            this.ws.removeAllListeners();
            this.ws = null;
        }
        console.log("WebSocketManager stopped.");
    }
}

module.exports = WebSocketManager;