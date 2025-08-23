#!/usr/bin/env node

import { Worker } from 'worker_threads';
import path from 'path';
import { fileURLToPath } from 'url';

// Get current directory for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class SimpleThreadedZapBot {
    constructor() {
        this.workers = new Map();
        this.workerStates = new Map();
        this.isInitialized = false;
        this.isShuttingDown = false;
        
        console.log('🚀 Simple Threaded ZapBot initialized');
    }

    async initialize() {
        if (this.isInitialized) {
            console.warn("SimpleThreadedZapBot is already initialized.");
            return;
        }

        console.log('--- Starting Simple Threaded ZapBot Initialization ---');

        try {
            // Initialize worker threads
            await this.initializeWorkers();
            
            // Setup worker monitoring
            this.setupWorkerMonitoring();
            
            this.isInitialized = true;
            console.log('--- Simple Threaded ZapBot Initialization Completed! ---');
        } catch (error) {
            console.error('Failed to initialize SimpleThreadedZapBot:', error);
            throw error;
        }
    }

    async initializeWorkers() {
        console.log('Initializing worker threads...');
        
        const workerConfigs = [
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
        console.log('Shutting down SimpleThreadedZapBot...');
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

        console.log('SimpleThreadedZapBot shutdown complete');
    }

    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // Public API methods
    async startCopyTrading(chatId, traderName) {
        console.log(`[Action] START request for ${traderName} from chat ${chatId}`);
        return true;
    }

    async stopCopyTrading(chatId, traderName) {
        console.log(`[Action] STOP request for ${traderName} from chat ${chatId}`);
        return true;
    }
}

// Export the class
export default SimpleThreadedZapBot;

// If this file is run directly, start the bot
if (import.meta.url === `file://${process.argv[1]}`) {
    const bot = new SimpleThreadedZapBot();
    
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
        console.log('🎉 Simple Threaded ZapBot is now running!');
        console.log('Press Ctrl+C to stop');
    }).catch((error) => {
        console.error('❌ Failed to start Simple Threaded ZapBot:', error);
        process.exit(1);
    });
}
