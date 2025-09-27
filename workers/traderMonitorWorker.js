// =================================================================
// ===== traderMonitorWorker.js (Cleaned & LaserStream gRPC only) =====
// =================================================================

const BaseWorker = require('./templates/baseWorker');
const { DataManager } = require('../dataManager');
const { RedisManager } = require('../redis/redisManager');
const { SolanaManager } = require('../solanaManager');
const { PublicKey } = require('@solana/web3.js');
const TransactionLogger = require('../transactionLogger.js');
const config = require('../config.js');
const bs58 = require('bs58');
const { shortenAddress } = require('../utils');
const { LaserStreamManager } = require('../laserstreamManager'); // gRPC LaserStream
const { quickMap } = require('../map.js');

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
        
        // =======================================================================
        // ====== CACHING SYSTEM - AVOID RE-PROCESSING ==========================
        // =======================================================================
        this.analysisCache = new Map(); // Cache analysis results
        this.cacheTimestamps = new Map(); // Cache timestamps for TTL
        this.CACHE_TTL = 30000; // 30 seconds cache TTL
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

            // Initialize LaserStreamManager (SIMPLE COPY BOT)
            this.laserstreamManager = new LaserStreamManager(
                this,  // Pass this worker directly
                config, 
                this.redisManager
            );
            
            // Load bot configuration and set it in LaserStreamManager
            await this.loadBotConfiguration();
            
            // Initialize SolanaManager
            this.solanaManager = new SolanaManager();
            await this.solanaManager.initialize();
            
            // Initialize Transaction Logger only
            this.transactionLogger = new TransactionLogger();
            
            // Set up the unified transaction handler (combines debugging + analysis)
            this.laserstreamManager.transactionNotificationCallback = this.handleUnifiedTransaction.bind(this);

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
    
    async loadBotConfiguration() {
        try {
            // Load settings from dataManager
            const settings = await this.dataManager.getSettings();
            
            const botConfig = {
                // Transaction scaling settings
                scaleFactor: settings.botSettings?.scaleFactor || 0.1,
                minTransactionAmount: settings.botSettings?.minSolAmount || 0.1,
                maxTransactionAmount: settings.botSettings?.maxSolAmount || 10.0,
                
                // ATA slicing settings
                enableATASlicing: settings.botSettings?.enableATASlicing || true,
                ataSliceOffset: settings.botSettings?.ataSliceOffset || 64,
                ataSliceLength: settings.botSettings?.ataSliceLength || 8,
                
                // Platform settings
                supportedPlatforms: settings.botSettings?.supportedPlatforms || ['PumpFun', 'Raydium', 'Jupiter', 'Meteora', 'Orca'],
                enableRouterDetection: settings.botSettings?.enableRouterDetection || true,
                
                // Risk management
                maxSlippage: settings.botSettings?.maxSlippage || 0.05,
                computeBudgetUnits: settings.botSettings?.computeBudgetUnits || 200000,
                computeBudgetFee: settings.botSettings?.computeBudgetFee || 0
            };
            
            // Set the configuration in LaserStreamManager
            this.laserstreamManager.setBotConfiguration(botConfig);
            
            this.logInfo(`✅ Bot configuration loaded: Scale Factor: ${botConfig.scaleFactor}, Min Amount: ${botConfig.minTransactionAmount} SOL`);
            
        } catch (error) {
            this.logError('❌ Error loading bot configuration:', error);
            // Use default configuration
            const defaultConfig = {
                scaleFactor: 0.1,
                minTransactionAmount: 0.1,
                maxTransactionAmount: 10.0,
                enableATASlicing: true,
                ataSliceOffset: 64,
                ataSliceLength: 8,
                supportedPlatforms: ['PumpFun', 'Raydium', 'Jupiter', 'Meteora', 'Orca'],
                enableRouterDetection: true,
                maxSlippage: 0.05,
                computeBudgetUnits: 200000,
                computeBudgetFee: 0
            };
            this.laserstreamManager.setBotConfiguration(defaultConfig);
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
        this.registerHandler('HANDLE_SMART_COPY', this.handleSmartCopy.bind(this));
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

    async handleSmartCopy(message) {
        try {
            this.logInfo(`[SMART-COPY] 🔧 Handling smart copy from LaserStream`);
            this.logInfo(`[SMART-COPY] 🔍 Trader: ${message.traderWallet}`);
            this.logInfo(`[SMART-COPY] 🔍 Signature: ${message.signature} (type: ${typeof message.signature})`);
            this.logInfo(`[SMART-COPY] 🔍 Signature length: ${message.signature ? message.signature.length : 'undefined'}`);
            this.logInfo(`[SMART-COPY] 🔍 Analysis result: ${message.analysisResult ? 'Present' : 'Missing'}`);
            
            // Forward to executor with proper data structure
            this.logInfo(`[SMART-COPY] 🔍 Sending to executor - Signature: ${message.signature} (type: ${typeof message.signature})`);
            this.logInfo(`[SMART-COPY] 🔍 Sending to executor - Signature length: ${message.signature ? message.signature.length : 'undefined'}`);
            
            this.signalMessage('HANDLE_SMART_COPY', {
                traderWallet: message.traderWallet,
                traderName: message.traderName, // <-- ADD TRADER NAME
                signature: message.signature,
                analysisResult: message.analysisResult,
                originalTransaction: message.originalTransaction,
                meta: message.meta,
                programIds: message.programIds,
                routerInfo: message.routerInfo,
                userConfig: message.userConfig,
                smartCopyMode: true
            });
            
            this.logInfo(`[SMART-COPY] ✅ Smart copy forwarded to executor`);
            
        } catch (error) {
            this.logError(`[SMART-COPY] ❌ Error handling smart copy: ${error.message}`);
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
            this.logInfo(`[TRADER-LOOKUP] 🔍 Looking up trader name for wallet: ${walletAddress}`);
            
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
    // ====== SMART GATEKEEPER - THE FINAL FILTER ============================
    // =======================================================================
    
    // =======================================================================
    // ====== 4-LAYER DNA ANALYSIS - GOLDEN FILTER ENHANCEMENT ==============
    // =======================================================================
    
    /**
     * 4-Layer DNA Analysis for Perfect Trade Detection
     * Layer 1: Program ID Check (DEX/Router identification)
     * Layer 2: Key Account Structure (Critical accounts present)
     * Layer 3: Instruction Data Pattern (Discriminator analysis)
     * Layer 4: Economic Signature (SOL/Token balance changes)
     */
    _isPotentiallyATrade(normalizedTx, sourceWallet, knownDexPrograms) {
        try {
            this.logInfo(`[DNA-ANALYSIS] 🔬 Starting analysis for ${shortenAddress(sourceWallet)}`);
            
            // =========================================================================
            // ======================== THE UPGRADE ====================================
            // =========================================================================
            // We replace the old Layer 1 analysis with our new, smart classifier.
            const classification = this._classifyTransactionPrograms(normalizedTx);
            
            const finalDex = classification.dex;
            const finalRouter = classification.router || 'Direct'; // If no router found, it's a direct call.

            this.logInfo(`[DNA-ANALYSIS] ✅ Program Analysis Complete: 🛣️ Router: ${finalRouter}, 🏢 DEX: ${finalDex || 'Unknown'}`);
            
            // If we couldn't find a real DEX, the trade is not copyable. This is a powerful filter.
            if (!finalDex) {
                this.logInfo(`[DNA-ANALYSIS] ❌ FAILED: Could not identify a known DEX destination. Ignoring transaction.`);
                return false;
            }
            // =========================================================================
            
            // The rest of the DNA analysis continues as before...
            const layer3Result = this._analyzeLayer3_InstructionData(normalizedTx, finalDex);
            if (!layer3Result.isValid) {
                this.logInfo(`[DNA-ANALYSIS] ❌ Layer 3 FAILED: ${layer3Result.reason}`);
                return false;
            }
            this.logInfo(`[DNA-ANALYSIS] ✅ Layer 3 PASSED: Valid instruction pattern (${layer3Result.tradeType})`);

            const layer4Result = this._analyzeLayer4_EconomicSignature(normalizedTx, sourceWallet);
            if (!layer4Result.isValid) {
                this.logInfo(`[DNA-ANALYSIS] ❌ Layer 4 FAILED: ${layer4Result.reason}`);
                return false;
            }
            this.logInfo(`[DNA-ANALYSIS] ✅ Layer 4 PASSED: Economic activity confirmed`);
            
            // Extract mints using the helper function
            const { inputMint, outputMint } = this._extractMintsFromAnalysis(layer4Result, normalizedTx);

            // =======================================================================
            // ==================== SLIPPAGE DETECTION ==============================
            // =======================================================================
            // Extract the master trader's slippage from their original instruction
            const masterTraderSlippageBps = this._extractMasterTraderSlippage(normalizedTx, finalDex, layer4Result);
            
            this.logInfo(`[DNA-ANALYSIS] 🎯 All layers PASSED. Final Verdict: ${finalDex} trade via ${finalRouter}.`);

            // Finally, we build the NEW, smarter analysis result
            return {
                isCopyable: true,
                swapDetails: {
                    platform: finalDex, // The REAL DEX
                    router: finalRouter, // The router used (or 'Direct')
                    tradeType: layer3Result.tradeType,
                    inputMint: inputMint,
                    outputMint: outputMint,
                    traderPubkey: sourceWallet,
                    originalAmount: Math.abs(layer4Result.solChange || 0) / 1e9, // Amount in SOL for logging
                    inputAmount: Math.abs(layer4Result.solChange || 0), // Raw amount in lamports for executor
                    requiresATACreation: outputMint !== config.NATIVE_SOL_MINT,
                    requiresPDARecovery: ['PumpFun', 'Raydium', 'Meteora', 'Orca', 'Jupiter'].includes(finalDex),
                    masterTraderSlippageBps: masterTraderSlippageBps // 🎯 THE ALPHA: Master's slippage tolerance
                },
                summary: `${layer3Result.tradeType} on ${finalDex} via ${finalRouter}`,
                reason: 'All layers passed with smart classification.'
            };

        } catch (e) {
            this.logError('[DNA-ANALYSIS] ❌ Error during 4-layer analysis:', { error: e.message });
            return false;
        }
    }

    /**
     * THE NEW, SMARTER "BOUNCER" - Router vs DEX Classification
     * Uses the new config structure to intelligently identify routers and DEXs
     */
    _classifyTransactionPrograms(normalizedTx) {
        const topLevelInstructions = normalizedTx.instructions;
        const accountKeys = normalizedTx.accountKeys;
        const logMessages = normalizedTx.logMessages.join(' '); // Join for easy searching

        let detectedRouter = null;
        let detectedDex = null;

        // Helper function to check a list of program IDs
        const findProgram = (programList, searchTarget, targetName) => {
            for (const [key, id] of Object.entries(programList)) {
                const idsToCheck = Array.isArray(id) ? id.map(pk => pk.toBase58()) : [id.toBase58()];
                if (idsToCheck.includes(searchTarget)) {
                    return { name: targetName || key.replace(/_/g, ''), id: searchTarget };
                }
            }
            return null;
        };

        // --- STEP 1: CHECK THE FRONT DOOR (Top-Level Instructions for Routers) ---
        // The highest priority is to identify the router being directly called.
        for (const instruction of topLevelInstructions) {
            const programId = accountKeys[instruction.programIdIndex];
            const router = findProgram(config.ROUTER_PROGRAM_IDS, programId, null);
            if (router) {
                detectedRouter = router.name;
                this.logInfo(`[BOUNCER] 🛣️  Router detected at front door: ${detectedRouter}`);
                break; // Found the primary router, stop searching.
            }
        }
        
        // --- STEP 2: LOOK INSIDE THE CAR (Inner Instructions & Logs for the DEX) ---
        // We search the entire context of the transaction for the real DEX.
        // Priority: Check logs first (most reliable), then account keys
        
        // First, check logs for DEX indicators (most reliable)
        if (!detectedDex) {
            // Special case: Check for Pump.fun specific log patterns first
            if (logMessages.includes('pump.fun') || logMessages.includes('Pump.fun') || 
                logMessages.includes('Program log: Instruction: Buy') || 
                logMessages.includes('Program log: Instruction: Sell')) {
                detectedDex = 'PUMPFUN';
                this.logInfo(`[BOUNCER] 🏢 DEX found in logs (Pump.fun specific): ${detectedDex}`);
            } else {
                // General DEX detection in logs
                for (const [key, id] of Object.entries(config.DEX_PROGRAM_IDS)) {
                    const idsToCheck = Array.isArray(id) ? id.map(pk => pk.toBase58()) : [id.toBase58()];
                    for(const dexId of idsToCheck){
                        if (logMessages.includes(dexId)){
                             detectedDex = key.replace(/_/g, '');
                             this.logInfo(`[BOUNCER] 🏢 DEX found in logs: ${detectedDex}`);
                             break;
                        }
                    }
                    if(detectedDex) break;
                }
            }
        }
        
        // If no DEX found in logs, check account keys
        if (!detectedDex) {
            for (const programId of accountKeys) {
                const dex = findProgram(config.DEX_PROGRAM_IDS, programId, null);
                if (dex) {
                    detectedDex = dex.name;
                    this.logInfo(`[BOUNCER] 🏢 DEX found in account keys: ${detectedDex}`);
                    break; // Found the first (and likely primary) DEX, stop searching.
                }
            }
        }

        this.logInfo(`[BOUNCER] 🎯 Final Classification: Router=${detectedRouter || 'None'}, DEX=${detectedDex || 'None'}`);

        return {
            router: detectedRouter,
            dex: detectedDex
        };
    }

    /**
     * LAYER 1: Program ID Analysis with Smart Bouncer
     * Uses the new classification system
     */
    _analyzeLayer1_ProgramID(normalizedTx, knownDexPrograms) {
        try {
            // =========================================================================
            // ======================== THE UPGRADE ====================================
            // =========================================================================
            // We replace the old Layer 1 analysis with our new, smart classifier.
            const classification = this._classifyTransactionPrograms(normalizedTx);
            
            const finalDex = classification.dex;
            const finalRouter = classification.router || 'Direct'; // If no router found, it's a direct call.

            this.logInfo(`[LAYER-1] ✅ Program Analysis Complete: 🛣️ Router: ${finalRouter}, 🏢 DEX: ${finalDex || 'Unknown'}`);
            
            // If we couldn't find a real DEX, the trade is not copyable. This is a powerful filter.
            if (!finalDex) {
                this.logInfo(`[LAYER-1] ❌ FAILED: Could not identify a known DEX destination. Ignoring transaction.`);
                return {
                    isValid: false,
                    reason: 'No known DEX destination found'
                };
            }
            
            return {
                isValid: true,
                platform: finalDex, // The REAL DEX
                router: finalRouter, // The router used (or 'Direct')
                reason: `Router ${finalRouter} → DEX ${finalDex}`
            };
            
        } catch (error) {
            return {
                isValid: false,
                reason: `Layer 1 analysis error: ${error.message}`
            };
        }
    }

    /**
     * Helper function to extract token mints from analysis
     */
    _extractMintsFromAnalysis(layer4Result, normalizedTx) {
        let inputMint = config.NATIVE_SOL_MINT;
        let outputMint = config.NATIVE_SOL_MINT;
        
        // Use the mints from Layer 4 analysis if available
        if (layer4Result.inputMint) {
            inputMint = layer4Result.inputMint;
        }
        if (layer4Result.outputMint) {
            outputMint = layer4Result.outputMint;
        }
        
        // Fallback: Find token mint from postTokenBalances
        if (outputMint === config.NATIVE_SOL_MINT) {
            const postTokenBalances = normalizedTx.postTokenBalances || [];
            if (postTokenBalances.length > 0) {
                const firstTokenBalance = postTokenBalances[0];
                if (firstTokenBalance && firstTokenBalance.mint) {
                    outputMint = firstTokenBalance.mint;
                    this.logInfo(`[MINT-EXTRACTION] 🎯 Found token mint from postTokenBalances: ${shortenAddress(firstTokenBalance.mint)}`);
                }
            }
        }
        
        return { inputMint, outputMint };
    }

    /**
     * 🎯 THE ALPHA: Extract Master Trader's Slippage from their original instruction
     * This is the professional way to copy their exact risk tolerance
     */
    _extractMasterTraderSlippage(normalizedTx, dexPlatform, layer4Result) {
        try {
            this.logInfo(`[SLIPPAGE-DETECTIVE] 🔍 Extracting master trader's slippage for ${dexPlatform}...`);
            
            // Find the real DEX instruction in the transaction
            const realDexInstruction = this._findRealDexInstruction(normalizedTx, dexPlatform);
            if (!realDexInstruction) {
                this.logInfo(`[SLIPPAGE-DETECTIVE] ⚠️ No DEX instruction found for ${dexPlatform}, using default slippage`);
                return null; // Will fall back to default
            }
            
            // Decode the instruction data using the appropriate Borsh schema
            const decodedArgs = this._decodeDexInstruction(realDexInstruction, dexPlatform);
            if (!decodedArgs) {
                this.logInfo(`[SLIPPAGE-DETECTIVE] ⚠️ Failed to decode instruction for ${dexPlatform}, using default slippage`);
                return null;
            }
            
            // Calculate slippage from the decoded arguments
            const slippageBps = this._calculateSlippageBps(decodedArgs, layer4Result);
            if (slippageBps !== null) {
                this.logInfo(`[SLIPPAGE-DETECTIVE] ✅ Master trader's slippage: ${slippageBps} bps (${(slippageBps/100).toFixed(2)}%)`);
                return slippageBps;
            }
            
            this.logInfo(`[SLIPPAGE-DETECTIVE] ⚠️ Could not calculate slippage for ${dexPlatform}, using default`);
            return null;
            
        } catch (error) {
            this.logWarn(`[SLIPPAGE-DETECTIVE] ❌ Error extracting slippage: ${error.message}`);
            return null;
        }
    }

    /**
     * Find the real DEX instruction in the transaction
     */
    _findRealDexInstruction(normalizedTx, dexPlatform) {
        try {
            // ==========================================================
            // ==================== THE FINAL FIX =======================
            // ==========================================================
            // The detective must search the BASEMENT (inner instructions) first,
            // as this is where the real action happens when routers are involved.

            if (normalizedTx.innerInstructions && normalizedTx.innerInstructions.length > 0) {
                for (const innerIx of normalizedTx.innerInstructions) {
                    for (const instruction of innerIx.instructions) {
                        const programId = normalizedTx.accountKeys[instruction.programIdIndex];
                        if (this._isDexProgram(programId, dexPlatform)) {
                            this.logInfo(`[SLIPPAGE-DETECTIVE] ✅ Found real DEX instruction in INNER instructions.`);
                            return instruction;
                        }
                    }
                }
            }
            
            // As a fallback, we can still check the top-level for direct calls.
            for (const instruction of normalizedTx.instructions) {
                const programId = normalizedTx.accountKeys[instruction.programIdIndex];
                if (this._isDexProgram(programId, dexPlatform)) {
                    this.logInfo(`[SLIPPAGE-DETECTIVE] ✅ Found real DEX instruction in TOP-LEVEL instructions.`);
                    return instruction;
                }
            }
            // ==========================================================
            
            this.logInfo(`[SLIPPAGE-DETECTIVE] ⚠️ No DEX instruction found for ${dexPlatform} in either inner or top-level instructions.`);
            return null;

        } catch (error) {
            this.logWarn(`[SLIPPAGE-DETECTIVE] ❌ Error finding DEX instruction: ${error.message}`);
            return null;
        }
    }

    /**
     * Check if a program ID matches the DEX platform
     */
    _isDexProgram(programId, dexPlatform) {
        try {
            // Map platform names to config keys
            const platformMapping = {
                'PUMPFUN': 'PUMP_FUN',
                'RAYDIUMCPMM': 'RAYDIUM_CPMM',
                'RAYDIUMV4': 'RAYDIUM_V4',
                'RAYDIUMCLMM': 'RAYDIUM_CLMM',
                'METEORA': 'METEORA_DLMM',
                'ORCA': 'WHIRLPOOL'
            };
            
            const configKey = platformMapping[dexPlatform] || dexPlatform;
            const dexPrograms = config.DEX_PROGRAM_IDS[configKey];
            
            if (!dexPrograms) {
                this.logInfo(`[SLIPPAGE-DETECTIVE] ⚠️ No DEX programs found for ${dexPlatform} (mapped to ${configKey})`);
                return false;
            }
            
            const programIdStr = programId.toString();
            
            // ==========================================================
            // ==================== THE FINAL FIX =======================
            // ==========================================================
            // For PumpFun, check against ALL known PumpFun program IDs
            if (dexPlatform === 'PUMPFUN') {
                const pumpFunIds = [
                    config.DEX_PROGRAM_IDS.PUMP_FUN.toBase58(),
                    config.DEX_PROGRAM_IDS.PUMP_FUN_AMM.toBase58(),
                    config.DEX_PROGRAM_IDS.PUMP_FUN_V2.toBase58()
                ];
                
                const isMatch = pumpFunIds.includes(programIdStr);
                if (isMatch) {
                    this.logInfo(`[SLIPPAGE-DETECTIVE] ✅ Found matching PumpFun program: ${programIdStr} for ${dexPlatform}`);
                }
                return isMatch;
            }
            // ==========================================================
            
            // Standard check for other DEXes
            const idsToCheck = Array.isArray(dexPrograms) ? dexPrograms.map(pk => pk.toBase58()) : [dexPrograms.toBase58()];
            
            const isMatch = idsToCheck.includes(programIdStr);
            if (isMatch) {
                this.logInfo(`[SLIPPAGE-DETECTIVE] ✅ Found matching DEX program: ${programIdStr} for ${dexPlatform}`);
            }
            
            return isMatch;
            
        } catch (error) {
            this.logWarn(`[SLIPPAGE-DETECTIVE] ❌ Error checking DEX program: ${error.message}`);
            return false;
        }
    }

    /**
     * Decode DEX instruction using appropriate Borsh schema
     */
    _decodeDexInstruction(instruction, dexPlatform) {
        try {
            if (!instruction.data || instruction.data.length === 0) {
                this.logInfo(`[SLIPPAGE-DETECTIVE] ⚠️ No instruction data for ${dexPlatform}`);
                return null;
            }
            
            this.logInfo(`[SLIPPAGE-DETECTIVE] 🔧 Decoding ${dexPlatform} instruction (${instruction.data.length} bytes)`);
            
            // Handle different DEX platforms with their specific instruction formats
            switch (dexPlatform) {
                case 'PUMPFUN':
                    return this._decodePumpFunInstruction(instruction);
                case 'RAYDIUMCPMM':
                case 'RAYDIUMV4':
                case 'RAYDIUMCLMM':
                    return this._decodeRaydiumInstruction(instruction);
                case 'METEORA':
                    return this._decodeMeteoraInstruction(instruction);
                case 'ORCA':
                    return this._decodeOrcaInstruction(instruction);
                default:
                    this.logInfo(`[SLIPPAGE-DETECTIVE] ⚠️ Unknown DEX platform: ${dexPlatform}, using generic decoding`);
                    return this._decodeGenericInstruction(instruction);
            }
            
        } catch (error) {
            this.logWarn(`[SLIPPAGE-DETECTIVE] ❌ Error decoding instruction: ${error.message}`);
            return null;
        }
    }

    /**
     * Decode PumpFun instruction (Buy/Sell)
     */
    _decodePumpFunInstruction(instruction) {
        try {
            const data = instruction.data;
            if (data.length < 8) {
                this.logInfo(`[SLIPPAGE-DETECTIVE] ⚠️ PumpFun instruction too short: ${data.length} bytes`);
                return null;
            }
            
            // PumpFun instruction format (simplified):
            // Bytes 0-7: Discriminator (8 bytes)
            // Bytes 8-15: amount (u64) - tokens to buy/sell
            // Bytes 16-23: maxSolCost (u64) - max SOL willing to spend
            
            const discriminator = data.readUInt8(0);
            const amount = data.readBigUInt64LE(8);
            const maxSolCost = data.readBigUInt64LE(16);
            
            this.logInfo(`[SLIPPAGE-DETECTIVE] 🔧 PumpFun decoded: discriminator=${discriminator}, amount=${amount}, maxSolCost=${maxSolCost}`);
            
            return {
                amountIn: Number(amount),
                minimumAmountOut: Number(maxSolCost), // For PumpFun, this is the max SOL cost
                discriminator: discriminator
            };
            
        } catch (error) {
            this.logWarn(`[SLIPPAGE-DETECTIVE] ❌ Error decoding PumpFun instruction: ${error.message}`);
            return null;
        }
    }

    /**
     * Decode Raydium instruction
     */
    _decodeRaydiumInstruction(instruction) {
        try {
            const data = instruction.data;
            if (data.length < 17) {
                this.logInfo(`[SLIPPAGE-DETECTIVE] ⚠️ Raydium instruction too short: ${data.length} bytes`);
                return null;
            }
            
            // Raydium instruction format:
            // Byte 0: Discriminator (u8)
            // Bytes 1-8: amountIn (u64)
            // Bytes 9-16: minimumAmountOut (u64)
            
            const discriminator = data.readUInt8(0);
            const amountIn = data.readBigUInt64LE(1);
            const minimumAmountOut = data.readBigUInt64LE(9);
            
            this.logInfo(`[SLIPPAGE-DETECTIVE] 🔧 Raydium decoded: discriminator=${discriminator}, amountIn=${amountIn}, minimumAmountOut=${minimumAmountOut}`);
            
            return {
                amountIn: Number(amountIn),
                minimumAmountOut: Number(minimumAmountOut),
                discriminator: discriminator
            };
            
        } catch (error) {
            this.logWarn(`[SLIPPAGE-DETECTIVE] ❌ Error decoding Raydium instruction: ${error.message}`);
            return null;
        }
    }

    /**
     * Decode Meteora instruction
     */
    _decodeMeteoraInstruction(instruction) {
        try {
            // Meteora has different instruction formats, using generic approach for now
            this.logInfo(`[SLIPPAGE-DETECTIVE] 🔧 Meteora instruction decoding (placeholder)`);
            return this._decodeGenericInstruction(instruction);
            
        } catch (error) {
            this.logWarn(`[SLIPPAGE-DETECTIVE] ❌ Error decoding Meteora instruction: ${error.message}`);
            return null;
        }
    }

    /**
     * Decode Orca instruction
     */
    _decodeOrcaInstruction(instruction) {
        try {
            // Orca has complex instruction formats, using generic approach for now
            this.logInfo(`[SLIPPAGE-DETECTIVE] 🔧 Orca instruction decoding (placeholder)`);
            return this._decodeGenericInstruction(instruction);
            
        } catch (error) {
            this.logWarn(`[SLIPPAGE-DETECTIVE] ❌ Error decoding Orca instruction: ${error.message}`);
            return null;
        }
    }

    /**
     * Generic instruction decoding (fallback)
     */
    _decodeGenericInstruction(instruction) {
        try {
            const data = instruction.data;
            this.logInfo(`[SLIPPAGE-DETECTIVE] 🔧 Generic decoding for ${data.length} bytes`);
            
            // Try to extract basic information
            if (data.length >= 8) {
                const firstByte = data.readUInt8(0);
                return {
                    amountIn: 0, // Unknown format
                    minimumAmountOut: 0, // Unknown format
                    discriminator: firstByte
                };
            }
            
            return null;
            
        } catch (error) {
            this.logWarn(`[SLIPPAGE-DETECTIVE] ❌ Error in generic decoding: ${error.message}`);
            return null;
        }
    }

    /**
     * Calculate slippage in basis points from decoded instruction arguments
     */
    _calculateSlippageBps(decodedArgs, layer4Result) {
        try {
            if (!decodedArgs.amountIn || !decodedArgs.minimumAmountOut) {
                this.logInfo(`[SLIPPAGE-DETECTIVE] ⚠️ Missing amountIn or minimumAmountOut`);
                return null;
            }
            
            // For PumpFun, the slippage calculation is different
            // PumpFun uses maxSolCost as the maximum SOL willing to spend
            // We can estimate slippage based on the ratio of expected vs actual cost
            if (decodedArgs.discriminator !== undefined) {
                // This is likely a PumpFun instruction
                return this._calculatePumpFunSlippage(decodedArgs, layer4Result);
            }
            
            // Standard slippage calculation for other DEXes
            const slippagePercent = ((decodedArgs.amountIn - decodedArgs.minimumAmountOut) / decodedArgs.amountIn) * 100;
            const slippageBps = Math.round(slippagePercent * 100); // Convert to basis points
            
            // Sanity check: slippage should be reasonable (0-50%)
            if (slippageBps < 0 || slippageBps > 5000) {
                this.logInfo(`[SLIPPAGE-DETECTIVE] ⚠️ Unreasonable slippage: ${slippageBps} bps, using default`);
                return null;
            }
            
            return slippageBps;
            
        } catch (error) {
            this.logWarn(`[SLIPPAGE-DETECTIVE] ❌ Error calculating slippage: ${error.message}`);
            return null;
        }
    }

    /**
     * Calculate PumpFun-specific slippage
     */
    _calculatePumpFunSlippage(decodedArgs, layer4Result) {
        try {
            // For PumpFun, we estimate slippage based on the maxSolCost vs actual SOL change
            const actualSolChange = Math.abs(layer4Result.solChange || 0);
            const maxSolCost = decodedArgs.minimumAmountOut; // This is maxSolCost for PumpFun
            
            if (actualSolChange === 0 || maxSolCost === 0) {
                this.logInfo(`[SLIPPAGE-DETECTIVE] ⚠️ Cannot calculate PumpFun slippage: actualSolChange=${actualSolChange}, maxSolCost=${maxSolCost}`);
                return null;
            }
            
            // Calculate slippage as the difference between max cost and actual cost
            const slippagePercent = ((maxSolCost - actualSolChange) / maxSolCost) * 100;
            const slippageBps = Math.round(slippagePercent * 100);
            
            this.logInfo(`[SLIPPAGE-DETECTIVE] 🔧 PumpFun slippage: maxSolCost=${maxSolCost}, actualSolChange=${actualSolChange}, slippage=${slippageBps} bps`);
            
            // Sanity check: slippage should be reasonable (0-50%)
            if (slippageBps < 0 || slippageBps > 5000) {
                this.logInfo(`[SLIPPAGE-DETECTIVE] ⚠️ Unreasonable PumpFun slippage: ${slippageBps} bps, using default`);
                return null;
            }
            
            return slippageBps;
            
        } catch (error) {
            this.logWarn(`[SLIPPAGE-DETECTIVE] ❌ Error calculating PumpFun slippage: ${error.message}`);
            return null;
        }
    }

    /**
     * LAYER 2: Account Structure Analysis
     * Verify critical accounts are present for the detected platform
     */
    _analyzeLayer2_AccountStructure(normalizedTx, sourceWallet, platform) {
        try {
            // Check if source wallet is present
            if (!normalizedTx.accountKeys.includes(sourceWallet)) {
                return {
                    isValid: false,
                    reason: 'Source wallet not found in transaction accounts'
                };
            }
            
            // Platform-specific account structure checks
            if (platform === 'Pump.fun') {
                // Check for Pump.fun specific accounts
                const pumpFunFeeRecipient = config.PUMP_FUN_CONSTANTS.FEE_RECIPIENT.toBase58();
                const hasPumpFunFeeRecipient = normalizedTx.accountKeys.includes(pumpFunFeeRecipient);
                
                // Debug: Log account keys for Pump.fun analysis
                this.logInfo(`[DEBUG] Looking for Pump.fun fee recipient: ${pumpFunFeeRecipient}`);
                this.logInfo(`[DEBUG] Account keys count: ${normalizedTx.accountKeys.length}`);
                this.logInfo(`[DEBUG] First 5 account keys: ${normalizedTx.accountKeys.slice(0, 5).map(k => shortenAddress(k)).join(', ')}`);
                
                if (!hasPumpFunFeeRecipient) {
                    // For router-based Pump.fun trades, we might not have the fee recipient directly
                    // Check if this is a router transaction instead
                    const jupiterV4Id = config.PLATFORM_IDS.JUPITER.toBase58();
                    const jupiterV6Id = config.PLATFORM_IDS.JUPITER_V6.toBase58();
                    const jupiterAmmId = config.PLATFORM_IDS.JUPITER_AMM_ROUTING.toBase58();
                    
                    const hasJupiterV4 = normalizedTx.accountKeys.includes(jupiterV4Id);
                    const hasJupiterV6 = normalizedTx.accountKeys.includes(jupiterV6Id);
                    const hasJupiterAmm = normalizedTx.accountKeys.includes(jupiterAmmId);
                    const hasJupiter = hasJupiterV4 || hasJupiterV6 || hasJupiterAmm;
                    
                    this.logInfo(`[DEBUG] Checking for Jupiter routers:`);
                    this.logInfo(`[DEBUG] - Jupiter V4 (${jupiterV4Id}): ${hasJupiterV4}`);
                    this.logInfo(`[DEBUG] - Jupiter V6 (${jupiterV6Id}): ${hasJupiterV6}`);
                    this.logInfo(`[DEBUG] - Jupiter AMM (${jupiterAmmId}): ${hasJupiterAmm}`);
                    this.logInfo(`[DEBUG] Has any Jupiter: ${hasJupiter}`);
                    
                    if (hasJupiter) {
                        this.logInfo(`[DEBUG] Router-based Pump.fun trade detected - skipping fee recipient check`);
                        return {
                            isValid: true,
                            reason: 'Router-based Pump.fun trade (fee recipient handled by router)'
                        };
                    }
                    
                    return {
                        isValid: false,
                        reason: 'Pump.fun fee recipient not found'
                    };
                }
            } else if (platform === 'Raydium') {
                // Check for Raydium specific accounts (pools, etc.)
                // This is a simplified check - in production you'd check for pool accounts
                const hasSystemProgram = normalizedTx.accountKeys.includes(config.SYSTEM_PROGRAM_ID.toBase58());
                if (!hasSystemProgram) {
                    return {
                        isValid: false,
                        reason: 'System program not found (required for Raydium)'
                    };
                }
            } else if (platform === 'Meteora') {
                // Check for Meteora specific accounts
                const hasTokenProgram = normalizedTx.accountKeys.includes(config.TOKEN_PROGRAM_ID.toBase58());
                if (!hasTokenProgram) {
                    return {
                        isValid: false,
                        reason: 'Token program not found (required for Meteora)'
                    };
                }
            }
            
            return {
                isValid: true,
                reason: 'Critical accounts present for platform'
            };
            
        } catch (error) {
            return {
                isValid: false,
                reason: `Layer 2 analysis error: ${error.message}`
            };
        }
    }

    /**
     * LAYER 3: Instruction Data Pattern Analysis
     * Check discriminators and instruction patterns
     */
    _analyzeLayer3_InstructionData(normalizedTx, platform) {
        try {
            // Look for instruction data patterns in log messages first (easier to parse)
            const logMessages = normalizedTx.logMessages || [];
            
            // Check for trade-related log messages
            const hasTradeLogs = logMessages.some(log => 
                log.includes('Instruction: Buy') || 
                log.includes('Instruction: Sell') ||
                log.includes('Instruction: Swap') ||
                log.includes('Program log: Instruction: Buy') ||
                log.includes('Program log: Instruction: Sell')
            );
            
            if (hasTradeLogs) {
                // Determine trade type from logs
                let tradeType = 'buy'; // Default to buy if we have trade logs
                if (logMessages.some(log => log.includes('Buy'))) {
                    tradeType = 'buy';
                } else if (logMessages.some(log => log.includes('Sell'))) {
                    tradeType = 'sell';
                } else if (logMessages.some(log => log.includes('Swap'))) {
                    tradeType = 'swap';
                }
                
                return {
                    isValid: true,
                    tradeType: tradeType,
                    reason: `Valid instruction pattern detected: ${tradeType}`
                };
            }
            
            // Fallback: Check if we have instructions with data
            const hasInstructionData = normalizedTx.instructions.some(instruction => 
                instruction.data && instruction.data.length > 0
            );
            
            if (hasInstructionData) {
                return {
                    isValid: true,
                    tradeType: 'buy', // Default to buy for any transaction with instruction data
                    reason: 'Instruction data present, assuming buy trade'
                };
            }
            
            return {
                isValid: false,
                reason: 'No valid instruction patterns found'
            };
            
        } catch (error) {
            return {
                isValid: false,
                reason: `Layer 3 analysis error: ${error.message}`
            };
        }
    }

    /**
     * LAYER 4: Economic Signature Analysis
     * Verify SOL and token balance changes
     */
    _analyzeLayer4_EconomicSignature(normalizedTx, sourceWallet) {
        try {
            const traderIndex = normalizedTx.accountKeys.findIndex(key => key === sourceWallet);
            if (traderIndex === -1) {
                return {
                    isValid: false,
                    reason: 'Trader wallet not found in account keys'
                };
            }
            
            // Check SOL balance changes
            const solChange = normalizedTx.postBalances[traderIndex] - normalizedTx.preBalances[traderIndex];
            const hasSignificantSolChange = Math.abs(solChange) > 100000; // 0.0001 SOL minimum
            
            // Check token balance changes
            const tokenBalanceChanges = new Map();
            
            // Process pre-token balances
            normalizedTx.preTokenBalances.forEach(tb => {
                if (tb.owner === sourceWallet) {
                    const currentAmount = tokenBalanceChanges.get(tb.mint) || 0n;
                    tokenBalanceChanges.set(tb.mint, currentAmount - BigInt(tb.uiTokenAmount.amount));
                }
            });
            
            // Process post-token balances
            normalizedTx.postTokenBalances.forEach(tb => {
                if (tb.owner === sourceWallet) {
                    const currentAmount = tokenBalanceChanges.get(tb.mint) || 0n;
                    tokenBalanceChanges.set(tb.mint, currentAmount + BigInt(tb.uiTokenAmount.amount));
                }
            });
            
            // Check for significant token changes
            const hasSignificantTokenChange = Array.from(tokenBalanceChanges.values()).some(change => change !== 0n);
            
            if (hasSignificantSolChange || hasSignificantTokenChange) {
                // Extract input and output mints from token balance changes
                let inputMint = config.NATIVE_SOL_MINT;
                let outputMint = config.NATIVE_SOL_MINT;
                
                // Find the token that decreased (input) and increased (output)
                for (const [mint, change] of tokenBalanceChanges.entries()) {
                    if (change < 0n) {
                        inputMint = mint; // Token decreased (sold)
                    } else if (change > 0n) {
                        outputMint = mint; // Token increased (bought)
                    }
                }
                
                return {
                    isValid: true,
                    inputMint: inputMint,
                    outputMint: outputMint,
                    solChange: solChange,
                    reason: `Economic activity confirmed: SOL change: ${solChange} lamports, Token changes: ${hasSignificantTokenChange}`
                };
            }
            
            return {
                isValid: false,
                reason: 'No significant economic activity detected'
            };
            
        } catch (error) {
            return {
                isValid: false,
                reason: `Layer 4 analysis error: ${error.message}`
            };
        }
    }

    /**
     * Detect original platform intent by looking for specific indicators
     */
    _detectOriginalPlatformIntent(normalizedTx) {
        const logMessages = normalizedTx.logMessages || [];
        
        // Check for Pump.fun specific indicators
        for (const log of logMessages) {
            // Pump.fun specific log patterns
            if (log.includes('Program log: Instruction: Buy') || 
                log.includes('Program log: Instruction: Sell') ||
                log.includes('Program log: Instruction: Create') ||
                log.includes('pump.fun') ||
                log.includes('Pump.fun')) {
                return 'Pump.fun';
            }
            
            // Meteora specific patterns
            if (log.includes('Meteora') || log.includes('DLMM') || log.includes('DBC')) {
                return 'Meteora';
            }
            
            // Raydium specific patterns (but only if not inside router)
            if (log.includes('Raydium') && !log.includes('Jupiter')) {
                return 'Raydium';
            }
        }
        
        // Check account keys for Pump.fun program ID
        const pumpFunId = config.PLATFORM_IDS.PUMP_FUN.toBase58();
        if (normalizedTx.accountKeys.includes(pumpFunId)) {
            return 'Pump.fun';
        }
        
        return null; // No clear original intent detected
    }

    /**
     * Identify platform from program ID with Router vs DEX distinction
     */
    _identifyPlatform(programId) {
        const programIdStr = programId.toString();
        
        // DEBUG: Log the program ID being identified
        this.logInfo(`[DEBUG] Identifying platform for program ID: ${programIdStr}`);
        
        // ====== STEP 1: Check if it's a ROUTER (Aggregator) ======
        for (const [routerName, routerId] of Object.entries(config.ROUTER_PROGRAM_IDS)) {
            if (Array.isArray(routerId)) {
                if (routerId.some(pk => pk.toBase58() === programIdStr)) {
                    this.logInfo(`[DEBUG] 🛣️  ROUTER detected: ${routerName} for ${programIdStr}`);
                    return `Router:${routerName}`; // Mark as router
                }
            } else if (routerId.toBase58() === programIdStr) {
                this.logInfo(`[DEBUG] 🛣️  ROUTER detected: ${routerName} for ${programIdStr}`);
                return `Router:${routerName}`; // Mark as router
            }
        }
        
        // ====== STEP 2: Check if it's a REAL DEX ======
        for (const [dexName, dexId] of Object.entries(config.DEX_PROGRAM_IDS)) {
            if (Array.isArray(dexId)) {
                if (dexId.some(pk => pk.toBase58() === programIdStr)) {
                    this.logInfo(`[DEBUG] 🏢 REAL DEX detected: ${dexName} for ${programIdStr}`);
                    return dexName; // Real DEX platform
                }
            } else if (dexId.toBase58() === programIdStr) {
                this.logInfo(`[DEBUG] 🏢 REAL DEX detected: ${dexName} for ${programIdStr}`);
                return dexName; // Real DEX platform
            }
        }
        
        // NO MATCH FOUND
        this.logInfo(`[DEBUG] ❌ No match found for ${programIdStr}`);
        return 'Unknown';
    }

    // =======================================================================
    // ====== BASIC TRADE DETECTION - SIMPLE FILTER =========================
    // =======================================================================
    
    _isBasicTrade(normalizedTx, sourceWallet) {
        try {
            // Check if transaction has significant SOL change
            const traderIndex = normalizedTx.accountKeys.indexOf(sourceWallet);
            if (traderIndex === -1) return false;
            
            const solChange = normalizedTx.postBalances[traderIndex] - normalizedTx.preBalances[traderIndex];
            if (Math.abs(solChange) < 100000) return false; // Less than 0.0001 SOL
            
            // Check if transaction has multiple instructions (likely a trade)
            if (normalizedTx.instructions.length < 2) return false;
            
            // Check if transaction has token balance changes
            const hasTokenChanges = normalizedTx.preTokenBalances && normalizedTx.postTokenBalances;
            if (!hasTokenChanges) return false;
            
            this.logInfo(`[BASIC-FILTER] ✅ Potential trade detected: SOL change: ${solChange}, Instructions: ${normalizedTx.instructions.length}`);
            return true;
            
        } catch (error) {
            this.logError('[BASIC-FILTER] Error:', error.message);
            return false;
        }
    }

    // =======================================================================
    // ====== ROUTER PEELING LOGIC - FIND INNER DEX CALLS ===================
    // =======================================================================
    
    /**
     * Router Peeling: Drill down through router calls to find the real DEX
     * This handles cases where the outer instruction is a router but inner calls are DEXs
     */
    _performRouterPeeling(normalizedTx, knownDexPrograms) {
        try {
            this.logInfo(`[ROUTER-PEELING] 🔍 Starting router peeling analysis`);
            
            // Check if this is a router transaction
            const routerPrograms = this._identifyRouterPrograms(normalizedTx);
            if (routerPrograms.length === 0) {
                this.logInfo(`[ROUTER-PEELING] ✅ No router detected - direct DEX call`);
                return {
                    isRouter: false,
                    realDexProgram: null,
                    platform: null
                };
            }
            
            this.logInfo(`[ROUTER-PEELING] 🔍 Router detected: ${routerPrograms.map(p => shortenAddress(p)).join(', ')}`);
            
            // Look for inner DEX calls in the transaction
            const innerDexPrograms = this._findInnerDexPrograms(normalizedTx, knownDexPrograms);
            
            if (innerDexPrograms.length > 0) {
                const realDexProgram = innerDexPrograms[0];
                const platform = this._identifyPlatform(realDexProgram);
                
                this.logInfo(`[ROUTER-PEELING] ✅ Found inner DEX: ${platform} (${shortenAddress(realDexProgram)})`);
                
                return {
                    isRouter: true,
                    realDexProgram: realDexProgram,
                    platform: platform,
                    routerPrograms: routerPrograms
                };
            }
            
            // Check log messages for inner DEX activity
            const logDexPrograms = this._findDexInLogs(normalizedTx, knownDexPrograms);
            if (logDexPrograms.length > 0) {
                const realDexProgram = logDexPrograms[0];
                const platform = this._identifyPlatform(realDexProgram);
                
                this.logInfo(`[ROUTER-PEELING] ✅ Found DEX in logs: ${platform} (${shortenAddress(realDexProgram)})`);
                
                return {
                    isRouter: true,
                    realDexProgram: realDexProgram,
                    platform: platform,
                    routerPrograms: routerPrograms
                };
            }
            
            this.logInfo(`[ROUTER-PEELING] ⚠️ Router detected but no inner DEX found`);
            return {
                isRouter: true,
                realDexProgram: null,
                platform: null,
                routerPrograms: routerPrograms
            };
            
        } catch (error) {
            this.logError(`[ROUTER-PEELING] ❌ Error during router peeling:`, error.message);
            return {
                isRouter: false,
                realDexProgram: null,
                platform: null
            };
        }
    }

    /**
     * Identify router programs in the transaction using new config structure
     */
    _identifyRouterPrograms(normalizedTx) {
        const routerPrograms = [];
        
        // Get all router program IDs from config
        const knownRouters = [];
        for (const [routerName, routerId] of Object.entries(config.ROUTER_PROGRAM_IDS)) {
            if (Array.isArray(routerId)) {
                knownRouters.push(...routerId.map(id => id.toBase58()));
            } else {
                knownRouters.push(routerId.toBase58());
            }
        }
        
        this.logInfo(`[ROUTER-DETECTION] 🔍 Checking against ${knownRouters.length} known routers`);
        
        // Check main instructions
        for (const instruction of normalizedTx.instructions) {
            const programId = normalizedTx.accountKeys[instruction.programIdIndex];
            if (knownRouters.includes(programId)) {
                routerPrograms.push(programId);
                this.logInfo(`[ROUTER-DETECTION] 🛣️  Router found in instruction: ${programId}`);
            }
        }
        
        // Check account keys
        for (const accountKey of normalizedTx.accountKeys) {
            if (knownRouters.includes(accountKey) && !routerPrograms.includes(accountKey)) {
                routerPrograms.push(accountKey);
                this.logInfo(`[ROUTER-DETECTION] 🛣️  Router found in accounts: ${accountKey}`);
            }
        }
        
        return routerPrograms;
    }

    /**
     * Find inner DEX programs in the transaction using new config structure
     */
    _findInnerDexPrograms(normalizedTx, knownDexPrograms) {
        const innerDexPrograms = [];
        
        // Get all DEX program IDs from config
        const knownDexIds = [];
        for (const [dexName, dexId] of Object.entries(config.DEX_PROGRAM_IDS)) {
            if (Array.isArray(dexId)) {
                knownDexIds.push(...dexId.map(id => id.toBase58()));
            } else {
                knownDexIds.push(dexId.toBase58());
            }
        }
        
        this.logInfo(`[DEX-DETECTION] 🔍 Checking against ${knownDexIds.length} known DEX programs`);
        
        // Check all account keys for known DEX programs
        for (const accountKey of normalizedTx.accountKeys) {
            if (knownDexIds.includes(accountKey)) {
                innerDexPrograms.push(accountKey);
                this.logInfo(`[DEX-DETECTION] 🏢 Real DEX found: ${accountKey}`);
            }
        }
        
        return innerDexPrograms;
    }

    /**
     * Find DEX programs mentioned in log messages
     */
    _findDexInLogs(normalizedTx, knownDexPrograms) {
        const logDexPrograms = [];
        const logMessages = normalizedTx.logMessages || [];
        
        // Look for program IDs in log messages
        for (const logMessage of logMessages) {
            for (const [programId] of knownDexPrograms) {
                if (logMessage.includes(programId)) {
                    logDexPrograms.push(programId);
                }
            }
        }
        
        return logDexPrograms;
    }

    // =======================================================================
    // ====== CACHING SYSTEM - AVOID RE-PROCESSING ==========================
    // =======================================================================
    
    /**
     * Get cached analysis result if available and not expired
     */
    _getCachedAnalysis(signature) {
        try {
            const cacheKey = `analysis:${signature}`;
            const timestamp = this.cacheTimestamps.get(cacheKey);
            
            if (!timestamp) {
                return null; // No cache entry
            }
            
            const now = Date.now();
            if (now - timestamp > this.CACHE_TTL) {
                // Cache expired, remove it
                this.analysisCache.delete(cacheKey);
                this.cacheTimestamps.delete(cacheKey);
                return null;
            }
            
            const cachedResult = this.analysisCache.get(cacheKey);
            this.logInfo(`[CACHE] ✅ Cache HIT for ${shortenAddress(signature)} (${Math.round((now - timestamp) / 1000)}s old)`);
            return cachedResult;
            
        } catch (error) {
            this.logWarn(`[CACHE] ⚠️ Error getting cached analysis: ${error.message}`);
            return null;
        }
    }

    /**
     * Cache analysis result with timestamp
     */
    _cacheAnalysis(signature, analysisResult) {
        try {
            const cacheKey = `analysis:${signature}`;
            const timestamp = Date.now();
            
            this.analysisCache.set(cacheKey, analysisResult);
            this.cacheTimestamps.set(cacheKey, timestamp);
            
            this.logInfo(`[CACHE] 💾 Cached analysis for ${shortenAddress(signature)} (TTL: ${this.CACHE_TTL / 1000}s)`);
            
        } catch (error) {
            this.logWarn(`[CACHE] ⚠️ Error caching analysis: ${error.message}`);
        }
    }

    /**
     * Clear expired cache entries
     */
    _cleanupExpiredCache() {
        try {
            const now = Date.now();
            const expiredKeys = [];
            
            for (const [key, timestamp] of this.cacheTimestamps.entries()) {
                if (now - timestamp > this.CACHE_TTL) {
                    expiredKeys.push(key);
                }
            }
            
            expiredKeys.forEach(key => {
                this.analysisCache.delete(key);
                this.cacheTimestamps.delete(key);
            });
            
            if (expiredKeys.length > 0) {
                this.logInfo(`[CACHE] 🧹 Cleaned up ${expiredKeys.length} expired cache entries`);
            }
            
        } catch (error) {
            this.logWarn(`[CACHE] ⚠️ Error cleaning up cache: ${error.message}`);
        }
    }

    // =======================================================================
    // ====== HANDLE TRADER ACTIVITY (v9 - WITH SMART GATEKEEPER) ============
    // =======================================================================
    
    // =======================================================================
    // ====== UNIFIED TRANSACTION HANDLER (DEBUGGING + ANALYSIS) ============
    // =======================================================================
    async handleUnifiedTransaction(sourceWallet, signature, transactionUpdate) {
        try {
            console.log(`[MONITOR-BRAIN] 🧠 Analyzing transaction... Sig: ${shortenAddress(signature)}`);
            
            // --- PART 1: Rich Debugging (from handleRawTransaction) ---
            const coreTx = this.getCoreTransaction(transactionUpdate.transaction);
            if (!coreTx || !coreTx.meta || !coreTx.message || coreTx.meta.err) {
                this.logInfo(`[MONITOR-BRAIN] ⏭️ Transaction is malformed or failed. Ignoring.`);
                return; 
            }

            // Rich transaction structure logging
            this.logInfo(`[RAW-TX] 📊 SERIALIZED PARSED DATA:`);
            this.logInfo(`[RAW-TX] 📊 preTokenBalances: [ ${coreTx.meta?.preTokenBalances?.length || 0} items ]`);
            this.logInfo(`[RAW-TX] 📊 postTokenBalances: [ ${coreTx.meta?.postTokenBalances?.length || 0} items ]`);
            this.logInfo(`[RAW-TX] 📊 preBalances: [ ${coreTx.meta?.preBalances?.length || 0} items ]`);
            this.logInfo(`[RAW-TX] 📊 postBalances: [ ${coreTx.meta?.postBalances?.length || 0} items ]`);
            this.logInfo(`[RAW-TX] 📊 logMessages: [ ${coreTx.meta?.logMessages?.length || 0} items ]`);
            this.logInfo(`[RAW-TX] 📊 accountKeys: [ ${coreTx.message?.accountKeys?.length || 0} items ]`);
            this.logInfo(`[RAW-TX] 📊 instructions: [ ${coreTx.message?.instructions?.length || 0} items ]`);
            
            // --- PART 2: Deep Analysis (from _processTraderActivity) ---
            const analysisResult = await this._processTraderActivity(sourceWallet, signature, transactionUpdate);

            // --- PART 3: Final Decision (from handleTraderActivity) ---
            if (analysisResult && analysisResult.isCopyable) {
                
                const traderName = await this.getTraderNameFromWallet(sourceWallet);
                const platform = analysisResult.swapDetails?.platform || 'Unknown';
                const router = analysisResult.swapDetails?.router || 'Direct';
                
                console.log(`🚀 FORWARDING COPY TRADE from monitor to executor:`);
                console.log(`   🕺 Trader: ${traderName} (${shortenAddress(sourceWallet)})`);
                console.log(`   ✒️ Signature: ${shortenAddress(signature)}`);
                console.log(`   🏢 DEX: ${platform}`);
                console.log(`   🛣️  Router: ${router}`);
                console.log(`[MONITOR-BRAIN] ✅ Analysis complete. Target: ${platform}. Queuing execution.`);
                
                // ==========================================================
                // ==================== THE FINAL FIX =======================
                // ==========================================================
                // We create a PURIFIED, 100% JSON-safe message.
                // We manually copy ONLY the data we need. This strips away
                // all the dangerous, complex protobuf objects.
                const messagePayload = {
                    traderWallet: sourceWallet,
                    traderName: traderName,
                    signature: signature,
                    analysisResult: {
                        isCopyable: analysisResult.isCopyable,
                        swapDetails: {
                            platform: analysisResult.swapDetails.platform,
                            router: analysisResult.swapDetails.router,
                            tradeType: analysisResult.swapDetails.tradeType,
                            inputMint: analysisResult.swapDetails.inputMint,
                            outputMint: analysisResult.swapDetails.outputMint,
                            traderPubkey: analysisResult.swapDetails.traderPubkey,
                            originalAmount: analysisResult.swapDetails.originalAmount, // This is a number
                            inputAmount: analysisResult.swapDetails.inputAmount, // This is a number
                            requiresATACreation: analysisResult.swapDetails.requiresATACreation,
                            requiresPDARecovery: analysisResult.swapDetails.requiresPDARecovery,
                            masterTraderSlippageBps: analysisResult.swapDetails.masterTraderSlippageBps, // This is a number
                        },
                        summary: analysisResult.summary, // This is a string
                        reason: analysisResult.reason, // This is a string
                    }
                };
                
                console.log(`🚀 FORWARDING PURIFIED COPY TRADE to executor...`);
                this.signalMessage('EXECUTE_COPY_TRADE', messagePayload);
                // ==========================================================

            } else {
                console.log(`[MONITOR-BRAIN] ⏭️ Transaction did not pass analysis. Ignoring.`);
            }

        } catch (error) {
            this.logError('❌ Error in Unified Transaction Handler:', { error: error.message, stack: error.stack });
        }
    }
    
    async _processTraderActivity(sourceWallet, signature, transactionUpdate) {
        try {
            // Signature is already base58 encoded from laserstreamManager
            const signatureString = signature;
            const coreTx = this.getCoreTransaction(transactionUpdate.transaction);

            if (!coreTx || !coreTx.meta || !coreTx.message || coreTx.meta.err) {
                return; 
            }

            // =========================================================================
            // ======================= THE FINAL NORMALIZER ============================
            // =========================================================================
            // STEP 1: Get the static account keys listed directly in the transaction.
            let fullAccountList = coreTx.message.accountKeys.map(k => new PublicKey(k.pubkey || k));

            // STEP 2: CRITICAL ALT FIX - Check for and fetch accounts from lookup tables.
            const addressTableLookups = coreTx.message.addressTableLookups || coreTx.message.message?.addressTableLookups;
            if (addressTableLookups && this.solanaManager) {
                this.logInfo(`[NORMALIZER] Found ${addressTableLookups.length} ALT(s). Fetching full account list...`);
                for (const lookup of addressTableLookups) {
                    const altAccount = await this.solanaManager.fetchALTTable(lookup.accountKey);
                    if (altAccount) {
                        // Add the accounts from the lookup table to our full list.
                        fullAccountList.push(...altAccount.state.addresses);
                    }
                }
            }
            
            const fullAccountListStrings = fullAccountList.map(pk => pk.toBase58());
            this.logInfo(`[NORMALIZER] Built complete account list with ${fullAccountListStrings.length} accounts.`);
            
            // STEP 3: Create the Golden Record with the COMPLETE account list.
                        
            const normalizedTx = {
                signature: signatureString,
                sourceWallet: sourceWallet,
                isSuccess: (() => {
                    const err = coreTx.meta.err;
                    const isSuccess = err === null || err === undefined;
                    this.logInfo(`[DEBUG] coreTx.meta.err: ${JSON.stringify(err)}`);
                    this.logInfo(`[DEBUG] isSuccess calculation: ${isSuccess}`);
                    return isSuccess;
                })(),
                slot: transactionUpdate.slot,
                blockTime: transactionUpdate.blockTime,
                logMessages: coreTx.meta.logMessages || [],
                instructions: coreTx.message.instructions || [],
                innerInstructions: coreTx.meta.innerInstructions || [], // 🎯 THE ALPHA: Include inner instructions for Slippage Detective
                accountKeys: fullAccountListStrings, // Use the complete list
                preBalances: coreTx.meta.preBalances || [],
                postBalances: coreTx.meta.postBalances || [],
                preTokenBalances: coreTx.meta.preTokenBalances || [],
                postTokenBalances: coreTx.meta.postTokenBalances || [],
                // Include raw lookups for the analyzer, just in case
                addressTableLookups: addressTableLookups || []
            };

            // 🗺️ MAPPING: Show normalization process
            this.logInfo(`[MAPPING] 📥 RAW: ${coreTx.message.accountKeys?.length || 0} base accounts`);
            this.logInfo(`[MAPPING] 🔄 NORMALIZED: ${fullAccountListStrings.length} total accounts (including ALT)`);
            this.logInfo(`[MAPPING] 📋 Instructions: ${normalizedTx.instructions.length}`);
            
            // ===== DETAILED SERIALIZED PARSED DATA LOGGING =====
            this.logInfo(`[MAPPING] 📊 SERIALIZED PARSED DATA:`);
            this.logInfo(`[MAPPING] 📊 preTokenBalances: [ ${normalizedTx.preTokenBalances?.length || 0} items ]`);
            this.logInfo(`[MAPPING] 📊 postTokenBalances: [ ${normalizedTx.postTokenBalances?.length || 0} items ]`);
            this.logInfo(`[MAPPING] 📊 preBalances: [ ${normalizedTx.preBalances?.length || 0} items ]`);
            this.logInfo(`[MAPPING] 📊 postBalances: [ ${normalizedTx.postBalances?.length || 0} items ]`);
            this.logInfo(`[MAPPING] 📊 logMessages: [ ${normalizedTx.logMessages?.length || 0} items ]`);
            this.logInfo(`[MAPPING] 📊 instructions: [ ${normalizedTx.instructions?.length || 0} items ]`);
            this.logInfo(`[MAPPING] 📊 accountKeys: [ ${normalizedTx.accountKeys?.length || 0} items ]`);
            
            // ===== DETAILED TOKEN BALANCE STRUCTURE =====
            if (normalizedTx.preTokenBalances && normalizedTx.preTokenBalances.length > 0) {
                this.logInfo(`[MAPPING] 📊 preTokenBalances structure:`, JSON.stringify(normalizedTx.preTokenBalances, null, 2));
            }
            if (normalizedTx.postTokenBalances && normalizedTx.postTokenBalances.length > 0) {
                this.logInfo(`[MAPPING] 📊 postTokenBalances structure:`, JSON.stringify(normalizedTx.postTokenBalances, null, 2));
            }
            
            // ===== DETAILED TRANSACTION STRUCTURE =====
            this.logInfo(`[MAPPING] 📊 Transaction structure:`);
            this.logInfo(`[MAPPING] 📊 hasTransaction: ${!!normalizedTx}`);
            this.logInfo(`[MAPPING] 📊 hasMeta: ${!!normalizedTx.meta}`);
            this.logInfo(`[MAPPING] 📊 transaction keys: ${normalizedTx ? Object.keys(normalizedTx).join(', ') : 'none'}`);
            this.logInfo(`[MAPPING] 📊 meta keys: ${normalizedTx.meta ? Object.keys(normalizedTx.meta).join(', ') : 'none'}`);
            
            // ===== FULL NORMALIZED TRANSACTION STRUCTURE =====
            this.logInfo(`[MAPPING] 📊 Full normalized transaction structure:`, JSON.stringify(normalizedTx, null, 2));
            // =========================================================================

            // ===============================================
            // ======== NEW: DISCRIMINATOR PRE-FILTER ========
            // ===============================================
            // A quick check for known 'buy' or 'sell' discriminators in the logs.
            const hasKnownDiscriminator = (normalizedTx.logMessages || []).some(log => 
                log.includes('Program log: Instruction: Buy') || 
                log.includes('Program log: Instruction: Sell')
            );
            
            // If there's no known discriminator AND no significant economic change, it's probably junk.
            const traderIndex = normalizedTx.accountKeys.findIndex(key => key === sourceWallet);
            const solChange = traderIndex !== -1 ? 
                (normalizedTx.postBalances[traderIndex] - normalizedTx.preBalances[traderIndex]) : 0;
            
            if (!hasKnownDiscriminator && Math.abs(solChange) < 100000) {
                this.logInfo(`[PRE-FILTER] ❌ Blocked: No known trade discriminator and insignificant SOL change.`);
                return;
            }
            this.logInfo(`[PRE-FILTER] ✅ Passed: Transaction appears to be a legitimate economic event.`);
            // ===============================================

            // SIMPLIFIED: Just check if it's potentially a trade (basic filter)
            if (!this._isBasicTrade(normalizedTx, sourceWallet)) {
                return; 
            }

            // Get trader name for better logging
            const traderName = await this.getTraderNameFromWallet(sourceWallet);
            const displayName = traderName ? `${traderName} (${shortenAddress(sourceWallet)})` : shortenAddress(sourceWallet);
            
            this.logInfo(`[MONITOR] ✅ Potential trade detected for ${displayName}. Forwarding COMPLETE data.`);
            
            // ======================================================================
            // ======================== THE FINAL FIX ==============================
            // ======================================================================
            // We need to analyze the transaction here and pass the result to the executor
            // This prevents the "Cannot read properties of null" error in tradingEngine
            
            // =======================================================================
            // ====== CACHING INTEGRATION - AVOID RE-PROCESSING ===================
            // =======================================================================
            // PERFORM ANALYSIS IN MONITOR (as originally designed)
            const analysisResult = this._isPotentiallyATrade(normalizedTx, sourceWallet, this.knownDexPrograms);
            
            // ================================================================
            // ======================== THE FIX ===============================
            // ================================================================
            // The Analyst's ONLY job is to return its findings.
            // It does NOT send any messages itself.
            // DELETE all the `signalMessage` and `MONITOR-DEBUG` logs from this function.
            
            return analysisResult; // <-- The most important line.
            // ================================================================
            
        } catch (error) {
            const sigForError = (typeof signature !== 'undefined' && signature) ? bs58.encode(signature) : 'unknown_sig';
            this.logError('Error in Unified Trader Activity Handler:', { error: error.message, stack: error.stack, signature: sigForError });
        }
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

        // Cache cleanup every 2 minutes
        setInterval(() => {
            this._cleanupExpiredCache();
        }, 2 * 60 * 1000); // every 2 minutes
    }

    // REMOVED: handleRawTransaction function - merged into handleUnifiedTransaction
    
    // Helper method to check if platform is a private router
    isPrivateRouter(platform) {
        const privateRouters = ['BloomRouter', 'PrivateRouter', 'BLURRouter'];
        return privateRouters.includes(platform);
    }
    
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
} // <-- Closing the class definition

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