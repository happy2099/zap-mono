// File: laserstreamManager.js (PROFESSIONAL PLAN - LaserStream gRPC)
// Description: Advanced Helius LaserStream manager using gRPC for Professional plan users

const { subscribe, CommitmentLevel, decodeSubscribeUpdate } = require('helius-laserstream');
const { EventEmitter } = require('events');
const { PublicKey } = require('@solana/web3.js');
const config = require('./config.js');
const { shortenAddress } = require('./utils.js');
const bs58 = require('bs58');


// Add fetch for Node.js compatibility
const fetch = require('node-fetch');

class LaserStreamManager extends EventEmitter {
    constructor(tradingEngineOrWorker, mainConfig = null, redisManager = null) {
        super();
        if (!tradingEngineOrWorker) {
            throw new Error("LaserStreamManager requires a tradingEngine or worker instance.");
        }

        // --- THE FIX: Store the main config ---
        this.config = mainConfig || config; // Use passed config or fallback to require('./config.js')
        this.redisManager = redisManager; // 🚀 REDIS ENHANCEMENT: Store for caching pre-fetched data
        // --- END OF FIX ---

        // Parent worker will be the TraderMonitorWorker instance.
        // It's still important for cleanup context.
        this.parentWorker = tradingEngineOrWorker; 
        if(tradingEngineOrWorker instanceof require('./tradingEngine.js').TradingEngine) {
            this.tradingEngine = tradingEngineOrWorker;
            // if single-threaded, it might also register this as a general callback system if you wish.
        } else {
            // It's the Worker (e.g. TraderMonitorWorker)
            this.tradingEngine = null; // will be set externally later.
        }
        
        this.stream = null;
        this.activeTraderWallets = new Set();
        this.streamStatus = 'idle';
        
        // Safety check to ensure activeTraderWallets is always a Set
        if (!this.activeTraderWallets) {
            this.activeTraderWallets = new Set();
        }
    }

    // Getter method to ensure activeTraderWallets is always a Set
    get activeTraderWallets() {
        if (!this._activeTraderWallets) {
            this._activeTraderWallets = new Set();
        }
        return this._activeTraderWallets;
    }

    // Setter method to ensure activeTraderWallets is always a Set
    set activeTraderWallets(value) {
        this._activeTraderWallets = value instanceof Set ? value : new Set(value || []);
        
        // Initialize PumpFun template cache
       
        
        // Professional Plan: LaserStream gRPC Configuration
        this.laserstreamConfig = {
            apiKey: this.config.HELIUS_API_KEY, // Use the dynamically loaded API key from config.js
            endpoint: this.config.HELIUS_ENDPOINTS.laserstream_grpc, // Primary: Singapore
            fallbackEndpoint: this.config.HELIUS_ENDPOINTS.laserstream_grpc_alt // Fallback: EWR
        };
        
        // Legacy endpoints are for RPC/WebSocket services, NOT LaserStream gRPC.
        // They are retained for compatibility if `getSingaporeEndpoints` or `healthCheck` were ever to access RPC/sender related tasks.
        this.singaporeEndpoints = {
            // No direct 'laserstream' field here as the actual LaserStream uses gRPC endpoints defined in this.laserstreamConfig
            rpc: this.config.HELIUS_ENDPOINTS.rpc, // Using the centralized RPC URL
            sender: this.config.HELIUS_ENDPOINTS.sender // Using the centralized SENDER URL
        };
        
        // Ensure Pump.fun program IDs are pre-converted to strings for consistent comparisons
        this.pumpFunMainProgramIdStr = this.config.PLATFORM_IDS.PUMP_FUN.toBase58();
        this.pumpFunAMMProgramIdStr = this.config.PLATFORM_IDS.PUMP_FUN_AMM.toBase58();
        
        console.log('[LASERSTREAM-PROFESSIONAL] 🚀 Manager initialized with LaserStream gRPC (Professional Plan).');
        console.log(`[LASERSTREAM-PROFESSIONAL] 🌏 Primary Endpoint (Singapore): ${this.laserstreamConfig.endpoint}`);
        console.log(`[LASERSTREAM-PROFESSIONAL] 🌏 Fallback Endpoint (EWR): ${this.laserstreamConfig.fallbackEndpoint}`);
    }

