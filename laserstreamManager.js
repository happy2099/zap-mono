// File: laserstreamManager.js (ENHANCED - Singapore Regional + Refined Data)
// Description: Advanced Helius LaserStream manager with Singapore regional endpoints and refined transaction data extraction

const { subscribe, CommitmentLevel, decodeSubscribeUpdate } = require('helius-laserstream');
const { EventEmitter } = require('events');
const config = require('./config.js');
const { shortenAddress } = require('./utils.js');

class LaserStreamManager extends EventEmitter {
    constructor(tradingEngineOrWorker) {
        super();
        if (!tradingEngineOrWorker) {
            throw new Error("LaserStreamManager requires a tradingEngine or worker instance.");
        }

        // This makes the manager flexible for both threaded and non-threaded use
        if(tradingEngineOrWorker instanceof require('./tradingEngine.js').TradingEngine) {
            this.tradingEngine = tradingEngineOrWorker;
            this.parentWorker = null; // We are in single-thread mode
        } else {
            this.parentWorker = tradingEngineOrWorker; // The worker is passed in
            this.tradingEngine = null; // Will be set separately in the worker
        }
        
        this.stream = null;
        this.activeTraderWallets = new Set();
        this.streamStatus = 'idle';
        this.singaporeEndpoints = {
            laserstream: 'wss://sgp-laserstream.helius-rpc.com',
            rpc: 'https://sgp.helius-rpc.com',
            sender: 'https://sgp-sender.helius-rpc.com/fast'
        };
        
        console.log('[LASERSTREAM-ENHANCED] 🚀 Manager initialized with Singapore regional endpoints.');
        console.log(`[LASERSTREAM-ENHANCED] 🌏 Singapore Endpoints: ${JSON.stringify(this.singaporeEndpoints, null, 2)}`);
    }

