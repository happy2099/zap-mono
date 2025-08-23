import BaseWorker from './templates/baseWorker.js';
import { parentPort } from 'worker_threads';
import { Connection, PublicKey } from '@solana/web3.js';

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
        
        // Initialize Solana connection
        this.connection = new Connection(process.env.RPC_URL);
        
        // Register custom message handlers
        this.registerHandler('START_MONITORING', this.handleStartMonitoring.bind(this));
        this.registerHandler('STOP_MONITORING', this.handleStopMonitoring.bind(this));
        
        console.log(`TraderMonitorWorker initialized with RPC: ${this.connection.rpcEndpoint}`);
    }

    async handleStartMonitoring(message) {
        const { traders } = message.data;
        
        console.log(`Starting monitoring for ${traders.length} traders`);
        
        for (const trader of traders) {
            await this.startMonitoringTrader(trader);
        }
    }

    async startMonitoringTrader(trader) {
        if (this.activeTraders.has(trader.wallet)) {
            console.log(`Already monitoring trader: ${trader.name}`);
            return;
        }

        console.log(`Starting monitoring for trader: ${trader.name} (${trader.wallet})`);
        
        this.activeTraders.set(trader.wallet, trader);
        
        // Initialize cutoff signature
        try {
            const signatures = await this.connection.getSignaturesForAddress(
                new PublicKey(trader.wallet),
                { limit: 1 }
            );
            
            if (signatures.length > 0) {
                this.cutoffSignatures.set(trader.wallet, signatures[0].signature);
                console.log(`Set cutoff signature for ${trader.name}: ${signatures[0].signature}`);
            }
        } catch (error) {
            console.error(`Failed to initialize cutoff for ${trader.name}:`, error);
        }
        
        // Create polling interval
        const interval = setInterval(async () => {
            await this.pollTrader(trader);
        }, 25000); // Poll every 25 seconds

        this.pollingIntervals.set(trader.wallet, interval);
        
        console.log(`Monitoring started for ${trader.name}`);
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
                
                console.log(`Found ${newSignatures.length} new transactions for ${trader.name}`);
                
                parentPort.postMessage({
                    type: 'NEW_TRANSACTIONS',
                    trader: trader.name,
                    wallet: trader.wallet,
                    signatures: newSignatures,
                    timestamp: Date.now()
                });
            }
        } catch (error) {
            console.error(`Error polling trader ${trader.name}:`, error);
            
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
        const trader = this.activeTraders.get(traderWallet);
        if (!trader) {
            console.log(`Trader ${traderWallet} not found in active traders`);
            return;
        }

        console.log(`Stopping monitoring for trader: ${trader.name}`);
        
        const interval = this.pollingIntervals.get(traderWallet);
        if (interval) {
            clearInterval(interval);
            this.pollingIntervals.delete(traderWallet);
        }
        
        this.activeTraders.delete(traderWallet);
        this.cutoffSignatures.delete(traderWallet);
        
        console.log(`Monitoring stopped for ${trader.name}`);
    }

    async cleanup() {
        console.log('Cleaning up TraderMonitorWorker...');
        
        // Clear all intervals
        for (const interval of this.pollingIntervals.values()) {
            clearInterval(interval);
        }
        
        this.pollingIntervals.clear();
        this.activeTraders.clear();
        this.cutoffSignatures.clear();
        
        console.log('TraderMonitorWorker cleanup complete');
    }
}

// Initialize worker
const worker = new TraderMonitorWorker();
worker.initialize();

// Handle messages from main thread
parentPort.on('message', async (message) => {
    await worker.handleMessage(message);
});
