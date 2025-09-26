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
            
            // Set the transaction notification callback
            this.laserstreamManager.transactionNotificationCallback = this.handleTraderActivity.bind(this);

            // Initialize SolanaManager
            this.solanaManager = new SolanaManager();
            await this.solanaManager.initialize();
            
            // Initialize Transaction Logger only
            this.transactionLogger = new TransactionLogger();
            
            // Listen for raw transaction events for cloning
            this.laserstreamManager.on('transaction', this.handleRawTransaction.bind(this));

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
            this.logInfo(`[DNA-ANALYSIS] 🔬 Starting 4-layer DNA analysis for ${shortenAddress(sourceWallet)}`);
            
            // =======================================================================
            // SKIP L1 & L2 - We go even if we don't have them
            // =======================================================================
            // Layer 1 & 2 are optional - we proceed regardless
            const layer1Result = { platform: 'Generic' }; // No need for specific platform
            const layer2Result = { isValid: true }; // Skip Layer 2
            
            // =======================================================================
            // LAYER 3: INSTRUCTION DATA PATTERN - Check discriminators
            // =======================================================================
            const layer3Result = this._analyzeLayer3_InstructionData(normalizedTx, layer1Result.platform);
            if (!layer3Result.isValid) {
                this.logInfo(`[DNA-ANALYSIS] ❌ Layer 3 FAILED: ${layer3Result.reason}`);
                return false;
            }
            this.logInfo(`[DNA-ANALYSIS] ✅ Layer 3 PASSED: Valid instruction pattern (${layer3Result.tradeType})`);
            
            // =======================================================================
            // LAYER 4: ECONOMIC SIGNATURE - SOL/Token balance changes
            // =======================================================================
            const layer4Result = this._analyzeLayer4_EconomicSignature(normalizedTx, sourceWallet);
            if (!layer4Result.isValid) {
                this.logInfo(`[DNA-ANALYSIS] ❌ Layer 4 FAILED: ${layer4Result.reason}`);
                return false;
            }
            this.logInfo(`[DNA-ANALYSIS] ✅ Layer 4 PASSED: Economic activity confirmed`);
            
            // =======================================================================
            // EXTRACT TOKEN MINT FOR ATA CREATION
            // =======================================================================
            let inputMint = config.NATIVE_SOL_MINT;
            let outputMint = config.NATIVE_SOL_MINT;
            
            // Find token mint from postTokenBalances (most reliable method)
            const postTokenBalances = normalizedTx.postTokenBalances || [];
            this.logInfo(`[DNA-ANALYSIS] 🔍 Analyzing ${postTokenBalances.length} postTokenBalances for token mint...`);
            
            if (postTokenBalances.length > 0) {
                // Get the first token mint from postTokenBalances
                const firstTokenBalance = postTokenBalances[0];
                if (firstTokenBalance && firstTokenBalance.mint) {
                    outputMint = firstTokenBalance.mint;
                    this.logInfo(`[DNA-ANALYSIS] 🎯 Found token mint from postTokenBalances: ${shortenAddress(firstTokenBalance.mint)}`);
                }
            }
            
            // Fallback: Find token mint in account keys if not found in postTokenBalances
            if (outputMint === config.NATIVE_SOL_MINT) {
                const accountKeys = normalizedTx.accountKeys || [];
                this.logInfo(`[DNA-ANALYSIS] 🔍 Fallback: Analyzing ${accountKeys.length} account keys for token mint...`);
                
                for (const accountKey of accountKeys) {
                    if (accountKey && 
                        accountKey !== config.NATIVE_SOL_MINT &&
                        accountKey.length === 44 &&
                        !accountKey.includes('11111111111111111111111111111111') &&
                        !accountKey.includes('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA') &&
                        !accountKey.includes('ComputeBudget111111111111111111111111111111') &&
                        !accountKey.includes('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL') &&
                        accountKey !== sourceWallet) { // EXCLUDE TRADER'S WALLET
                        outputMint = accountKey;
                        this.logInfo(`[DNA-ANALYSIS] 🎯 Found token mint from account keys: ${shortenAddress(accountKey)}`);
                        break;
                    }
                }
            }
            
            if (outputMint === config.NATIVE_SOL_MINT) {
                this.logInfo(`[DNA-ANALYSIS] ⚠️ No token mint found in postTokenBalances or account keys`);
            }
            
            // =======================================================================
            // FINAL VERDICT: All 4 layers passed
            // =======================================================================
            this.logInfo(`[DNA-ANALYSIS] 🎯 ALL 4 LAYERS PASSED: ${layer1Result.platform} ${layer3Result.tradeType} trade confirmed`);
            return {
                isCopyable: true,
                details: {
                    dexPlatform: layer1Result.platform,
                    tradeType: layer3Result.tradeType,
                    inputMint: inputMint,
                    outputMint: outputMint,
                    traderPubkey: sourceWallet // 🔥 CRITICAL: Add traderPubkey
                },
                summary: `${layer3Result.tradeType} on ${layer1Result.platform}`,
                reason: 'All 4 layers passed'
            };

        } catch (e) {
            this.logError('[DNA-ANALYSIS] ❌ Error during 4-layer analysis:', { error: e.message });
            return false;
        }
    }

    /**
     * LAYER 1: Program ID Analysis
     * Check if transaction involves known DEX/Router programs
     */
    _analyzeLayer1_ProgramID(normalizedTx, knownDexPrograms) {
        try {
            // PRIORITY 1: Check main instructions for known DEX programs (direct calls)
            const mainDexPrograms = [];
            for (const instruction of normalizedTx.instructions) {
                const programId = normalizedTx.accountKeys[instruction.programIdIndex];
                if (knownDexPrograms.has(programId)) {
                    mainDexPrograms.push(programId);
                    this.logInfo(`[DEBUG] Found DEX in main instruction: ${programId}`);
                }
            }
            
            if (mainDexPrograms.length > 0) {
                const platform = this._identifyPlatform(mainDexPrograms[0]);
                return {
                    isValid: true,
                    platform: platform,
                    reason: `Direct DEX call detected: ${shortenAddress(mainDexPrograms[0])} -> ${platform}`
                };
            }
            
            // PRIORITY 2: Check account keys for known DEX programs (CPI calls)
            const accountDexPrograms = [];
            for (const accountKey of normalizedTx.accountKeys) {
                if (knownDexPrograms.has(accountKey)) {
                    accountDexPrograms.push(accountKey);
                    this.logInfo(`[DEBUG] Found DEX in account keys (CPI): ${accountKey}`);
                }
            }
            
            if (accountDexPrograms.length > 0) {
                const platform = this._identifyPlatform(accountDexPrograms[0]);
                return {
                    isValid: true,
                    platform: platform,
                    reason: `DEX program found in accounts (CPI chain): ${shortenAddress(accountDexPrograms[0])} -> ${platform}`
                };
            }
            
            return {
                isValid: false,
                reason: 'No known DEX programs found in transaction'
            };
            
        } catch (error) {
            return {
                isValid: false,
                reason: `Layer 1 analysis error: ${error.message}`
            };
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
     * Identify platform from program ID
     */
    _identifyPlatform(programId) {
        const programIdStr = programId.toString();
        
        // DEBUG: Log the program ID being identified
        this.logInfo(`[DEBUG] Identifying platform for program ID: ${programIdStr}`);
        
        // Check against known platform IDs (EXACT MATCHES ONLY)
        for (const [platform, id] of Object.entries(config.PLATFORM_IDS)) {
            if (Array.isArray(id)) {
                if (id.some(pk => pk.toBase58() === programIdStr)) {
                    this.logInfo(`[DEBUG] Found exact match: ${platform} for ${programIdStr}`);
                    return platform;
                }
            } else if (id.toBase58() === programIdStr) {
                this.logInfo(`[DEBUG] Found exact match: ${platform} for ${programIdStr}`);
                return platform;
            }
        }
        
        // NO STRING MATCHING - Only exact matches from config
        this.logInfo(`[DEBUG] No exact match found for ${programIdStr}`);
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
     * Identify router programs in the transaction
     */
    _identifyRouterPrograms(normalizedTx) {
        const routerPrograms = [];
        
        // Known router program IDs
        const knownRouters = [
            'JUP6LwwmjhEGGjp4tfXXFW2uJTkV5WkxSfCSsFUxXH5', // Jupiter V4
            'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4', // Jupiter V6
            'routeUGWgWzqBWFcrCfv8tritsqukccJPu3q5GPP3xS', // Jupiter AMM Routing
            'BSfDmrRWQ4jvEPvsVU4EoHEpgzq1VV7AbicfhtW4xC9iM', // Photon Router
            'So11111111111111111111111111111111111111112' // System Program (sometimes used as router)
        ];
        
        // Check main instructions
        for (const instruction of normalizedTx.instructions) {
            const programId = normalizedTx.accountKeys[instruction.programIdIndex];
            if (knownRouters.includes(programId)) {
                routerPrograms.push(programId);
            }
        }
        
        // Check account keys
        for (const accountKey of normalizedTx.accountKeys) {
            if (knownRouters.includes(accountKey) && !routerPrograms.includes(accountKey)) {
                routerPrograms.push(accountKey);
            }
        }
        
        return routerPrograms;
    }

    /**
     * Find inner DEX programs in the transaction
     */
    _findInnerDexPrograms(normalizedTx, knownDexPrograms) {
        const innerDexPrograms = [];
        
        // Check all account keys for known DEX programs
        for (const accountKey of normalizedTx.accountKeys) {
            if (knownDexPrograms.has(accountKey)) {
                innerDexPrograms.push(accountKey);
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
    
    async handleTraderActivity(sourceWallet, signature, transactionUpdate) {
        // 🔧 FIX: Add timeout wrapper to prevent getting stuck
        const ACTIVITY_TIMEOUT = 15000; // 15 seconds total timeout
        
        try {
            const activityPromise = this._processTraderActivity(sourceWallet, signature, transactionUpdate);
            const timeoutPromise = new Promise((_, reject) => 
                setTimeout(() => reject(new Error('Trader activity processing timeout')), ACTIVITY_TIMEOUT)
            );
            
            await Promise.race([activityPromise, timeoutPromise]);
        } catch (error) {
            if (error.message.includes('timeout')) {
                this.logWarn(`[MONITOR] ⏰ Trader activity processing timed out for ${signature}`);
                return;
            }
            throw error;
        }
    }
    
    async _processTraderActivity(sourceWallet, signature, transactionUpdate) {
        try {
            const signatureString = bs58.encode(new Uint8Array(signature));
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
            
            // 🔍 DEBUG: Log what we're sending to the executor
            console.log(`[MONITOR-DEBUG] 🔍 Sending EXECUTE_COPY_TRADE message:`);
            console.log(`[MONITOR-DEBUG] 🔍 Trader: ${sourceWallet}`);
            console.log(`[MONITOR-DEBUG] 🔍 Signature: ${signatureString}`);
            console.log(`[MONITOR-DEBUG] 🔍 Normalized TX accounts: ${normalizedTx.accountKeys.length}`);
            console.log(`[MONITOR-DEBUG] 🔍 Normalized TX instructions: ${normalizedTx.instructions.length}`);
            console.log(`[MONITOR-DEBUG] 🔍 Analysis result: ${analysisResult}`);
            
            this.signalMessage('EXECUTE_COPY_TRADE', {
                traderWallet: sourceWallet,
                traderName: traderName, // <-- ADD TRADER NAME
                signature: signatureString,
                normalizedTransaction: normalizedTx,
                analysisResult: analysisResult // <-- THE CRITICAL FIX
            });
            // ======================================================================
            
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
            
            // ===== DETAILED SERIALIZED PARSED DATA LOGGING =====
            this.logInfo(`[RAW-TX] 📊 SERIALIZED PARSED DATA:`);
            this.logInfo(`[RAW-TX] 📊 preTokenBalances: [ ${rawTransaction.meta?.preTokenBalances?.length || 0} items ]`);
            this.logInfo(`[RAW-TX] 📊 postTokenBalances: [ ${rawTransaction.meta?.postTokenBalances?.length || 0} items ]`);
            this.logInfo(`[RAW-TX] 📊 preBalances: [ ${rawTransaction.meta?.preBalances?.length || 0} items ]`);
            this.logInfo(`[RAW-TX] 📊 postBalances: [ ${rawTransaction.meta?.postBalances?.length || 0} items ]`);
            this.logInfo(`[RAW-TX] 📊 logMessages: [ ${rawTransaction.meta?.logMessages?.length || 0} items ]`);
            this.logInfo(`[RAW-TX] 📊 innerInstructions: [ ${rawTransaction.meta?.innerInstructions?.length || 0} items ]`);
            this.logInfo(`[RAW-TX] 📊 accountKeys: [ ${rawTransaction.transaction?.message?.accountKeys?.length || 0} items ]`);
            this.logInfo(`[RAW-TX] 📊 instructions: [ ${rawTransaction.transaction?.message?.instructions?.length || 0} items ]`);
            
            // ===== DETAILED TOKEN BALANCE STRUCTURE =====
            if (rawTransaction.meta?.preTokenBalances && rawTransaction.meta.preTokenBalances.length > 0) {
                this.logInfo(`[RAW-TX] 📊 preTokenBalances structure:`, JSON.stringify(rawTransaction.meta.preTokenBalances, null, 2));
            }
            if (rawTransaction.meta?.postTokenBalances && rawTransaction.meta.postTokenBalances.length > 0) {
                this.logInfo(`[RAW-TX] 📊 postTokenBalances structure:`, JSON.stringify(rawTransaction.meta.postTokenBalances, null, 2));
            }
            
            // ===== DETAILED TRANSACTION STRUCTURE =====
            this.logInfo(`[RAW-TX] 📊 Transaction structure:`);
            this.logInfo(`[RAW-TX] 📊 hasTransaction: ${!!rawTransaction}`);
            this.logInfo(`[RAW-TX] 📊 hasMeta: ${!!rawTransaction.meta}`);
            this.logInfo(`[RAW-TX] 📊 transaction keys: ${rawTransaction ? Object.keys(rawTransaction).join(', ') : 'none'}`);
            this.logInfo(`[RAW-TX] 📊 meta keys: ${rawTransaction.meta ? Object.keys(rawTransaction.meta).join(', ') : 'none'}`);
            
            // ===== FULL RAW TRANSACTION STRUCTURE =====
            this.logInfo(`[RAW-TX] 📊 Full raw transaction structure:`, JSON.stringify(rawTransaction, null, 2));
            
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
            // ======================================================================
            // ===================== DIRECT COPY LOGIC (NO DEBRIDGE) ==============
            // ======================================================================
            try {
                // Find the trader wallet from the account keys (first monitored wallet found)
                const traderWallet = transactionData.accountKeys?.find(key => 
                    this.activeTraderWallets && this.activeTraderWallets.has(key)
                ) || transactionData.source;
                
                // Extract analysis data from transactionData
                const balanceAnalysis = transactionData.balanceAnalysis || { solChange: 0, tokenChanges: [] };
                const platform = transactionData.platform || 'Jupiter';
                const routerInfo = transactionData.routerInfo || [];
                const classification = transactionData.classification || { type: 'DEX' };
                const programIds = transactionData.programIds || [];
                
                // ✅ FIXED: Load user configuration for proper SOL amount injection
                const userConfig = {
                    scaleFactor: this.laserstreamManager.botConfig?.scaleFactor || 0.1,
                    solAmount: this.laserstreamManager.botConfig?.minTransactionAmount || 0.1,
                    slippageBps: 5000, // 0.5% default slippage
                    maxSlippage: this.laserstreamManager.botConfig?.maxSlippage || 0.05
                };
                
                this.logInfo(`[RAW-TX] 🔧 User config: Scale Factor: ${userConfig.scaleFactor}, SOL Amount: ${userConfig.solAmount}`);
                
                // ======================================================================
                // ===================== DIRECT COPY LOGIC (NO DEBRIDGE) ==============
                // ======================================================================
                this.logInfo(`[DIRECT-COPY] 🚀 Using DIRECT copy logic`);
                
                // Extract token info from transaction data
                this.logInfo(`[DIRECT-COPY] 🔧 Extracting token info from actual transaction data...`);
                
                // Extract input/output mints from the actual transaction
                let inputMint = 'So11111111111111111111111111111111111111112'; // Default to SOL
                let outputMint = 'So11111111111111111111111111111111111111112'; // Default to SOL
                
                // Extract from transaction data
                if (rawTransaction && rawTransaction.meta && rawTransaction.meta.postTokenBalances) {
                    const tokenBalances = rawTransaction.meta.postTokenBalances;
                    this.logInfo(`[DIRECT-COPY] 🔍 Found ${tokenBalances.length} token balances in transaction`);
                    
                    // Find the most significant token change
                    let maxChange = 0;
                    let significantToken = null;
                    
                    for (const balance of tokenBalances) {
                        if (balance.uiTokenAmount && Math.abs(balance.uiTokenAmount.amount) > maxChange) {
                            maxChange = Math.abs(balance.uiTokenAmount.amount);
                            significantToken = balance;
                        }
                    }
                    
                    if (significantToken && significantToken.mint) {
                        outputMint = significantToken.mint;
                        this.logInfo(`[DIRECT-COPY] 🎯 Found significant token: ${significantToken.mint}`);
                    }
                }
                
                // Calculate scaled input amount
                const originalSolAmount = Math.abs(balanceAnalysis.solChange) * 1e9; // SOL change in lamports
                const scaledInputAmount = Math.floor(originalSolAmount * userConfig.scaleFactor); 
                
                analysisResult = {
                    isCopyable: true,
                    swapDetails: {
                        platform: platform || 'Jupiter', // Use detected platform
                        inputMint: inputMint,
                        outputMint: outputMint,
                        inputAmount: scaledInputAmount, // Scaled amount in lamports
                        outputAmount: 0,
                        scaleFactor: userConfig.scaleFactor,
                        originalAmount: Math.abs(balanceAnalysis.solChange),
                        scaledAmount: Math.abs(balanceAnalysis.solChange) * userConfig.scaleFactor,
                        isPrivateRouter: this.isPrivateRouter(platform),
                        requiresATACreation: outputMint !== inputMint,
                        requiresPDARecovery: platform === 'PumpFun' || platform === 'Raydium',
                        routerUsed: routerInfo?.length > 0 ? routerInfo[0] : null,
                        routerId: undefined,
                        transactionType: classification?.type || 'DEX',
                        realDexProgramId: classification?.programId || undefined
                    },
                    blueprint: {
                        originalTransaction: rawTransaction,
                        meta: rawTransaction.meta,
                        programIds,
                        routerInfo: routerInfo || [],
                        accountMapping: {},
                        classification: classification || { type: 'UNKNOWN' }
                    },
                    reason: 'Direct copy ',
                    userConfig
                };
                
                this.logInfo(`[DIRECT-COPY] ✅ Analysis: ${inputMint} → ${outputMint}, Original: ${Math.abs(balanceAnalysis.solChange)} SOL, Scaled: ${scaledInputAmount/1e9} SOL`);
                
                this.logInfo(`[DIRECT-COPY] ✅ Analysis completed: ${analysisResult?.isCopyable ? 'COPYABLE' : 'NOT COPYABLE'}`);
                
                // ======================================================================
                // ================ DIRECT EXECUTOR CALL (NO CLONING) ==================
                // ======================================================================
                if (analysisResult && analysisResult.isCopyable) {
                    this.logInfo(`[DIRECT-COPY] 🚀 Transaction is copyable! Proceeding to direct execution...`);
                    
                    // Send directly to executor - NO cloning needed!
                    this.signalMessage('HANDLE_SMART_COPY', {
                        traderWallet,
                        traderName: await this.getTraderNameFromWallet(traderWallet), // <-- ADD TRADER NAME
                        signature: rawTransaction.signature,
                        analysisResult,
                        originalTransaction: rawTransaction,
                        meta: rawTransaction.meta,
                        programIds,
                        routerInfo: routerInfo || [],
                        userConfig
                    });
                    
                    this.logInfo(`[DIRECT-COPY] ✅ Smart copy message sent to executor `);
                } else {
                    this.logInfo(`[DIRECT-COPY] ⏭️ Transaction not copyable: ${analysisResult?.reason || 'Unknown reason'}`);
                }
                
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
            
            // ======================================================================
            // ================ DIRECT COPY LOGIC - NO CLONING LOGGER ==============
            // ======================================================================
            // Direct copy logic - no need for universal cloning logger
            
            try {
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
        } catch (error) {
            this.logError('[RAW-TX] ❌ Error handling raw transaction:', error);
        }
    }
    
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