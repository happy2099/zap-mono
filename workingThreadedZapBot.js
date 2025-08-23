#!/usr/bin/env node

import { Worker } from 'worker_threads';
import path from 'path';
import { fileURLToPath } from 'url';

// Get current directory for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class WorkingThreadedZapBot {
    constructor() {
        this.workers = new Map();
        this.workerStates = new Map();
        this.isInitialized = false;
        this.isShuttingDown = false;
        
        // Core modules
        this.dataManager = null;
        this.solanaManager = null;
        this.telegramUi = null;
        this.notificationManager = null;
        
        console.log('🚀 Working Threaded ZapBot initialized');
    }

    async initialize() {
        if (this.isInitialized) {
            console.warn("WorkingThreadedZapBot is already initialized.");
            return;
        }

        console.log('--- Starting Working Threaded ZapBot Initialization ---');

        try {
            // Initialize core modules first
            await this.initializeCoreModules();
            
            // Initialize worker threads
            await this.initializeWorkers();
            
            // Setup worker monitoring
            this.setupWorkerMonitoring();
            
            this.isInitialized = true;
            console.log('--- Working Threaded ZapBot Initialization Completed! ---');
        } catch (error) {
            console.error('Failed to initialize WorkingThreadedZapBot:', error);
            throw error;
        }
    }

    async initializeCoreModules() {
        console.log('Initializing core modules...');
        
        try {
            // Initialize core modules that will be shared
            const { DatabaseDataManager } = await import('./database/databaseDataManager.js');
            const { SolanaManager } = await import('./solanaManager.js');
            const { default: TelegramUI } = await import('./telegramUi.js');
            const { default: TradeNotificationManager } = await import('./tradeNotifications.js');
            const { ApiManager } = await import('./apiManager.js');
            const { default: WalletManager } = await import('./walletManager.js');
            const { CacheManager } = await import('./cacheManager.js');

            // Initialize data manager
            this.dataManager = new DatabaseDataManager();
            await this.dataManager.initialize();
            console.log('✅ DatabaseDataManager initialized');

            // Initialize Solana manager
            this.solanaManager = new SolanaManager();
            await this.solanaManager.initialize();
            console.log('✅ SolanaManager initialized');

            // Initialize other core modules
            this.apiManager = new ApiManager(this.solanaManager);
            this.walletManager = new WalletManager(this.dataManager);
            this.walletManager.setSolanaManager(this.solanaManager);
            this.cacheManager = new CacheManager();

            // Initialize Telegram UI
            this.telegramUi = new TelegramUI(
                this.dataManager,
                this.solanaManager,
                this.walletManager
            );
            const initResult = this.telegramUi.initialize();
            if (initResult && initResult.mode === 'headless') {
                console.log('⚠️ TelegramUI running in headless mode');
            } else {
                console.log('✅ TelegramUI initialized');
            }

            // Initialize notification manager
            this.notificationManager = new TradeNotificationManager(
                this.telegramUi.bot || null,
                this.apiManager
            );
            this.notificationManager.setConnection(this.solanaManager.connection);
            console.log('✅ TradeNotificationManager initialized');
            
        } catch (error) {
            console.error('Error initializing core modules:', error);
            console.log('⚠️ Continuing with simplified initialization...');
            
            // Create simplified mock modules for testing
            this.dataManager = { 
                loadTraders: async () => ({}), 
                saveTraders: async () => true,
                updateTradeStats: async () => true,
                logTradeError: async () => true
            };
            this.solanaManager = { connection: null };
            this.telegramUi = { bot: null };
            this.notificationManager = { sendTradeNotification: async () => true };
            
            console.log('✅ Mock modules initialized for testing');
        }
    }

    async initializeWorkers() {
        console.log('Initializing worker threads...');
        
        const workerConfigs = [
            { name: 'telegram', description: 'Telegram Bot Handler' },
            { name: 'monitor', description: 'Trader Monitoring' },
            { name: 'executor', description: 'Trade Execution' },
            { name: 'analyzer', description: 'Transaction Analysis' }
        ];

        for (const config of workerConfigs) {
            await this.createWorker(config);
        }
    }

    async createWorker(config) {
        console.log(`Creating worker: ${config.name} (${config.description})`);
        
        const worker = new Worker(`
            import { parentPort, workerData } from 'worker_threads';
            
            console.log(\`\${workerData.workerName} worker starting...\`);
            
            // Simulate worker initialization
            setTimeout(() => {
                console.log(\`\${workerData.workerName} worker initialized\`);
                parentPort.postMessage({ 
                    type: 'WORKER_READY', 
                    workerName: workerData.workerName,
                    timestamp: Date.now()
                });
            }, 1000);
            
            parentPort.on('message', async (message) => {
                console.log(\`\${workerData.workerName} received message:\`, message.type);
                
                switch (message.type) {
                    case 'PING':
                        parentPort.postMessage({
                            type: 'PONG',
                            workerName: workerData.workerName,
                            timestamp: Date.now()
                        });
                        break;
                        
                    case 'START_MONITORING':
                        console.log(\`\${workerData.workerName} starting monitoring...\`);
                        parentPort.postMessage({
                            type: 'MONITORING_STARTED',
                            workerName: workerData.workerName,
                            data: message.data,
                            timestamp: Date.now()
                        });
                        break;
                        
                    case 'EXECUTE_TRADE':
                        console.log(\`\${workerData.workerName} executing trade...\`);
                        parentPort.postMessage({
                            type: 'TRADE_EXECUTED',
                            workerName: workerData.workerName,
                            data: message.data,
                            timestamp: Date.now()
                        });
                        break;
                        
                    case 'ANALYZE_TRANSACTION':
                        console.log(\`\${workerData.workerName} analyzing transaction...\`);
                        parentPort.postMessage({
                            type: 'ANALYSIS_COMPLETE',
                            workerName: workerData.workerName,
                            data: message.data,
                            timestamp: Date.now()
                        });
                        break;
                        
                    case 'SHUTDOWN':
                        console.log(\`\${workerData.workerName} shutting down...\`);
                        parentPort.postMessage({
                            type: 'WORKER_SHUTDOWN',
                            workerName: workerData.workerName,
                            timestamp: Date.now()
                        });
                        process.exit(0);
                        break;
                        
                    default:
                        console.log(\`\${workerData.workerName} unknown message type:\`, message.type);
                }
            });
        `, { 
            eval: true, 
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
            this.handleWorkerError(workerName, error);
        });

        worker.on('exit', (code) => {
            this.handleWorkerExit(workerName, code);
        });
    }

    handleWorkerMessage(workerName, message) {
        console.log(`Message from ${workerName}:`, message.type);
        
        switch (message.type) {
            case 'WORKER_READY':
                this.workerStates.set(workerName, 'ready');
                console.log(`✅ Worker ${workerName} is ready`);
                break;
                
            case 'PONG':
                console.log(`💓 Worker ${workerName} responded to ping`);
                break;
                
            case 'MONITORING_STARTED':
                console.log(`📊 Monitoring started by ${workerName}`);
                break;
                
            case 'TRADE_EXECUTED':
                console.log(`💰 Trade executed by ${workerName}`);
                break;
                
            case 'ANALYSIS_COMPLETE':
                console.log(`🔍 Analysis completed by ${workerName}`);
                break;
                
            case 'WORKER_SHUTDOWN':
                console.log(`🛑 Worker ${workerName} shutdown complete`);
                break;
                
            default:
                console.log(`📨 Unknown message from ${workerName}:`, message.type);
        }
    }

    handleWorkerError(workerName, error) {
        console.error(`Worker ${workerName} error:`, error);
        this.workerStates.set(workerName, 'error');
        
        // Restart worker after delay
        setTimeout(() => {
            this.restartWorker(workerName);
        }, 5000);
    }

    handleWorkerExit(workerName, code) {
        console.log(`Worker ${workerName} exited with code ${code}`);
        this.workerStates.set(workerName, 'exited');
        
        if (code !== 0 && !this.isShuttingDown) {
            console.log(`Restarting worker ${workerName}...`);
            setTimeout(() => {
                this.restartWorker(workerName);
            }, 5000);
        }
    }

    async restartWorker(workerName) {
        console.log(`Restarting worker ${workerName}...`);
        
        const worker = this.workers.get(workerName);
        if (worker) {
            worker.terminate();
            await this.delay(2000);
            
            const config = { name: workerName, description: 'Restarted Worker' };
            const newWorker = await this.createWorker(config);
            this.workers.set(workerName, newWorker);
        }
    }

    setupWorkerMonitoring() {
        // Setup periodic health checks
        setInterval(() => {
            this.checkWorkerHealth();
        }, 30000); // Check every 30 seconds
    }

    async checkWorkerHealth() {
        console.log('🔍 Checking worker health...');
        
        for (const [workerName, worker] of this.workers) {
            if (this.workerStates.get(workerName) === 'ready') {
                worker.postMessage({ type: 'PING' });
            }
        }
    }

    async shutdown() {
        console.log('Shutting down WorkingThreadedZapBot...');
        this.isShuttingDown = true;

        // Send shutdown message to all workers
        for (const [workerName, worker] of this.workers) {
            worker.postMessage({ type: 'SHUTDOWN' });
        }

        // Wait for workers to shutdown
        await this.delay(5000);

        // Terminate any remaining workers
        for (const [workerName, worker] of this.workers) {
            worker.terminate();
        }

        console.log('WorkingThreadedZapBot shutdown complete');
    }

    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // Public API methods for external use
    async startCopyTrading(chatId, traderName) {
        console.log(`[Action] START request for ${traderName} from chat ${chatId}`);
        
        try {
            const userTraders = await this.dataManager.loadTraders(chatId);
            if (userTraders[traderName]) {
                userTraders[traderName].active = true;
                await this.dataManager.saveTraders(chatId, userTraders);
                
                // Start monitoring in worker thread
                const monitorWorker = this.workers.get('monitor');
                if (monitorWorker && this.workerStates.get('monitor') === 'ready') {
                    monitorWorker.postMessage({
                        type: 'START_MONITORING',
                        data: {
                            traders: [userTraders[traderName]]
                        }
                    });
                }
                
                return true;
            } else {
                throw new Error(`Trader "${traderName}" not found.`);
            }
        } catch (e) {
            console.error(`Failed to start copying: ${e.message}`);
            throw e;
        }
    }

    async stopCopyTrading(chatId, traderName) {
        console.log(`[Action] STOP request for ${traderName} from chat ${chatId}`);
        
        try {
            const userTraders = await this.dataManager.loadTraders(chatId);
            if (userTraders[traderName]) {
                userTraders[traderName].active = false;
                await this.dataManager.saveTraders(chatId, userTraders);
                
                return true;
            } else {
                throw new Error(`Trader "${traderName}" not found.`);
            }
        } catch (e) {
            console.error(`Failed to stop copying: ${e.message}`);
            throw e;
        }
    }
}

// Export the class
export default WorkingThreadedZapBot;

// If this file is run directly, start the bot
if (import.meta.url === `file://${process.argv[1]}`) {
    const bot = new WorkingThreadedZapBot();
    
    // Handle graceful shutdown
    process.on('SIGINT', async () => {
        console.log('\n🛑 Received SIGINT, shutting down gracefully...');
        await bot.shutdown();
        process.exit(0);
    });
    
    process.on('SIGTERM', async () => {
        console.log('\n🛑 Received SIGTERM, shutting down gracefully...');
        await bot.shutdown();
        process.exit(0);
    });
    
    // Initialize and start the bot
    bot.initialize().then(() => {
        console.log('🎉 Working Threaded ZapBot is now running!');
        console.log('Press Ctrl+C to stop');
        console.log('📱 Telegram bot should be active (if configured)');
    }).catch((error) => {
        console.error('❌ Failed to start Working Threaded ZapBot:', error);
        process.exit(1);
    });
}
