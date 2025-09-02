// ==========================================
// ========== Trade Executor Worker ==========
// ==========================================
// File: workers/tradeExecutorWorker.js
// Description: Executes trades in a separate thread

const { workerData } = require('worker_threads');
const BaseWorker = require('./templates/baseWorker');
const { DatabaseManager } = require('../database/databaseManager');
const { SolanaManager } = require('../solanaManager');
const WalletManager = require('../walletManager');
const { TransactionAnalyzer } = require('../transactionAnalyzer');
const { ApiManager } = require('../apiManager');
const { CacheManager } = require('../cacheManager');
const TradeNotificationManager = require('../tradeNotifications');

class TradeExecutorWorker extends BaseWorker {
    constructor() {
        super();
        this.databaseManager = null;
        this.solanaManager = null;
        this.walletManager = null;
        this.transactionAnalyzer = null;
        this.apiManager = null;
        this.cacheManager = null;
        this.notificationManager = null;
        this.tradingEngine = null;
        this.pendingTrades = new Map();
        this.completedTrades = new Map();
        this.failedTrades = new Map();
    }

    async customInitialize() {
        try {
            // Initialize core managers
            this.databaseManager = new DatabaseManager();
            await this.databaseManager.initialize();
            
            this.solanaManager = new SolanaManager();
            await this.solanaManager.initialize();
            
            this.walletManager = new WalletManager(this.databaseManager);
            this.walletManager.setSolanaManager(this.solanaManager);
            await this.walletManager.initialize();
            
            this.apiManager = new ApiManager(this.solanaManager);
            this.transactionAnalyzer = new TransactionAnalyzer(this.solanaManager.connection, this.apiManager);
            this.cacheManager = new CacheManager();
            
            // Initialize notification manager with a mock bot for now
            // In a real implementation, this would be coordinated with the telegram worker
            const mockBot = {
                sendMessage: async () => { /* Mock implementation */ },
                isPolling: () => false
            };
            this.notificationManager = new TradeNotificationManager(mockBot, this.apiManager);
            this.notificationManager.setConnection(this.solanaManager.connection);

            // Initialize trading engine
            const { TradingEngine } = require('../tradingEngine');
            this.tradingEngine = new TradingEngine(
                this.solanaManager,
                this.databaseManager,
                this.walletManager,
                this.transactionAnalyzer,
                this.notificationManager,
                this.apiManager,
                this.cacheManager
            );

            this.logInfo('Trade executor worker initialized successfully');
        } catch (error) {
            this.logError('Failed to initialize trade executor worker', { error: error.message });
            throw error;
        }
    }

    async handleMessage(message) {
        if (message.type === 'EXECUTE_TRADE') {
            await this.executeTrade(message.tradeData);
        } else if (message.type === 'CANCEL_TRADE') {
            await this.cancelTrade(message.tradeId);
        } else if (message.type === 'GET_TRADE_STATUS') {
            await this.getTradeStatus(message.tradeId);
        } else if (message.type === 'GET_PENDING_TRADES') {
            await this.getPendingTrades();
        } else if (message.type === 'PROCESS_TRADER_ACTIVITY') {
            await this.processTraderActivity(message.traderInfo);
        } else {
            await super.handleMessage(message);
        }
    }

