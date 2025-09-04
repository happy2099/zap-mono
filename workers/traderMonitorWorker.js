const BaseWorker = require('./templates/baseWorker');
const { LaserStreamManager } = require('../laserstreamManager');
const { TradingEngine } = require('../tradingEngine'); // Required to get the trader list
const { DatabaseManager } = require('../database/databaseManager'); // Required for the temp engine

class TraderMonitorWorker extends BaseWorker {
    constructor() {
        super();
        this.laserStreamManager = null;
        this.databaseManager = null;
    }

    async customInitialize() {
        this.logInfo('Initializing ULTRA-LOW LATENCY Trader Monitor with LaserStream...');
        
        try {
            this.databaseManager = new DatabaseManager();
            await this.databaseManager.initialize();
            
            // CRITICAL: We create a 'dummy' engine instance here. Its ONLY purpose
            // is to provide the `getMasterTraderWallets` method to the LaserStreamManager.
            // This is a clean way to share logic without complex dependencies in a worker.
            const tempEngineForTraderList = new TradingEngine({ databaseManager: this.databaseManager }, { partialInit: true });
            
            // Initialize ULTRA-LOW LATENCY LaserStreamManager for real-time copy trading
            // Pass the temp engine so LaserStreamManager can access getMasterTraderWallets
            this.laserStreamManager = new LaserStreamManager(tempEngineForTraderList); 
            
            this.logInfo('Starting ULTRA-LOW LATENCY LaserStream monitoring...');
            const masterTraderWallets = await tempEngineForTraderList.getMasterTraderWallets();

            if (!masterTraderWallets || masterTraderWallets.length === 0) {
                this.logWarn('No active master traders found in the database. LaserStream will not monitor any specific wallets.');
            } else {
                this.logInfo(`Initializing ULTRA-LOW LATENCY LaserStream to monitor ${masterTraderWallets.length} specific trader wallets.`);
                this.logInfo('⚡ Target detection latency: <100ms');
                this.logInfo('🔧 Using PROCESSED commitment for fastest possible detection');
                this.logInfo('📡 Zstd compression enabled for optimal performance');
                
                // Store the trader wallets for LaserStreamManager to access
                this.masterTraderWallets = masterTraderWallets;
                
                // Start monitoring with LaserStreamManager
                await this.laserStreamManager.startMonitoring();
            }
            
            // CRITICAL FALLBACK: If LaserStream fails, start direct RPC polling
            this.logInfo('Starting direct RPC polling as backup...');
            await this.startDirectRPCPolling();
            
            // PERIODIC REFRESH: Check for new traders every 5 minutes
            this.logInfo('Starting periodic subscription refresh...');
            this.startPeriodicRefresh();
            
        } catch (error) {
            this.logError('FATAL: Failed to initialize or start ULTRA-LOW LATENCY LaserStream', { error: error.message });
            this.signalError(error);
            throw error;
        }
    }
    
    // This is the function the LaserStreamManager will call when it gets a new transaction
    handleTraderActivity(sourceWallet, signature, update) { // Removed async since binding doesn't support it
        // THE FIX: The real transaction data is nested inside the 'transaction' property of the update.
        const txData = update.transaction; 
        
        this.logInfo(`🚀 STREAM EVENT for ${sourceWallet.substring(0,4)}...${sourceWallet.slice(-4)} | Sig: ${signature.substring(0,8)}...`);
        this.logInfo(`📊 Pre-fetched Data: ✅ Present (Raw gRPC Stream)`);
        
        // This log will now show the correct instruction count.
        const instructionCount = txData?.transaction?.message?.instructions?.length || 0;
        this.logInfo(`📋 Instructions in Payload: ${instructionCount}`);
        
        // Get the trader name synchronously using the hardcoded mapping
        const traderName = this.getTraderName(sourceWallet);
        this.logInfo(`📍 Resolved trader name: ${traderName} for wallet ${sourceWallet.substring(0,4)}...${sourceWallet.slice(-4)}`);
        
        // Send the message to the main thread's router
        this.signalMessage('EXECUTE_COPY_TRADE', {
            traderName: traderName,
            traderWallet: sourceWallet,
            signature: signature,
            userChatId: 'ALL_USERS', // A special flag for the main thread
            // We pass the REAL, unpacked transaction response object to the executor.
            preFetchedTxData: txData 
        });
    }

    // Handle messages from other workers
    async handleMessage(message) {
        try {
            switch (message.type) {
                case 'REFRESH_SUBSCRIPTIONS':
                    this.logInfo('📨 Received refresh request from main thread');
                    await this.refreshTraderSubscriptions();
                    break;
                case 'TRADER_ADDED':
                case 'TRADER_REMOVED':
                case 'TRADER_UPDATED':
                    this.logInfo('📨 Trader list changed, refreshing subscriptions');
                    await this.refreshTraderSubscriptions();
                    break;
                default:
                    await super.handleMessage(message);
            }
        } catch (error) {
            this.logError('Error handling message in monitor worker', { 
                messageType: message.type, 
                error: error.message 
            });
        }
    }

