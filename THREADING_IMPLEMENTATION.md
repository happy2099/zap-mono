# 🔧 ZapBot Threading Implementation Guide

## 📋 Implementation Steps

### Phase 1: Core Infrastructure Setup

#### Step 1: Create Worker Directory Structure
```bash
mkdir workers/
mkdir workers/templates/
mkdir config/
mkdir tests/threading/
```

#### Step 2: Create Base Worker Template
```javascript
// workers/templates/baseWorker.js
const { parentPort, workerData } = require('worker_threads');

class BaseWorker {
    constructor() {
        this.workerName = workerData.workerName;
        this.isShuttingDown = false;
        this.messageHandlers = new Map();
    }

    async initialize() {
        this.setupMessageHandlers();
        this.signalReady();
    }

    setupMessageHandlers() {
        this.registerHandler('SHUTDOWN', this.handleShutdown.bind(this));
        this.registerHandler('PING', this.handlePing.bind(this));
    }

    registerHandler(messageType, handler) {
        this.messageHandlers.set(messageType, handler);
    }

    async handleMessage(message) {
        const handler = this.messageHandlers.get(message.type);
        if (handler) {
            await handler(message);
        }
    }

    signalReady() {
        parentPort.postMessage({
            type: 'WORKER_READY',
            workerName: this.workerName,
            timestamp: Date.now()
        });
    }

    async handleShutdown() {
        this.isShuttingDown = true;
        await this.cleanup();
        process.exit(0);
    }

    async handlePing() {
        parentPort.postMessage({
            type: 'PONG',
            workerName: this.workerName,
            timestamp: Date.now()
        });
    }

    async cleanup() {
        // Override in subclasses
    }
}

module.exports = BaseWorker;
```

#### Step 3: Update Main Thread
```javascript
// zapbot.js - Updated main thread
const { Worker } = require('worker_threads');

class ThreadedZapBot {
    constructor() {
        this.workers = new Map();
        this.workerStates = new Map();
        this.messageHandlers = new Map();
    }

    async initialize() {
        await this.initializeWorkers();
        this.setupMessageHandlers();
        this.setupWorkerMonitoring();
    }

    async initializeWorkers() {
        const workerConfigs = [
            { name: 'telegram', file: './workers/telegramWorker.js' },
            { name: 'monitor', file: './workers/traderMonitorWorker.js' },
            { name: 'executor', file: './workers/tradeExecutorWorker.js' },
            { name: 'data', file: './workers/dataManagerWorker.js' },
            { name: 'websocket', file: './workers/websocketWorker.js' },
            { name: 'cache', file: './workers/cacheManagerWorker.js' },
            { name: 'analyzer', file: './workers/transactionAnalyzerWorker.js' }
        ];

        for (const config of workerConfigs) {
            await this.createWorker(config);
        }
    }

    async createWorker(config) {
        const worker = new Worker(config.file, {
            workerData: { workerName: config.name }
        });

        this.setupWorkerEventHandlers(worker, config.name);
        this.workers.set(config.name, worker);
        this.workerStates.set(config.name, 'initializing');

        return worker;
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

    handleWorkerMessage(workerName, message) {
        switch (message.type) {
            case 'WORKER_READY':
                this.workerStates.set(workerName, 'ready');
                console.log(`Worker ${workerName} is ready`);
                break;
            case 'NEW_TRANSACTIONS':
                this.handleNewTransactions(message);
                break;
            case 'TRADE_EXECUTED':
                this.handleTradeExecuted(message);
                break;
            case 'TRADE_FAILED':
                this.handleTradeFailed(message);
                break;
            default:
                console.log(`Unknown message type from ${workerName}:`, message.type);
        }
    }

    handleWorkerError(workerName, error) {
        console.error(`Worker ${workerName} error:`, error);
        this.restartWorker(workerName);
    }

    async restartWorker(workerName) {
        console.log(`Restarting worker ${workerName}...`);
        
        const worker = this.workers.get(workerName);
        if (worker) {
            worker.terminate();
            await this.delay(5000);
            
            const newWorker = await this.createWorker({
                name: workerName,
                file: `./workers/${workerName}Worker.js`
            });
            
            this.workers.set(workerName, newWorker);
        }
    }

    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}
```

### Phase 2: Worker Implementation