    async executeTrade(tradeData) {
        const tradeId = `trade_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        
        try {
            this.logInfo('Executing trade', { tradeId, tradeData });
            
            // Add to pending trades
            this.pendingTrades.set(tradeId, {
                id: tradeId,
                data: tradeData,
                status: 'pending',
                startTime: Date.now(),
                attempts: 0
            });

            // Execute the trade
            const result = await this.performTrade(tradeId, tradeData);
            
            // Move to completed trades
            this.pendingTrades.delete(tradeId);
            this.completedTrades.set(tradeId, {
                ...result,
                endTime: Date.now(),
                status: 'completed'
            });

            this.signalMessage('TRADE_COMPLETED', {
                tradeId,
                result,
                executionTime: Date.now() - result.startTime
            });

        } catch (error) {
            this.logError('Trade execution failed', { tradeId, error: error.message });
            
            // Move to failed trades
            if (this.pendingTrades.has(tradeId)) {
                const trade = this.pendingTrades.get(tradeId);
                this.pendingTrades.delete(tradeId);
                this.failedTrades.set(tradeId, {
                    ...trade,
                    error: error.message,
                    endTime: Date.now(),
                    status: 'failed'
                });
            }

            this.signalMessage('TRADE_FAILED', {
                tradeId,
                error: error.message
            });
        }
    }

    async performTrade(tradeId, tradeData) {
        try {
            const trade = this.pendingTrades.get(tradeId);
            if (!trade) {
                throw new Error('Trade not found in pending trades');
            }

            trade.attempts++;
            trade.status = 'executing';

            // Get user's primary trading wallet
            const keypairPacket = await this.walletManager.getPrimaryTradingKeypair(tradeData.userChatId);
            if (!keypairPacket) {
                throw new Error('No primary trading wallet found for user');
            }

            // Execute the trade using the trading engine
            const result = await this.tradingEngine.executeTrade(
                tradeData.tradeDetails,
                keypairPacket.wallet,
                tradeData.traderName
            );

            return {
                tradeId,
                result,
                startTime: trade.startTime,
                attempts: trade.attempts
            };

        } catch (error) {
            this.logError('Trade performance failed', { tradeId, error: error.message });
            throw error;
        }
    }

    async cancelTrade(tradeId) {
        try {
            if (this.pendingTrades.has(tradeId)) {
                const trade = this.pendingTrades.get(tradeId);
                trade.status = 'cancelled';
                
                this.pendingTrades.delete(tradeId);
                this.failedTrades.set(tradeId, {
                    ...trade,
                    endTime: Date.now(),
                    status: 'cancelled'
                });

                this.logInfo('Trade cancelled', { tradeId });
                this.signalMessage('TRADE_CANCELLED', { tradeId });
            } else {
                this.logWarn('Trade not found for cancellation', { tradeId });
            }
        } catch (error) {
            this.logError('Failed to cancel trade', { tradeId, error: error.message });
        }
    }

    async getTradeStatus(tradeId) {
        try {
            let trade = null;
            let status = 'not_found';

            if (this.pendingTrades.has(tradeId)) {
                trade = this.pendingTrades.get(tradeId);
                status = 'pending';
            } else if (this.completedTrades.has(tradeId)) {
                trade = this.completedTrades.get(tradeId);
                status = 'completed';
            } else if (this.failedTrades.has(tradeId)) {
                trade = this.failedTrades.get(tradeId);
                status = 'failed';
            }

            this.signalMessage('TRADE_STATUS_RESPONSE', {
                tradeId,
                status,
                trade
            });
        } catch (error) {
            this.logError('Failed to get trade status', { tradeId, error: error.message });
        }
    }

    async getPendingTrades() {
        try {
            const pendingTrades = Array.from(this.pendingTrades.values());
            this.signalMessage('PENDING_TRADES_RESPONSE', {
                count: pendingTrades.length,
                trades: pendingTrades
            });
        } catch (error) {
            this.logError('Failed to get pending trades', { error: error.message });
        }
    }

    async processTraderActivity(traderInfo) {
        try {
            this.logInfo('Processing trader activity', { 
                traderName: traderInfo.name,
                wallet: traderInfo.wallet 
            });

            // Process the trader through the trading engine
            await this.tradingEngine.processTrader(traderInfo);

            this.signalMessage('TRADER_ACTIVITY_PROCESSED', {
                traderName: traderInfo.name,
                wallet: traderInfo.wallet,
                timestamp: Date.now()
            });
        } catch (error) {
            this.logError('Failed to process trader activity', { 
                error: error.message,
                traderName: traderInfo.name 
            });
        }
    }

    async customCleanup() {
        try {
            // Cancel all pending trades
            const pendingTradeIds = Array.from(this.pendingTrades.keys());
            for (const tradeId of pendingTradeIds) {
                await this.cancelTrade(tradeId);
            }

            // Close database connection
            if (this.databaseManager) {
                await this.databaseManager.close();
            }

            this.logInfo('Trade executor worker cleanup completed');
        } catch (error) {
            this.logError('Error during cleanup', { error: error.message });
        }
    }

    async customHealthCheck() {
        try {
            const pendingCount = this.pendingTrades.size;
            const completedCount = this.completedTrades.size;
            const failedCount = this.failedTrades.size;
            
            return {
                healthy: true,
                pendingTrades: pendingCount,
                completedTrades: completedCount,
                failedTrades: failedCount,
                totalProcessed: completedCount + failedCount
            };
        } catch (error) {
            this.logError('Health check failed', { error: error.message });
            return { healthy: false, error: error.message };
        }
    }
}

// Initialize worker if this file is run directly
if (require.main === module) {
    const worker = new TradeExecutorWorker();
    worker.initialize().catch(error => {
        console.error('Trade executor worker failed to initialize:', error);
        process.exit(1);
    });
}

module.exports = TradeExecutorWorker;