    // Handle streaming errors
    handleStreamError(error) {
        this.logError('❌ LaserStream error:', { error: error.message });
        // The LaserstreamManager handles reconnection automatically
    }





    // Refresh LaserStream subscriptions when traders change
    async refreshTraderSubscriptions() {
        this.logInfo('🔄 Refreshing LaserStream subscriptions...');
        try {
            if (this.laserStreamManager) {
                // Refresh LaserStream subscriptions with new trader list
                const refreshed = await this.laserStreamManager.refreshSubscriptions();
                if (refreshed) {
                    this.logInfo('✅ LaserStream subscriptions refreshed successfully');
                } else {
                    this.logInfo('✅ No changes in LaserStream subscriptions');
                }
                // Also refresh RPC polling list
                await this.refreshRPCPolling();
            }
        } catch (error) {
            this.logError('❌ Failed to refresh LaserStream subscriptions', { error: error.message });
        }
    }

    // Direct RPC polling as fallback when LaserStream fails  
    async startDirectRPCPolling() {
        this.logInfo('🚀 Starting dynamic direct RPC polling...');
        
        // Get the list of wallets to monitor dynamically from database
        const walletsToMonitor = await this.getDynamicWalletsToMonitor();
        
        // Store last signatures to detect new transactions
        this.lastSignatures = new Map();
        
        if (walletsToMonitor.length === 0) {
            this.logInfo('⚠️ No active traders found for RPC polling');
            return;
        }

        this.logInfo(`📊 Monitoring ${walletsToMonitor.length} wallets via RPC polling`);
        
        // Poll every 2 seconds for new transactions
        this.rpcPollingInterval = setInterval(async () => {
            try {
                const currentWallets = await this.getDynamicWalletsToMonitor();
                for (const wallet of currentWallets) {
                    await this.checkWalletForNewTransactions(wallet);
                }
            } catch (error) {
                this.logError('Error in RPC polling:', { error: error.message });
            }
        }, 2000); // 2 seconds - More aggressive polling
        
        this.logInfo('✅ Dynamic direct RPC polling started successfully');
    }

    // Get dynamic list of wallets from database
    async getDynamicWalletsToMonitor() {
        try {
            const tempEngine = new TradingEngine({ databaseManager: this.databaseManager }, { partialInit: true });
            const wallets = await tempEngine.getMasterTraderWallets();
            return wallets;
        } catch (error) {
            this.logError('Error getting dynamic wallet list:', { error: error.message });
            return [];
        }
    }

    // Refresh RPC polling with new wallet list
    async refreshRPCPolling() {
        this.logInfo('🔄 Refreshing RPC polling wallet list...');
        try {
            const newWallets = await this.getDynamicWalletsToMonitor();
            this.logInfo(`📊 Updated RPC polling list: ${newWallets.length} wallets`);
            // The polling interval will automatically pick up the new list
        } catch (error) {
            this.logError('Error refreshing RPC polling:', { error: error.message });
        }
    }

    // Start periodic refresh every 5 minutes
    startPeriodicRefresh() {
        const REFRESH_INTERVAL = 5 * 60 * 1000; // 5 minutes
        
        this.periodicRefreshInterval = setInterval(async () => {
            try {
                this.logInfo('⏰ Periodic subscription refresh triggered');
                await this.refreshTraderSubscriptions();
            } catch (error) {
                this.logError('Error in periodic refresh:', { error: error.message });
            }
        }, REFRESH_INTERVAL);
        
        this.logInfo(`✅ Periodic refresh started (every ${REFRESH_INTERVAL / 60000} minutes)`);
    }

    // Stop periodic refresh (called during shutdown)
    stopPeriodicRefresh() {
        if (this.periodicRefreshInterval) {
            clearInterval(this.periodicRefreshInterval);
            this.periodicRefreshInterval = null;
            this.logInfo('🛑 Periodic refresh stopped');
        }
    }
    