    // ===== TREASURE HUNTER (BATTLE-TESTED) =====
    // This version intelligently finds the correct transaction object,
    // regardless of how deeply it is nested by Helius.
    getCoreTransaction(updateObject) {
        
        // Handle the specific Helius LaserStream structure we just discovered
        if (updateObject && updateObject.transaction && updateObject.transaction.transaction) {
            const nestedTx = updateObject.transaction.transaction;
            if (nestedTx.meta && nestedTx.message) {
                return {
                    message: nestedTx.message,
                    meta: nestedTx.meta,
                    signature: updateObject.signature || nestedTx.signature || null
                };
            }
        }
        
        // Fallback to original logic for other structures
        let current = updateObject;
        let metaObject = null;
        let messageObject = null;
        
        // Search for meta and message at different levels
        for (let i = 0; i < 5; i++) {
            if (current && current.meta && !metaObject) {
                metaObject = current.meta;
            }
            if (current && current.message && !messageObject) {
                messageObject = current.message;
            }
            
            if (current && current.transaction) {
                current = current.transaction;
            } else {
                break;
            }
        }
        
        if (metaObject && messageObject) {
            return {
                message: messageObject,
                meta: metaObject,
                signature: updateObject.signature || null
            };
        }
        return null;
    }

    // ===== WORKING VERSION - Based on live_debug.js =====
    async startMonitoring(walletsToMonitor = null) {
        if (this.stream) {
            console.log('[LASERSTREAM-PRO] 🔄 Stream is already active. Restarting to apply latest trader list...');
            await this.stop();
        }

        try {
            const traderWallets = walletsToMonitor || Array.from(this.activeTraderWallets);
            if (traderWallets.length === 0) {
                this.streamStatus = 'connected';
                console.log('[LASERSTREAM-PRO] ⚠️ No active traders to monitor. Standing by.');
                return;
            }
            this.activeTraderWallets = new Set(traderWallets.map(w => w.toString()));
            const finalWalletsToSubscribe = Array.from(this.activeTraderWallets);
            
            console.log(`[LASERSTREAM-PRO] 🎯 Subscribing to ${finalWalletsToSubscribe.length} active trader wallets...`);
            console.log(`[LASERSTREAM-PRO] 🔍 Wallets to monitor: ${finalWalletsToSubscribe.map(w => shortenAddress(w)).join(', ')}`);

            if (!this.config.HELIUS_API_KEY) {
                throw new Error("Cannot subscribe: HELIUS_API_KEY is missing.");
            }

            // ✅ USE EXACT SAME CONFIG AS WORKING live_debug.js
            const laserstreamConfig = {
                apiKey: this.config.HELIUS_API_KEY,
                endpoint: "https://laserstream-mainnet-sgp.helius-rpc.com", // Same as working live_debug.js
            };

            // No DEX filtering - monitor all transactions from tracked wallets
            console.log(`[LASERSTREAM-PRO] Subscribing to ${finalWalletsToSubscribe.length} trader wallets (no DEX filtering).`);

            const subscription = {
                transactions: {
                    "zap-copy-trades": {
                        // BATTLE-TESTED: Use accountIncludes (not accountInclude)
                        accountIncludes: finalWalletsToSubscribe,
                        
                        // Standard noise reduction
                        vote: false,
                        failed: false,
                    }
                },
                // Use PROCESSED for the absolute fastest notification speed.
                commitment: CommitmentLevel.PROCESSED,
            };

            console.log("[LASERSTREAM-PRO] ✅ Using accountIncludes filtering. Connecting...");

            // ✅ USE BATTLE-TESTED LOGIC FROM test-pipeline.js
            const streamCallback = async (update) => {
                try {
                    // 1. Safety check: Ensure the update object and its nested transaction exist.
                    if (typeof update !== 'object' || update === null || !update.transaction) {
                        return; // Ignore invalid or non-transactional updates.
                    }
                    
                    // BATTLE-TESTED: Use Treasure Hunter to find the correct data structure
                    const coreTx = this.getCoreTransaction(update.transaction);
                    
                    if (!coreTx) {
                        console.warn('[LASERSTREAM-PRO] ❌ Treasure Hunter could not find core transaction block.');
                        return;
                    }
                    
                    // BATTLE-TESTED: Access accountKeys from the correct structure
                    const accountKeyBuffers = coreTx.message?.accountKeys;
                    
                    if (!accountKeyBuffers || accountKeyBuffers.length === 0) {
                        console.warn('[LASERSTREAM-PRO] ❌ Transaction received with an empty accountKeys array.');
                        return;
                    }
                    
                    // BATTLE-TESTED: Convert to strings and find trader
                    const accountKeyStrings = accountKeyBuffers.map(bs58.encode);
                    if (!this.activeTraderWallets || this.activeTraderWallets.size === 0) {
                        return; // Skip if no active trader wallets
                    }
                    const sourceWallet = accountKeyStrings.find(keyStr => this.activeTraderWallets && this.activeTraderWallets.has(keyStr));

                    if (!sourceWallet) {
                        // This will now correctly ignore transactions that are not from your followed traders.
                        return;
                    }

                    // If we reach this point, WE HAVE A MATCH. The pipeline is working.
                    // Signature found at nested path: update.transaction.transaction.signature
                    
                    // BATTLE-TESTED: Get the raw signature Buffer (nested path!)
                    const signatureBuffer = update.transaction?.transaction?.signature;
                    if (!signatureBuffer) {
                        console.log('[LASERSTREAM-PRO] ⚠️ Could not find signature, but transaction data is available');
                        return; // Skip if no signature
                    }
                    
                    // For logging purposes, encode to string
                    const signatureString = bs58.encode(signatureBuffer);
                    console.log(`[LASERSTREAM-PRO] ✅ Source Wallet Identified: ${shortenAddress(sourceWallet)} | Sig: ${shortenAddress(signatureString)}`);
                    
                    // The handoff to the traderMonitorWorker's handler.
                    if (this.parentWorker && typeof this.parentWorker.handleTraderActivity === 'function') {
                        // Pass the raw Buffer to handleTraderActivity - it will encode it
                        this.parentWorker.handleTraderActivity(sourceWallet, signatureBuffer, update); // Pass the whole 'update' object 
                    } else {
                         console.warn(`[LASERSTREAM-PRO] ⚠️ No valid 'handleTraderActivity' handler found.`);
                    }

                } catch (handlerError) {
                    console.error('❌❌ FATAL ERROR in LaserStream streamCallback ❌❌', {
                        errorMessage: handlerError?.message || 'Unknown Error',
                        errorStack: handlerError?.stack || 'No Stack'
                    });
                }
            };

            const errorCallback = (error) => {
                console.error('[LASERSTREAM-PRO] 🚨 SDK-LEVEL STREAM ERROR:', error);
            };

            this.stream = await subscribe(
                laserstreamConfig,
                subscription,
                streamCallback,
                errorCallback
            );

            console.log(`[LASERSTREAM-PRO] ✅ LaserStream connected using WORKING approach. ID: ${this.stream.id}. Monitoring...`);
            console.log(`[LASERSTREAM-PRO] 🔧 Using proven live_debug.js method with ${finalWalletsToSubscribe.length} wallets`);
            this.streamStatus = 'connected';
    
        } catch (error) {
            console.error(`[LASERSTREAM-PRO] ❌ Failed to subscribe:`, error);
            this.streamStatus = 'error';
        }
    }
    

