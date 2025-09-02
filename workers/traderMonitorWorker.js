// ==========================================
// ========== Trader Monitor Worker ==========
// ==========================================
// File: workers/traderMonitorWorker.js
// Description: Monitors trader activities and processes transactions

const { workerData } = require('worker_threads');
const BaseWorker = require('./templates/baseWorker');
const { DatabaseManager } = require('../database/databaseManager');
const { SolanaManager } = require('../solanaManager');
const { TransactionAnalyzer } = require('../transactionAnalyzer');
const { ApiManager } = require('../apiManager');

class TraderMonitorWorker extends BaseWorker {
    constructor() {
        super();
        this.databaseManager = null;
        this.solanaManager = null;
        this.transactionAnalyzer = null;
        this.apiManager = null;
        this.monitoredTraders = new Map();
        this.monitoringInterval = null;
        this.isMonitoring = false;
    }

    async customInitialize() {
        try {
            // Initialize core managers
            this.databaseManager = new DatabaseManager();
            await this.databaseManager.initialize();
            
            this.solanaManager = new SolanaManager();
            await this.solanaManager.initialize();
            
            this.apiManager = new ApiManager(this.solanaManager);
            this.transactionAnalyzer = new TransactionAnalyzer(this.solanaManager.connection, this.apiManager);

            this.logInfo('Trader monitor worker initialized successfully');
        } catch (error) {
            this.logError('Failed to initialize trader monitor worker', { error: error.message });
            throw error;
        }
    }

    async handleMessage(message) {
        if (message.type === 'START_MONITORING') {
            await this.startMonitoring(message.traders);
        } else if (message.type === 'STOP_MONITORING') {
            await this.stopMonitoring();
        } else if (message.type === 'ADD_TRADER') {
            await this.addTrader(message.trader);
        } else if (message.type === 'REMOVE_TRADER') {
            await this.removeTrader(message.traderName);
        } else if (message.type === 'UPDATE_TRADER') {
            await this.updateTrader(message.trader);
        } else if (message.type === 'PROCESS_SIGNATURE') {
            await this.processSignature(message.traderWallet, message.signature);
        } else {
            await super.handleMessage(message);
        }
    }

    async startMonitoring(traders = null) {
        try {
            if (this.isMonitoring) {
                this.logWarn('Monitoring already active');
                await this.databaseManager.logWarning('TRADER_MONITOR', 'Monitoring already active');
                return;
            }

            this.isMonitoring = true;
            await this.databaseManager.logInfo('TRADER_MONITOR', 'Starting trader monitoring');
            
            // Load traders if not provided
            if (!traders) {
                traders = await this.extractActiveTraders();
                await this.databaseManager.logInfo('TRADER_MONITOR', 'Extracted active traders', { 
                    traderCount: traders.length,
                    traders: traders.map(t => ({ name: t.name, wallet: t.wallet }))
                });
            }

            // Add traders to monitoring
            for (const trader of traders) {
                await this.addTrader(trader);
            }

            
            this.logInfo('Trader monitoring started', { traderCount: this.monitoredTraders.size });
            await this.databaseManager.logInfo('TRADER_MONITOR', 'Trader monitoring started successfully', { 
                traderCount: this.monitoredTraders.size,
                monitoredTraders: Array.from(this.monitoredTraders.keys())
            });
            this.signalMessage('MONITORING_STARTED', { traderCount: this.monitoredTraders.size });
        } catch (error) {
            this.logError('Failed to start monitoring', { error: error.message });
            await this.databaseManager.logError('TRADER_MONITOR', 'Failed to start monitoring', { error: error.message });
            this.isMonitoring = false;
        }
    }

    async stopMonitoring() {
        try {
            this.isMonitoring = false;
            
            if (this.monitoringInterval) {
                clearInterval(this.monitoringInterval);
                this.monitoringInterval = null;
            }

            this.monitoredTraders.clear();
            
            this.logInfo('Trader monitoring stopped');
            this.signalMessage('MONITORING_STOPPED');
        } catch (error) {
            this.logError('Failed to stop monitoring', { error: error.message });
        }
    }

    async addTrader(trader) {
        try {
            if (!trader || !trader.wallet || !trader.name) {
                throw new Error('Invalid trader data');
            }

            const traderInfo = {
                name: trader.name,
                wallet: trader.wallet,
                userChatId: trader.userChatId,
                active: trader.active || false,
                addedAt: Date.now()
            };

            this.monitoredTraders.set(trader.name, traderInfo);
            
            this.logInfo('Trader added to monitoring', { 
                name: trader.name, 
                wallet: trader.wallet,
                userChatId: trader.userChatId 
            });
            
            this.signalMessage('TRADER_ADDED_TO_MONITORING', { 
                name: trader.name,
                wallet: trader.wallet 
            });
        } catch (error) {
            this.logError('Failed to add trader', { error: error.message, trader });
        }
    }

    async removeTrader(traderName) {
        try {
            if (this.monitoredTraders.has(traderName)) {
                this.monitoredTraders.delete(traderName);
                this.logInfo('Trader removed from monitoring', { name: traderName });
                this.signalMessage('TRADER_REMOVED_FROM_MONITORING', { name: traderName });
            } else {
                this.logWarn('Trader not found in monitoring', { name: traderName });
            }
        } catch (error) {
            this.logError('Failed to remove trader', { error: error.message, traderName });
        }
    }

