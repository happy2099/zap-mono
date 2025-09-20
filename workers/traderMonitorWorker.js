// =================================================================
// ===== traderMonitorWorker.js (Cleaned & LaserStream gRPC only) =====
// =================================================================

const BaseWorker = require('./templates/baseWorker');
const { TradingEngine } = require('../tradingEngine');
const { DataManager } = require('../dataManager');
const { RedisManager } = require('../redis/redisManager');
const { SolanaManager } = require('../solanaManager');
const { PublicKey } = require('@solana/web3.js');
const { UniversalAnalyzer } = require('../universalAnalyzer.js');
const { UniversalCloningLogger } = require('../universalCloningLogger.js');
const TransactionLogger = require('../transactionLogger.js');
const config = require('../config.js');
const bs58 = require('bs58');
const { shortenAddress } = require('../utils');
const { LaserStreamManager } = require('../laserstreamManager'); // gRPC LaserStream// Smart router discovery


class TraderMonitorWorker extends BaseWorker {
    constructor() {
        super();
        this.dataManager = null;
        this.redisManager = null;
        this.laserstreamManager = null; // Instance of LaserStreamManager
        this.knownDexPrograms = null; // <-- ADD THIS for Golden Filter
        this.activeTraders = []; // [{ walletAddress: string }]
        this.monitoringStats = {
            totalTransactions: 0,
            transactionsByPlatform: {},
            lastRefresh: Date.now()
        };
        this.reconnectTimer = null; // Timer for health checks or reconnects if needed
    }

    async customInitialize() {
        this.logInfo('Initializing Trader Monitor for Helius LaserStream (gRPC)...');
        
        // Setup message handlers for inter-worker communication
        this.setupMessageHandlers();
        
        try {
            // Initialize database and Redis managers
            this.dataManager = new DataManager();
            await this.dataManager.initialize();
            this.logInfo('✅ DataManager initialized.');
            
            this.redisManager = new RedisManager();
            await this.redisManager.initialize();
            this.logInfo('✅ RedisManager initialized.');
            
            // Initialize SolanaManager for connection
            const { SolanaManager } = require('../solanaManager');
            this.solanaManager = new SolanaManager();
            await this.solanaManager.initialize();
            this.logInfo('✅ SolanaManager initialized.');


            
            // Initialize Golden Filter with static DEX programs
            this.knownDexPrograms = new Set();
            for (const key in config.PLATFORM_IDS) {
                const value = config.PLATFORM_IDS[key];
                if (Array.isArray(value)) {
                    value.forEach(pk => pk instanceof PublicKey && this.knownDexPrograms.add(pk.toBase58()));
                } else if (value instanceof PublicKey) {
                    this.knownDexPrograms.add(value.toBase58());
                }
            }
            this.logInfo(`✅ Golden Filter pre-loaded with ${this.knownDexPrograms.size} static DEX IDs.`);
            
            // Log some of the loaded DEX IDs for verification
            const sampleDexIds = Array.from(this.knownDexPrograms).slice(0, 5);
            console.log(`[GOLDEN_FILTER] 📋 Sample DEX IDs loaded: ${sampleDexIds.map(id => shortenAddress(id)).join(', ')}`);

            // Load router database and active traders from DB
            await this.loadRouterDatabase();
            await this.loadActiveTraders();

            // Instantiate LaserStreamManager passing this worker for callbacks
            const tempEngineForLaserstream = new TradingEngine(
                { dataManager: this.dataManager },
                { partialInit: true }
            );

            this.laserstreamManager = new LaserStreamManager(
                this,  // <--- `this` (TraderMonitorWorker instance) is passed as parentWorker
                config, 
                this.redisManager
                // NO 4th argument, LaserStreamManager will use `this.parentWorker.handleTraderActivity` internally.
            );
            this.laserstreamManager.tradingEngine = tempEngineForLaserstream;
            
            // Set the transaction notification callback
            this.laserstreamManager.transactionNotificationCallback = this.handleTraderActivity.bind(this);

            // Initialize SolanaManager for Universal Analyzer
            this.solanaManager = new SolanaManager();
            await this.solanaManager.initialize();
            
            // Initialize Universal Analyzer, Cloning Logger, and Transaction Logger
            this.universalAnalyzer = new UniversalAnalyzer(this.solanaManager.connection);
            this.universalCloningLogger = new UniversalCloningLogger();
            this.transactionLogger = new TransactionLogger();
            
            // Listen for raw transaction events for cloning
            this.laserstreamManager.on('transaction', this.handleRawTransaction.bind(this));
            // REMOVED: this.laserstreamManager.on('copy_trade_detected', this.handleCopyTradeDetected.bind(this));
            // Using only 'transaction' event to avoid duplicate analysis

            this.logInfo('✅ Initialized LaserStreamManager, Universal Analyzer, and Cloning Logger. Ready to start monitoring.');
           
            // Start monitoring and setup periodic refresh and health checks
            await this.startMonitoring();
            this.startPerformanceMonitoring();
           
            this.logInfo('✅ All systems are up and running.');
        } catch (error) {
            this.logError('FATAL: Failed to initialize Trader Monitor Worker', { error: error.message, stack: error.stack });
            this.signalError(error);
            throw error;
        }
    }
    