    async startMonitoring() {
        if (this.stream) {
            console.log('[LASERSTREAM-ENHANCED] 🔄 Stream is already active. Restarting to apply latest trader list...');
            await this.stop();
        }
   
        try {
            const walletsToMonitor = await this.tradingEngine.getMasterTraderWallets();
            if (walletsToMonitor.length === 0) {
                console.log('[LASERSTREAM-ENHANCED] ⚠️ No active traders to monitor.');
                this.streamStatus = 'connected'; 
                this.emit('status_change', { status: 'connected', reason: 'No active traders' });
                return;
            }
   
            this.activeTraderWallets = new Set(walletsToMonitor);
            console.log(`[LASERSTREAM-ENHANCED] 🎯 Subscribing to ${this.activeTraderWallets.size} master trader wallets...`);
            console.log(`[LASERSTREAM-ENHANCED] 📍 Traders: ${Array.from(this.activeTraderWallets).map(w => shortenAddress(w)).join(', ')}`);
   
            const laserstreamConfig = {
                apiKey: config.HELIUS_API_KEY,
                endpoint: this.singaporeEndpoints.laserstream, // Use Singapore endpoint
                maxReconnectAttempts: 15, // Increased for reliability
                channelOptions: {
                    // Optimized for Singapore region
                    'grpc.keepalive_time_ms': 30000,
                    'grpc.keepalive_timeout_ms': 5000,
                    'grpc.keepalive_permit_without_calls': 1,
                    'grpc.http2.max_pings_without_data': 0,
                    'grpc.http2.min_time_between_pings_ms': 10000,
                    'grpc.http2.min_ping_interval_without_data_ms': 300000,
                    // Buffer optimizations for high-frequency data
                    'grpc.max_receive_message_length': 2_000_000_000, // 2GB
                    'grpc.max_send_message_length': 64_000_000,      // 64MB
                    'grpc.initial_stream_window_size': 16_777_216,   // 16MB
                    'grpc.initial_connection_window_size': 33_554_432, // 32MB
                }
            };
   
            if (!laserstreamConfig.apiKey) {
                const errorMsg = "Cannot subscribe: HELIUS_API_KEY is missing.";
                console.error(`❌ [LASERSTREAM-ENHANCED] ${errorMsg}`);
                this.streamStatus = 'error';
                this.emit('status_change', { status: 'disconnected', error: errorMsg });
                return;
            }
   
            // Enhanced subscription request with refined filtering
            const subscriptionRequest = {
                // Monitor specific trader accounts for balance changes
                accounts: {
                    "trader-accounts": {
                        account: walletsToMonitor,
                        owner: [],
                        filters: []
                    }
                },
                // Monitor transactions involving trader wallets
                transactions: { 
                    "copy-trade-detection": { 
                        accountRequired: walletsToMonitor, 
                        vote: false, 
                        failed: false,
                        accountInclude: [], // Include all accounts in transaction
                        accountExclude: []  // Don't exclude any accounts
                    } 
                },
                // Get transaction status updates
                transactionsStatus: {
                    "trade-confirmation": {
                        accountRequired: walletsToMonitor
                    }
                },
                commitment: CommitmentLevel.PROCESSED,
                // Enhanced data slicing for quick analysis
                accountsDataSlice: [
                    {
                        offset: 0,   // Start of account data
                        length: 128  // First 128 bytes for quick token/balance analysis
                    }
                ]
            };
            
            console.log(`[LASERSTREAM-ENHANCED] 🔧 Using enhanced subscription with data slicing and Singapore endpoint`);
            
            // Enhanced callback with refined data extraction
            const streamCallback = (error, rawUpdateData) => {
                if (error) {
                    console.error('[LASERSTREAM-ENHANCED] ❌ Stream encountered a critical error:', error);
                    this.streamStatus = 'error';
                    this.emit('status_change', { status: 'disconnected', error: error.message });
                    return;
                }

                try {
                    // Decode the raw binary data into a usable object
                    const update = decodeSubscribeUpdate(rawUpdateData);
                    
                    // Handle different types of updates
                    if (update.transaction) {
                        this.handleTransactionUpdate(update.transaction);
                    } else if (update.account) {
                        this.handleAccountUpdate(update.account);
                    } else if (update.transactionStatus) {
                        this.handleTransactionStatusUpdate(update.transactionStatus);
                    }
                    
                } catch (decodeError) {
                    console.error('[LASERSTREAM-ENHANCED] ❌ Error decoding update:', decodeError);
                }
            };
   
            this.stream = await subscribe(
                laserstreamConfig, 
                subscriptionRequest, 
                streamCallback
            );
            
            console.log(`[LASERSTREAM-ENHANCED] ✅ Stream connected to Singapore endpoint. ID: ${this.stream.id}`);
            this.streamStatus = 'connected';
            this.emit('status_change', { status: 'connected', reason: 'Stream successfully subscribed to Singapore region' });
   
        } catch (error) {
            const errorMsg = `Failed to subscribe: ${error.message || error}`;
            console.error('[LASERSTREAM-ENHANCED] ❌', errorMsg);
            this.streamStatus = 'error';
            this.emit('status_change', { status: 'disconnected', error: errorMsg });
        }
    }

    // Enhanced transaction handling with refined data extraction
    handleTransactionUpdate(transactionUpdate) {
        try {
            const transaction = transactionUpdate.transaction;
            if (!transaction || !transaction.signatures || transaction.signatures.length === 0) {
                return;
            }

            const signature = transaction.signatures[0];
            const signatureStr = typeof signature === 'string' ? signature : signature.toString('base64');
            
            // Extract account keys with proper handling
            let accountKeys = [];
            if (transaction.message && transaction.message.accountKeys) {
                accountKeys = transaction.message.accountKeys.map(key => {
                    if (typeof key === 'string') return key;
                    if (key && key.pubkey) return key.pubkey.toString();
                    if (Buffer.isBuffer(key)) return key.toString('base64');
                    return key.toString();
                });
            }

            // Find which trader wallet is involved
            const sourceWallet = accountKeys.find(key => this.activeTraderWallets.has(key));
            
            if (sourceWallet) {
                console.log(`[LASERSTREAM-ENHANCED] 🎯 Copy trade detected for ${shortenAddress(sourceWallet)} | Sig: ${shortenAddress(signatureStr)}`);
                
                // Extract refined transaction data for copy trading
                const refinedData = this.extractRefinedTransactionData(transactionUpdate, sourceWallet);
                
                // Emit enhanced event with refined data
                this.emit('copy_trade_detected', {
                    sourceWallet,
                    signature: signatureStr,
                    refinedData,
                    timestamp: Date.now(),
                    endpoint: 'singapore-laserstream'
                });

                // Call parent handler if available
                if (this.parentWorker && typeof this.parentWorker.handleTraderActivity === 'function') {
                    this.parentWorker.handleTraderActivity(sourceWallet, signatureStr, refinedData);
                }
            }
            
        } catch (error) {
            console.error('[LASERSTREAM-ENHANCED] ❌ Error handling transaction update:', error);
        }
    }

