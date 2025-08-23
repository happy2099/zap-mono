import BaseWorker from './templates/baseWorker.js';
import { parentPort } from 'worker_threads';

class DataManagerWorker extends BaseWorker {
    constructor() {
        super();
        this.dataManager = null;
        this.operationQueue = [];
        this.isProcessing = false;
        this.maxConcurrentOperations = 10;
        this.activeOperations = new Map();
    }

    async initialize() {
        await super.initialize();
        
        // Initialize data manager
        await this.initializeDataManager();
        
        // Register custom message handlers
        this.registerHandler('LOAD_TRADERS', this.handleLoadTraders.bind(this));
        this.registerHandler('SAVE_TRADERS', this.handleSaveTraders.bind(this));
        this.registerHandler('UPDATE_TRADE_STATS', this.handleUpdateTradeStats.bind(this));
        this.registerHandler('LOG_TRADE_ERROR', this.handleLogTradeError.bind(this));
        this.registerHandler('LOAD_USER_DATA', this.handleLoadUserData.bind(this));
        this.registerHandler('SAVE_USER_DATA', this.handleSaveUserData.bind(this));
        
        console.log('DataManagerWorker initialized');
    }

    async initializeDataManager() {
        try {
            const { DatabaseDataManager } = await import('../database/databaseDataManager.js');
            this.dataManager = new DatabaseDataManager();
            await this.dataManager.initialize();
            console.log('DatabaseDataManager initialized in worker');
        } catch (error) {
            console.error('Failed to initialize DatabaseDataManager in worker:', error);
            throw error;
        }
    }

    async handleLoadTraders(message) {
        const { chatId } = message.data;
        
        console.log(`Loading traders for chat ${chatId}`);
        
        const operationId = await this.queueOperation({
            type: 'LOAD_TRADERS',
            data: { chatId },
            handler: async () => {
                const traders = await this.dataManager.loadTraders(chatId);
                return traders;
            }
        });

        parentPort.postMessage({
            type: 'OPERATION_QUEUED',
            operationId: operationId,
            timestamp: Date.now()
        });
    }

    async handleSaveTraders(message) {
        const { chatId, traders } = message.data;
        
        console.log(`Saving traders for chat ${chatId}`);
        
        const operationId = await this.queueOperation({
            type: 'SAVE_TRADERS',
            data: { chatId, traders },
            handler: async () => {
                await this.dataManager.saveTraders(chatId, traders);
                return { success: true };
            }
        });

        parentPort.postMessage({
            type: 'OPERATION_QUEUED',
            operationId: operationId,
            timestamp: Date.now()
        });
    }

    async handleUpdateTradeStats(message) {
        const { result } = message.data;
        
        console.log(`Updating trade stats for result:`, result);
        
        const operationId = await this.queueOperation({
            type: 'UPDATE_TRADE_STATS',
            data: { result },
            handler: async () => {
                // This would call the actual updateTradeStats method
                // For now, just log the operation
                console.log('Trade stats update operation queued');
                return { success: true };
            }
        });

        parentPort.postMessage({
            type: 'OPERATION_QUEUED',
            operationId: operationId,
            timestamp: Date.now()
        });
    }

    async handleLogTradeError(message) {
        const { executionId, error } = message.data;
        
        console.log(`Logging trade error for execution ${executionId}:`, error);
        
        const operationId = await this.queueOperation({
            type: 'LOG_TRADE_ERROR',
            data: { executionId, error },
            handler: async () => {
                // This would call the actual logTradeError method
                // For now, just log the operation
                console.log('Trade error logging operation queued');
                return { success: true };
            }
        });

        parentPort.postMessage({
            type: 'OPERATION_QUEUED',
            operationId: operationId,
            timestamp: Date.now()
        });
    }

    async handleLoadUserData(message) {
        const { chatId, dataType } = message.data;
        
        console.log(`Loading user data for chat ${chatId}, type: ${dataType}`);
        
        const operationId = await this.queueOperation({
            type: 'LOAD_USER_DATA',
            data: { chatId, dataType },
            handler: async () => {
                // This would call the appropriate load method based on dataType
                // For now, return empty data
                return {};
            }
        });

        parentPort.postMessage({
            type: 'OPERATION_QUEUED',
            operationId: operationId,
            timestamp: Date.now()
        });
    }

    async handleSaveUserData(message) {
        const { chatId, dataType, data } = message.data;
        
        console.log(`Saving user data for chat ${chatId}, type: ${dataType}`);
        
        const operationId = await this.queueOperation({
            type: 'SAVE_USER_DATA',
            data: { chatId, dataType, data },
            handler: async () => {
                // This would call the appropriate save method based on dataType
                // For now, just log the operation
                console.log('User data save operation queued');
                return { success: true };
            }
        });

        parentPort.postMessage({
            type: 'OPERATION_QUEUED',
            operationId: operationId,
            timestamp: Date.now()
        });
    }

    async queueOperation(operation) {
        const operationId = `op_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        
        this.operationQueue.push({
            id: operationId,
            ...operation,
            timestamp: Date.now(),
            priority: operation.priority || 0
        });

        // Sort queue by priority (higher priority first)
        this.operationQueue.sort((a, b) => b.priority - a.priority);

        console.log(`Operation queued with ID: ${operationId}, queue length: ${this.operationQueue.length}`);

        if (!this.isProcessing) {
            this.processOperationQueue();
        }

        return operationId;
    }

    async processOperationQueue() {
        this.isProcessing = true;

        while (this.operationQueue.length > 0 && this.activeOperations.size < this.maxConcurrentOperations) {
            const operation = this.operationQueue.shift();
            
            this.activeOperations.set(operation.id, operation);
            
            console.log(`Starting operation: ${operation.id} (${operation.type})`);
            
            // Execute operation in parallel
            this.executeOperation(operation).catch(error => {
                console.error(`Operation failed for ${operation.id}:`, error);
                
                parentPort.postMessage({
                    type: 'OPERATION_FAILED',
                    operationId: operation.id,
                    error: error.message,
                    timestamp: Date.now()
                });
            }).finally(() => {
                this.activeOperations.delete(operation.id);
                console.log(`Operation completed for: ${operation.id}`);
            });
        }

        this.isProcessing = false;
        
        // Continue processing if queue is not empty
        if (this.operationQueue.length > 0) {
            setTimeout(() => this.processOperationQueue(), 100);
        }
    }

    async executeOperation(operation) {
        try {
            const result = await operation.handler();
            
            parentPort.postMessage({
                type: 'OPERATION_COMPLETED',
                operationId: operation.id,
                operationType: operation.type,
                result: result,
                timestamp: Date.now()
            });
        } catch (error) {
            console.error(`Error executing operation ${operation.id}:`, error);
            throw error;
        }
    }

    async cleanup() {
        console.log('Cleaning up DataManagerWorker...');
        
        // Clear queue and stop processing
        this.operationQueue = [];
        this.activeOperations.clear();
        this.isProcessing = false;
        
        // Close database connections if needed
        if (this.dataManager) {
            // Add any cleanup needed for the data manager
        }
        
        console.log('DataManagerWorker cleanup complete');
    }
}

// Initialize worker
const worker = new DataManagerWorker();
worker.initialize();

// Handle messages from main thread
parentPort.on('message', async (message) => {
    await worker.handleMessage(message);
});
