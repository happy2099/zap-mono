// ==========================================
// ========== Threaded ZapBot Implementation ==========
// ==========================================
// File: threadedZapBot.js
// Description: Multi-threaded version of ZapBot using Worker Threads

const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const path = require('path');

class ThreadedZapBot {
    constructor(options = {}) {
        this.workers = new Map();
        this.workerStates = new Map();
        this.messageHandlers = new Map();
        this.isShuttingDown = false;
        this.isInitialized = false;
        this.startTime = Date.now();
        
        // Configuration
        this.config = {
            maxWorkerMemory: options.maxWorkerMemory || '1GB',
            workerRestartDelay: options.workerRestartDelay || 5000,
            maxConcurrentTrades: options.maxConcurrentTrades || 50,
            maxQueueSize: options.maxQueueSize || 1000,
            heartbeatInterval: options.heartbeatInterval || 30000,
            taskTimeout: options.taskTimeout || 30000,
            ...options
        };

        // Worker configurations
        this.workerConfigs = [
            { 
                name: 'telegram', 
                file: './workers/telegramWorker.js', 
                options: { maxMemory: '512MB' },
                required: false
            },
            { 
                name: 'monitor', 
                file: './workers/traderMonitorWorker.js', 
                options: { maxMemory: '1GB' },
                required: true
            },
            { 
                name: 'executor', 
                file: './workers/tradeExecutorWorker.js', 
                options: { maxMemory: '1GB' },
                required: true
            },
            { 
                name: 'data', 
                file: './workers/dataManagerWorker.js', 
                options: { maxMemory: '512MB' },
                required: true
            },
            { 
                name: 'websocket', 
                file: './workers/websocketWorker.js', 
                options: { maxMemory: '256MB' },
                required: false
            },
            { 
                name: 'cache', 
                file: './workers/cacheManagerWorker.js', 
                options: { maxMemory: '256MB' },
                required: true
            },
            { 
                name: 'analyzer', 
                file: './workers/transactionAnalyzerWorker.js', 
                options: { maxMemory: '512MB' },
                required: true
            }
        ];

        console.log('🧵 ThreadedZapBot initialized with worker configuration');
    }

    async initialize() {
        if (this.isInitialized) {
            console.warn('ThreadedZapBot is already initialized');
            return;
        }

        console.log('🚀 Starting ThreadedZapBot initialization...');

        try {
            // Step 1: Initialize workers
            await this.initializeWorkers();
            
            // Step 2: Setup message handlers
            this.setupMessageHandlers();
            
            // Step 3: Setup worker monitoring
            this.setupWorkerMonitoring();
            
            // Step 4: Setup shutdown handlers
            this.setupShutdownHandlers();
            
            // Step 5: Wait for all workers to be ready
            await this.waitForWorkersReady();
            
            this.isInitialized = true;
            console.log('✅ ThreadedZapBot initialization completed successfully');
            
            // Step 6: Start trader monitoring
            await this.startTraderMonitoring();
            
            // Send startup message
            console.log('🎉 ThreadedZapBot started successfully with', this.workers.size, 'workers');
            
        } catch (error) {
            console.error('❌ ThreadedZapBot initialization failed:', error);
            await this.cleanup();
            throw error;
        }
    }

    async initializeWorkers() {
        console.log('🔧 Initializing worker threads...');
        
        const initPromises = this.workerConfigs.map(config => this.createWorker(config));
        await Promise.all(initPromises);
        
        console.log(`✅ ${this.workers.size} workers initialized`);
    }

    async createWorker(config) {
        try {
            const worker = new Worker(path.resolve(__dirname, config.file), {
                workerData: { 
                    workerName: config.name,
                    ...config.options 
                }
            });

            this.setupWorkerEventHandlers(worker, config.name);
            this.workers.set(config.name, worker);
            this.workerStates.set(config.name, 'initializing');

            console.log(`🔧 Created worker: ${config.name}`);
            return worker;
        } catch (error) {
            console.error(`❌ Failed to create worker ${config.name}:`, error);
            if (config.required) {
                throw error;
            } else {
                console.warn(`⚠️ Optional worker ${config.name} failed to initialize, continuing...`);
            }
        }
    }

    setupWorkerEventHandlers(worker, workerName) {
        worker.on('message', (message) => {
            this.handleWorkerMessage(workerName, message);
        });

        worker.on('error', (error) => {
            console.error(`❌ Worker ${workerName} error:`, error);
            this.handleWorkerError(workerName, error);
        });

        worker.on('exit', (code) => {
            console.log(`📤 Worker ${workerName} exited with code ${code}`);
            this.handleWorkerExit(workerName, code);
        });
    }

