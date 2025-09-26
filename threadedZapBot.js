// ==========================================
// ========== Threaded ZapBot Implementation ==========
// ==========================================
// File: threadedZapBot.js
// Description: Multi-threaded version of ZapBot using Worker Threads

const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const path = require('path');

// Import the leader tracker for ultra-low latency execution
const leaderTracker = require('./leaderTracker.js');

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
            }
            // WebSocketWorker removed - was redundant and not actually used
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
            
            // Step 5: Initialize Leader Tracker for ultra-low latency
            console.log('🎯 Initializing proactive leader tracking...');
            try {
                await leaderTracker.startMonitoring();
                console.log('✅ Proactive leader tracking has been activated.');
            } catch (error) {
                console.warn('⚠️ Leader tracker failed to start:', error.message);
                console.warn('⚠️ Continuing without leader tracking - performance may be reduced.');
            }
            
            // Step 6: Wait for all workers to be ready
            await this.waitForWorkersReady();
            
            this.isInitialized = true;
            console.log('✅ ThreadedZapBot initialization completed successfully');
            
            // Step 7: Start trader monitoring
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
                    } else if (message.type !== 'PONG') {
                        // Log all messages except PONG to reduce verbosity
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

        // WebSocket message handler removed - WebSocketWorker no longer used

        this.messageHandlers.set('TELEGRAM_MESSAGE_SENT', (workerName, message) => {
            console.log(`📱 Telegram message sent by ${workerName}:`, message.chatId);
        });

        this.messageHandlers.set('EXECUTE_COPY_TRADE', (workerName, message) => {
            console.log(`🚀 FORWARDING COPY TRADE from ${workerName} to executor:`);
            
            // Show trader name if available, otherwise show shortened wallet
            if (message.traderName && message.traderName !== 'Unknown (LaserStream)' && message.traderName !== 'Unknown') {
                console.log(`   📍 Trader: ${message.traderName} ${message.traderWallet ? `(${message.traderWallet.substring(0,4)}...${message.traderWallet.slice(-4)})` : ''}`);
            } else if (message.traderWallet) {
                console.log(`   📍 Trader: ${message.traderWallet.substring(0,4)}...${message.traderWallet.slice(-4)}`);
            } else {
                console.log(`   📍 Trader: Unknown`);
            }
            
            console.log(`   🔑 Signature: ${message.signature ? message.signature.substring(0,8) + '...' : 'Unknown'}`);
            
            // Show DEX name if available
            if (message.dexPrograms && message.dexPrograms.length > 0) {
                const dexNames = message.dexPrograms.map(id => this.getDexName(id)).join(', ');
                console.log(`   🏪 DEX: ${dexNames}`);
            }
            
            // Raw data cloning - no pre-fetched data needed
            
            const executorWorker = this.workers.get('executor');
            if (executorWorker && this.workerStates.get('executor') === 'ready') {
                console.log(`✅ Executor worker ready, forwarding message...`);
                // Pass the ENTIRE message payload, including pre-fetched data,
                // to the executor for the fastest possible analysis.
                executorWorker.postMessage(message); 
            } else {
                console.error(`❌ Executor worker not ready for copy trade execution. Status: ${this.workerStates.get('executor')}`);
            }
        });

        this.messageHandlers.set('HANDLE_SMART_COPY', (workerName, message) => {
            console.log(`🧠 FORWARDING SMART COPY from ${workerName} to executor:`);
            
            // Show trader info
            if (message.traderName && message.traderName !== 'Unknown' && message.traderName !== 'Unknown (LaserStream)') {
                console.log(`   📍 Trader: ${message.traderName} (${message.traderWallet ? message.traderWallet.substring(0,4) + '...' + message.traderWallet.slice(-4) : 'Unknown'})`);
            } else if (message.traderWallet) {
                console.log(`   📍 Trader: ${message.traderWallet.substring(0,4)}...${message.traderWallet.slice(-4)}`);
            } else {
                console.log(`   📍 Trader: Unknown`);
            }
            
            console.log(`   🔑 Signature: ${message.signature ? message.signature.substring(0,8) + '...' : 'Unknown'}`);
            
            // Show platform info if available
            if (message.analysisResult && message.analysisResult.swapDetails) {
                console.log(`   🏪 Platform: ${message.analysisResult.swapDetails.platform}`);
                console.log(`   💰 Amount: ${message.analysisResult.swapDetails.inputAmount}`);
            }
            
            const executorWorker = this.workers.get('executor');
            if (executorWorker && this.workerStates.get('executor') === 'ready') {
                console.log(`✅ Executor worker ready, forwarding smart copy message...`);
                executorWorker.postMessage(message); 
            } else {
                console.error(`❌ Executor worker not ready for smart copy execution. Status: ${this.workerStates.get('executor')}`);
            }
        });

        // =========================================================================================
        // ================================ START: ADD THIS CODE BLOCK ===============================
        // =========================================================================================

        this.messageHandlers.set('SEND_NOTIFICATION', (workerName, message) => {
            console.log(`[ROUTER] Forwarding notification from ${workerName} to telegram worker.`);
            const telegramWorker = this.workers.get('telegram');
            if (telegramWorker && this.workerStates.get('telegram') === 'ready') {
                // We directly forward the core payload to the telegram worker
                telegramWorker.postMessage({
                    type: 'SEND_MESSAGE',
                    payload: message.payload 
                });
            } else {
                console.error(`❌ Telegram worker not ready for notification from ${workerName}`);
            }
        });

        // =========================================================================================
        // ================================= END: ADD THIS CODE BLOCK ================================
        // =========================================================================================
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


            console.log('✅ Trader monitoring started (auto-run via LaserStream in worker).');
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
            // Stop leader tracker monitoring
            try {
                await leaderTracker.stopMonitoring();
                console.log('✅ Leader tracker stopped');
            } catch (error) {
                console.warn('⚠️ Leader tracker cleanup warning:', error.message);
            }
            
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

    // Helper function to get DEX/Router name from program ID
    getDexName(programId) {
        const dexMappings = {
            // DEXs
            '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8': 'Raydium V4',
            'LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj': 'Raydium Launchpad',
            'CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C': 'Raydium CPMM',
            'CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK': 'Raydium CLMM',
            '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P': 'Pump.fun BC',
            'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA': 'Pump.fun AMM',
            // '6HB1VBBS8LrdQiR9MZcXV5VdpKFb7vjTMZuQQEQEPioC': 'Pump.fun AMM V2', // REMOVED: This is a private router, not a DEX
            'LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo': 'Meteora DLMM',
            'dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN': 'Meteora DBC',
            'DBCFiGetD2C2s9w2b1G9dwy2J2B6Jq2mRGuo1S4t61d': 'Meteora DBC',
            'CPAMdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG': 'Meteora CP AMM',
            '675kPX9MHTjS2zt1qFR1UARY7hdK2uQDchjADx1Z1gkv': 'Raydium AMM',
            'srmqPvymJeFKQ4zGQed1GFppgkRHL9kaELCbyksJtPX': 'OpenBook',
            'srmq2Vp3e2wBq3dDDjWM9t48Xm21S2Jd2eBE4Pj4u7d': 'OpenBook V3',
            '5quBtoiQqxF9Jv6KYKctB59NT3gtJD2Y65kdnB1Uev3h': 'Raydium Stable',
            'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc': 'Whirlpool',
            
            // Routers
            'JUP6LwwmjhEGGjp4tfXXFW2uJTkV5WkxSfCSsFUxXH5': 'Jupiter Router',
            'BSfD6SHZigAfDWSjzD5Q41jw8LmKwtmjskPH9XW1mrRW': 'Photon Router',
            'AxiomfHaWDemCFBLBayqnEnNwE6b7B2Qz3UmzMpgbMG6': 'Axiom Router',
            'AxiomxSitiyXyPjKgJ9XSrdhsydtZsskZTEDam3PxKcC': 'Axiom Router',
            'routeUGWgWzqBWFcrCfv8tritsqukccJPu3q5GPP3xS': 'Raydium Router'
        };
        
        return dexMappings[programId] || programId.substring(0,4) + '...' + programId.slice(-4);
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