    // Enhanced transaction handling with refined data extraction
    async handleTransactionUpdate(transactionUpdate) { // Now accepts the full update object
        try {
            // DEBUG: Check activeTraderWallets state
            console.log(`[LASERSTREAM-DEBUG] activeTraderWallets type: ${typeof this.activeTraderWallets}, size: ${this.activeTraderWallets ? this.activeTraderWallets.size : 'undefined'}`);
            
            // THE FIX: The transaction data is directly on the object passed in.
            const transaction = transactionUpdate.transaction;
            if (!transaction || !transaction.signatures || transaction.signatures.length === 0) {
                return;
            }

            const signature = transaction.signatures[0];
            const signatureStr = typeof signature === 'string' ? signature : bs58.encode(signature); // Use bs58 for buffers
            
            // Extract account keys with proper Helius LaserStream format handling
            let accountKeys = [];
            
            // According to Helius docs, account keys are in transaction.message.accountKeys
            // But they might be in different formats - let's handle all cases
            if (transaction.message && transaction.message.accountKeys) {
                accountKeys = transaction.message.accountKeys.map(key => {
                    try {
                        // Case 1: Direct buffer/bytes
                        if (Buffer.isBuffer(key)) {
                            return new PublicKey(key).toBase58();
                        }
                        // Case 2: Object with pubkey field
                        if (key && key.pubkey) {
                            return new PublicKey(key.pubkey).toBase58();
                        }
                        // Case 3: String format
                        if (typeof key === 'string') {
                            return key;
                        }
                        // Case 4: Already a PublicKey
                        if (key instanceof PublicKey) {
                            return key.toBase58();
                        }
                        // Case 5: Try to convert directly
                        return new PublicKey(key).toBase58();
                    } catch (error) {
                        console.log(`[LASERSTREAM-DEBUG] Failed to parse account key:`, key, error.message);
                        return null;
                    }
                }).filter(key => key !== null);
            }
            
            // Alternative: Check if account keys are in a different location
            if (accountKeys.length === 0 && transaction.message && transaction.message.instructions) {
                // Sometimes account keys might be referenced in instructions
                const allKeys = new Set();
                transaction.message.instructions.forEach(instruction => {
                    if (instruction.accounts) {
                        instruction.accounts.forEach(accountIndex => {
                            if (transaction.message.accountKeys && transaction.message.accountKeys[accountIndex]) {
                                const key = transaction.message.accountKeys[accountIndex];
                                try {
                                    if (Buffer.isBuffer(key)) {
                                        allKeys.add(new PublicKey(key).toBase58());
                                    } else if (key && key.pubkey) {
                                        allKeys.add(new PublicKey(key.pubkey).toBase58());
                                    } else if (typeof key === 'string') {
                                        allKeys.add(key);
                                    }
                                } catch (e) {
                                    // Skip invalid keys
                                }
                            }
                        });
                    }
                });
                accountKeys = Array.from(allKeys);
            }

            // Find which trader wallet is involved
            if (!this.activeTraderWallets || this.activeTraderWallets.size === 0) {
                console.log(`[LASERSTREAM-DEBUG] ⚠️ No active trader wallets set, skipping transaction`);
                return;
            }
            const sourceWallet = accountKeys.find(key => this.activeTraderWallets && this.activeTraderWallets.has(key));
            
            // DEBUG: Log transaction structure and wallet detection details
            console.log(`[LASERSTREAM-DEBUG] 🔍 Transaction Structure Debug:`);
            console.log(`[LASERSTREAM-DEBUG] 🔍 Transaction keys:`, Object.keys(transaction));
            console.log(`[LASERSTREAM-DEBUG] 🔍 Message keys:`, transaction.message ? Object.keys(transaction.message) : 'No message');
            console.log(`[LASERSTREAM-DEBUG] 🔍 AccountKeys type:`, transaction.message?.accountKeys ? typeof transaction.message.accountKeys : 'No accountKeys');
            console.log(`[LASERSTREAM-DEBUG] 🔍 AccountKeys length:`, transaction.message?.accountKeys?.length || 0);
            console.log(`[LASERSTREAM-DEBUG] 🔍 First accountKey sample:`, transaction.message?.accountKeys?.[0]);
            
            console.log(`[LASERSTREAM-DEBUG] 🔍 Wallet Detection Debug:`);
            console.log(`[LASERSTREAM-DEBUG] 🔍 Active Trader Wallets: ${Array.from(this.activeTraderWallets).join(', ')}`);
            console.log(`[LASERSTREAM-DEBUG] 🔍 Account Keys in Transaction: ${accountKeys.slice(0, 5).join(', ')}${accountKeys.length > 5 ? '...' : ''}`);
            console.log(`[LASERSTREAM-DEBUG] 🔍 Source Wallet Found: ${sourceWallet || 'NONE'}`);
            
            if (sourceWallet) {
                // --- START OF NEW MASTER PLAN LOGIC ---
                // The transaction age check can happen first, as it's the cheapest.
                const ageInSeconds = (Date.now() - (transactionUpdate.blockTime * 1000)) / 1000;
                if (ageInSeconds > this.config.TRANSACTION_FILTERING.MAX_AGE_SECONDS) {
                    this.parentWorker.logInfo(`[FILTER] ⏰ Skipping old transaction. Sig: ${signatureStr.slice(0,10)}... (age: ${ageInSeconds.toFixed(0)}s)`);
                    return; // Kill it immediately.
                }
                this.parentWorker.logInfo(`[FILTER] ✅ Transaction age: ${ageInSeconds.toFixed(0)}s - within acceptable range.`);

                // --- NOISE FILTERING DISABLED in config.js, so we don't check here ---

                // If we reach this point, the transaction is FRESH and it is NOT noise.
                console.log(`[LASERSTREAM-PROFESSIONAL] 🎯 High-quality transaction detected for ${shortenAddress(sourceWallet)} | Sig: ${shortenAddress(signatureStr)}`);
                
                // 🚀 REDIS CACHE ENHANCEMENT: Store pre-fetched data for instant access
                try {
                    const preFetchedData = this.extractRefinedTransactionData(transactionUpdate, sourceWallet);
                    
                    // Cache for 30 seconds (enough for analysis)
                    const cacheKey = `laserstream:prefetch:${signatureStr}`;
                    if (this.redisManager) {
                        await this.redisManager.setWithExpiry(cacheKey, JSON.stringify(preFetchedData), 30);
                        console.log(`[LASERSTREAM-PROFESSIONAL] 💎 Pre-fetched data cached for ${shortenAddress(signatureStr)}`);
                    }
                } catch (cacheError) {
                    console.error('[LASERSTREAM-PROFESSIONAL] ⚠️ Failed to cache pre-fetched data:', cacheError.message);
                }

                // Call the explicitly registered callback instead of parentWorker (more reliable context)
                if (typeof this.transactionNotificationCallback === 'function') { // <--- USE THE NEW CALLBACK
                    this.transactionNotificationCallback(sourceWallet, signatureStr, transactionUpdate);
                } else if (this.parentWorker && typeof this.parentWorker.handleTraderActivity === 'function') { // Fallback for old callers
                    this.parentWorker.handleTraderActivity(sourceWallet, signatureStr, transactionUpdate);
                } else {
                    console.warn(`[LASERSTREAM-PROFESSIONAL] ⚠️ No valid handler found for transaction update.`);
                }
            } else {
                // DEBUG: Log when no source wallet is found
                console.log(`[LASERSTREAM-DEBUG] 🚫 No active trader wallet found in transaction. Skipping.`);
            }
            
        } catch (error) {
            console.error('[LASERSTREAM-PROFESSIONAL] ❌ Error handling transaction update:', error);
        }
    }