    async loadRouterDatabase() {
        try {
            const routerData = await this.redisManager.get('router:intelligence:database');
            if (routerData) {
                this.routerDatabase = JSON.parse(routerData);
                this.logInfo(`[Monitor] 🧠 Loaded ${Object.keys(this.routerDatabase).length} known routers.`);
            } else {
                this.routerDatabase = {};
                this.logInfo('[Monitor] No router database found, starting empty.');
            }
        } catch (error) {
            this.logWarn('[Monitor] Warning loading router database:', error.message);
            this.routerDatabase = {};
        }
    }

    async loadActiveTraders() {
        this.logInfo("[Monitor] 🧠 Loading active traders from REDIS as Single Source of Truth...");
        try {
            // Get all user IDs from the permanent database
            const allUsers = await this.dataManager.loadUsers();
            const allActiveWallets = new Set();
            
            // For each user, get their active trader list from Redis
            for (const user of Object.values(allUsers)) {
                // Fetch the list of ACTIVE TRADER NAMES from Redis
                const activeTraderNames = await this.redisManager.getActiveTraders(user.chat_id.toString());

                if (activeTraderNames && activeTraderNames.length > 0) {
                    this.logInfo(`[Monitor] Found ${activeTraderNames.length} active traders for user ${user.chat_id}: ${activeTraderNames.join(', ')}`);
                    
                    // Get all traders for this user from the DB to find their wallets
                    // Use user.id (internal ID) not user.chat_id
                     const allUserTraders = await this.dataManager.getTraders(user.id);
                     this.logInfo(`[Monitor] Loaded ${allUserTraders.length} total traders from DB for user ${user.id}`);
                     
                     for (const traderName of activeTraderNames) {
                         const traderInfo = allUserTraders.find(t => t.name === traderName);
                         if (traderInfo && traderInfo.wallet) {
                             allActiveWallets.add(traderInfo.wallet);
                             this.logInfo(`[Monitor] ✅ Added trader ${traderName} with wallet ${traderInfo.wallet}`);
                             
                             // PRE-SYNC trader names to Redis for ultra-fast lookup
                             await this.syncTraderNameToRedis(traderName, traderInfo.wallet);
                         } else {
                             this.logWarn(`[Monitor] ⚠️ Trader ${traderName} not found in DB or missing wallet`);
                         }
                     }
                } else {
                    this.logInfo(`[Monitor] No active traders found for user ${user.chat_id}`);
                }
            }
            
            this.activeTraders = Array.from(allActiveWallets).map(walletAddress => ({ walletAddress }));
            this.logInfo(`[Monitor] ✅ Loaded ${this.activeTraders.length} unique active trader wallets from Redis.`);
            this.logInfo(`[Monitor] ⚡ Pre-synced ${this.activeTraders.length} trader names to Redis for instant lookup.`);

        } catch(error) {
             this.logError("CRITICAL FAILURE loading traders from Redis.", { error: error.message, stack: error.stack});
             this.activeTraders = []; // Safety reset
        }
    }