    // Extract refined transaction data for copy trading
    extractRefinedTransactionData(transactionUpdate, sourceWallet) {
        try {
            const transaction = transactionUpdate.transaction;
            const meta = transactionUpdate.meta;
            
            const refinedData = {
                // Basic transaction info
                signature: transaction.signatures[0],
                slot: transactionUpdate.slot,
                blockTime: transactionUpdate.blockTime,
                
                // Account information
                accountKeys: transaction.message?.accountKeys || [],
                numRequiredSignatures: transaction.message?.header?.numRequiredSignatures || 0,
                numReadonlySignedAccounts: transaction.message?.header?.numReadonlySignedAccounts || 0,
                numReadonlyUnsignedAccounts: transaction.message?.header?.numReadonlyUnsignedAccounts || 0,
                
                // Instructions analysis
                instructions: transaction.message?.instructions || [],
                innerInstructions: meta?.innerInstructions || [],
                
                // Balance changes (if available)
                preBalances: meta?.preBalances || [],
                postBalances: meta?.postBalances || [],
                preTokenBalances: meta?.preTokenBalances || [],
                postTokenBalances: meta?.postTokenBalances || [],
                
                // Transaction metadata
                fee: meta?.fee || 0,
                computeUnitsConsumed: meta?.computeUnitsConsumed || 0,
                err: meta?.err || null,
                logMessages: meta?.logMessages || [],
                
                // Enhanced data for copy trading
                isCopyable: true,
                sourceWallet,
                detectedAt: Date.now(),
                dataSource: 'singapore-laserstream-enhanced'
            };

            // Add platform detection hints
            refinedData.platformHints = this.detectPlatformHints(refinedData);
            
            return refinedData;
            
        } catch (error) {
            console.error('[LASERSTREAM-ENHANCED] ❌ Error extracting refined data:', error);
            return { error: error.message, isCopyable: false };
        }
    }

    // Detect platform hints from transaction data
    detectPlatformHints(refinedData) {
        const hints = {
            pumpFun: false,
            raydium: false,
            meteora: false,
            jupiter: false,
            unknown: false
        };

        try {
            // Check account keys for known platform program IDs
            const accountKeys = refinedData.accountKeys.map(key => key.toString().toLowerCase());
            
            // Pump.fun detection
            if (accountKeys.some(key => key.includes('6ef8rrecth'))) {
                hints.pumpFun = true;
            }
            
            // Raydium detection
            if (accountKeys.some(key => key.includes('675kpx9wm'))) {
                hints.raydium = true;
            }
            
            // Meteora detection
            if (accountKeys.some(key => key.includes('whir'))) {
                hints.meteora = true;
            }
            
            // Jupiter detection
            if (accountKeys.some(key => key.includes('jupit'))) {
                hints.jupiter = true;
            }

            // Check log messages for additional hints
            if (refinedData.logMessages) {
                const logs = refinedData.logMessages.join(' ').toLowerCase();
                if (logs.includes('pump.fun') || logs.includes('pumpfun')) hints.pumpFun = true;
                if (logs.includes('raydium')) hints.raydium = true;
                if (logs.includes('meteora')) hints.meteora = true;
                if (logs.includes('jupiter')) hints.jupiter = true;
            }

            // If no specific platform detected, mark as unknown
            if (!Object.values(hints).some(hint => hint)) {
                hints.unknown = true;
            }

        } catch (error) {
            console.error('[LASERSTREAM-ENHANCED] ❌ Error detecting platform hints:', error);
            hints.unknown = true;
        }

        return hints;
    }