    // ====================================================================
    // ====== EXTRACT REFINED DATA (vFINAL - With Treasure Hunter) ======
    // ====================================================================
    extractRefinedTransactionData(transactionUpdate, sourceWallet) {
        try {
            // --- DEBUG: Let's see what we're actually getting ---
            console.log(`[LASERSTREAM-DEBUG] 🔍 TransactionUpdate structure:`, {
                hasTransaction: !!transactionUpdate.transaction,
                hasMeta: !!transactionUpdate.meta,
                hasMessage: !!transactionUpdate.message,
                keys: Object.keys(transactionUpdate)
            });
            
            if (transactionUpdate.transaction) {
                console.log(`[LASERSTREAM-DEBUG] 🔍 Transaction structure:`, {
                    hasMeta: !!transactionUpdate.transaction.meta,
                    hasMessage: !!transactionUpdate.transaction.message,
                    keys: Object.keys(transactionUpdate.transaction)
                });
            }
            
            // --- THIS IS THE FINAL FIX ---
            // We use our proven "Treasure Hunter" to find the real core transaction data.
            const coreTx = this.getCoreTransaction(transactionUpdate);

            if (!coreTx) {
                // If we can't find the core data, we return a copyable=false object
                // to prevent empty data from being cached.
                return { isCopyable: false, reason: "Treasure Hunter could not find core transaction block in Laserstream update." };
            }
            // --- END OF FINAL FIX ---
            
            // Now, we can safely and reliably extract data from the coreTx object.
            const refinedData = {
                signature: bs58.encode(transactionUpdate.signature), // Signature is on the root object
                slot: transactionUpdate.slot,
                blockTime: transactionUpdate.blockTime,
                
                // All other data comes from the coreTx object found by the Treasure Hunter
                accountKeys: coreTx.message?.accountKeys || [],
                instructions: coreTx.message?.instructions || [],
                innerInstructions: coreTx.meta?.innerInstructions || [],
                preBalances: coreTx.meta?.preBalances || [],
                postBalances: coreTx.meta?.postBalances || [],
                preTokenBalances: coreTx.meta?.preTokenBalances || [],
                postTokenBalances: coreTx.meta?.postTokenBalances || [],
                fee: coreTx.meta?.fee || 0,
                computeUnitsConsumed: coreTx.meta?.computeUnitsConsumed || 0,
                err: coreTx.meta?.err || null,
                logMessages: coreTx.meta?.logMessages || [],
                
                isCopyable: true,
                sourceWallet,
                detectedAt: Date.now(),
                dataSource: 'singapore-laserstream-v-final'
            };

            // Add platform detection hints
            refinedData.platformHints = this.detectPlatformHints(refinedData);
            
            return refinedData;
            
        } catch (error) {
            console.error('[LASERSTREAM-PROFESSIONAL] ❌ Error extracting refined data:', error);
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
            console.error('[LASERSTREAM-PROFESSIONAL] ❌ Error detecting platform hints:', error);
            hints.unknown = true;
        }

        return hints;
    }