    setupMessageHandlers() {
        this.registerHandler('REFRESH_SUBSCRIPTIONS', this.handleRefreshSubscriptions.bind(this));
        this.registerHandler('TRADER_ADDED', this.handleTraderAdded.bind(this));
        this.registerHandler('TRADER_STARTED', this.handleTraderStarted.bind(this));
    }

    async handleMessage(message) {
        const handler = this.messageHandlers.get(message.type);
        if (handler) {
            await handler(message);
            } else {
            await super.handleMessage(message);
        }
    }

    async handleRefreshSubscriptions(message) {
        this.logInfo('🔄 Received REFRESH_SUBSCRIPTIONS - reloading active traders and restarting monitoring...');
        try {
            // Reload active traders from Redis
            await this.loadActiveTraders();
            
            // Restart monitoring with updated trader list
            await this.startMonitoring();
            
            this.logInfo('✅ Successfully refreshed subscriptions with updated trader list');
        } catch (error) {
            this.logError('❌ Failed to refresh subscriptions:', error);
        }
    }

    async handleTraderAdded(message) {
        this.logInfo(`🆕 Received TRADER_ADDED - syncing new trader to Redis: ${message.traderName}`);
        try {
            // Get trader info from database
            const allUsers = await this.dataManager.loadUsers();
            for (const user of Object.values(allUsers)) {
                if (user.chat_id.toString() === message.chatId) {
                    const allUserTraders = await this.dataManager.getTraders(user.id);
                    const traderInfo = allUserTraders.find(t => t.name === message.traderName);
                    
                    if (traderInfo && traderInfo.wallet) {
                        // Sync the new trader name to Redis immediately
                        await this.syncTraderNameToRedis(message.traderName, traderInfo.wallet);
                        this.logInfo(`✅ New trader synced to Redis: ${message.traderName} (${traderInfo.wallet})`);
                    } else {
                        this.logWarn(`⚠️ New trader ${message.traderName} not found in database or missing wallet`);
                    }
                    break;
                }
            }
        } catch (error) {
            this.logError(`❌ Failed to sync new trader ${message.traderName} to Redis:`, error);
        }
    }

    async handleTraderStarted(message) {
        this.logInfo(`🚀 Received TRADER_STARTED - syncing activated trader to Redis: ${message.traderName}`);
        try {
            // Get trader info from database
            const allUsers = await this.dataManager.loadUsers();
            for (const user of Object.values(allUsers)) {
                if (user.chat_id.toString() === message.chatId) {
                    const allUserTraders = await this.dataManager.getTraders(user.id);
                    const traderInfo = allUserTraders.find(t => t.name === message.traderName);
                    
                    if (traderInfo && traderInfo.wallet) {
                        // Sync the activated trader name to Redis immediately
                        await this.syncTraderNameToRedis(message.traderName, traderInfo.wallet);
                        this.logInfo(`✅ Activated trader synced to Redis: ${message.traderName} (${traderInfo.wallet})`);
                    } else {
                        this.logWarn(`⚠️ Activated trader ${message.traderName} not found in database or missing wallet`);
                    }
                    break;
                }
            }
        } catch (error) {
            this.logError(`❌ Failed to sync activated trader ${message.traderName} to Redis:`, error);
        }
    }

    // Method for LaserStream to get active trader wallets
    getMasterTraderWallets() {
        return this.activeTraders.map(trader => trader.walletAddress);
    }