    handleWorkerMessage(workerName, message) {
        try {
            switch (message.type) {
                case 'WORKER_READY':
                    this.workerStates.set(workerName, 'ready');
                    console.log(`✅ Worker ${workerName} is ready`);
                    break;
                    
                case 'WORKER_ERROR':
                    console.error(`❌ Worker ${workerName} reported error:`, message.error);
                    this.workerStates.set(workerName, 'error');
                    break;
                    
                case 'WORKER_SHUTDOWN':
                    console.log(`📤 Worker ${workerName} shutdown complete`);
                    this.workerStates.set(workerName, 'shutdown');
                    break;
                    
                default:
                    // Handle custom messages
                    const handler = this.messageHandlers.get(message.type);
                    if (handler) {
                        handler(workerName, message);
                    } else {
                        console.log(`📨 Message from ${workerName}:`, message.type, message);
                    }
            }
        } catch (error) {
            console.error(`❌ Error handling message from ${workerName}:`, error);
        }
    }

    handleWorkerError(workerName, error) {
        this.workerStates.set(workerName, 'error');
        
        // Restart worker if it's required
        const config = this.workerConfigs.find(c => c.name === workerName);
        if (config && config.required) {
            console.log(`🔄 Restarting required worker ${workerName}...`);
            setTimeout(() => {
                this.restartWorker(workerName);
            }, this.config.workerRestartDelay);
        }
    }

    handleWorkerExit(workerName, code) {
        this.workerStates.set(workerName, 'exited');
        
        if (code !== 0) {
            console.error(`❌ Worker ${workerName} exited with error code ${code}`);
            this.handleWorkerError(workerName, new Error(`Worker exited with code ${code}`));
        }
    }

    async restartWorker(workerName) {
        try {
            const config = this.workerConfigs.find(c => c.name === workerName);
            if (!config) {
                console.error(`❌ Worker config not found for ${workerName}`);
                return;
            }

            // Terminate existing worker
            const existingWorker = this.workers.get(workerName);
            if (existingWorker) {
                existingWorker.terminate();
                this.workers.delete(workerName);
            }

            // Create new worker
            await this.createWorker(config);
            console.log(`✅ Worker ${workerName} restarted successfully`);
        } catch (error) {
            console.error(`❌ Failed to restart worker ${workerName}:`, error);
        }
    }

    setupMessageHandlers() {
        // Setup message handlers for inter-worker communication
        this.messageHandlers.set('TRADE_COMPLETED', (workerName, message) => {
            console.log(`✅ Trade completed by ${workerName}:`, message.tradeId);
        });

        this.messageHandlers.set('TRADE_FAILED', (workerName, message) => {
            console.error(`❌ Trade failed in ${workerName}:`, message.tradeId, message.error);
        });

        this.messageHandlers.set('TRADER_ACTIVITY_DETECTED', (workerName, message) => {
            console.log(`👁️ Trader activity detected by ${workerName}:`, message.traderName);
        });

        this.messageHandlers.set('CACHE_UPDATED', (workerName, message) => {
            console.log(`💾 Cache updated by ${workerName}:`, message.key);
        });

        this.messageHandlers.set('WEBSOCKET_CONNECTED', (workerName, message) => {
            console.log(`🔌 WebSocket connected in ${workerName}:`, message.connectionId);
        });

        this.messageHandlers.set('TELEGRAM_MESSAGE_SENT', (workerName, message) => {
            console.log(`📱 Telegram message sent by ${workerName}:`, message.chatId);
        });
    }

    setupWorkerMonitoring() {
        // Setup periodic health checks
        setInterval(() => {
            this.performHealthCheck();
        }, this.config.heartbeatInterval);

        console.log(`💓 Worker monitoring started (interval: ${this.config.heartbeatInterval}ms)`);
    }