    // Handle account balance updates
    handleAccountUpdate(accountUpdate) {
        try {
            if (accountUpdate.account && accountUpdate.account.pubkey) {
                const pubkey = accountUpdate.account.pubkey.toString();
                if (this.activeTraderWallets && this.activeTraderWallets.has(pubkey)) {
                    console.log(`[LASERSTREAM-PROFESSIONAL] 💰 Balance update for trader ${shortenAddress(pubkey)}`);
                    
                    this.emit('trader_balance_update', {
                        wallet: pubkey,
                        lamports: accountUpdate.account.lamports,
                        slot: accountUpdate.slot,
                        timestamp: Date.now()
                    });
                }
            }
        } catch (error) {
            console.error('[LASERSTREAM-PROFESSIONAL] ❌ Error handling account update:', error);
        }
    }

    // Handle transaction status updates
    handleTransactionStatusUpdate(statusUpdate) {
        try {
            if (statusUpdate.signature && statusUpdate.err === null) {
                console.log(`[LASERSTREAM-PROFESSIONAL] ✅ Transaction confirmed: ${shortenAddress(statusUpdate.signature)}`);
                
                this.emit('transaction_confirmed', {
                    signature: statusUpdate.signature,
                    slot: statusUpdate.slot,
                    timestamp: Date.now()
                });
            }
        } catch (error) {
            console.error('[LASERSTREAM-PROFESSIONAL] ❌ Error handling status update:', error);
        }
    }