    // Helper function to sync a specific trader name to Redis
    async syncTraderNameToRedis(traderName, walletAddress) {
        try {
            await this.redisManager.set(`trader_name:${walletAddress}`, traderName, 3600); // 1 hour TTL
            this.logInfo(`[REDIS-SYNC] ⚡ Synced trader name to Redis: ${traderName} (${walletAddress})`);
        } catch (error) {
            this.logWarn(`[REDIS-SYNC] ❌ Failed to sync trader name to Redis: ${traderName}`, error.message);
        }
    }

    // Helper function to get trader name from wallet address - ULTRA-FAST Redis lookup
    async getTraderNameFromWallet(walletAddress) {
        try {
            // ULTRA-FAST: Try Redis lookup first (instant)
            const traderName = await this.redisManager.get(`trader_name:${walletAddress}`);
            if (traderName) {
                this.logInfo(`[TRADER-LOOKUP] ⚡ INSTANT Redis lookup: ${traderName} (${walletAddress})`);
                return traderName;
            }
            
            // Fallback: Load from JSON and sync to Redis for future lookups
            this.logInfo(`[TRADER-LOOKUP] 🔍 Redis miss, loading from JSON for wallet: ${walletAddress}`);
            
            const traders = await this.dataManager.readJsonFile('traders.json');
            if (!traders?.traders) {
                this.logWarn(`[TRADER-LOOKUP] ⚠️ No traders data found in JSON file`);
                return 'Unknown';
            }

            // Search through all users and traders to find the name
            for (const [userId, userTraders] of Object.entries(traders.traders)) {
                for (const [name, trader] of Object.entries(userTraders)) {
                    if (trader.wallet === walletAddress) {
                        // SYNC TO REDIS for instant future lookups
                        await this.syncTraderNameToRedis(name, walletAddress);
                        this.logInfo(`[TRADER-LOOKUP] ✅ Found & synced to Redis: ${name} (${walletAddress})`);
                        return name;
                    }
                }
            }
            
            this.logWarn(`[TRADER-LOOKUP] ❌ No trader found with wallet ${walletAddress}`);
            return 'Unknown';
        } catch (error) {
            this.logWarn(`[TRADER-LOOKUP] ❌ Error getting trader name for wallet ${walletAddress}:`, error.message);
            return 'Unknown';
        }
    }

    async startMonitoring() {
        if (this.laserstreamManager && this.laserstreamManager.isConnected()) {
            this.logWarn('LaserStreamManager is already connected. Forcing restart to apply latest trader list...');
            await this.laserstreamManager.stop();
        }

        // --- THIS IS THE FIX ---
        // 1. ALWAYS get a fresh, authoritative list of traders directly from the database and Redis.
        await this.loadActiveTraders();

        // 2. Use THIS fresh list (this.activeTraders) to build the subscription.
        const walletAddresses = this.activeTraders.map(t => t.walletAddress);

        if (walletAddresses.length === 0) {
            this.logWarn('No active traders to monitor. Standing by.');
            // We can also ensure the stream is stopped if there are no traders.
            if (this.laserstreamManager) await this.laserstreamManager.stop();
            
            // CRITICAL FIX: If no traders found, wait a bit and try again
            // This handles the race condition where telegram worker hasn't synced yet
            this.logInfo('🔄 No traders found - waiting 5 seconds for telegram worker to sync...');
            setTimeout(async () => {
                await this.loadActiveTraders();
                const retryWallets = this.activeTraders.map(t => t.walletAddress);
                if (retryWallets.length > 0) {
                    this.logInfo(`📡 Retry: Starting LaserStream gRPC subscription for ${retryWallets.length} active trader wallets...`);
                    await this.laserstreamManager.startMonitoring(retryWallets);
                } else {
                    this.logWarn('🔄 Retry: Still no active traders found after waiting.');
                }
            }, 5000);
            return;
        }

        this.logInfo(`📡 Starting LaserStream gRPC subscription for ${walletAddresses.length} active trader wallets...`);

        // 3. Pass the fresh, validated list directly to the LaserStream manager.
        try {
            await this.laserstreamManager.startMonitoring(walletAddresses);
            this.logInfo('✅ LaserStream monitoring started successfully');
        } catch (error) {
            this.logError('❌ Failed to start LaserStream monitoring:', error.message);
            // Retry after a delay
            setTimeout(async () => {
                this.logInfo('🔄 Retrying LaserStream connection...');
                try {
        await this.laserstreamManager.startMonitoring(walletAddresses);
                    this.logInfo('✅ LaserStream monitoring started successfully on retry');
                } catch (retryError) {
                    this.logError('❌ LaserStream retry failed:', retryError.message);
                }
            }, 10000); // Retry after 10 seconds
        }
    }