    async updateTrader(trader) {
        try {
            if (this.monitoredTraders.has(trader.name)) {
                const existingTrader = this.monitoredTraders.get(trader.name);
                const updatedTrader = { ...existingTrader, ...trader };
                this.monitoredTraders.set(trader.name, updatedTrader);
                
                this.logInfo('Trader updated in monitoring', { name: trader.name });
                this.signalMessage('TRADER_UPDATED_IN_MONITORING', { name: trader.name });
            } else {
                this.logWarn('Trader not found for update', { name: trader.name });
            }
        } catch (error) {
            this.logError('Failed to update trader', { error: error.message, trader });
        }
    }

    async processSignature(traderWallet, signature) {
        try {
            this.logInfo('Processing signature', { traderWallet, signature });
            
            // Find the trader by wallet
            const trader = Array.from(this.monitoredTraders.values())
                .find(t => t.wallet === traderWallet);
            
            if (!trader) {
                this.logWarn('Trader not found for signature', { traderWallet });
                return;
            }

            // Process the transaction
            const result = await this.transactionAnalyzer.analyzeTransaction(signature);
            
            if (result) {
                this.signalMessage('TRANSACTION_ANALYZED', {
                    traderName: trader.name,
                    traderWallet,
                    signature,
                    result
                });
            }
        } catch (error) {
            this.logError('Failed to process signature', { 
                error: error.message, 
                traderWallet, 
                signature 
            });
        }
    }

    startPeriodicMonitoring() {
        const MONITORING_INTERVAL = 25000; // 25 seconds
        
        this.monitoringInterval = setInterval(async () => {
            if (!this.isMonitoring || this.isShuttingDown) {
                return;
            }

            try {
                await this.databaseManager.logDebug('TRADER_MONITOR', 'Starting monitoring cycle');
                await this.monitorTraders();
                await this.databaseManager.logDebug('TRADER_MONITOR', 'Completed monitoring cycle');
            } catch (error) {
                this.logError('Error in periodic monitoring', { error: error.message });
                await this.databaseManager.logError('TRADER_MONITOR', 'Error in periodic monitoring', { error: error.message });
            }
        }, MONITORING_INTERVAL);

        this.logInfo('Periodic monitoring started', { interval: MONITORING_INTERVAL });
        this.databaseManager.logInfo('TRADER_MONITOR', 'Periodic monitoring started', { interval: MONITORING_INTERVAL });
    }

    async monitorTraders() {
        try {
            const activeTraders = Array.from(this.monitoredTraders.values())
                .filter(trader => trader.active);

            for (const trader of activeTraders) {
                try {
                    await this.monitorTrader(trader);
                } catch (error) {
                    this.logError('Error monitoring trader', { 
                        error: error.message, 
                        traderName: trader.name 
                    });
                }
            }
        } catch (error) {
            this.logError('Error in trader monitoring cycle', { error: error.message });
        }
    }

    async monitorTrader(trader) {
        try {
            // This is a simplified monitoring implementation
            // In a real implementation, you would:
            // 1. Check for new transactions
            // 2. Analyze transaction patterns
            // 3. Detect trading activities
            // 4. Send notifications to other workers

            this.logDebug('Monitoring trader', { 
                name: trader.name, 
                wallet: trader.wallet 
            });

            // Signal that we're actively monitoring this trader
            this.signalMessage('TRADER_MONITORED', {
                name: trader.name,
                wallet: trader.wallet,
                timestamp: Date.now()
            });
        } catch (error) {
            this.logError('Error monitoring individual trader', { 
                error: error.message, 
                traderName: trader.name 
            });
        }
    }

    async extractActiveTraders() {
        try {
            const traders = [];
            
            // Get all active traders from database
            const activeTraders = await this.databaseManager.all(
                'SELECT t.*, u.chat_id FROM traders t JOIN users u ON t.user_id = u.id WHERE t.active = 1'
            );
            
            for (const trader of activeTraders) {
                traders.push({
                    id: trader.id,
                    name: trader.name,
                    wallet: trader.wallet,
                    userChatId: trader.chat_id,
                    active: trader.active === 1,
                    addedAt: trader.created_at
                });
            }
            
            return traders;
        } catch (error) {
            this.logError('Failed to extract active traders', { error: error.message });
            return [];
        }
    }

    async customCleanup() {
        try {
            await this.stopMonitoring();
            if (this.databaseManager) {
                await this.databaseManager.close();
            }
            this.logInfo('Trader monitor worker cleanup completed');
        } catch (error) {
            this.logError('Error during cleanup', { error: error.message });
        }
    }

    async customHealthCheck() {
        try {
            return this.isMonitoring && this.monitoredTraders.size > 0;
        } catch (error) {
            this.logError('Health check failed', { error: error.message });
            return false;
        }
    }
}

// Initialize worker if this file is run directly
if (require.main === module) {
    const worker = new TraderMonitorWorker();
    worker.initialize().catch(error => {
        console.error('Trader monitor worker failed to initialize:', error);
        process.exit(1);
    });
}

module.exports = TraderMonitorWorker;
