// ==========================================
// ========== Transaction Analyzer Worker ==========
// ==========================================
// File: workers/transactionAnalyzerWorker.js
// Description: Analyzes transactions in a separate thread

const { workerData } = require('worker_threads');
const BaseWorker = require('./templates/baseWorker');
const { SolanaManager } = require('../solanaManager');
const { TransactionAnalyzer } = require('../transactionAnalyzer');
const { ApiManager } = require('../apiManager');

class TransactionAnalyzerWorker extends BaseWorker {
    constructor() {
        super();
        this.solanaManager = null;
        this.transactionAnalyzer = null;
        this.apiManager = null;
        this.analysisQueue = [];
        this.processingQueue = false;
        this.analysisStats = {
            totalAnalyzed: 0,
            successful: 0,
            failed: 0,
            averageTime: 0
        };
    }

    async customInitialize() {
        try {
            this.solanaManager = new SolanaManager();
            await this.solanaManager.initialize();
            
            this.apiManager = new ApiManager(this.solanaManager);
            this.transactionAnalyzer = new TransactionAnalyzer(this.solanaManager.connection, this.apiManager);
            
            // Start processing queue
            this.startQueueProcessing();
            
            this.logInfo('Transaction analyzer worker initialized successfully');
        } catch (error) {
            this.logError('Failed to initialize transaction analyzer worker', { error: error.message });
            throw error;
        }
    }

    async handleMessage(message) {
        if (message.type === 'ANALYZE_TRANSACTION') {
            await this.analyzeTransaction(message.signature, message.options);
        } else if (message.type === 'ANALYZE_BATCH') {
            await this.analyzeBatch(message.signatures, message.options);
        } else if (message.type === 'GET_ANALYSIS_STATS') {
            await this.getAnalysisStats();
        } else if (message.type === 'CLEAR_QUEUE') {
            await this.clearQueue();
        } else {
            await super.handleMessage(message);
        }
    }

    async analyzeTransaction(signature, options = {}) {
        const analysisId = `analysis_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        
        try {
            this.logInfo('Starting transaction analysis', { analysisId, signature });
            
            const startTime = Date.now();
            const result = await this.transactionAnalyzer.analyzeTransaction(signature);
            const endTime = Date.now();
            const analysisTime = endTime - startTime;

            // Update stats
            this.analysisStats.totalAnalyzed++;
            this.analysisStats.successful++;
            this.analysisStats.averageTime = (this.analysisStats.averageTime + analysisTime) / 2;

            this.signalMessage('TRANSACTION_ANALYZED', {
                analysisId,
                signature,
                result,
                analysisTime,
                timestamp: Date.now()
            });

        } catch (error) {
            this.logError('Transaction analysis failed', { analysisId, signature, error: error.message });
            
            // Update stats
            this.analysisStats.totalAnalyzed++;
            this.analysisStats.failed++;

            this.signalMessage('TRANSACTION_ANALYSIS_ERROR', {
                analysisId,
                signature,
                error: error.message,
                timestamp: Date.now()
            });
        }
    }

    async analyzeBatch(signatures, options = {}) {
        const batchId = `batch_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        
        try {
            this.logInfo('Starting batch analysis', { batchId, count: signatures.length });
            
            const startTime = Date.now();
            const results = [];
            const errors = [];

            // Process signatures in parallel (with concurrency limit)
            const concurrency = options.concurrency || 5;
            const chunks = this.chunkArray(signatures, concurrency);

            for (const chunk of chunks) {
                const chunkPromises = chunk.map(async (signature) => {
                    try {
                        const result = await this.transactionAnalyzer.analyzeTransaction(signature);
                        results.push({ signature, result });
                    } catch (error) {
                        errors.push({ signature, error: error.message });
                    }
                });

                await Promise.all(chunkPromises);
            }

            const endTime = Date.now();
            const batchTime = endTime - startTime;

            // Update stats
            this.analysisStats.totalAnalyzed += signatures.length;
            this.analysisStats.successful += results.length;
            this.analysisStats.failed += errors.length;

            this.signalMessage('BATCH_ANALYSIS_COMPLETED', {
                batchId,
                totalSignatures: signatures.length,
                successful: results.length,
                failed: errors.length,
                results,
                errors,
                batchTime,
                timestamp: Date.now()
            });

        } catch (error) {
            this.logError('Batch analysis failed', { batchId, error: error.message });
            this.signalMessage('BATCH_ANALYSIS_ERROR', {
                batchId,
                error: error.message,
                timestamp: Date.now()
            });
        }
    }

    async getAnalysisStats() {
        try {
            const stats = {
                ...this.analysisStats,
                queueSize: this.analysisQueue.length,
                processing: this.processingQueue,
                timestamp: Date.now()
            };
            
            this.signalMessage('ANALYSIS_STATS_RESPONSE', stats);
        } catch (error) {
            this.logError('Failed to get analysis stats', { error: error.message });
        }
    }

    async clearQueue() {
        try {
            this.analysisQueue = [];
            this.logInfo('Analysis queue cleared');
            this.signalMessage('QUEUE_CLEARED', { timestamp: Date.now() });
        } catch (error) {
            this.logError('Failed to clear queue', { error: error.message });
        }
    }

    startQueueProcessing() {
        const PROCESSING_INTERVAL = 1000; // 1 second
        
        setInterval(async () => {
            if (this.processingQueue || this.analysisQueue.length === 0) {
                return;
            }

            this.processingQueue = true;
            
            try {
                await this.processQueue();
            } catch (error) {
                this.logError('Error processing queue', { error: error.message });
            } finally {
                this.processingQueue = false;
            }
        }, PROCESSING_INTERVAL);

        this.logInfo('Queue processing started', { interval: PROCESSING_INTERVAL });
    }

    async processQueue() {
        try {
            const batchSize = 10; // Process up to 10 items at a time
            const batch = this.analysisQueue.splice(0, batchSize);
            
            if (batch.length === 0) {
                return;
            }

            this.logDebug('Processing queue batch', { batchSize: batch.length });

            for (const item of batch) {
                try {
                    await this.analyzeTransaction(item.signature, item.options);
                } catch (error) {
                    this.logError('Error processing queue item', { 
                        signature: item.signature, 
                        error: error.message 
                    });
                }
            }
        } catch (error) {
            this.logError('Error processing queue', { error: error.message });
        }
    }

    chunkArray(array, chunkSize) {
        const chunks = [];
        for (let i = 0; i < array.length; i += chunkSize) {
            chunks.push(array.slice(i, i + chunkSize));
        }
        return chunks;
    }

    async customCleanup() {
        try {
            // Clear any remaining queue items
            this.analysisQueue = [];
            this.processingQueue = false;
            
            this.logInfo('Transaction analyzer worker cleanup completed');
        } catch (error) {
            this.logError('Error during cleanup', { error: error.message });
        }
    }

    async customHealthCheck() {
        try {
            return {
                healthy: true,
                queueSize: this.analysisQueue.length,
                processing: this.processingQueue,
                stats: this.analysisStats,
                uptime: Date.now() - this.startTime
            };
        } catch (error) {
            this.logError('Health check failed', { error: error.message });
            return { healthy: false, error: error.message };
        }
    }
}

// Initialize worker if this file is run directly
if (require.main === module) {
    const worker = new TransactionAnalyzerWorker();
    worker.initialize().catch(error => {
        console.error('Transaction analyzer worker failed to initialize:', error);
        process.exit(1);
    });
}

module.exports = TransactionAnalyzerWorker;