  // =================================================================
    // =========== TREASURE HUNTER (BATTLE-TESTED) ====================
    // =================================================================
    // This version intelligently finds the correct transaction object,
    // regardless of how deeply it is nested by Helius.
    getCoreTransaction(updateObject) {
        let current = updateObject;
        let metaObject = null;
        let messageObject = null;
        
        // Search for meta and message at different levels
        for (let i = 0; i < 5; i++) { // Max 5 levels deep search
            if (current && current.meta && !metaObject) metaObject = current.meta;
            if (current && current.message && !messageObject) messageObject = current.message;
            if (current && current.transaction) current = current.transaction;
            else break;
        }
        
        if (metaObject && messageObject) {
            return { message: messageObject, meta: metaObject };
        }
        return null;
    }


    // =======================================================================
    // ====== HANDLE TRADER ACTIVITY (v8 - FINALIZED PIPELINE) ===============
    // =======================================================================
    async handleTraderActivity(sourceWallet, signature, transactionUpdate) {
        try {
            const signatureString = bs58.encode(signature);

            // BATTLE-TESTED: Use the Treasure Hunter to find the real core transaction data.
            const coreTx = this.getCoreTransaction(transactionUpdate.transaction);

            // Early exit if the transaction is incomplete, failed, or a vote.
            if (!coreTx || !coreTx.meta || !coreTx.message || coreTx.meta.err) {
                return;
            }
            
            // =======================================================================
            // ====== CORRECT FLOW: Let Golden Peeling decide! =====================
            // =======================================================================
            
            // Basic pre-filter: Check for SOL/Token balance changes
            const hasBalanceChanges = this._hasSignificantBalanceChanges(coreTx);
            
            if (hasBalanceChanges) {
                this.logInfo(`[MONITOR] ✅ Potential trade detected from ${shortenAddress(sourceWallet)} | Sig: ${shortenAddress(signatureString)} - Passing to Golden Peeling`);
                
                // Perform analysis here to provide results to executor
                let analysisResult = null;
                if (this.universalAnalyzer) {
                    try {
                        // Pass the full transactionUpdate structure, not just coreTx
                        // UniversalAnalyzer expects the full LaserStream response structure
                        analysisResult = await this.universalAnalyzer.analyzeTransaction(transactionUpdate, sourceWallet);
                        this.logInfo(`[MONITOR] ✅ Analysis completed: ${analysisResult?.isCopyable ? 'COPYABLE' : 'NOT COPYABLE'}`);
                    } catch (analyzerError) {
                        this.logWarn('[MONITOR] ⚠️ Universal analyzer error:', analyzerError.message);
                    }
                }
                
                // Pass to executor for Golden Peeling analysis WITH analysis results
                this.signalMessage('EXECUTE_COPY_TRADE', {
                    traderWallet: sourceWallet, 
                    signature: signatureString,
                    detectionTimestamp: Date.now(),
                    parsedInfo: null, 
                    preFetchedTxData: transactionUpdate,  // ✅ Pass the original LaserStream data
                    analysisResult: analysisResult  // ✅ Pass the analysis results
                });
            } else {
                // Only log if it's not a simple fee payment
                const isSimpleFeePayment = this._isSimpleFeePayment(coreTx);
                if (!isSimpleFeePayment) {
                    console.log(`[MONITOR] ⚠️ No significant balance changes from ${shortenAddress(sourceWallet)} | Sig: ${shortenAddress(signatureString)}`);
                }
            }

        } catch (error) {
            const sigForError = (typeof signature !== 'undefined' && signature) ? bs58.encode(signature) : 'unknown_sig';
            this.logError('Error in Unified Trader Activity Handler:', { error: error.message, signature: sigForError });
        }
    }