    // Handle account balance updates
    handleAccountUpdate(accountUpdate) {
        try {
            if (accountUpdate.account && accountUpdate.account.pubkey) {
                const pubkey = accountUpdate.account.pubkey.toString();
                if (this.activeTraderWallets.has(pubkey)) {
                    console.log(`[LASERSTREAM-ENHANCED] 💰 Balance update for trader ${shortenAddress(pubkey)}`);
                    
                    this.emit('trader_balance_update', {
                        wallet: pubkey,
                        lamports: accountUpdate.account.lamports,
                        slot: accountUpdate.slot,
                        timestamp: Date.now()
                    });
                }
            }
        } catch (error) {
            console.error('[LASERSTREAM-ENHANCED] ❌ Error handling account update:', error);
        }
    }

    // Handle transaction status updates
    handleTransactionStatusUpdate(statusUpdate) {
        try {
            if (statusUpdate.signature && statusUpdate.err === null) {
                console.log(`[LASERSTREAM-ENHANCED] ✅ Transaction confirmed: ${shortenAddress(statusUpdate.signature)}`);
                
                this.emit('transaction_confirmed', {
                    signature: statusUpdate.signature,
                    slot: statusUpdate.slot,
                    timestamp: Date.now()
                });
            }
        } catch (error) {
            console.error('[LASERSTREAM-ENHANCED] ❌ Error handling status update:', error);
        }
    }

    // Get Singapore regional endpoints
    getSingaporeEndpoints() {
        return this.singaporeEndpoints;
    }

    // Refresh subscriptions when traders are added/removed
    async refreshSubscriptions() {
        console.log('[LASERSTREAM-ENHANCED] 🔄 Refreshing trader subscriptions...');
        try {
            const currentWallets = await this.tradingEngine.getMasterTraderWallets();
            const currentWalletSet = new Set(currentWallets);
            
            // Check if wallets have changed
            const walletsChanged = currentWallets.length !== this.activeTraderWallets.size ||
                                 !currentWallets.every(wallet => this.activeTraderWallets.has(wallet));
            
            if (walletsChanged) {
                console.log('[LASERSTREAM-ENHANCED] 📊 Trader list changed. Restarting stream...');
                console.log(`[LASERSTREAM-ENHANCED] Old: ${this.activeTraderWallets.size} traders`);
                console.log(`[LASERSTREAM-ENHANCED] New: ${currentWallets.length} traders`);
                
                await this.startMonitoring(); // This will restart with new list
                return true;
            } else {
                console.log('[LASERSTREAM-ENHANCED] ✅ No changes in trader list');
                return false;
            }
        } catch (error) {
            console.error('[LASERSTREAM-ENHANCED] ❌ Error refreshing subscriptions:', error);
            return false;
        }
    }

    // Health check for Singapore connection
    async healthCheck() {
        try {
            const response = await fetch(`${this.singaporeEndpoints.rpc}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    jsonrpc: '2.0',
                    id: 1,
                    method: 'getHealth'
                })
            });
            
            const result = await response.json();
            return result.result === 'ok';
        } catch (error) {
            console.error('[LASERSTREAM-ENHANCED] ❌ Health check failed:', error);
            return false;
        }
    }

    async stop() {
        if (this.stream) {
            console.log('[LASERSTREAM-ENHANCED] 🛑 Shutting down Singapore stream...');
            this.stream.cancel();
            this.stream = null;
            this.streamStatus = 'disconnected';
            this.emit('status_change', { status: 'disconnected', reason: 'Manual shutdown' });
        }
    }
}

module.exports = { LaserStreamManager };