    async performHealthCheck() {
        try {
            const healthStatus = {
                timestamp: Date.now(),
                workers: {},
                overall: 'healthy'
            };

            for (const [workerName, worker] of this.workers) {
                const state = this.workerStates.get(workerName);
                healthStatus.workers[workerName] = {
                    state,
                    healthy: state === 'ready'
                };

                if (state !== 'ready') {
                    healthStatus.overall = 'unhealthy';
                }

                // Send ping to worker
                if (worker && state === 'ready') {
                    worker.postMessage({ type: 'PING' });
                }
            }

            console.log(`💓 Health check: ${healthStatus.overall}`, {
                workers: Object.keys(healthStatus.workers).length,
                ready: Object.values(healthStatus.workers).filter(w => w.healthy).length
            });
        } catch (error) {
            console.error('❌ Health check failed:', error);
        }
    }

    setupShutdownHandlers() {
        const signals = ['SIGINT', 'SIGTERM', 'SIGQUIT'];
        signals.forEach(signal => {
            process.on(signal, async () => {
                if (this.isShuttingDown) return;
                this.isShuttingDown = true;
                console.log(`\n🛑 Received ${signal}. Shutting down ThreadedZapBot...`);
                await this.shutdown();
                process.exit(0);
            });
        });

        process.on('uncaughtException', (error) => {
            console.error('💥 Uncaught Exception:', error);
            this.shutdown();
        });

        process.on('unhandledRejection', (reason, promise) => {
            console.error('💥 Unhandled Rejection at:', promise, 'reason:', reason);
            this.shutdown();
        });
    }

    async waitForWorkersReady() {
        console.log('⏳ Waiting for workers to be ready...');
        
        const requiredWorkers = this.workerConfigs.filter(c => c.required).map(c => c.name);
        const maxWaitTime = 30000; // 30 seconds
        const startTime = Date.now();

        while (Date.now() - startTime < maxWaitTime) {
            const readyWorkers = requiredWorkers.filter(name => 
                this.workerStates.get(name) === 'ready'
            );

            if (readyWorkers.length === requiredWorkers.length) {
                console.log('✅ All required workers are ready');
                return;
            }

            await new Promise(resolve => setTimeout(resolve, 1000));
        }

        throw new Error('Timeout waiting for workers to be ready');
    }

    async startTraderMonitoring() {
        console.log('🎯 Starting trader monitoring...');
        
        try {
            // Get the monitor worker
            const monitorWorker = this.workers.get('monitor');
            if (!monitorWorker) {
                console.error('❌ Monitor worker not found');
                return;
            }

            // Send start monitoring command to the monitor worker
            monitorWorker.postMessage({
                type: 'START_MONITORING'
            });

            console.log('✅ Trader monitoring started');
        } catch (error) {
            console.error('❌ Failed to start trader monitoring:', error);
        }
    }

    // Public API methods
    async sendMessage(workerName, message) {
        const worker = this.workers.get(workerName);
        if (!worker) {
            throw new Error(`Worker ${workerName} not found`);
        }

        if (this.workerStates.get(workerName) !== 'ready') {
            throw new Error(`Worker ${workerName} is not ready`);
        }

        worker.postMessage(message);
    }

    async broadcastMessage(message) {
        for (const [workerName, worker] of this.workers) {
            if (this.workerStates.get(workerName) === 'ready') {
                worker.postMessage(message);
            }
        }
    }

    getWorkerStatus() {
        const status = {};
        for (const [workerName, state] of this.workerStates) {
            status[workerName] = {
                state,
                healthy: state === 'ready'
            };
        }
        return status;
    }

    async shutdown() {
        if (this.isShuttingDown) return;
        this.isShuttingDown = true;

        console.log('🛑 Shutting down ThreadedZapBot...');

        try {
            // Send shutdown signal to all workers
            await this.broadcastMessage({ type: 'SHUTDOWN' });

            // Wait for workers to shutdown gracefully
            const shutdownPromises = Array.from(this.workers.values()).map(worker => {
                return new Promise((resolve) => {
                    worker.on('exit', () => resolve());
                    setTimeout(() => resolve(), 5000); // Force resolve after 5 seconds
                });
            });

            await Promise.all(shutdownPromises);

            // Terminate any remaining workers
            for (const [workerName, worker] of this.workers) {
                try {
                    worker.terminate();
                } catch (error) {
                    console.warn(`⚠️ Error terminating worker ${workerName}:`, error.message);
                }
            }

            this.workers.clear();
            this.workerStates.clear();

            console.log('✅ ThreadedZapBot shutdown completed');
        } catch (error) {
            console.error('❌ Error during shutdown:', error);
        }
    }

    async cleanup() {
        try {
            await this.shutdown();
        } catch (error) {
            console.error('❌ Error during cleanup:', error);
        }
    }
}

module.exports = ThreadedZapBot;