    // Helper: Check for significant balance changes (SOL or tokens)
    _hasSignificantBalanceChanges(coreTx) {
        if (!coreTx.meta || !coreTx.meta.preBalances || !coreTx.meta.postBalances) {
            return false;
        }

        const preBalances = coreTx.meta.preBalances;
        const postBalances = coreTx.meta.postBalances;
        
        // Check for SOL balance changes (using config threshold)
        for (let i = 0; i < preBalances.length; i++) {
            const balanceChange = postBalances[i] - preBalances[i];
            if (Math.abs(balanceChange) > 100000) { // More than 0.0001 SOL (matches config)
                return true;
            }
        }

        // Check for token balance changes
        if (coreTx.meta.preTokenBalances && coreTx.meta.postTokenBalances) {
            const preTokens = coreTx.meta.preTokenBalances;
            const postTokens = coreTx.meta.postTokenBalances;
            
            // If token balances exist, it's likely a trade
            if (preTokens.length > 0 || postTokens.length > 0) {
                return true;
            }
        }

        return false;
    }

    // Helper: Check if it's just a simple fee payment
    _isSimpleFeePayment(coreTx) {
        if (!coreTx.meta || !coreTx.meta.preBalances || !coreTx.meta.postBalances) {
            return false;
        }

        const preBalances = coreTx.meta.preBalances;
        const postBalances = coreTx.meta.postBalances;
        
        // Count significant balance changes
        let significantChanges = 0;
        for (let i = 0; i < preBalances.length; i++) {
            const balanceChange = postBalances[i] - preBalances[i];
            if (Math.abs(balanceChange) > 100000) { // More than 0.0001 SOL (matches config)
                significantChanges++;
            }
        }

        // If only 1-2 accounts have significant changes, it's likely just a fee payment
        return significantChanges <= 2;
    }


    updateMonitoringStats(notification) {
        try {
            const accounts = notification.transaction?.message?.accountKeys?.map(acc =>
                typeof acc === 'string' ? acc : acc.pubkey?.toString() || acc.toString()
            ) || [];

            let platform = 'Unknown';

            for (const programId of accounts) {
                if (this.routerDatabase[programId]) {
                    platform = this.routerDatabase[programId].platform;
                    break;
                }
                if (programId.includes('JUP')) platform = 'Jupiter';
                else if (programId.includes('RAY')) platform = 'Raydium';
                else if (programId.includes('PUMP')) platform = 'Pump.fun';
                else if (programId.includes('METEORA')) platform = 'Meteora';
            }

            this.monitoringStats.transactionsByPlatform[platform] = (this.monitoringStats.transactionsByPlatform[platform] || 0) + 1;

            if (this.monitoringStats.totalTransactions % 10 === 0) {
                this.logMonitoringStats();
            }
        } catch (error) {
            this.logWarn('Failed to update monitoring stats:', error.message);
        }

    }

