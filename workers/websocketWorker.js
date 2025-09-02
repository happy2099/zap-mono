// ==========================================
// ========== WebSocket Worker ==========
// ==========================================
// File: workers/websocketWorker.js
// Description: Handles WebSocket connections in a separate thread

const { workerData } = require('worker_threads');
const BaseWorker = require('./templates/baseWorker');
const { SolanaManager } = require('../solanaManager');
const { ApiManager } = require('../apiManager');
const { LaserStreamManager } = require('../laserstreamManager');

class WebSocketWorker extends BaseWorker {
    constructor() {
        super();
        this.solanaManager = null;
        this.apiManager = null;
        this.laserstreamManager = null;
        this.activeConnections = new Map();
        this.subscriptions = new Map();
        this.isConnected = false;
    }

    async customInitialize() {
        try {
            this.solanaManager = new SolanaManager();
            await this.solanaManager.initialize();
            
            this.apiManager = new ApiManager(this.solanaManager);
            
            this.logInfo('WebSocket worker initialized successfully');
        } catch (error) {
            this.logError('Failed to initialize WebSocket worker', { error: error.message });
            throw error;
        }
    }

    async handleMessage(message) {
        if (message.type === 'CONNECT_WEBSOCKET') {
            await this.connectWebSocket(message.config);
        } else if (message.type === 'DISCONNECT_WEBSOCKET') {
            await this.disconnectWebSocket(message.connectionId);
        } else if (message.type === 'SUBSCRIBE_TO_TRADER') {
            await this.subscribeToTrader(message.traderWallet);
        } else if (message.type === 'UNSUBSCRIBE_FROM_TRADER') {
            await this.unsubscribeFromTrader(message.traderWallet);
        } else if (message.type === 'START_LASERSTREAM') {
            await this.startLaserStream(message.config);
        } else if (message.type === 'STOP_LASERSTREAM') {
            await this.stopLaserStream();
        } else {
            await super.handleMessage(message);
        }
    }

    async connectWebSocket(config) {
        try {
            const connectionId = `ws_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            
            // Initialize WebSocket connection
            const connection = {
                id: connectionId,
                config,
                status: 'connecting',
                startTime: Date.now()
            };

            this.activeConnections.set(connectionId, connection);

            // Simulate WebSocket connection
            setTimeout(() => {
                connection.status = 'connected';
                this.isConnected = true;
                this.logInfo('WebSocket connected', { connectionId });
                this.signalMessage('WEBSOCKET_CONNECTED', { connectionId });
            }, 1000);

        } catch (error) {
            this.logError('Failed to connect WebSocket', { error: error.message });
            this.signalMessage('WEBSOCKET_CONNECTION_ERROR', { error: error.message });
        }
    }

    async disconnectWebSocket(connectionId) {
        try {
            if (this.activeConnections.has(connectionId)) {
                const connection = this.activeConnections.get(connectionId);
                connection.status = 'disconnected';
                
                this.activeConnections.delete(connectionId);
                
                if (this.activeConnections.size === 0) {
                    this.isConnected = false;
                }

                this.logInfo('WebSocket disconnected', { connectionId });
                this.signalMessage('WEBSOCKET_DISCONNECTED', { connectionId });
            } else {
                this.logWarn('WebSocket connection not found', { connectionId });
            }
        } catch (error) {
            this.logError('Failed to disconnect WebSocket', { connectionId, error: error.message });
        }
    }

    async subscribeToTrader(traderWallet) {
        try {
            if (this.subscriptions.has(traderWallet)) {
                this.logWarn('Already subscribed to trader', { traderWallet });
                return;
            }

            const subscription = {
                traderWallet,
                startTime: Date.now(),
                status: 'active'
            };

            this.subscriptions.set(traderWallet, subscription);
            
            this.logInfo('Subscribed to trader', { traderWallet });
            this.signalMessage('TRADER_SUBSCRIBED', { traderWallet });
        } catch (error) {
            this.logError('Failed to subscribe to trader', { traderWallet, error: error.message });
        }
    }

    async unsubscribeFromTrader(traderWallet) {
        try {
            if (this.subscriptions.has(traderWallet)) {
                this.subscriptions.delete(traderWallet);
                this.logInfo('Unsubscribed from trader', { traderWallet });
                this.signalMessage('TRADER_UNSUBSCRIBED', { traderWallet });
            } else {
                this.logWarn('Not subscribed to trader', { traderWallet });
            }
        } catch (error) {
            this.logError('Failed to unsubscribe from trader', { traderWallet, error: error.message });
        }
    }

    async startLaserStream(config) {
        try {
            if (this.laserstreamManager) {
                this.logWarn('LaserStream already running');
                return;
            }

            // Initialize LaserStream manager
            this.laserstreamManager = new LaserStreamManager(null); // TradingEngine will be set later
            
            this.logInfo('LaserStream started', { config });
            this.signalMessage('LASERSTREAM_STARTED', { config });
        } catch (error) {
            this.logError('Failed to start LaserStream', { error: error.message });
            this.signalMessage('LASERSTREAM_START_ERROR', { error: error.message });
        }
    }

    async stopLaserStream() {
        try {
            if (this.laserstreamManager) {
                this.laserstreamManager.stop();
                this.laserstreamManager = null;
                
                this.logInfo('LaserStream stopped');
                this.signalMessage('LASERSTREAM_STOPPED');
            } else {
                this.logWarn('LaserStream not running');
            }
        } catch (error) {
            this.logError('Failed to stop LaserStream', { error: error.message });
        }
    }

    async customCleanup() {
        try {
            // Disconnect all WebSocket connections
            const connectionIds = Array.from(this.activeConnections.keys());
            for (const connectionId of connectionIds) {
                await this.disconnectWebSocket(connectionId);
            }

            // Unsubscribe from all traders
            const traderWallets = Array.from(this.subscriptions.keys());
            for (const traderWallet of traderWallets) {
                await this.unsubscribeFromTrader(traderWallet);
            }

            // Stop LaserStream
            await this.stopLaserStream();

            this.logInfo('WebSocket worker cleanup completed');
        } catch (error) {
            this.logError('Error during cleanup', { error: error.message });
        }
    }

    async customHealthCheck() {
        try {
            return {
                healthy: this.isConnected,
                activeConnections: this.activeConnections.size,
                activeSubscriptions: this.subscriptions.size,
                laserstreamRunning: this.laserstreamManager !== null
            };
        } catch (error) {
            this.logError('Health check failed', { error: error.message });
            return { healthy: false, error: error.message };
        }
    }
}

// Initialize worker if this file is run directly
if (require.main === module) {
    const worker = new WebSocketWorker();
    worker.initialize().catch(error => {
        console.error('WebSocket worker failed to initialize:', error);
        process.exit(1);
    });
}

module.exports = WebSocketWorker;

