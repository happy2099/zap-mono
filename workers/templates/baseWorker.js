// ==========================================
// ========== Base Worker Template ==========
// ==========================================
// File: workers/templates/baseWorker.js
// Description: Base template for all worker threads

const { parentPort, workerData } = require('worker_threads');

class BaseWorker {
    constructor() {
        this.workerName = workerData?.workerName || 'unknown';
        this.isShuttingDown = false;
        this.messageHandlers = new Map();
        this.startTime = Date.now();
        this.messageCount = 0;
        this.errorCount = 0;
    }

    async initialize() {
        try {
            console.log(`[${this.workerName}] Initializing worker...`);
            this.setupMessageHandlers();
            this.setupMessageListener();
            await this.customInitialize();
            this.signalReady();
            console.log(`[${this.workerName}] Worker initialized successfully`);
        } catch (error) {
            console.error(`[${this.workerName}] Initialization failed:`, error);
            this.signalError(error);
        }
    }

    setupMessageHandlers() {
        this.registerHandler('SHUTDOWN', this.handleShutdown.bind(this));
        this.registerHandler('PING', this.handlePing.bind(this));
        this.registerHandler('STATS', this.handleStats.bind(this));
        this.registerHandler('HEALTH_CHECK', this.handleHealthCheck.bind(this));
    }

    setupMessageListener() {
        parentPort.on('message', async (message) => {
            try {
                this.messageCount++;
                await this.handleMessage(message);
            } catch (error) {
                this.errorCount++;
                console.error(`[${this.workerName}] Error handling message:`, error);
                this.signalError(error);
            }
        });
    }

    registerHandler(messageType, handler) {
        this.messageHandlers.set(messageType, handler);
    }

    async handleMessage(message) {
        let handler = this.messageHandlers.get(message.type);
        
        // Special case-insensitive handling for telegram worker
        if (!handler && this.workerName === 'telegram') {
            // Try common case variations for telegram messages
            const caseVariations = [
                message.type.toUpperCase(),
                message.type.toLowerCase(),
                'SEND_MESSAGE',  // Most common fallback
                'PIN_MESSAGE'
            ];
            
            for (const variation of caseVariations) {
                handler = this.messageHandlers.get(variation);
                if (handler) {
                    console.log(`[${this.workerName}] 🔧 Fixed case mismatch: ${message.type} -> ${variation}`);
                    break;
                }
            }
        }
        
        if (handler) {
            await handler(message);
        } else {
            console.warn(`[${this.workerName}] Unknown message type: ${message.type}`);
        }
    }

    signalReady() {
        parentPort.postMessage({
            type: 'WORKER_READY',
            workerName: this.workerName,
            timestamp: Date.now(),
            uptime: Date.now() - this.startTime
        });
    }

    signalError(error) {
        parentPort.postMessage({
            type: 'WORKER_ERROR',
            workerName: this.workerName,
            error: error.message,
            timestamp: Date.now()
        });
    }

    signalMessage(type, data = {}) {
        parentPort.postMessage({
            type,
            workerName: this.workerName,
            timestamp: Date.now(),
            ...data
        });
    }

    async handleShutdown(message) {
        console.log(`[${this.workerName}] Received shutdown signal`);
        this.isShuttingDown = true;
        await this.customCleanup();
        this.signalMessage('WORKER_SHUTDOWN');
        process.exit(0);
    }

    async handlePing(message) {
        // Send PONG response without logging to reduce verbosity
        this.signalMessage('PONG', {
            uptime: Date.now() - this.startTime,
            messageCount: this.messageCount,
            errorCount: this.errorCount
        });
    }

    async handleStats(message) {
        this.signalMessage('WORKER_STATS', {
            uptime: Date.now() - this.startTime,
            messageCount: this.messageCount,
            errorCount: this.errorCount,
            memoryUsage: process.memoryUsage()
        });
    }

    async handleHealthCheck(message) {
        const isHealthy = await this.customHealthCheck();
        this.signalMessage('HEALTH_RESPONSE', {
            healthy: isHealthy,
            uptime: Date.now() - this.startTime
        });
    }

    // Override these methods in subclasses
    async customInitialize() {
        // Custom initialization logic
    }

    async customCleanup() {
        // Custom cleanup logic
    }

    async customHealthCheck() {
        // Custom health check logic
        return true;
    }

    // Utility methods
    log(level, message, data = {}) {
        const timestamp = new Date().toISOString();
        console.log(`[${timestamp}] [${this.workerName}] [${level}] ${message}`, data);
    }

    logInfo(message, data = {}) {
        this.log('INFO', message, data);
    }

    logError(message, data = {}) {
        this.log('ERROR', message, data);
    }

    logWarn(message, data = {}) {
        this.log('WARN', message, data);
    }

    logDebug(message, data = {}) {
        this.log('DEBUG', message, data);
    }
}

module.exports = BaseWorker;