#### Step 4: Implement Trader Monitor Worker
```javascript
// workers/traderMonitorWorker.js
const BaseWorker = require('./templates/baseWorker');
const { Connection, PublicKey } = require('@solana/web3.js');

class TraderMonitorWorker extends BaseWorker {
    constructor() {
        super();
        this.activeTraders = new Map();
        this.pollingIntervals = new Map();
        this.connection = null;
        this.cutoffSignatures = new Map();
    }

    async initialize() {
        await super.initialize();
        
        this.connection = new Connection(process.env.RPC_URL);
        
        this.registerHandler('START_MONITORING', this.handleStartMonitoring.bind(this));
        this.registerHandler('STOP_MONITORING', this.handleStopMonitoring.bind(this));
    }

    async handleStartMonitoring(message) {
        const { traders } = message.data;
        
        for (const trader of traders) {
            await this.startMonitoringTrader(trader);
        }
    }

    async startMonitoringTrader(trader) {
        if (this.activeTraders.has(trader.wallet)) {
            return;
        }

        this.activeTraders.set(trader.wallet, trader);
        
        // Initialize cutoff signature
        try {
            const signatures = await this.connection.getSignaturesForAddress(
                new PublicKey(trader.wallet),
                { limit: 1 }
            );
            
            if (signatures.length > 0) {
                this.cutoffSignatures.set(trader.wallet, signatures[0].signature);
            }
        } catch (error) {
            console.error(`Failed to initialize cutoff for ${trader.name}:`, error);
        }
        
        // Create polling interval
        const interval = setInterval(async () => {
            await this.pollTrader(trader);
        }, 25000);

        this.pollingIntervals.set(trader.wallet, interval);
    }

    async pollTrader(trader) {
        if (this.isShuttingDown) return;

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
                workerName: this.workerName,
                error: error.message,
                trader: trader.name
            });
        }
    }

    async handleStopMonitoring(message) {
        const { traderWallet } = message.data;
        await this.stopMonitoringTrader(traderWallet);
    }

    async stopMonitoringTrader(traderWallet) {
        const interval = this.pollingIntervals.get(traderWallet);
        if (interval) {
            clearInterval(interval);
            this.pollingIntervals.delete(traderWallet);
        }
        this.activeTraders.delete(traderWallet);
        this.cutoffSignatures.delete(traderWallet);
    }

    async cleanup() {
        // Clear all intervals
        for (const interval of this.pollingIntervals.values()) {
            clearInterval(interval);
        }
        
        this.pollingIntervals.clear();
        this.activeTraders.clear();
        this.cutoffSignatures.clear();
    }
}

// Initialize worker
const worker = new TraderMonitorWorker();
worker.initialize();

// Handle messages
parentPort.on('message', async (message) => {
    await worker.handleMessage(message);
});
```

#### Step 5: Implement Trade Executor Worker
```javascript
// workers/tradeExecutorWorker.js
const BaseWorker = require('./templates/baseWorker');
const { Connection, Keypair } = require('@solana/web3.js');

class TradeExecutorWorker extends BaseWorker {
    constructor() {
        super();
        this.executionQueue = [];
        this.isProcessing = false;
        this.connection = null;
        this.activeExecutions = new Map();
        this.maxConcurrentTrades = 10;
    }

    async initialize() {
        await super.initialize();
        
        this.connection = new Connection(process.env.RPC_URL);
        
        this.registerHandler('EXECUTE_TRADE', this.handleExecuteTrade.bind(this));
        this.registerHandler('STOP_ACCEPTING_TASKS', this.handleStopAcceptingTasks.bind(this));
    }

    async handleExecuteTrade(message) {
        const { tradeData } = message.data;
        
        const executionId = await this.queueTrade(tradeData);
        
        parentPort.postMessage({
            type: 'TRADE_QUEUED',
            executionId: executionId,
            timestamp: Date.now()
        });
    }

    async queueTrade(tradeData) {
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

    async buildTransaction(tradeData) {
        // This would integrate with existing platform builders
        // For now, return a placeholder
        throw new Error('Transaction building not implemented');
    }

    handleStopAcceptingTasks() {
        this.executionQueue = [];
        this.isProcessing = false;
    }

    async cleanup() {
        this.executionQueue = [];
        this.activeExecutions.clear();
    }
}

// Initialize worker
const worker = new TradeExecutorWorker();
worker.initialize();

// Handle messages
parentPort.on('message', async (message) => {
    await worker.handleMessage(message);
});
```

### Phase 3: Integration