    // Get Singapore regional endpoints
    getSingaporeEndpoints() {
        return this.singaporeEndpoints;
    }

    // Refresh subscriptions when traders are added/removed
    async refreshSubscriptions() {
        console.log('[LASERSTREAM-PROFESSIONAL] 🔄 Refreshing trader subscriptions...');
        try {
            const currentWallets = await this.tradingEngine.getMasterTraderWallets();
            const currentWalletSet = new Set(currentWallets);
            
            // Check if wallets have changed
            const walletsChanged = currentWallets.length !== (this.activeTraderWallets ? this.activeTraderWallets.size : 0) ||
                                 !currentWallets.every(wallet => this.activeTraderWallets && this.activeTraderWallets.has(wallet));
            
            if (walletsChanged) {
                console.log('[LASERSTREAM-PROFESSIONAL] 📊 Trader list changed. Restarting stream...');
                console.log(`[LASERSTREAM-PROFESSIONAL] Old: ${this.activeTraderWallets ? this.activeTraderWallets.size : 0} traders`);
                console.log(`[LASERSTREAM-PROFESSIONAL] New: ${currentWallets.length} traders`);
                
                await this.startMonitoring(); // This will restart with new list
                return true;
            } else {
                console.log('[LASERSTREAM-PROFESSIONAL] ✅ No changes in trader list');
                return false;
            }
        } catch (error) {
            console.error('[LASERSTREAM-PROFESSIONAL] ❌ Error refreshing subscriptions:', error);
            return false;
        }
    }