    async checkWalletForNewTransactions(wallet) {
        try {
            const response = await fetch('https://mainnet.helius-rpc.com/?api-key=b9a69ad0-d823-429e-8c18-7cbea0e31769', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    jsonrpc: '2.0',
                    id: 1,
                    method: 'getSignaturesForAddress',
                    params: [wallet, { limit: 5 }] // Check last 5 transactions instead of just 1
                })
            });
            
            const data = await response.json();
            if (data.result && data.result.length > 0) {
                const lastSignature = this.lastSignatures.get(wallet);
                
                // Find the first new transaction that's a trading transaction
                for (const txInfo of data.result) {
                    if (txInfo.signature === lastSignature) {
                        break; // We've reached a transaction we've already processed
                    }
                    
                    // Skip failed transactions
                    if (txInfo.err) {
                        // Filter out common "noise" errors that don't need logging
                        const errStr = JSON.stringify(txInfo.err);
                        const isNoise = errStr.includes('"InstructionError"') || 
                                       errStr.includes('"InsufficientFundsForRent"') ||
                                       errStr.includes('"Custom":1') ||
                                       errStr.includes('"Custom":6000');
                        
                        if (!isNoise) {
                            this.logInfo(`⏭️ Failed transaction skipped for ${wallet.substring(0, 8)}... | Sig: ${txInfo.signature.substring(0, 8)}... | Error: ${errStr}`);
                        }
                        continue;
                    }
                    
                    this.logInfo(`🚀 New transaction detected for wallet ${wallet.substring(0, 8)}... | Sig: ${txInfo.signature.substring(0, 8)}...`);
                    
                    // 🔍 ENHANCED: Get full transaction details to check if it's a trade
                    try {
                        const txResponse = await fetch('https://mainnet.helius-rpc.com/?api-key=b9a69ad0-d823-429e-8c18-7cbea0e31769', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                jsonrpc: '2.0',
                                id: 1,
                                method: 'getTransaction',
                                params: [txInfo.signature, { maxSupportedTransactionVersion: 0 }]
                            })
                        });
                        
                        const txData = await txResponse.json();
                        if (txData.result && txData.result.transaction) {
                            // 🔥 AGGRESSIVE APPROACH: We'll let the transaction analyzer decide what's copyable
                            // based on actual balance changes and trade detection, not just program IDs
                            
                            // 🔥 AGGRESSIVE APPROACH: Forward ALL successful transactions to the transaction analyzer
                            // Let the analyzer decide what's copyable based on balance changes and actual trade detection
                            this.logInfo(`🎯 Transaction detected for ${wallet.substring(0, 8)}... | Sig: ${txInfo.signature.substring(0, 8)}... | Forwarding to analyzer...`);
                            
                            // Store the new signature
                            this.lastSignatures.set(wallet, txInfo.signature);
                            
                            // Forward to executor for copy trading analysis
                            this.signalMessage('EXECUTE_COPY_TRADE', {
                                traderName: this.getTraderName(wallet),
                                traderWallet: wallet,
                                signature: txInfo.signature,
                                userChatId: 'ALL_USERS',
                                preFetchedTxData: txData.result
                            });
                            
                            // Found a transaction, stop looking
                            break;
                        }
                    } catch (txError) {
                        this.logError(`Error fetching transaction details for ${txInfo.signature}:`, { error: txError.message });
                        // Continue to next transaction
                        continue;
                    }
                }
                
                // If we didn't find any new trading transactions, store the latest signature to avoid re-processing
                if (data.result.length > 0) {
                    const latestSignature = data.result[0].signature;
                    if (!this.lastSignatures.has(wallet)) {
                        this.lastSignatures.set(wallet, latestSignature);
                    }
                }
            }
        } catch (error) {
            this.logError(`Error checking wallet ${wallet}:`, { error: error.message });
        }
    }
    
    getTraderName(wallet) {
        const traderNames = {
            'DfMxre4cKmvogbLrPigxmibVTTQDuzjdXojWzjCXXhzj': 'eu',
            'suqh5sHtr8HyJ7q8scBimULPkPpA557prMG47xCHQfK': 'cup',
            'As7HjL7dzzvbRbaD3WCun47robib2kmAKRXMvjHkSMB5': 'otta',
            '96sErVjEN7LNJ6Uvj63bdRWZxNuBngj56fnT9biHLKBf': 'orange'
        };
        return traderNames[wallet] || 'Unknown';
    }
    
    async customCleanup() {
        if (this.laserStreamManager) {
            this.logInfo('Stopping LaserStream...');
            await this.laserStreamManager.stop();
        }
        if (this.rpcPollingInterval) {
            this.logInfo('Stopping RPC polling...');
            clearInterval(this.rpcPollingInterval);
        }
                // Stop periodic refresh
        this.stopPeriodicRefresh();
        
        if (this.databaseManager) {
            await this.databaseManager.close();
        }
    }

    async cleanup() {
        this.logInfo('Cleaning up trader monitor worker...');
        
        if (this.laserStreamManager) {
            await this.laserStreamManager.stop();
        }
        
        if (this.rpcPollingInterval) {
            clearInterval(this.rpcPollingInterval);
            this.rpcPollingInterval = null;
        }
        
        // Stop periodic refresh
        this.stopPeriodicRefresh();
        
        await super.cleanup();
    }
}

// Standard worker startup
if (require.main === module) {
    const worker = new TraderMonitorWorker();
    worker.initialize().catch(error => {
        console.error('Trader monitor worker failed to initialize:', error);
        process.exit(1);
    });
}

module.exports = TraderMonitorWorker;