#### Step 6: Update Main Bot Logic
```javascript
// In zapbot.js - Update existing methods
class ThreadedZapBot {
    // ... existing code ...

    async handleStartCopy(chatId, traderName) {
        console.log(`[Action] START request for ${traderName} from chat ${chatId}`);
        
        try {
            const userTraders = await this.dataManager.loadTraders(chatId);
            if (userTraders[traderName]) {
                userTraders[traderName].active = true;
                await this.dataManager.saveTraders(chatId, userTraders);
                
                // Start monitoring in worker thread
                this.workers.get('monitor').postMessage({
                    type: 'START_MONITORING',
                    data: {
                        traders: [userTraders[traderName]]
                    }
                });
                
                await this.telegramUi.showMainMenu(chatId);
            } else {
                await this.telegramUi.sendErrorMessage(chatId, `Trader "${traderName}" not found.`);
            }
        } catch (e) {
            await this.telegramUi.sendErrorMessage(chatId, `Failed to start copying: ${e.message}`);
        }
    }

    async handleNewTransactions(message) {
        const { trader, wallet, signatures } = message;
        
        // Process each signature
        for (const signature of signatures) {
            // Send to analyzer worker
            this.workers.get('analyzer').postMessage({
                type: 'ANALYZE_TRANSACTION',
                data: {
                    signature,
                    trader,
                    wallet
                }
            });
        }
    }

    async handleTradeExecuted(message) {
        const { executionId, result } = message;
        
        // Update trade statistics
        await this.dataManager.updateTradeStats(result);
        
        // Send notification
        await this.notificationManager.sendTradeNotification(result);
    }

    async handleTradeFailed(message) {
        const { executionId, error } = message;
        
        console.error(`Trade execution failed: ${error}`);
        
        // Log error and potentially retry
        await this.dataManager.logTradeError(executionId, error);
    }
}
```

### Phase 4: Testing

#### Step 7: Create Test Suite
```javascript
// tests/threading/worker.test.js
const { Worker } = require('worker_threads');

describe('Worker Threads', () => {
    test('Trader Monitor Worker Initialization', async () => {
        const worker = new Worker('./workers/traderMonitorWorker.js');
        
        const readyMessage = await new Promise(resolve => {
            worker.on('message', resolve);
        });
        
        expect(readyMessage.type).toBe('WORKER_READY');
        worker.terminate();
    });

    test('Trade Executor Worker Queue', async () => {
        const worker = new Worker('./workers/tradeExecutorWorker.js');
        
        // Wait for worker to be ready
        await new Promise(resolve => {
            worker.on('message', (msg) => {
                if (msg.type === 'WORKER_READY') resolve();
            });
        });
        
        // Send trade execution request
        const result = await new Promise(resolve => {
            worker.on('message', resolve);
            worker.postMessage({
                type: 'EXECUTE_TRADE',
                data: {
                    tradeData: {
                        platform: 'test',
                        tokenMint: 'test',
                        amount: 1,
                        direction: 'buy'
                    }
                }
            });
        });
        
        expect(result.type).toBe('TRADE_QUEUED');
        worker.terminate();
    });
});
```

#### Step 8: Performance Testing
```javascript
// tests/threading/performance.test.js
describe('Performance Tests', () => {
    test('High Trader Count', async () => {
        const traderCount = 50;
        const traders = Array.from({ length: traderCount }, (_, i) => ({
            name: `trader_${i}`,
            wallet: `wallet_${i}`,
            active: true
        }));

        const startTime = Date.now();
        
        // Start monitoring all traders
        const worker = new Worker('./workers/traderMonitorWorker.js');
        
        await new Promise(resolve => {
            worker.on('message', (msg) => {
                if (msg.type === 'WORKER_READY') resolve();
            });
        });
        
        worker.postMessage({
            type: 'START_MONITORING',
            data: { traders }
        });
        
        const endTime = Date.now();
        
        expect(endTime - startTime).toBeLessThan(5000); // Should complete within 5 seconds
        worker.terminate();
    });
});
```

### Phase 5: Deployment

#### Step 9: Update Package.json
```json
{
  "scripts": {
    "start": "node zapbot.js",
    "start:threaded": "node zapbot.js --threading",
    "test:threading": "jest tests/threading/",
    "dev:threaded": "nodemon zapbot.js --threading"
  }
}
```

#### Step 10: Environment Configuration
```bash
# .env
THREADING_ENABLED=true
MAX_WORKER_MEMORY=1GB
WORKER_RESTART_DELAY=5000
MAX_CONCURRENT_TRADES=50
MAX_QUEUE_SIZE=1000
HEARTBEAT_INTERVAL=30000
```

## 🚀 Quick Start Commands

```bash
# Install dependencies
npm install

# Run threaded version
npm run start:threaded

# Run tests
npm run test:threading

# Development mode
npm run dev:threaded
```

## 📊 Monitoring Commands

```bash
# Check worker status
curl http://localhost:3000/workers/status

# Monitor performance
curl http://localhost:3000/metrics

# View logs
tail -f logs/threading.log
```

This implementation guide provides step-by-step instructions for converting ZapBot to a threaded architecture, including all the necessary code changes and testing procedures.