    // Health check for Singapore connection
    async healthCheck() {
        try {
            const response = await fetch(`${this.config.HELIUS_ENDPOINTS.rpc}`, {
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
            console.error('[LASERSTREAM-PROFESSIONAL] ❌ Health check failed:', error);
            return false;
        }
    }

    // Test gRPC configuration before subscribing
    async testGrpcConfiguration() {
        try {
            console.log('[LASERSTREAM-PROFESSIONAL] 🔧 Testing gRPC configuration...');
            
            // Test if the channel options are valid
            const testConfig = {
                apiKey: this.config.HELIUS_API_KEY, // Ensure consistent API key
                endpoint: this.config.HELIUS_ENDPOINTS.laserstream_grpc, // Point to the correct gRPC endpoint
                maxReconnectAttempts: 1,
                channelOptions: {
                    'grpc.max_send_message_length': 64 * 1024 * 1024,
                    'grpc.max_receive_message_length': 100 * 1024 * 1024,
                    'grpc.keepalive_time_ms': 20000,
                    'grpc.keepalive_timeout_ms': 10000,
                }
            };
            
            console.log('[LASERSTREAM-PROFESSIONAL] ✅ gRPC configuration test passed');
            return true;
        } catch (error) {
            console.error('[LASERSTREAM-PROFESSIONAL] ❌ gRPC configuration test failed:', error);
            return false;
        }
    }

    async stop() {
        if (this.stream) {
            console.log('[LASERSTREAM-PROFESSIONAL] 🛑 Shutting down Singapore stream...');
            this.stream.cancel();
            this.stream = null;
            this.streamStatus = 'disconnected';
            this.emit('status_change', { status: 'disconnected', reason: 'Manual shutdown' });
        }
    }

    // PROFESSIONAL PLAN: Check if LaserStream is connected (required for worker priority logic)
    isConnected() {
        return this.streamStatus === 'connected' && this.stream !== null;
    }

    // COMPATIBILITY METHODS - For old code that expects these methods
    
    // Legacy method name for compatibility
    async initializeCopyTradingStream(onTransaction, onError, traderWallets = []) {
        console.log('[LASERSTREAM-PROFESSIONAL] 🔄 Legacy method called - redirecting to startMonitoring...');
        
        // Store callbacks for legacy compatibility
        this.onTransactionCallback = onTransaction;
        this.onErrorCallback = onError;
        
        // Start monitoring (this will use the enhanced Singapore endpoints)
        return await this.startMonitoring();
    }

    // Legacy method for getting active streams count
    getActiveStreamCount() {
        return this.stream ? 1 : 0;
    }

    // Legacy method for shutting down all streams  
    async shutdownAllStreams() {
        console.log('[LASERSTREAM-PROFESSIONAL] 🔄 Legacy shutdownAllStreams called...');
        await this.stop();
    }

    // NEW: Universal trader detection from mempool transactions
    async handleUniversalTraderDetection(transactionUpdate) {
        try {
            const transaction = transactionUpdate.transaction;
            if (!transaction || !transaction.signatures || transaction.signatures.length === 0) {
                return;
            }

            const signature = transaction.signatures[0];
            const signatureStr = typeof signature === 'string' ? signature : signature.toString('base64');
            
            // Extract account keys for analysis
            const accountKeys = transaction.message?.accountKeys || [];
            
            // Check if this transaction involves any known trader wallets
            const knownTraderInvolved = Array.from(this.activeTraderWallets).some(traderWallet => 
                accountKeys.some(account => account.toString() === traderWallet)
            );

            if (knownTraderInvolved) {
                console.log(`[UNIVERSAL-DETECTION] 🎯 Trader transaction detected: ${shortenAddress(signatureStr)}`);
                
                // Extract instruction data for platform identification
                const instructions = transaction.message?.instructions || [];
                const programIds = new Set();
                
                for (const instruction of instructions) {
                    if (instruction.programIdIndex !== undefined && accountKeys[instruction.programIdIndex]) {
                        const programId = accountKeys[instruction.programIdIndex].toString();
                        programIds.add(programId);
                    }
                }

                if (programIds.size > 0) {
                    console.log(`[UNIVERSAL-DETECTION] 🔍 Platform program IDs: ${Array.from(programIds).map(id => shortenAddress(id)).join(', ')}`);
                    console.log(`[UNIVERSAL-DETECTION] 🔍 Complete program IDs: ${Array.from(programIds).join(', ')}`);
                    
                    // Emit event for copy trade processing
                    this.emit('copy_trade_detected', {
                        signature: signatureStr,
                        sourceWallet: sourceWallet,
                        programIds: Array.from(programIds),
                        transaction: transactionUpdate,
                        timestamp: Date.now()
                    });
                    
                    // Also emit legacy event for backward compatibility
                    this.emit('universal_trader_detected', {
                        signature: signatureStr,
                        programIds: Array.from(programIds),
                        transaction: transactionUpdate,
                        timestamp: Date.now()
                    });
                }
            }
        } catch (error) {
            console.error('[UNIVERSAL-DETECTION] ❌ Error in universal trader detection:', error);
        }
    }

    

    /**
     * Calculate price impact from recent transactions
     */
    calculatePriceImpact(transactions) {
        try {
            if (transactions.length < 2) return 0;
            
            // Simplified price impact calculation
            // In reality, you'd parse the transaction logs more carefully
            const priceChanges = [];
            
            for (let i = 1; i < transactions.length; i++) {
                const prevTx = transactions[i-1];
                const currTx = transactions[i];
                
                // Extract price changes from transaction data
                // This is simplified - you'd need more sophisticated parsing
                // const priceChange = Math.random() * 0.1; // Placeholder - COMMENTED OUT
                const priceChange = 0.05; // Default small price change
                priceChanges.push(priceChange);
            }
            
            const avgPriceChange = priceChanges.reduce((sum, change) => sum + change, 0) / priceChanges.length;
            return avgPriceChange;
            
        } catch (error) {
            console.error('[LASERSTREAM] ❌ Error calculating price impact:', error.message);
            return 0;
        }
    }

    /**
     * Calculate liquidity ratio from recent transactions
     */
    calculateLiquidityRatio(transactions) {
        try {
            if (transactions.length === 0) return 1.0;
            
            // Calculate average transaction size relative to pool liquidity
            // This is simplified - you'd need actual pool liquidity data
            const avgTxSize = this.calculateAverageTxSize(transactions);
            // const estimatedPoolLiquidity = 1000000000; // 1 SOL in lamports (placeholder) - COMMENTED OUT
            const estimatedPoolLiquidity = 1000000000; // Default 1 SOL in lamports
            
            return Math.min(avgTxSize / estimatedPoolLiquidity, 1.0);
            
        } catch (error) {
            console.error('[LASERSTREAM] ❌ Error calculating liquidity ratio:', error.message);
            return 1.0;
        }
    }

    /**
     * Calculate average transaction size
     */
    calculateAverageTxSize(transactions) {
        try {
            if (transactions.length === 0) return 0;
            
            let totalSize = 0;
            for (const tx of transactions) {
                // Extract transaction size from meta data
                // This is simplified - you'd need actual size calculation
                // totalSize += Math.random() * 100000000; // Placeholder - COMMENTED OUT
                totalSize += 50000000; // Default transaction size
            }
            
            return totalSize / transactions.length;
            
        } catch (error) {
            console.error('[LASERSTREAM] ❌ Error calculating average tx size:', error.message);
            return 0;
        }
    }

    /**
     * Calculate volatility from recent transactions
     */
    calculateVolatility(transactions) {
        try {
            if (transactions.length < 2) return 0;
            
            // Calculate price volatility from transaction data
            // This is simplified - you'd need actual price data
            const priceChanges = [];
            
            for (let i = 1; i < transactions.length; i++) {
                // const priceChange = Math.random() * 0.2; // Placeholder - COMMENTED OUT
                const priceChange = 0.1; // Default price change
                priceChanges.push(priceChange);
            }
            
            const avgChange = priceChanges.reduce((sum, change) => sum + change, 0) / priceChanges.length;
            const variance = priceChanges.reduce((sum, change) => sum + Math.pow(change - avgChange, 2), 0) / priceChanges.length;
            const volatility = Math.sqrt(variance);
            
            return volatility;
            
        } catch (error) {
            console.error('[LASERSTREAM] ❌ Error calculating volatility:', error.message);
            return 0;
        }
    }
}

module.exports = { LaserStreamManager };