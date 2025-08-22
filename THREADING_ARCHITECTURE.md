# 🏗️ ZapBot Threaded Architecture - Technical Specifications

## 📋 Table of Contents
1. [Thread Structure](#thread-structure)
2. [Message Passing Protocol](#message-passing-protocol)
3. [Worker Thread Implementation](#worker-thread-implementation)
4. [Shared Memory Management](#shared-memory-management)
5. [Error Handling & Recovery](#error-handling--recovery)
6. [Performance Optimization](#performance-optimization)
7. [Configuration Management](#configuration-management)

## 🧵 Thread Structure

### Main Thread (Orchestrator)
```javascript
// zapbot.js - Main orchestrator
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');

class ThreadedZapBot {
    constructor() {
        this.workers = new Map();
        this.messageHandlers = new Map();
        this.workerStates = new Map();
        this.isShuttingDown = false;
    }

    async initialize() {
        await this.initializeWorkers();
        this.setupMessageHandlers();
        this.setupWorkerMonitoring();
        this.setupShutdownHandlers();
    }

    async initializeWorkers() {
        const workerConfigs = [
            { name: 'telegram', file: './workers/telegramWorker.js', options: { maxMemory: '512MB' } },
            { name: 'monitor', file: './workers/traderMonitorWorker.js', options: { maxMemory: '1GB' } },
            { name: 'executor', file: './workers/tradeExecutorWorker.js', options: { maxMemory: '1GB' } },
            { name: 'data', file: './workers/dataManagerWorker.js', options: { maxMemory: '512MB' } },
            { name: 'websocket', file: './workers/websocketWorker.js', options: { maxMemory: '256MB' } },
            { name: 'cache', file: './workers/cacheManagerWorker.js', options: { maxMemory: '256MB' } },
            { name: 'analyzer', file: './workers/transactionAnalyzerWorker.js', options: { maxMemory: '512MB' } }
        ];

        for (const config of workerConfigs) {
            const worker = new Worker(config.file, {
                workerData: { 
                    workerName: config.name,
                    options: config.options
                }
            });
            
            this.setupWorkerEventHandlers(worker, config.name);
            this.workers.set(config.name, worker);
            this.workerStates.set(config.name, 'initializing');
        }
    }

    setupWorkerEventHandlers(worker, workerName) {
        worker.on('message', (message) => {
            this.handleWorkerMessage(workerName, message);
        });

        worker.on('error', (error) => {
            console.error(`Worker ${workerName} error:`, error);
            this.handleWorkerError(workerName, error);
        });

        worker.on('exit', (code) => {
            console.log(`Worker ${workerName} exited with code ${code}`);
            this.handleWorkerExit(workerName, code);
        });
    }
}
```

### Worker Thread Responsibilities

#### 1. Telegram UI Worker
```javascript
// workers/telegramWorker.js
class TelegramWorker {
    constructor() {
        this.bot = null;
        this.activeFlows = new Map();
        this.messageQueue = [];
    }

    async initialize() {
        this.bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { 
            polling: { interval: 300, autoStart: true } 
        });
        
        this.setupEventListeners();
        
        parentPort.postMessage({
            type: 'WORKER_READY',
            workerName: workerData.workerName
        });
    }

    setupEventListeners() {
        this.bot.onText(/^\/(start|menu)$/, msg => this.handleMenuCommand(msg));
        this.bot.on('callback_query', cb => this.handleCallbackQuery(cb));
        this.bot.on('message', msg => this.handleMessage(msg));
    }

    async handleMenuCommand(msg) {
        const chatId = msg.chat.id;
        
        // Send menu request to main thread for data
        parentPort.postMessage({
            type: 'REQUEST_MENU_DATA',
            chatId: chatId
        });
    }
}
```

#### 2. Trader Monitor Worker
```javascript
// workers/traderMonitorWorker.js
class TraderMonitorWorker {
    constructor() {
        this.activeTraders = new Map();
        this.pollingIntervals = new Map();
        this.connection = null;
        this.cutoffSignatures = new Map();
    }

    async initialize() {
        this.connection = new Connection(process.env.RPC_URL);
        
        parentPort.postMessage({
            type: 'WORKER_READY',
            workerName: workerData.workerName
        });
    }

    async startMonitoring(traders) {
        for (const trader of traders) {
            if (this.activeTraders.has(trader.wallet)) {
                continue;
            }

            this.activeTraders.set(trader.wallet, trader);
            
            // Initialize cutoff signature
            const signatures = await this.connection.getSignaturesForAddress(
                new PublicKey(trader.wallet), 
                { limit: 1 }
            );
            
            if (signatures.length > 0) {
                this.cutoffSignatures.set(trader.wallet, signatures[0].signature);
            }
            
            // Create individual polling interval
            const interval = setInterval(async () => {
                await this.pollTrader(trader);
            }, 25000);

            this.pollingIntervals.set(trader.wallet, interval);
        }
    }

    async pollTrader(trader) {
        try {
            const cutoff = this.cutoffSignatures.get(trader.wallet);
            const signatures = await this.connection.getSignaturesForAddress(
                new PublicKey(trader.wallet),
                { limit: 25 }
            );

            const newSignatures = [];
            for (const sig of signatures) {
                if (sig.signature === cutoff) break;
                if (!sig.err) newSignatures.push(sig.signature);
            }

            if (newSignatures.length > 0) {
                this.cutoffSignatures.set(trader.wallet, newSignatures[0]);
                
                parentPort.postMessage({
                    type: 'NEW_TRANSACTIONS',
                    trader: trader.name,
                    wallet: trader.wallet,
                    signatures: newSignatures,
                    timestamp: Date.now()
                });
            }
        } catch (error) {
            parentPort.postMessage({
                type: 'WORKER_ERROR',
                workerName: workerData.workerName,
                error: error.message,
                trader: trader.name
            });
        }
    }
}
```

#### 3. Trade Executor Worker
```javascript
// workers/tradeExecutorWorker.js
class TradeExecutorWorker {
    constructor() {
        this.executionQueue = [];
        this.isProcessing = false;
        this.connection = null;
        this.activeExecutions = new Map();
        this.maxConcurrentTrades = 10;
    }

    async initialize() {
        this.connection = new Connection(process.env.RPC_URL);
        
        parentPort.postMessage({
            type: 'WORKER_READY',
            workerName: workerData.workerName
        });
    }

    async processTradeExecution(tradeData) {
        const executionId = `exec_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        
        this.executionQueue.push({
            id: executionId,
            data: tradeData,
            timestamp: Date.now(),
            priority: tradeData.priority || 0
        });

        // Sort queue by priority
        this.executionQueue.sort((a, b) => b.priority - a.priority);

        if (!this.isProcessing) {
            this.processQueue();
        }

        return executionId;
    }

    async processQueue() {
        this.isProcessing = true;

        while (this.executionQueue.length > 0 && this.activeExecutions.size < this.maxConcurrentTrades) {
            const trade = this.executionQueue.shift();
            
            this.activeExecutions.set(trade.id, trade);
            
            // Execute trade in parallel
            this.executeTrade(trade).catch(error => {
                parentPort.postMessage({
                    type: 'TRADE_FAILED',
                    executionId: trade.id,
                    error: error.message,
                    timestamp: Date.now()
                });
            }).finally(() => {
                this.activeExecutions.delete(trade.id);
            });
        }

        this.isProcessing = false;
        
        // Continue processing if queue is not empty
        if (this.executionQueue.length > 0) {
            setTimeout(() => this.processQueue(), 100);
        }
    }

    async executeTrade(trade) {
        const { platform, tokenMint, amount, direction, userWallet } = trade.data;
        
        // Build transaction based on platform
        const transaction = await this.buildTransaction(trade.data);
        
        // Send transaction
        const signature = await this.connection.sendTransaction(transaction);
        
        // Wait for confirmation
        const confirmation = await this.connection.confirmTransaction(signature);
        
        if (confirmation.value.err) {
            throw new Error(`Transaction failed: ${confirmation.value.err}`);
        }
        
        parentPort.postMessage({
            type: 'TRADE_EXECUTED',
            executionId: trade.id,
            result: {
                signature,
                platform,
                tokenMint,
                amount,
                direction,
                status: 'success',
                confirmation
            },
            timestamp: Date.now()
        });
    }
}
```

## 📨 Message Passing Protocol

### Message Types
```javascript
const MESSAGE_TYPES = {
    // System messages
    WORKER_READY: 'WORKER_READY',
    WORKER_ERROR: 'WORKER_ERROR',
    SHUTDOWN: 'SHUTDOWN',
    
    // Trader monitoring
    START_MONITORING: 'START_MONITORING',
    STOP_MONITORING: 'STOP_MONITORING',
    NEW_TRANSACTIONS: 'NEW_TRANSACTIONS',
    
    // Trade execution
    EXECUTE_TRADE: 'EXECUTE_TRADE',
    TRADE_EXECUTED: 'TRADE_EXECUTED',
    TRADE_FAILED: 'TRADE_FAILED',
    TRADE_QUEUED: 'TRADE_QUEUED',
    
    // Data management
    LOAD_DATA: 'LOAD_DATA',
    SAVE_DATA: 'SAVE_DATA',
    DATA_LOADED: 'DATA_LOADED',
    DATA_SAVED: 'DATA_SAVED',
    
    // Transaction analysis
    ANALYZE_TRANSACTION: 'ANALYZE_TRANSACTION',
    ANALYSIS_COMPLETE: 'ANALYSIS_COMPLETE',
    
    // WebSocket
    WEBSOCKET_DATA: 'WEBSOCKET_DATA',
    WEBSOCKET_ERROR: 'WEBSOCKET_ERROR',
    
    // Cache management
    CACHE_GET: 'CACHE_GET',
    CACHE_SET: 'CACHE_SET',
    CACHE_CLEAR: 'CACHE_CLEAR',
    
    // Telegram UI
    REQUEST_MENU_DATA: 'REQUEST_MENU_DATA',
    SEND_MESSAGE: 'SEND_MESSAGE',
    UPDATE_MESSAGE: 'UPDATE_MESSAGE'
};
```

### Message Structure
```javascript
// Standard message format
{
    type: MESSAGE_TYPES.EXECUTE_TRADE,
    id: 'unique_message_id',
    timestamp: Date.now(),
    data: {
        // Message-specific data
    },
    metadata: {
        source: 'worker_name',
        priority: 0,
        retryCount: 0
    }
}
```

### Message Handler Implementation
```javascript
class MessageHandler {
    constructor() {
        this.handlers = new Map();
        this.messageQueue = [];
        this.isProcessing = false;
    }

    registerHandler(messageType, handler) {
        this.handlers.set(messageType, handler);
    }

    async handleMessage(workerName, message) {
        const handler = this.handlers.get(message.type);
        
        if (handler) {
            try {
                await handler(workerName, message);
            } catch (error) {
                console.error(`Error handling message ${message.type}:`, error);
                
                // Send error response
                this.sendToWorker(workerName, {
                    type: 'MESSAGE_ERROR',
                    originalMessage: message,
                    error: error.message
                });
            }
        } else {
            console.warn(`No handler for message type: ${message.type}`);
        }
    }

    sendToWorker(workerName, message) {
        const worker = this.workers.get(workerName);
        if (worker) {
            worker.postMessage(message);
        }
    }
}
```

## 🧠 Shared Memory Management

### Shared Memory Implementation
```javascript
// For high-frequency data sharing between threads
const { SharedArrayBuffer, Atomics } = require('worker_threads');

class SharedMemoryManager {
    constructor() {
        this.sharedBuffers = new Map();
        this.atomicViews = new Map();
        this.locks = new Map();
    }

    createSharedBuffer(name, size) {
        const buffer = new SharedArrayBuffer(size);
        const view = new Uint8Array(buffer);
        
        this.sharedBuffers.set(name, buffer);
        this.atomicViews.set(name, view);
        
        // Initialize lock
        this.locks.set(name, new Int32Array(buffer, 0, 1));
        
        return { buffer, view };
    }

    acquireLock(bufferName) {
        const lock = this.locks.get(bufferName);
        if (!lock) return false;
        
        // Try to acquire lock (0 = unlocked, 1 = locked)
        const oldValue = Atomics.compareExchange(lock, 0, 0, 1);
        return oldValue === 0;
    }

    releaseLock(bufferName) {
        const lock = this.locks.get(bufferName);
        if (lock) {
            Atomics.store(lock, 0, 0);
        }
    }

    writeToBuffer(bufferName, data, offset = 4) {
        const view = this.atomicViews.get(bufferName);
        if (!view) return false;
        
        if (this.acquireLock(bufferName)) {
            try {
                const encoder = new TextEncoder();
                const encoded = encoder.encode(JSON.stringify(data));
                view.set(encoded, offset);
                return true;
            } finally {
                this.releaseLock(bufferName);
            }
        }
        return false;
    }

    readFromBuffer(bufferName, offset = 4) {
        const view = this.atomicViews.get(bufferName);
        if (!view) return null;
        
        if (this.acquireLock(bufferName)) {
            try {
                const decoder = new TextDecoder();
                const data = decoder.decode(view.slice(offset));
                return JSON.parse(data);
            } finally {
                this.releaseLock(bufferName);
            }
        }
        return null;
    }
}
```

### High-Frequency Data Sharing
```javascript
// Example: Sharing trader activity data
class TraderActivityBuffer {
    constructor() {
        this.buffer = new SharedArrayBuffer(1024 * 1024); // 1MB
        this.view = new Uint32Array(this.buffer);
        this.dataView = new DataView(this.buffer);
    }

    writeTraderActivity(traderWallet, activity) {
        const hash = this.hashWallet(traderWallet);
        const offset = (hash % 1000) * 8; // 8 bytes per entry
        
        // Write timestamp
        this.dataView.setBigUint64(offset, BigInt(Date.now()));
        
        // Write activity data
        this.dataView.setUint32(offset + 8, activity.transactionCount);
        this.dataView.setUint32(offset + 12, activity.lastActivity);
    }

    readTraderActivity(traderWallet) {
        const hash = this.hashWallet(traderWallet);
        const offset = (hash % 1000) * 8;
        
        const timestamp = Number(this.dataView.getBigUint64(offset));
        const transactionCount = this.dataView.getUint32(offset + 8);
        const lastActivity = this.dataView.getUint32(offset + 12);
        
        return {
            timestamp,
            transactionCount,
            lastActivity
        };
    }

    hashWallet(wallet) {
        let hash = 0;
        for (let i = 0; i < wallet.length; i++) {
            hash = ((hash << 5) - hash) + wallet.charCodeAt(i);
            hash = hash & hash; // Convert to 32-bit integer
        }
        return Math.abs(hash);
    }
}
```

## 🛡️ Error Handling & Recovery

### Worker Error Handler
```javascript
class WorkerErrorHandler {
    constructor() {
        this.errorCounts = new Map();
        this.restartDelays = new Map();
        this.maxRetries = 3;
        this.baseDelay = 5000;
    }

    handleWorkerError(workerName, error) {
        const errorCount = this.errorCounts.get(workerName) || 0;
        this.errorCounts.set(workerName, errorCount + 1);

        console.error(`Worker ${workerName} error (${errorCount + 1}):`, error);

        if (errorCount >= this.maxRetries) {
            this.restartWorker(workerName);
        } else {
            // Exponential backoff
            const delay = this.baseDelay * Math.pow(2, errorCount);
            setTimeout(() => {
                this.resetErrorCount(workerName);
            }, delay);
        }
    }

    async restartWorker(workerName) {
        console.log(`Restarting worker ${workerName}...`);
        
        const worker = this.workers.get(workerName);
        if (worker) {
            try {
                worker.terminate();
                await this.delay(this.restartDelays.get(workerName) || this.baseDelay);
                
                const newWorker = new Worker(`./workers/${workerName}Worker.js`);
                this.setupWorkerEventHandlers(newWorker, workerName);
                this.workers.set(workerName, newWorker);
                
                // Reset error count
                this.errorCounts.set(workerName, 0);
                
                // Exponential backoff for restart delay
                const currentDelay = this.restartDelays.get(workerName) || this.baseDelay;
                this.restartDelays.set(workerName, Math.min(currentDelay * 2, 60000));
                
            } catch (error) {
                console.error(`Failed to restart worker ${workerName}:`, error);
            }
        }
    }

    resetErrorCount(workerName) {
        this.errorCounts.set(workerName, 0);
    }

    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}
```

### Graceful Shutdown
```javascript
async shutdown() {
    console.log('Initiating graceful shutdown...');
    
    this.isShuttingDown = true;
    
    // Stop accepting new tasks
    this.stopAcceptingNewTasks();
    
    // Send shutdown message to all workers
    const shutdownPromises = Array.from(this.workers.values()).map(worker => {
        return new Promise((resolve) => {
            worker.postMessage({ type: 'SHUTDOWN' });
            
            const timeout = setTimeout(() => {
                console.warn('Worker shutdown timeout, forcing termination');
                worker.terminate();
                resolve();
            }, 10000); // 10 second timeout
            
            worker.once('exit', () => {
                clearTimeout(timeout);
                resolve();
            });
        });
    });
    
    // Wait for all workers to shutdown
    await Promise.all(shutdownPromises);
    
    console.log('All workers shutdown successfully');
}

stopAcceptingNewTasks() {
    // Stop accepting new trade executions
    this.workers.get('executor')?.postMessage({
        type: 'STOP_ACCEPTING_TASKS'
    });
    
    // Stop accepting new monitoring requests
    this.workers.get('monitor')?.postMessage({
        type: 'STOP_MONITORING'
    });
}
```

## ⚡ Performance Optimization

### Thread Pool Implementation
```javascript
class ThreadPool {
    constructor(size, workerScript, options = {}) {
        this.size = size;
        this.workerScript = workerScript;
        this.workers = [];
        this.taskQueue = [];
        this.availableWorkers = [];
        this.maxQueueSize = options.maxQueueSize || 1000;
        this.taskTimeout = options.taskTimeout || 30000;
    }

    async initialize() {
        for (let i = 0; i < this.size; i++) {
            const worker = new Worker(this.workerScript);
            this.setupWorkerHandlers(worker);
            this.workers.push(worker);
            this.availableWorkers.push(worker);
        }
    }

    setupWorkerHandlers(worker) {
        worker.on('message', (result) => {
            this.availableWorkers.push(worker);
            
            if (this.taskQueue.length > 0) {
                const nextTask = this.taskQueue.shift();
                this.assignTaskToWorker(worker, nextTask);
            }
        });

        worker.on('error', (error) => {
            console.error('Worker error:', error);
            this.restartWorker(worker);
        });
    }

    async executeTask(task) {
        return new Promise((resolve, reject) => {
            if (this.taskQueue.length >= this.maxQueueSize) {
                reject(new Error('Task queue full'));
                return;
            }

            const taskWrapper = {
                task,
                resolve,
                reject,
                timestamp: Date.now()
            };

            if (this.availableWorkers.length === 0) {
                this.taskQueue.push(taskWrapper);
                return;
            }

            const worker = this.availableWorkers.pop();
            this.assignTaskToWorker(worker, taskWrapper);
        });
    }

    assignTaskToWorker(worker, taskWrapper) {
        const timeout = setTimeout(() => {
            taskWrapper.reject(new Error('Task timeout'));
        }, this.taskTimeout);

        worker.once('message', (result) => {
            clearTimeout(timeout);
            taskWrapper.resolve(result);
        });

        worker.postMessage(taskWrapper.task);
    }

    async restartWorker(worker) {
        const index = this.workers.indexOf(worker);
        if (index !== -1) {
            worker.terminate();
            
            const newWorker = new Worker(this.workerScript);
            this.setupWorkerHandlers(newWorker);
            this.workers[index] = newWorker;
            this.availableWorkers.push(newWorker);
        }
    }
}
```

### Load Balancing
```javascript
class LoadBalancer {
    constructor() {
        this.workerLoads = new Map();
        this.workerCapacities = new Map();
        this.loadHistory = new Map();
    }

    selectWorker(taskType, taskData) {
        const availableWorkers = this.getAvailableWorkers(taskType);
        
        if (availableWorkers.length === 0) {
            return null;
        }

        // Select worker based on load and capacity
        let bestWorker = availableWorkers[0];
        let bestScore = this.calculateWorkerScore(bestWorker);

        for (const worker of availableWorkers.slice(1)) {
            const score = this.calculateWorkerScore(worker);
            if (score > bestScore) {
                bestWorker = worker;
                bestScore = score;
            }
        }

        return bestWorker;
    }

    calculateWorkerScore(worker) {
        const load = this.workerLoads.get(worker) || 0;
        const capacity = this.workerCapacities.get(worker) || 1;
        const history = this.loadHistory.get(worker) || [];
        
        // Calculate average load over time
        const avgLoad = history.length > 0 
            ? history.reduce((sum, l) => sum + l, 0) / history.length 
            : 0;
        
        // Score based on current capacity and historical performance
        return (capacity - load) * (1 - avgLoad / capacity);
    }

    updateWorkerLoad(worker, load) {
        this.workerLoads.set(worker, load);
        
        const history = this.loadHistory.get(worker) || [];
        history.push(load);
        
        // Keep only last 10 load measurements
        if (history.length > 10) {
            history.shift();
        }
        
        this.loadHistory.set(worker, history);
    }
}
```

## ⚙️ Configuration Management

### Threading Configuration
```javascript
// config/threading.js
module.exports = {
    // Thread configuration
    threads: {
        telegram: { 
            enabled: true, 
            maxMemory: '512MB',
            restartOnError: true,
            maxRestarts: 5
        },
        monitor: { 
            enabled: true, 
            maxMemory: '1GB',
            restartOnError: true,
            maxRestarts: 3
        },
        executor: { 
            enabled: true, 
            maxMemory: '1GB',
            restartOnError: true,
            maxRestarts: 3,
            maxConcurrentTrades: 10
        },
        data: { 
            enabled: true, 
            maxMemory: '512MB',
            restartOnError: true,
            maxRestarts: 5
        },
        websocket: { 
            enabled: true, 
            maxMemory: '256MB',
            restartOnError: true,
            maxRestarts: 10
        },
        cache: { 
            enabled: true, 
            maxMemory: '256MB',
            restartOnError: false,
            maxRestarts: 0
        },
        analyzer: { 
            enabled: true, 
            maxMemory: '512MB',
            restartOnError: true,
            maxRestarts: 3
        }
    },
    
    // Performance settings
    performance: {
        maxConcurrentTrades: 50,
        maxQueueSize: 1000,
        workerRestartDelay: 5000,
        heartbeatInterval: 30000,
        taskTimeout: 30000,
        maxRetries: 3
    },
    
    // Shared memory settings
    sharedMemory: {
        enabled: true,
        bufferSize: 1024 * 1024, // 1MB
        maxBuffers: 10,
        cleanupInterval: 60000 // 1 minute
    },
    
    // Load balancing
    loadBalancing: {
        enabled: true,
        algorithm: 'least-loaded', // 'round-robin', 'least-loaded', 'weighted'
        updateInterval: 5000
    }
};
```

### Environment Variables
```bash
# Threading configuration
THREADING_ENABLED=true
MAX_WORKER_MEMORY=1GB
WORKER_RESTART_DELAY=5000
MAX_CONCURRENT_TRADES=50
MAX_QUEUE_SIZE=1000
HEARTBEAT_INTERVAL=30000

# Shared memory
SHARED_MEMORY_ENABLED=true
SHARED_BUFFER_SIZE=1048576
SHARED_BUFFER_COUNT=10

# Performance tuning
TASK_TIMEOUT=30000
MAX_RETRIES=3
LOAD_BALANCING_ENABLED=true
```

This detailed architecture document provides comprehensive technical specifications for implementing the threaded version of ZapBot, including all the minute details needed for development.