    logMonitoringStats() {
        this.logInfo('\n[Monitor] Performance Statistics:');
        this.logInfo(`Total Transactions: ${this.monitoringStats.totalTransactions}`);
        this.logInfo('By Platform:');
        for (const [platform, count] of Object.entries(this.monitoringStats.transactionsByPlatform)) {
            this.logInfo(`   ${platform}: ${count}`);
        }
        this.logInfo(`Last Refresh: ${new Date(this.monitoringStats.lastRefresh).toLocaleTimeString()}`);
        this.logInfo('----------------------------------------\n');
    }

    startPerformanceMonitoring() {
        setInterval(async () => {
            if (this.laserstreamManager && (!this.laserstreamManager.streamStatus || this.laserstreamManager.streamStatus !== 'connected')) {
                this.logWarn('LaserStream is not connected. Attempting restart...');
                
                // Reload traders first to ensure we have the latest list
                await this.loadActiveTraders();
                const walletAddresses = this.activeTraders.map(t => t.walletAddress);
                
                if (walletAddresses.length > 0) {
                    try {
                        await this.laserstreamManager.startMonitoring(walletAddresses);
                        this.logInfo('✅ LaserStream reconnected successfully during health check');
                    } catch (e) {
                        this.logError('Error restarting LaserStream during health check:', e.message);
                    }
                } else {
                    this.logWarn('No active traders found during health check - skipping LaserStream restart');
                }
            }
        }, 30000); // check every 30 seconds

        setInterval(async () => {
            this.logInfo('Scheduled refresh started (trader list & subscriptions)');
            await this.loadActiveTraders();
            await this.loadRouterDatabase();
            const walletAddresses = this.activeTraders.map(t => t.walletAddress);
            await this.laserstreamManager.startMonitoring(walletAddresses);
            this.monitoringStats.lastRefresh = Date.now();
        }, 5 * 60 * 1000); // every 5 minutes
    }

    // Handle raw transaction data for cloning
    async handleRawTransaction(transactionData) {
        try {
            this.logInfo(`[RAW-TX] 📡 Processing raw transaction from LaserStream`);
            
            // Get the raw transaction data
            const rawTransaction = transactionData.rawTransaction;
            
            if (!rawTransaction) {
                this.logWarn('[RAW-TX] ⚠️ No raw transaction data received');
            return;
        }

            // Log transaction detection
            this.logInfo(`[RAW-TX] ✅ Raw transaction detected and ready for cloning`);
            
            // Save raw transaction data for debugging
            if (this.transactionLogger && transactionData.signature) {
                try {
                    const debugData = {
                        signature: transactionData.signature,
                        timestamp: new Date().toISOString(),
                        rawTransaction: rawTransaction,
                        accountKeys: transactionData.accountKeys,
                        dexPrograms: transactionData.dexPrograms,
                        source: transactionData.source,
                        programIds: transactionData.programIds
                    };
                    
                    this.transactionLogger.logTransactionAnalysis(transactionData.signature, debugData);
                    this.logInfo(`[RAW-TX] 💾 Transaction saved for debugging: ${transactionData.signature}`);
                } catch (saveError) {
                    this.logWarn('[RAW-TX] ⚠️ Failed to save transaction for debugging:', saveError.message);
                }
            }
            
            // Update monitoring stats
            this.monitoringStats.totalTransactions++;
            
            // Send to universal analyzer for processing (if available)
            let analysisResult = null;
            if (this.universalAnalyzer) {
                try {
                    // Find the trader wallet from the account keys (first monitored wallet found)
                    const traderWallet = transactionData.accountKeys?.find(key => 
                        this.activeTraderWallets && this.activeTraderWallets.has(key)
                    ) || transactionData.source;
                    
                    analysisResult = await this.universalAnalyzer.analyzeTransaction(rawTransaction, traderWallet);
                    this.logInfo(`[RAW-TX] ✅ Analysis completed: ${analysisResult?.isCopyable ? 'COPYABLE' : 'NOT COPYABLE'}`);
                    
                    // Save analysis result for debugging
                    if (this.transactionLogger && transactionData.signature && analysisResult) {
                        try {
                            this.transactionLogger.logTransactionAnalysis(
                                `${transactionData.signature}_analysis`, 
                                {
                                    signature: transactionData.signature,
                                    timestamp: new Date().toISOString(),
                                    analysisResult: analysisResult,
                                    traderWallet: traderWallet,
                                    logType: 'analysis_result'
                                }
                            );
                        } catch (analysisSaveError) {
                            this.logWarn('[RAW-TX] ⚠️ Failed to save analysis result:', analysisSaveError.message);
                        }
                    }
                } catch (analyzerError) {
                    this.logWarn('[RAW-TX] ⚠️ Universal analyzer error:', analyzerError.message);
                }
            }
            
            // Send to universal cloning logger (if available)
            if (this.universalCloningLogger) {
                try {
                    await this.universalCloningLogger.logTransactionAnalysis({
                        rawTransaction: rawTransaction,
                        timestamp: transactionData.timestamp,
                        source: transactionData.source
                    });
                } catch (loggerError) {
                    this.logWarn('[RAW-TX] ⚠️ Cloning logger error:', loggerError.message);
                }
            }
            
            // Get trader name from wallet address
            const traderName = await this.getTraderNameFromWallet(transactionData.source);
            
            // Send transaction to executor worker for processing (with pre-analyzed data!)
            this.signalMessage('EXECUTE_COPY_TRADE', {
                rawTransaction: rawTransaction,
                timestamp: transactionData.timestamp,
                source: transactionData.source,
                traderName: traderName,
                traderWallet: transactionData.source,
                dexPrograms: transactionData.dexPrograms || [],
                signature: transactionData.signature,
                preFetchedTxData: rawTransaction, // Raw transaction data
                analysisResult: analysisResult // Pre-completed analysis results!
            });
            
        } catch (error) {
            this.logError('[RAW-TX] ❌ Error handling raw transaction:', error);
        }
    }
    
