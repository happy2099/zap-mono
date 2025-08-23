// ==========================================
// ====== Threaded ZapBot Main ==============
// ==========================================
// File: threadedZapBot.js
// Description: Threaded version of ZapBot with worker thread architecture.

import { Worker } from 'worker_threads';
import path from 'path';
import { fileURLToPath } from 'url';

// Get current directory for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class ThreadedZapBot {
    constructor() {
        this.workers = new Map();
        this.workerStates = new Map();
        this.messageHandlers = new Map();
        this.isInitialized = false;
        this.isShuttingDown = false;
        
        // Core modules that will be shared with workers
        this.dataManager = null;
        this.solanaManager = null;
        this.telegramUi = null;
        this.notificationManager = null;
    }

    async initialize() {
        if (this.isInitialized) {
            console.warn("ThreadedZapBot is already initialized.");
            return;
        }

        console.log('--- Starting Threaded ZapBot Initialization ---');

        try {
            // Initialize core modules first
            await this.initializeCoreModules();
            
            // Initialize worker threads
            await this.initializeWorkers();
            
            // Setup message handlers
            this.setupMessageHandlers();
            
            // Setup worker monitoring
            this.setupWorkerMonitoring();
            
            this.isInitialized = true;
            console.log('--- Threaded ZapBot Initialization Completed! ---');
        } catch (error) {
            console.error('Failed to initialize ThreadedZapBot:', error);
            throw error;
        }
    }

    async initializeCoreModules() {
        console.log('Initializing core modules...');
        
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
    }

    async initializeWorkers() {
        console.log('Initializing worker threads...');
        
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
        console.log(`Creating worker: ${config.name}`);
        
        const worker = new Worker(config.file, {
            workerData: { 
                workerName: config.name,
                // Pass core module configurations
                rpcUrl: process.env.RPC_URL,
                telegramToken: process.env.TELEGRAM_BOT_TOKEN,
                adminChatId: process.env.ADMIN_CHAT_ID
            }
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
        console.log(`Message from ${workerName}:`, message.type);
        
        switch (message.type) {
            case 'WORKER_READY':
                this.workerStates.set(workerName, 'ready');
                console.log(`✅ Worker ${workerName} is ready`);
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
            case 'WORKER_ERROR':
                console.error(`Worker ${workerName} reported error:`, message.error);
                break;
            case 'PONG':
                console.log(`Worker ${workerName} responded to ping`);
                break;
            default:
                console.log(`Unknown message type from ${workerName}:`, message.type);
        }
    }

    handleWorkerError(workerName, error) {
        console.error(`Worker ${workerName} error:`, error);
        this.restartWorker(workerName);
    }

    handleWorkerExit(workerName, code) {
        console.log(`Worker ${workerName} exited with code ${code}`);
        if (code !== 0 && !this.isShuttingDown) {
            this.restartWorker(workerName);
        }
    }

    async restartWorker(workerName) {
        console.log(`Restarting worker ${workerName}...`);
        
        const worker = this.workers.get(workerName);
        if (worker) {
            worker.terminate();
            await this.delay(5000);
            
            // Map worker names to their correct file paths
            const workerFileMap = {
                'telegram': './workers/telegramWorker.js',
                'monitor': './workers/traderMonitorWorker.js',
                'executor': './workers/tradeExecutorWorker.js',
                'data': './workers/dataManagerWorker.js',
                'websocket': './workers/websocketWorker.js',
                'cache': './workers/cacheManagerWorker.js',
                'analyzer': './workers/transactionAnalyzerWorker.js'
            };
            
            const newWorker = await this.createWorker({
                name: workerName,
                file: workerFileMap[workerName]
            });
            
            this.workers.set(workerName, newWorker);
        }
    }

    setupMessageHandlers() {
        // Setup handlers for main thread messages
        this.messageHandlers.set('START_MONITORING', this.handleStartMonitoring.bind(this));
        this.messageHandlers.set('STOP_MONITORING', this.handleStopMonitoring.bind(this));
        this.messageHandlers.set('EXECUTE_TRADE', this.handleExecuteTrade.bind(this));
    }

    setupWorkerMonitoring() {
        // Setup periodic health checks
        setInterval(() => {
            this.checkWorkerHealth();
        }, 30000); // Check every 30 seconds
    }

    async checkWorkerHealth() {
        for (const [workerName, worker] of this.workers) {
            if (this.workerStates.get(workerName) === 'ready') {
                worker.postMessage({ type: 'PING' });
            }
        }
    }

    async handleStartMonitoring(message) {
        const monitorWorker = this.workers.get('monitor');
        if (monitorWorker && this.workerStates.get('monitor') === 'ready') {
            monitorWorker.postMessage({
                type: 'START_MONITORING',
                data: message.data
            });
        }
    }

    async handleStopMonitoring(message) {
        const monitorWorker = this.workers.get('monitor');
        if (monitorWorker && this.workerStates.get('monitor') === 'ready') {
            monitorWorker.postMessage({
                type: 'STOP_MONITORING',
                data: message.data
            });
        }
    }

    async handleExecuteTrade(message) {
        const executorWorker = this.workers.get('executor');
        if (executorWorker && this.workerStates.get('executor') === 'ready') {
            executorWorker.postMessage({
                type: 'EXECUTE_TRADE',
                data: message.data
            });
        }
    }

    async handleNewTransactions(message) {
        const { trader, wallet, signatures } = message;
        
        // Process each signature
        for (const signature of signatures) {
            // Send to analyzer worker
            const analyzerWorker = this.workers.get('analyzer');
            if (analyzerWorker && this.workerStates.get('analyzer') === 'ready') {
                analyzerWorker.postMessage({
                    type: 'ANALYZE_TRANSACTION',
                    data: {
                        signature,
                        trader,
                        wallet
                    }
                });
            }
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

    async shutdown() {
        console.log('Shutting down ThreadedZapBot...');
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

        console.log('ThreadedZapBot shutdown complete');
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
                await this.handleStartMonitoring({
                    data: {
                        traders: [userTraders[traderName]]
                    }
                });
                
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
                
                // Stop monitoring in worker thread
                await this.handleStopMonitoring({
                    data: {
                        traderWallet: userTraders[traderName].wallet
                    }
                });
                
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

export default ThreadedZapBot;
