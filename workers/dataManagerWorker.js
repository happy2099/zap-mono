// ==========================================
// ========== Data Manager Worker ==========
// ==========================================
// File: workers/dataManagerWorker.js
// Description: Handles database operations in a separate thread

const { workerData } = require('worker_threads');
const BaseWorker = require('./templates/baseWorker');
const { DatabaseManager } = require('../database/databaseManager');

class DataManagerWorker extends BaseWorker {
    constructor() {
        super();
        this.databaseManager = null;
        this.cache = new Map();
        this.lastSaveTime = Date.now();
    }

    async customInitialize() {
        try {
            this.databaseManager = new DatabaseManager();
            await this.databaseManager.initialize();
            
            this.logInfo('Database manager worker initialized successfully');
        } catch (error) {
            this.logError('Failed to initialize database manager worker', { error: error.message });
            throw error;
        }
    }

    async handleMessage(message) {
        if (message.type === 'LOAD_DATA') {
            await this.loadData(message.dataType, message.params);
        } else if (message.type === 'SAVE_DATA') {
            await this.saveData(message.dataType, message.data, message.params);
        } else if (message.type === 'UPDATE_DATA') {
            await this.updateData(message.dataType, message.data, message.params);
        } else if (message.type === 'DELETE_DATA') {
            await this.deleteData(message.dataType, message.params);
        } else if (message.type === 'GET_CACHE') {
            await this.getCache(message.key);
        } else if (message.type === 'SET_CACHE') {
            await this.setCache(message.key, message.value);
        } else {
            await super.handleMessage(message);
        }
    }

    async loadData(dataType, params = {}) {
        try {
            let data = null;
            
            switch (dataType) {
                case 'traders':
                    if (params.userId) {
                        data = await this.databaseManager.getTraders(params.userId);
                    } else {
                        // Get all traders for all users
                        data = await this.databaseManager.all('SELECT * FROM traders');
                    }
                    break;
                case 'user':
                    data = await this.databaseManager.getUser(params.chatId);
                    break;
                case 'tradeStats':
                    if (params.userId) {
                        data = await this.databaseManager.getTradeStats(params.userId);
                    } else {
                        data = await this.databaseManager.all('SELECT * FROM trade_stats');
                    }
                    break;
                case 'tradeHistory':
                    data = await this.databaseManager.getTradeHistory(params.userId, params.limit || 50);
                    break;
                case 'withdrawalHistory':
                    data = await this.databaseManager.getWithdrawalHistory(params.userId, params.limit || 20);
                    break;
                default:
                    throw new Error(`Unknown data type: ${dataType}`);
            }

            this.signalMessage('DATA_LOADED', {
                dataType,
                data,
                timestamp: Date.now()
            });
        } catch (error) {
            this.logError('Failed to load data', { dataType, error: error.message });
            this.signalMessage('DATA_LOAD_ERROR', {
                dataType,
                error: error.message
            });
        }
    }

    async saveData(dataType, data, params = {}) {
        try {
            switch (dataType) {
                case 'user':
                    await this.databaseManager.createUser(params.chatId, data);
                    break;
                case 'trader':
                    await this.databaseManager.addTrader(params.userId, data.name, data.wallet);
                    break;
                case 'tradeStats':
                    await this.databaseManager.updateTradeStats(params.userId, data);
                    break;
                case 'trade':
                    await this.databaseManager.recordTrade(
                        params.userId, 
                        params.traderId, 
                        data.signature, 
                        data.platform, 
                        data.tokenMint, 
                        data.amountRaw, 
                        data.solSpent, 
                        data.status
                    );
                    break;
                case 'withdrawal':
                    await this.databaseManager.recordWithdrawal(params.userId, data.amount, data.signature);
                    break;
                default:
                    throw new Error(`Unknown data type: ${dataType}`);
            }

            this.lastSaveTime = Date.now();
            this.signalMessage('DATA_SAVED', {
                dataType,
                timestamp: this.lastSaveTime
            });
        } catch (error) {
            this.logError('Failed to save data', { dataType, error: error.message });
            this.signalMessage('DATA_SAVE_ERROR', {
                dataType,
                error: error.message
            });
        }
    }

    async updateData(dataType, data, params = {}) {
        try {
            switch (dataType) {
                case 'user':
                    await this.databaseManager.updateUserSettings(params.chatId, data);
                    break;
                case 'trader':
                    await this.databaseManager.updateTraderStatus(params.userId, data.wallet, data.active);
                    break;
                case 'trade':
                    await this.databaseManager.updateTradeStatus(data.signature, data.status);
                    break;
                default:
                    throw new Error(`Unknown data type for update: ${dataType}`);
            }

            this.signalMessage('DATA_UPDATED', {
                dataType,
                timestamp: Date.now()
            });
        } catch (error) {
            this.logError('Failed to update data', { dataType, error: error.message });
            this.signalMessage('DATA_UPDATE_ERROR', {
                dataType,
                error: error.message
            });
        }
    }

    async deleteData(dataType, params = {}) {
        try {
            switch (dataType) {
                case 'trader':
                    if (params.userId && params.wallet) {
                        await this.databaseManager.deleteTrader(params.userId, params.wallet);
                    }
                    break;
                case 'user':
                    if (params.chatId) {
                        await this.databaseManager.run('DELETE FROM users WHERE chat_id = ?', [params.chatId]);
                    }
                    break;
                case 'all':
                    // Clear all data (use with caution)
                    await this.databaseManager.run('DELETE FROM trades');
                    await this.databaseManager.run('DELETE FROM traders');
                    await this.databaseManager.run('DELETE FROM trade_stats');
                    await this.databaseManager.run('DELETE FROM withdrawals');
                    await this.databaseManager.run('DELETE FROM users');
                    break;
                default:
                    throw new Error(`Unknown data type for deletion: ${dataType}`);
            }

            this.signalMessage('DATA_DELETED', {
                dataType,
                timestamp: Date.now()
            });
        } catch (error) {
            this.logError('Failed to delete data', { dataType, error: error.message });
            this.signalMessage('DATA_DELETE_ERROR', {
                dataType,
                error: error.message
            });
        }
    }

    async getCache(key) {
        try {
            const value = this.cache.get(key);
            this.signalMessage('CACHE_RETRIEVED', {
                key,
                value,
                timestamp: Date.now()
            });
        } catch (error) {
            this.logError('Failed to get cache', { key, error: error.message });
        }
    }

    async setCache(key, value) {
        try {
            this.cache.set(key, value);
            this.signalMessage('CACHE_SET', {
                key,
                timestamp: Date.now()
            });
        } catch (error) {
            this.logError('Failed to set cache', { key, error: error.message });
        }
    }

    async customCleanup() {
        try {
            // Close database connection
            if (this.databaseManager) {
                await this.databaseManager.close();
            }
            this.logInfo('Database manager worker cleanup completed');
        } catch (error) {
            this.logError('Error during cleanup', { error: error.message });
        }
    }

    async customHealthCheck() {
        try {
            return {
                healthy: true,
                cacheSize: this.cache.size,
                lastSaveTime: this.lastSaveTime,
                uptime: Date.now() - this.startTime
            };
        } catch (error) {
            this.logError('Health check failed', { error: error.message });
            return { healthy: false, error: error.message };
        }
    }
}

// Initialize worker if this file is run directly
if (require.main === module) {
    const worker = new DataManagerWorker();
    worker.initialize().catch(error => {
        console.error('Data manager worker failed to initialize:', error);
        process.exit(1);
    });
}

module.exports = DataManagerWorker;