    // REMOVED: Handle copy trade detection (using Monitor → Executor flow instead)
    // async handleCopyTradeDetected(tradeData) {
    //     try {
    //         this.logInfo(`🎯 SWAP DETECTED: ${tradeData.signature}`);
    //         
    //         // Send to universal analyzer for cloning
    //         if (this.universalAnalyzer) {
    //             await this.universalAnalyzer.analyzeTransaction(tradeData.rawData, tradeData.accountKeys[0]);
    //         }
    //         
    //         // Send to universal cloning logger
    //         if (this.universalCloningLogger) {
    //             await this.universalCloningLogger.logCloningAttempt(tradeData);
    //         }
    //         
    //     } catch (error) {
    //         this.logError('Error handling copy trade:', error);
    //     }
    // }


    async customCleanup() {
       
        if (this.laserstreamManager) {
            await this.laserstreamManager.stop();
            this.logInfo('LaserStreamManager connection closed.');
        }
        if (this.solanaManager) {
            await this.solanaManager.close();
            this.logInfo('SolanaManager connection closed.');
        }
        clearTimeout(this.reconnectTimer);
        if (this.redisManager) await this.redisManager.close();
        if (this.dataManager) await this.dataManager.shutdown();
    }
}

if (require.main === module) {
    const worker = new TraderMonitorWorker();
    worker.initialize().catch(error => {
        console.error('Trader monitor worker failed to initialize:', error);
        process.exit(1);
    });

    const shutdown = async () => {
        console.log('Shutdown signal received');
        await worker.customCleanup();
        process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
    process.on('uncaughtException', async error => {
        console.error('Uncaught exception:', error);
        await shutdown();
    });
}

// Add the missing method that laserstreamManager needs
TraderMonitorWorker.prototype.getMasterTraderWallets = function() {
    return Array.from(this.activeTraders.map(trader => trader.walletAddress));
};

module.exports = TraderMonitorWorker;    