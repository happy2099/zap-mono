import BaseWorker from './templates/baseWorker.js';
import { parentPort } from 'worker_threads';
import { Connection, Keypair } from '@solana/web3.js';

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
        
        // Initialize Solana connection
        this.connection = new Connection(process.env.RPC_URL);
        
        // Register custom message handlers
        this.registerHandler('EXECUTE_TRADE', this.handleExecuteTrade.bind(this));
        this.registerHandler('STOP_ACCEPTING_TASKS', this.handleStopAcceptingTasks.bind(this));
        
        console.log(`TradeExecutorWorker initialized with RPC: ${this.connection.rpcEndpoint}`);
    }

    async handleExecuteTrade(message) {
        const { tradeData } = message.data;
        
        console.log(`Received trade execution request:`, tradeData);
        
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

        // Sort queue by priority (higher priority first)
        this.executionQueue.sort((a, b) => b.priority - a.priority);

        console.log(`Trade queued with ID: ${executionId}, queue length: ${this.executionQueue.length}`);

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
            
            console.log(`Starting execution of trade: ${trade.id}`);
            
            // Execute trade in parallel
            this.executeTrade(trade).catch(error => {
                console.error(`Trade execution failed for ${trade.id}:`, error);
                
                parentPort.postMessage({
                    type: 'TRADE_FAILED',
                    executionId: trade.id,
                    error: error.message,
                    timestamp: Date.now()
                });
            }).finally(() => {
                this.activeExecutions.delete(trade.id);
                console.log(`Trade execution completed for: ${trade.id}`);
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
        
        console.log(`Executing trade: ${platform} ${direction} ${amount} of ${tokenMint}`);
        
        try {
            // Build transaction based on platform
            const transaction = await this.buildTransaction(trade.data);
            
            // Send transaction
            const signature = await this.connection.sendTransaction(transaction);
            
            console.log(`Transaction sent with signature: ${signature}`);
            
            // Wait for confirmation
            const confirmation = await this.connection.confirmTransaction(signature);
            
            if (confirmation.value.err) {
                throw new Error(`Transaction failed: ${confirmation.value.err}`);
            }
            
            console.log(`Transaction confirmed: ${signature}`);
            
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
        } catch (error) {
            console.error(`Trade execution error:`, error);
            throw error;
        }
    }

    async buildTransaction(tradeData) {
        // This would integrate with existing platform builders
        // For now, return a placeholder that will be implemented later
        console.log(`Building transaction for platform: ${tradeData.platform}`);
        
        // TODO: Integrate with platformBuilders.js
        // const platformBuilder = require('../platformBuilders.js');
        // return await platformBuilder.buildTransaction(tradeData);
        
        throw new Error('Transaction building not implemented yet - will integrate with platformBuilders.js');
    }

    handleStopAcceptingTasks() {
        console.log('Stopping acceptance of new trade tasks');
        this.executionQueue = [];
        this.isProcessing = false;
    }

    async cleanup() {
        console.log('Cleaning up TradeExecutorWorker...');
        
        // Clear queue and stop processing
        this.executionQueue = [];
        this.activeExecutions.clear();
        this.isProcessing = false;
        
        console.log('TradeExecutorWorker cleanup complete');
    }
}

// Initialize worker
const worker = new TradeExecutorWorker();
worker.initialize();

// Handle messages from main thread
parentPort.on('message', async (message) => {
    await worker.handleMessage(message);
});
