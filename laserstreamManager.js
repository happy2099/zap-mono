// File: laserstreamManager.js (PROFESSIONAL PLAN - LaserStream gRPC)
// Description: Advanced Helius LaserStream manager using gRPC for Professional plan users

const { subscribe, CommitmentLevel, decodeSubscribeUpdate } = require('helius-laserstream');
const { EventEmitter } = require('events');
const { PublicKey } = require('@solana/web3.js');
const config = require('./config.js');
const { shortenAddress } = require('./utils.js');
const bs58 = require('bs58');

// Universal recursive decoder for all binary data
function convertBuffers(obj) {
    if (!obj) return obj;
    
    if (Buffer.isBuffer(obj) || obj instanceof Uint8Array) {
        return bs58.encode(obj);
    }
    if (Array.isArray(obj)) {
        return obj.map(item => convertBuffers(item));
    }
    if (typeof obj === 'object') {
        return Object.fromEntries(
            Object.entries(obj).map(([key, value]) => [key, convertBuffers(value)])
        );
    }
    return obj;
}

// Extract SOL + token balance changes from decoded data
function analyzeBalances(meta, accountKeys) {
    let solChange = 0;
    const tokenChanges = [];
    
    // SOL changes (only count fee payer - index 0)
    if (meta.preBalances && meta.postBalances && meta.preBalances.length > 0) {
        const delta = meta.postBalances[0] - meta.preBalances[0];
        solChange = delta / 1e9; // Convert lamports to SOL
    }
    
    // Token changes
    const preTokenMap = new Map();
    const postTokenMap = new Map();
    
    // Map pre-token balances
    (meta.preTokenBalances || []).forEach(balance => {
        if (balance && balance.accountIndex !== undefined && balance.uiTokenAmount) {
            preTokenMap.set(balance.accountIndex, {
                mint: balance.mint,
                amount: parseFloat(balance.uiTokenAmount.uiAmountString || '0'),
                decimals: balance.uiTokenAmount.decimals
            });
        }
    });
    
    // Map post-token balances  
    (meta.postTokenBalances || []).forEach(balance => {
        if (balance && balance.accountIndex !== undefined && balance.uiTokenAmount) {
            postTokenMap.set(balance.accountIndex, {
                mint: balance.mint,
                amount: parseFloat(balance.uiTokenAmount.uiAmountString || '0'),
                decimals: balance.uiTokenAmount.decimals
            });
        }
    });
    
    // Calculate token changes
    const allIndices = new Set([...preTokenMap.keys(), ...postTokenMap.keys()]);
    allIndices.forEach(index => {
        const preBalance = preTokenMap.get(index) || { amount: 0, mint: '', decimals: 0 };
        const postBalance = postTokenMap.get(index) || { amount: 0, mint: '', decimals: 0 };
        
        if (preBalance.amount !== postBalance.amount) {
            const change = postBalance.amount - preBalance.amount;
            tokenChanges.push({
                accountIndex: index,
                mint: postBalance.mint || preBalance.mint,
                preAmount: preBalance.amount,
                postAmount: postBalance.amount,
                change: change,
                decimals: postBalance.decimals || preBalance.decimals
            });
        }
    });
    
    return {
        solChange,
        tokenChanges,
        significantChange: Math.abs(solChange) > 0.5 || tokenChanges.length > 0
    };
}

// Normalize transaction update with universal decoding
function normalizeTransaction(update) {
    if (!update.transaction) return null;
    
    // Decode all binary buffers to base58
    const decoded = convertBuffers(update.transaction);
    
    const tx = decoded.transaction;
    const meta = tx.meta || {};
    const message = tx.transaction?.message || {};
    const accountKeys = message.accountKeys || [];
    
    // Skip votes / failed transactions
    if (tx.isVote || meta.err !== null) {
        return null;
    }
    
    // Analyze balances
    const balanceAnalysis = analyzeBalances(meta, accountKeys);
    
    return {
        signature: tx.signature,
        slot: update.slot,
        success: meta.err === null,
        fee: meta.fee,
        computeUnits: meta.computeUnitsConsumed,
        message,
        meta,
        accountKeys,
        ...balanceAnalysis
    };
}

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
        // SIMPLE COPY BOT - No trading engine needed
        this.tradingEngine = null;
        
        this.stream = null;
        this.activeTraderWallets = new Set();
        this.streamStatus = 'idle';
        this.transactionNotificationCallback = null; // Callback for raw transaction notifications
        
        // 🔧 DUPLICATE DETECTION: Track processed signatures
        this.processedSignatures = new Set();
        
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
        
        // Bot configuration will be passed from TraderMonitorWorker
        this.botConfig = null;
        
        console.log('[LASERSTREAM-PROFESSIONAL] 🚀 Manager initialized with LaserStream gRPC (Professional Plan).');
        console.log(`[LASERSTREAM-PROFESSIONAL] 🌏 Primary Endpoint (Singapore): ${this.laserstreamConfig.endpoint}`);
        console.log(`[LASERSTREAM-PROFESSIONAL] 🌏 Fallback Endpoint (EWR): ${this.laserstreamConfig.fallbackEndpoint}`);
    }

    // ===== BOT CONFIGURATION SETTER =====
    setBotConfiguration(botConfig) {
        this.botConfig = botConfig;
        console.log(`[LASERSTREAM-PRO] ✅ Bot config set: Scale Factor: ${this.botConfig?.scaleFactor || 'N/A'}, Min Amount: ${this.botConfig?.minTransactionAmount || 'N/A'} SOL`);
    }

    // ===== SMART COPY HELPERS =====
    
    // Helper method to detect private routers
    _isPrivateRouter(programIds, routerInfo) {
        const privateRouterPatterns = [
            'b1oomGGqPKGD6errbyfbVMBuzSC8WtAAYo8MwNafWW1', // Example private router
            'CustomRouter', // Custom router patterns
            'PrivateRouter' // Private router patterns
        ];
        
        return programIds.some(id => privateRouterPatterns.includes(id)) || 
               routerInfo.some(router => router.isPrivate);
    }
    
    // Helper method to detect platform from program IDs (using config.js IDs)
    _detectPlatform(programIds) {
        const platformMap = {
            // Jupiter (from config.js)
            'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4': 'Jupiter', // Jupiter V6
            'JUP6LwwmjhEGGjp4tfXXFW2uJTkV5WkxSfCSsFUxXH5': 'Jupiter', // Jupiter
            'routeUGWgWzqBWFcrCfv8tritsqukccJPu3q5GPP3xS': 'Jupiter', // Jupiter AMM Routing
            
            // Raydium (from config.js)
            '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8': 'Raydium', // Raydium V4
            'CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK': 'Raydium', // Raydium CLMM
            'CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C': 'Raydium', // Raydium CPMM
            '675kPX9MHTjS2zt1qFR1UARY7hdK2uQDchjADx1Z1gkv': 'Raydium', // Raydium AMM
            '5quBtoiQqxF9Jv6KYKctB59NT3gtJD2Y65kdnB1Uev3h': 'Raydium', // Raydium Stable Swap
            'LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj': 'Raydium', // Raydium Launchpad
            
            // PumpFun (from config.js)
            '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P': 'PumpFun', // PumpFun BC
            'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA': 'PumpFun', // PumpFun AMM
            '6HB1VBBS8LrdQiR9MZcXV5VdpKFb7vjTMZuQQEQEPioC': 'PumpFun', // PumpFun V2
            'F5tfvbLog9VdGUPqBDTT8rgXvTTcq7e5UiGnupL1zvBq': 'PumpFun', // PumpFun Router
            
            // Meteora (from config.js)
            'LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo': 'Meteora', // Meteora DLMM
            'dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN': 'Meteora', // Meteora DBC
            'DBCFiGetD2C2s9w2b1G9dwy2J2B6Jq2mRGuo1S4t61d': 'Meteora', // Meteora DBC Alt
            'CPAMdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG': 'Meteora', // Meteora CP AMM
            
            // Orca (from config.js)
            'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc': 'Orca', // Whirlpool
            
            // OpenBook (from config.js)
            'srmqPvymJeFKQ4zGQed1GFppgkRHL9kaELCbyksJtPX': 'OpenBook', // OpenBook DEX
            'srmq2Vp3e2wBq3dDDjWM9t48Xm21S2Jd2eBE4Pj4u7d': 'OpenBook', // OpenBook V3
            '9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin': 'OpenBook', // Serum DEX v3
            
            // Private Routers (from config.js)
            'b1oomGGqPKGD6errbyfbVMBuzSC8WtAAYo8MwNafWW1': 'BloomRouter', // Bloom Router
            'AzcZqCRUQgKEg5FTAgY7JacATABEYCEfMbjXEzspLYFB': 'PrivateRouter', // Private Router
            
            // Additional Routers
            'BLUR9cL8HqZzu5bSaC7VRX25RCG93Hv3T6NPyKxQhWUT': 'BLURRouter' // BLUR Router
        };
        
        // PRIORITY DETECTION: Check for DEX first, then routers
        const dexProgramIds = programIds.filter(id => 
            platformMap[id] && !['BloomRouter', 'PrivateRouter', 'BLURRouter'].includes(platformMap[id])
        );
        
        console.log(`[PLATFORM-DETECT] 🔍 DEX Program IDs found: ${dexProgramIds.length}`);
        console.log(`[PLATFORM-DETECT] 🔍 All Program IDs: ${programIds.join(', ')}`);
        
        // If we found a DEX, use it
        if (dexProgramIds.length > 0) {
            for (const programId of dexProgramIds) {
                if (platformMap[programId]) {
                    console.log(`[PLATFORM-DETECT] 🎯 Found DEX: ${platformMap[programId]} (${programId})`);
                    return platformMap[programId];
                }
            }
        }
        
        // DEEP ANALYSIS: Check log messages for REAL DEX program IDs
        console.log(`[PLATFORM-DETECT] 🔍 No DEX in program IDs, checking log messages...`);
        
        // If no DEX found, check for routers but warn about deep analysis needed
        for (const programId of programIds) {
            if (platformMap[programId]) {
                console.log(`[PLATFORM-DETECT] 🔀 Found Router: ${platformMap[programId]} (${programId})`);
                console.log(`[PLATFORM-DETECT] ⚠️ Router detected - will need deep analysis to find real DEX`);
                return platformMap[programId];
            }
        }
        
        // Default to Jupiter if no specific platform detected
        console.log(`[PLATFORM-DETECT] ⚠️ No platform detected, defaulting to Jupiter`);
        return 'Jupiter';
    }
    
    // SMART CLASSIFICATION: Distinguish between routers and DEXes
    _classifyTransactionStructure(programIds, logMessages, innerInstructions) {
        try {
            console.log(`[SMART-CLASSIFIER] 🧠 Analyzing transaction structure...`);
            
            // Define router and DEX patterns
            const routerPatterns = {
                'b1oomGGqPKGD6errbyfbVMBuzSC8WtAAYo8MwNafWW1': 'BloomRouter',
                'AzcZqCRUQgKEg5FTAgY7JacATABEYCEfMbjXEzspLYFB': 'PrivateRouter',
                'BLUR9cL8HqZzu5bSaC7VRX25RCG93Hv3T6NPyKxQhWUT': 'BLURRouter'
            };
            
            const dexPatterns = {
                '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P': 'PumpFun',
                'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA': 'PumpFun',
                '6HB1VBBS8LrdQiR9MZcXV5VdpKFb7vjTMZuQQEQEPioC': 'PumpFun',
                'F5tfvbLog9VdGUPqBDTT8rgXvTTcq7e5UiGnupL1zvBq': 'PumpFun',
                '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8': 'Raydium',
                'CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK': 'Raydium',
                'CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C': 'Raydium',
                'LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo': 'Meteora',
                'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc': 'Orca'
            };
            
            // Step 1: Identify what we have in program IDs
            const foundRouters = [];
            const foundDexes = [];
            
            for (const programId of programIds) {
                if (routerPatterns[programId]) {
                    foundRouters.push({ id: programId, name: routerPatterns[programId] });
                }
                if (dexPatterns[programId]) {
                    foundDexes.push({ id: programId, name: dexPatterns[programId] });
                }
            }
            
            console.log(`[SMART-CLASSIFIER] 🔍 Found routers: ${foundRouters.map(r => r.name).join(', ')}`);
            console.log(`[SMART-CLASSIFIER] 🔍 Found DEXes: ${foundDexes.map(d => d.name).join(', ')}`);
            
            // Step 2: Analyze log messages for DEX activity
            const logDexes = [];
            for (const logMessage of logMessages) {
                for (const [programId, dexName] of Object.entries(dexPatterns)) {
                    if (logMessage.includes(programId)) {
                        logDexes.push({ id: programId, name: dexName });
                        console.log(`[SMART-CLASSIFIER] 🎯 Found DEX activity in logs: ${dexName} (${programId})`);
                    }
                }
            }
            
            // Step 3: Smart classification logic
            if (foundDexes.length > 0) {
                // Direct DEX transaction
                const primaryDex = foundDexes[0];
                console.log(`[SMART-CLASSIFIER] ✅ Direct DEX transaction: ${primaryDex.name}`);
                return {
                    type: 'DEX',
                    platform: primaryDex.name,
                    programId: primaryDex.id,
                    router: null
                };
            } else if (foundRouters.length > 0 && logDexes.length > 0) {
                // Router + DEX combination
                const router = foundRouters[0];
                const dex = logDexes[0];
                console.log(`[SMART-CLASSIFIER] 🔀 Router + DEX: ${router.name} → ${dex.name}`);
                return {
                    type: 'ROUTER_TO_DEX',
                    platform: dex.name,
                    programId: dex.id,
                    router: router.name,
                    routerId: router.id
                };
            } else if (foundRouters.length > 0) {
                // Router only (unknown target)
                const router = foundRouters[0];
                console.log(`[SMART-CLASSIFIER] ⚠️ Router only: ${router.name} (unknown target)`);
                return {
                    type: 'ROUTER_ONLY',
                    platform: 'Unknown',
                    programId: null,
                    router: router.name,
                    routerId: router.id
                };
            } else {
                // Unknown
                console.log(`[SMART-CLASSIFIER] ❓ Unknown transaction type`);
                return {
                    type: 'UNKNOWN',
                    platform: 'Unknown',
                    programId: null,
                    router: null
                };
            }
            
        } catch (error) {
            console.log(`[SMART-CLASSIFIER] ❌ Error classifying transaction: ${error.message}`);
            return {
                type: 'ERROR',
                platform: 'Unknown',
                programId: null,
                router: null
            };
        }
    }

    // DEEP ANALYSIS: Check log messages for real DEX program IDs (legacy method)
    _deepAnalyzeLogMessages(logMessages) {
        try {
            // console.log(`[DEEP-ANALYSIS] 🔍 Analyzing ${logMessages.length} log messages for real DEX...`); // SILENCED FOR CLEAN TERMINAL
            
            // Look for DEX program IDs in log messages
            const dexPatterns = {
                '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P': 'PumpFun',
                'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA': 'PumpFun',
                '6HB1VBBS8LrdQiR9MZcXV5VdpKFb7vjTMZuQQEQEPioC': 'PumpFun',
                'F5tfvbLog9VdGUPqBDTT8rgXvTTcq7e5UiGnupL1zvBq': 'PumpFun',
                '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8': 'Raydium',
                'CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK': 'Raydium',
                'CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C': 'Raydium',
                'LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo': 'Meteora',
                'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc': 'Orca'
            };
            
            for (const logMessage of logMessages) {
                for (const [programId, platform] of Object.entries(dexPatterns)) {
                    if (logMessage.includes(programId)) {
                        console.log(`[DEEP-ANALYSIS] 🎯 Found real DEX in logs: ${platform} (${programId})`);
                        return platform;
                    }
                }
            }
            
            console.log(`[DEEP-ANALYSIS] ⚠️ No real DEX found in log messages`);
            return null;
        } catch (error) {
            console.log(`[DEEP-ANALYSIS] ❌ Error analyzing log messages: ${error.message}`);
            return null;
        }
    }

    // Helper method to extract output mint from token changes
    _extractOutputMint(balanceAnalysis, meta) {
        if (balanceAnalysis.tokenChanges && balanceAnalysis.tokenChanges.length > 0) {
            // Find the token with the largest positive change (bought token)
            const boughtToken = balanceAnalysis.tokenChanges
                .filter(change => change.change > 0)
                .sort((a, b) => b.change - a.change)[0];
            
            if (boughtToken) {
                return boughtToken.mint;
            }
        }
        
        // Fallback to SOL if no token changes detected
        return 'So11111111111111111111111111111111111111112';
    }
    
    // Helper method to check if ATA creation is required
    _requiresATACreation(balanceAnalysis) {
        return balanceAnalysis.tokenChanges && 
               balanceAnalysis.tokenChanges.some(change => 
                   change.mint !== 'So11111111111111111111111111111111111111112' && 
                   change.change > 0
               );
    }
    
    // Helper method to check if PDA recovery is required
    _requiresPDARecovery(programIds) {
        const pdaPrograms = [
            'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
            'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL'
        ];
        
        return programIds.some(id => pdaPrograms.includes(id));
    }
    
    // Helper method to create account mapping for reconstruction
    _createAccountMapping(transaction, sourceWallet) {
        return {
            traderWallet: sourceWallet,
            userWallet: null, // Will be set by Universal Cloner
            tokenAccounts: [], // Will be populated during ATA creation
            programAccounts: [], // Will be populated during PDA recovery
            accountIndexMap: {} // Maps trader account indices to user account indices
        };
    }

    // ===== BUFFER DECODING =====
    convertBuffers(obj) {
        if (!obj) return obj;
        if (Buffer.isBuffer(obj) || obj instanceof Uint8Array) {
            return bs58.encode(obj);
        }
        if (Array.isArray(obj)) {
            return obj.map(item => this.convertBuffers(item));
        }
        if (typeof obj === 'object') {
            return Object.fromEntries(
                Object.entries(obj).map(([key, value]) => [key, this.convertBuffers(value)])
            );
        }
        return obj;
    }
    
    // ===== TOKEN BALANCE ANALYSIS =====
    analyzeTokenBalanceChanges(meta, accountKeys) {
        try {
            const analysis = {
                solChange: 0,
                tokenChanges: [],
                significantChange: false
            };
            
            // Analyze SOL balance changes
            if (meta.preBalances && meta.postBalances && accountKeys.length > 0) {
                const traderIndex = accountKeys.findIndex(key => this.activeTraderWallets.has(key));
                if (traderIndex !== -1) {
                    const preBalance = meta.preBalances[traderIndex] || 0;
                    const postBalance = meta.postBalances[traderIndex] || 0;
                    const solChange = (postBalance - preBalance) / 1_000_000_000; // Convert lamports to SOL
                    analysis.solChange = Math.abs(solChange);
                }
            }
            
            // Analyze token balance changes
            if (meta.preTokenBalances && meta.postTokenBalances) {
                // console.log(`[TOKEN-BALANCE] 🔍 Pre-token balances:`, meta.preTokenBalances.length, 'items'); // SILENCED FOR CLEAN TERMINAL
                // console.log(`[TOKEN-BALANCE] 🔍 Post-token balances:`, meta.postTokenBalances.length, 'items'); // SILENCED FOR CLEAN TERMINAL
                
                // ===== DETAILED SERIALIZED PARSED DATA LOGGING =====
                // console.log(`[TOKEN-BALANCE] 📊 SERIALIZED PARSED DATA:`); // SILENCED FOR CLEAN TERMINAL
                // console.log(`[TOKEN-BALANCE] 📊 preTokenBalances: [ ${meta.preTokenBalances.length} items ]`); // SILENCED FOR CLEAN TERMINAL
                // console.log(`[TOKEN-BALANCE] 📊 postTokenBalances: [ ${meta.postTokenBalances.length} items ]`); // SILENCED FOR CLEAN TERMINAL
                
                // Debug: Log the actual structure of token balances
                if (meta.preTokenBalances.length > 0) {
                    // console.log(`[TOKEN-BALANCE] 🔍 Sample pre-token balance:`, JSON.stringify(meta.preTokenBalances[0], null, 2)); // SILENCED FOR CLEAN TERMINAL
                    // console.log(`[TOKEN-BALANCE] 📊 Full preTokenBalances structure:`, JSON.stringify(meta.preTokenBalances, null, 2)); // SILENCED FOR CLEAN TERMINAL
                }
                if (meta.postTokenBalances.length > 0) {
                    // console.log(`[TOKEN-BALANCE] 🔍 Sample post-token balance:`, JSON.stringify(meta.postTokenBalances[0], null, 2)); // SILENCED FOR CLEAN TERMINAL
                    // console.log(`[TOKEN-BALANCE] 📊 Full postTokenBalances structure:`, JSON.stringify(meta.postTokenBalances, null, 2)); // SILENCED FOR CLEAN TERMINAL
                }
                
                const preTokenMap = new Map();
                const postTokenMap = new Map();
                
                // Map pre-token balances (using correct field names from actual data structure)
                meta.preTokenBalances.forEach((balance, index) => {
                    try {
                        if (balance && typeof balance === 'object' && balance.accountIndex !== undefined && balance.uiTokenAmount) {
                            preTokenMap.set(balance.accountIndex, {
                                mint: balance.mint,
                                amount: parseFloat(balance.uiTokenAmount.uiAmountString || '0'),
                                decimals: balance.uiTokenAmount.decimals
                            });
                            console.log(`[TOKEN-BALANCE] ✅ Pre-token balance parsed: ${balance.mint} = ${balance.uiTokenAmount.uiAmountString}`);
                        } else {
                            console.log(`[TOKEN-BALANCE] ⚠️ Invalid pre-token balance at index ${index}:`, balance);
                        }
                    } catch (error) {
                        console.log(`[TOKEN-BALANCE] ❌ Error parsing pre-token balance at index ${index}:`, error.message);
                    }
                });
                
                // Map post-token balances (using correct field names from actual data structure)
                meta.postTokenBalances.forEach((balance, index) => {
                    try {
                        if (balance && typeof balance === 'object' && balance.accountIndex !== undefined && balance.uiTokenAmount) {
                            postTokenMap.set(balance.accountIndex, {
                                mint: balance.mint,
                                amount: parseFloat(balance.uiTokenAmount.uiAmountString || '0'),
                                decimals: balance.uiTokenAmount.decimals
                            });
                            console.log(`[TOKEN-BALANCE] ✅ Post-token balance parsed: ${balance.mint} = ${balance.uiTokenAmount.uiAmountString}`);
                        } else {
                            console.log(`[TOKEN-BALANCE] ⚠️ Invalid post-token balance at index ${index}:`, balance);
                        }
                    } catch (error) {
                        console.log(`[TOKEN-BALANCE] ❌ Error parsing post-token balance at index ${index}:`, error.message);
                    }
                });
                
                // Calculate token changes
                const allIndices = new Set([...preTokenMap.keys(), ...postTokenMap.keys()]);
                console.log(`[TOKEN-BALANCE] 🔍 Processing ${allIndices.size} token balance indices`);
                
                allIndices.forEach(index => {
                    const preBalance = preTokenMap.get(index) || { amount: 0, mint: '', decimals: 0 };
                    const postBalance = postTokenMap.get(index) || { amount: 0, mint: '', decimals: 0 };
                    
                    if (preBalance.amount !== postBalance.amount) {
                        const change = postBalance.amount - preBalance.amount;
                        const mint = postBalance.mint || preBalance.mint;
                        console.log(`[TOKEN-BALANCE] 🔍 Token change detected: ${mint} = ${change} (${preBalance.amount} → ${postBalance.amount})`);
                        analysis.tokenChanges.push({
                            accountIndex: index,
                            mint: mint,
                            preAmount: preBalance.amount,
                            postAmount: postBalance.amount,
                            change: change,
                            decimals: postBalance.decimals || preBalance.decimals
                        });
                    }
                });
                
                console.log(`[TOKEN-BALANCE] 🔍 Total token changes detected: ${analysis.tokenChanges.length}`);
            }
            
            // Check if change is significant (>0.5 SOL equivalent)
            analysis.significantChange = analysis.solChange > 0.5;
            
            return analysis;
            
        } catch (error) {
            console.error('[LASERSTREAM-PRO] ❌ Error analyzing token balance changes:', error);
            return { solChange: 0, tokenChanges: [], significantChange: false };
        }
    }
    
    // ===== PROGRAM ID DETECTION =====
    detectProgramIds(transaction, accountKeys) {
        try {
            const programIds = new Set();
            
            // Get program IDs from instructions
            if (transaction.message && transaction.message.instructions) {
                transaction.message.instructions.forEach(instruction => {
                    if (instruction.programIdIndex !== undefined && accountKeys[instruction.programIdIndex]) {
                        programIds.add(accountKeys[instruction.programIdIndex]);
                    }
                });
            }
            
            // Get program IDs from inner instructions (from meta)
            if (transaction.meta && transaction.meta.innerInstructions) {
                transaction.meta.innerInstructions.forEach(innerInstruction => {
                    innerInstruction.instructions.forEach(instruction => {
                        if (instruction.programIdIndex !== undefined && accountKeys[instruction.programIdIndex]) {
                            programIds.add(accountKeys[instruction.programIdIndex]);
                        }
                    });
                });
            }
            
            return Array.from(programIds);
            
        } catch (error) {
            console.error('[LASERSTREAM-PRO] ❌ Error detecting program IDs:', error);
            return [];
        }
    }
    
    // ===== ROUTER DETECTION =====
    detectRouterTransactions(programIds) {
        try {
            const routerPrograms = new Map([
                // Jupiter Router
                ['JUP4Fb2cqiRUcaTHdrPC8h2gNsA2ETXiPDD33WcGuJB', 'Jupiter'],
                // Raydium Router
                ['675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8', 'Raydium'],
                // Meteora Router
                ['Eo7WjKq67rjJQSZxS6z3YkapzY3eMj6Xy8X5EQVn5UaB', 'Meteora'],
                // Orca Router
                ['9W959DqEETiGZocYWCQPaJ6sBmUzgfxXfqGeTEdp3aQP', 'Orca'],
                // Serum Router
                ['9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin', 'Serum']
            ]);
            
            const detectedRouters = [];
            programIds.forEach(programId => {
                if (routerPrograms.has(programId)) {
                    detectedRouters.push({
                        programId,
                        name: routerPrograms.get(programId),
                        isRouter: true
                    });
                }
            });
            
            return detectedRouters;
            
        } catch (error) {
            console.error('[LASERSTREAM-PRO] ❌ Error detecting router transactions:', error);
            return [];
        }
    }
    
    // ===== PLATFORM DETECTION =====
    detectPlatform(programIds, routerInfo, meta = null) {
        try {
            const platformPrograms = new Map([
                // Pump.fun programs
                ['6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P', 'PumpFun'],
                ['6HB1PioC', 'PumpFun'], // Shortened version from your output
                ['6HB1PioC...', 'PumpFun'], // Full version
                // Raydium AMM
                ['675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8', 'Raydium'],
                // Orca AMM
                ['9W959DqEETiGZocYWCQPaJ6sBmUzgfxXfqGeTEdp3aQP', 'Orca'],
                // Meteora AMM
                ['Eo7WjKq67rjJQSZxS6z3YkapzY3eMj6Xy8X5EQVn5UaB', 'Meteora'],
                // Jupiter
                ['JUP4Fb2cqiRUcaTHdrPC8h2gNsA2ETXiPDD33WcGuJB', 'Jupiter'],
                ['JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4', 'Jupiter'],
                // System Program (filter out)
                ['11111111111111111111111111111111', 'System']
            ]);
            
            // Check for direct platform matches (filter out system programs)
            for (const programId of programIds) {
                if (platformPrograms.has(programId) && platformPrograms.get(programId) !== 'System') {
                return {
                        platform: platformPrograms.get(programId),
                        programId,
                        isRouter: false
                    };
                }
            }
            
            // Check log messages for platform detection (as per documentation)
            if (meta && meta.logMessages) {
                const logPrograms = this.extractProgramsFromLogs(meta.logMessages);
                console.log(`[LASERSTREAM-PRO] 🔍 Log programs: ${logPrograms.join(', ')}`);
                for (const programId of logPrograms) {
                    if (platformPrograms.has(programId) && platformPrograms.get(programId) !== 'System') {
                        console.log(`[LASERSTREAM-PRO] ✅ Platform found in logs: ${platformPrograms.get(programId)}`);
                        return {
                            platform: platformPrograms.get(programId),
                            programId,
                            isRouter: false
                        };
                    }
                }
            }
            
            // Check if router was used
            if (routerInfo.length > 0) {
                return {
                    platform: routerInfo[0].name,
                    programId: routerInfo[0].programId,
                    isRouter: true
                };
            }
            
            return {
                platform: 'Unknown',
                programId: programIds[0] || 'Unknown',
                isRouter: false
            };
            
        } catch (error) {
            console.error('[LASERSTREAM-PRO] ❌ Error detecting platform:', error);
            return { platform: 'Unknown', programId: 'Unknown', isRouter: false };
        }
    }
    
    // ===== LOG MESSAGE ANALYSIS =====
    extractProgramsFromLogs(logMessages) {
        try {
            const programs = new Set();
            
            logMessages.forEach((log) => {
                // Match pattern: "Program [PROGRAM_ID] invoke"
                const match = log.match(/Program ([1-9A-HJ-NP-Za-km-z]{32,}) invoke/);
                if (match) {
                    programs.add(match[1]);
                }
            });
            
            return Array.from(programs);
            
        } catch (error) {
            console.error('[LASERSTREAM-PRO] ❌ Error extracting programs from logs:', error);
            return [];
        }
    }
    
    // ===== IDL INTEGRATION =====
    async loadIDL(platform) {
        try {
            const fs = require('fs');
            const path = require('path');
            
            // Map platforms to their IDL files
            const idlFileMap = {
                'PumpFun': 'idls/pump-official.json',
                'PumpFunAMM': 'idls/pump-amm-official.json',
                'Jupiter': 'idls/jupiter_idl.json',
                'Raydium': 'idls/raydium_amm.json',
                'RaydiumCPMM': 'idls/raydium_cpmm.json',
                'RaydiumV4': 'idls/raydium_V4.json',
                'Meteora': 'idls/meteora_dynamic_bonding_curve.json'
            };
            
            const idlFilePath = idlFileMap[platform];
            if (!idlFilePath) {
                console.log(`[LASERSTREAM-PRO] ⚠️ No IDL file found for platform: ${platform}`);
                return null;
            }
            
            const fullPath = path.join(__dirname, '..', idlFilePath);
            
            if (!fs.existsSync(fullPath)) {
                console.log(`[LASERSTREAM-PRO] ⚠️ IDL file not found: ${fullPath}`);
                return null;
            }
            
            const idlContent = fs.readFileSync(fullPath, 'utf8');
            const idl = JSON.parse(idlContent);
            
            console.log(`[LASERSTREAM-PRO] ✅ Loaded IDL for ${platform}: ${idl.name || platform} v${idl.version || 'unknown'}`);
            return idl;
            
        } catch (error) {
            console.error('[LASERSTREAM-PRO] ❌ Error loading IDL:', error);
            return null;
        }
    }

    // ===== AMOUNT CALCULATION =====
    calculateScaledAmounts(meta, scaleFactor) {
        try {
            // Calculate original SOL amount from balance changes
            let originalAmount = 0;
            if (meta.preBalances && meta.postBalances) {
                const balanceChange = Math.abs(meta.postBalances[0] - meta.preBalances[0]);
                originalAmount = balanceChange / 1_000_000_000; // Convert lamports to SOL
            }
            
            const scaledAmount = originalAmount * scaleFactor;
            
            return {
                original: originalAmount,
                scaled: scaledAmount,
                scaleFactor
            };
            
        } catch (error) {
            console.error('[LASERSTREAM-PRO] ❌ Error calculating scaled amounts:', error);
            return { original: 0, scaled: 0, scaleFactor };
        }
    }
    
    // ===== PLATFORM-SPECIFIC TRANSACTION BUILDING =====
    async buildTransactionByPlatform(platform, idl, userWallet, amounts) {
        try {
            switch (platform) {
                case 'PumpFun':
                    return await this.buildPumpFunTransaction(idl, userWallet, amounts);
                case 'Raydium':
                    return await this.buildRaydiumTransaction(idl, userWallet, amounts);
                case 'Jupiter':
                    return await this.buildJupiterTransaction(idl, userWallet, amounts);
                default:
                    throw new Error(`Unsupported platform: ${platform}`);
            }
        } catch (error) {
            console.error('[LASERSTREAM-PRO] ❌ Error building transaction:', error);
        return null;
        }
    }
    
    // ===== PUMP.FUN TRANSACTION BUILDING =====
    async buildPumpFunTransaction(idl, userWallet, amounts) {
        try {
            // Find the 'buy' instruction in the IDL
            const buyInstruction = idl.instructions.find(inst => inst.name === 'buy');
            if (!buyInstruction) {
                throw new Error('Buy instruction not found in PumpFun IDL');
            }
            
            const transaction = {
                platform: 'PumpFun',
                instruction: {
                    programId: '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P',
                    accounts: buyInstruction.accounts.map(account => ({
                        pubkey: account.name === 'user' ? userWallet : `PLACEHOLDER_${account.name.toUpperCase()}`,
                        isSigner: account.isSigner,
                        isWritable: account.isMut
                    })),
                    data: this.encodePumpFunInstruction(amounts.scaled)
                },
                computeBudget: {
                    units: this.botConfig?.computeBudgetUnits || 200000,
                    fee: this.botConfig?.computeBudgetFee || 0
                },
                idl: {
                    name: idl.name,
                    version: idl.version,
                    instruction: buyInstruction
                }
            };
            
            console.log(`[LASERSTREAM-PRO] ✅ Built PumpFun transaction using IDL: ${idl.name} v${idl.version}`);
            return transaction;
            
        } catch (error) {
            console.error('[LASERSTREAM-PRO] ❌ Error building PumpFun transaction:', error);
            return null;
        }
    }
    
    // ===== RAYDIUM TRANSACTION BUILDING =====
    async buildRaydiumTransaction(idl, userWallet, amounts) {
        try {
            // Find the 'swap' instruction in the IDL
            const swapInstruction = idl.instructions.find(inst => inst.name === 'swap');
            if (!swapInstruction) {
                throw new Error('Swap instruction not found in Raydium IDL');
            }
            
            const transaction = {
                platform: 'Raydium',
                instruction: {
                    programId: '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8',
                    accounts: swapInstruction.accounts.map(account => ({
                        pubkey: account.name === 'user' ? userWallet : `PLACEHOLDER_${account.name.toUpperCase()}`,
                        isSigner: account.isSigner,
                        isWritable: account.isMut
                    })),
                    data: this.encodeRaydiumInstruction(amounts.scaled, amounts.scaled * (1 - (this.botConfig?.maxSlippage || 0.05)))
                },
                computeBudget: {
                    units: this.botConfig?.computeBudgetUnits || 200000,
                    fee: this.botConfig?.computeBudgetFee || 0
                },
                idl: {
                    name: idl.name,
                    version: idl.version,
                    instruction: swapInstruction
                }
            };
            
            console.log(`[LASERSTREAM-PRO] ✅ Built Raydium transaction using IDL: ${idl.name} v${idl.version}`);
            return transaction;
            
        } catch (error) {
            console.error('[LASERSTREAM-PRO] ❌ Error building Raydium transaction:', error);
            return null;
        }
    }
    
    // ===== JUPITER TRANSACTION BUILDING =====
    async buildJupiterTransaction(idl, userWallet, amounts) {
        try {
            // Find the 'swap' instruction in the Jupiter IDL
            const swapInstruction = idl.instructions.find(inst => inst.name === 'swap');
            if (!swapInstruction) {
                throw new Error('Swap instruction not found in Jupiter IDL');
            }
            
            const transaction = {
                platform: 'Jupiter',
                instruction: {
                    programId: 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4',
                    accounts: swapInstruction.accounts.map(account => ({
                        pubkey: account.name === 'wallet' ? userWallet : `PLACEHOLDER_${account.name.toUpperCase()}`,
                        isSigner: account.writable && account.name === 'wallet',
                        isWritable: account.writable
                    })),
                    data: this.encodeJupiterInstruction(amounts.scaled, amounts.scaled * (1 - (this.botConfig?.maxSlippage || 0.05)))
                },
                computeBudget: {
                    units: this.botConfig?.computeBudgetUnits || 200000,
                    fee: this.botConfig?.computeBudgetFee || 0
                },
                idl: {
                    name: idl.metadata.name,
                    version: idl.metadata.version,
                    instruction: swapInstruction
                }
            };
            
            console.log(`[LASERSTREAM-PRO] ✅ Built Jupiter transaction using IDL: ${idl.metadata.name} v${idl.metadata.version}`);
            return transaction;
            
        } catch (error) {
            console.error('[LASERSTREAM-PRO] ❌ Error building Jupiter transaction:', error);
            return null;
        }
    }
    
    // ===== INSTRUCTION ENCODING =====
    encodePumpFunInstruction(amount) {
        // Simplified instruction encoding for PumpFun buy
        const instructionData = Buffer.alloc(8);
        instructionData.writeUInt32LE(0, 0); // Instruction discriminator for buy
        instructionData.writeUInt32LE(Math.floor(amount * 1_000_000_000), 4); // Amount in lamports
        return instructionData;
    }
    
    encodeRaydiumInstruction(amountIn, minimumAmountOut) {
        // Simplified instruction encoding for Raydium swap
        const instructionData = Buffer.alloc(16);
        instructionData.writeUInt32LE(0, 0); // Instruction discriminator for swap
        instructionData.writeUInt32LE(Math.floor(amountIn * 1_000_000_000), 4); // Amount in
        instructionData.writeUInt32LE(Math.floor(minimumAmountOut * 1_000_000_000), 8); // Min amount out
        instructionData.writeUInt32LE(0, 12); // Padding
        return instructionData;
    }
    
    encodeJupiterInstruction(amount, minAmountOut) {
        // Simplified instruction encoding for Jupiter route
        const instructionData = Buffer.alloc(16);
        instructionData.writeUInt32LE(0, 0); // Instruction discriminator for route
        instructionData.writeUInt32LE(Math.floor(amount * 1_000_000_000), 4); // Amount
        instructionData.writeUInt32LE(Math.floor(minAmountOut * 1_000_000_000), 8); // Min amount out
        instructionData.writeUInt32LE(0, 12); // Padding
        return instructionData;
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
            console.log(`[LASERSTREAM-PRO] 🔍 Full wallet addresses: ${JSON.stringify(finalWalletsToSubscribe)}`);

            if (!this.config.HELIUS_API_KEY) {
                throw new Error("Cannot subscribe: HELIUS_API_KEY is missing.");
            }

            // ✅ USE EXACT SAME CONFIG AS WORKING live_debug.js
            const laserstreamConfig = {
                apiKey: this.config.HELIUS_API_KEY,
                endpoint: "https://laserstream-mainnet-sgp.helius-rpc.com", // Same as working live_debug.js
            };

            // TRANSACTION SUBSCRIPTION: Monitor transactions from trader wallets
            console.log(`[LASERSTREAM-PRO] Subscribing to transactions from ${finalWalletsToSubscribe.length} trader wallets.`);

            const subscription = {
                transactions: {
                    "trader-transactions": {
                        account_include: finalWalletsToSubscribe, // Monitor transactions involving these wallets
                        vote: false,
                        failed: false,
                        // SMART FILTERING: Only capture REAL TRADING transactions
                        program_include: [
                            // DEX Programs (Real Trading)
                            "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4", // Jupiter v6
                            "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8", // Raydium V4
                            "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P", // PumpFun
                            "LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo", // Meteora DLMM
                            "whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc", // Orca Whirlpools
                            "srmqPvymJeFKQ4zGQed1GFppgkRHL9kaELCbyksJtPX", // OpenBook
                            "b1oomGGqPKGD6errbyfbVMBuzSC8WtAAYo8MwNafWW1", // Bloom Router
                            "AzcZqCRUQgKEg5FTAgY7JacATABEYCEfMbjXEzspLYFB", // Private Router
                            "F5tfvbLog9VdGUPqBDTT8rgXvTTcq7e5UiGnupL1zvBq"  // PumpFun Router
                        ],
                        // ADDITIONAL FILTERING: Eliminate noise
                        exclude_programs: [
                            "Vote111111111111111111111111111111111111111", // Voting transactions
                            "SysvarC1ock11111111111111111111111111111111", // Clock sysvar
                            "SysvarRent111111111111111111111111111111111", // Rent sysvar
                            "SysvarRecentB1ockHashes11111111111111111111", // Recent blockhashes
                            "SysvarS1otHashes111111111111111111111111111", // Slot hashes
                            "SysvarS1otHistory11111111111111111111111111", // Slot history
                            "SysvarStakeHistory1111111111111111111111111", // Stake history
                            "SysvarEpochSchedu1e111111111111111111111111", // Epoch schedule
                            "SysvarFees111111111111111111111111111111111", // Fees sysvar
                            "SysvarRewards1111111111111111111111111111111", // Rewards sysvar
                            "Sysvar1nstructions1111111111111111111111111", // Instructions sysvar
                            "SysvarUpgrade1111111111111111111111111111111", // Upgrade sysvar
                            "SysvarConfig1111111111111111111111111111111", // Config sysvar
                            "SysvarLastRestartS1ot1111111111111111111111", // Last restart slot
                            "SysvarEpochRewards1111111111111111111111111", // Epoch rewards
                            "SysvarRent111111111111111111111111111111111", // Rent sysvar
                            "SysvarRecentB1ockHashes11111111111111111111", // Recent blockhashes
                            "SysvarS1otHashes111111111111111111111111111", // Slot hashes
                            "SysvarS1otHistory11111111111111111111111111", // Slot history
                            "SysvarStakeHistory1111111111111111111111111", // Stake history
                            "SysvarEpochSchedu1e111111111111111111111111", // Epoch schedule
                            "SysvarFees111111111111111111111111111111111", // Fees sysvar
                            "SysvarRewards1111111111111111111111111111111", // Rewards sysvar
                            "Sysvar1nstructions1111111111111111111111111", // Instructions sysvar
                            "SysvarUpgrade1111111111111111111111111111111", // Upgrade sysvar
                            "SysvarConfig1111111111111111111111111111111", // Config sysvar
                            "SysvarLastRestartS1ot1111111111111111111111", // Last restart slot
                            "SysvarEpochRewards1111111111111111111111111"  // Epoch rewards
                        ]
                    }
                },
                // Advanced account filtering for token accounts
                accounts: {
                    "token-accounts": {
                        owner: ["TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"], // Token program
                        filters: [
                            { datasize: 165 }, // Standard token accounts (165 bytes)
                            { memcmp: { offset: 32, base58: finalWalletsToSubscribe[0] } } // Filter by owner if we have wallets
                        ]
                    }
                },
                // ATA slicing for token account balance analysis
                accounts_data_slice: (this.botConfig && this.botConfig.enableATASlicing) ? [
                    {
                        offset: this.botConfig.ataSliceOffset || 64, // 64 bytes offset for balance
                        length: this.botConfig.ataSliceLength || 8   // 8 bytes for balance
                    }
                ] : [],
                // Use PROCESSED for the absolute fastest notification speed.
                commitment: CommitmentLevel.PROCESSED,
            };

            console.log("[LASERSTREAM-PRO] ✅ Using transaction subscription filtering. Connecting...");

            // ✅ TRANSACTION SUBSCRIPTION CALLBACK - DUMB PIPE ONLY
            const streamCallback = async (update) => {
                try {
                    console.log(`[LASERSTREAM-PIPE] 📡 Received raw data packet from Helius.`);
                    
                    // 1. Basic validation: Does the update contain a transaction?
                    if (!update || !update.transaction) {
                        return; // Not a transaction update, ignore.
                    }

                    const transactionUpdate = update.transaction;
                    const signature = bs58.encode(transactionUpdate.transaction.signature);
                    
                    // FIX: Proper wallet extraction from account keys (they are bytes in protobuf)
                    const accountKeys = transactionUpdate.transaction.transaction.message.accountKeys;
                    let sourceWallet = null;
                    
                    // Account keys are stored as bytes in the protobuf, need to convert to base58
                    if (accountKeys && accountKeys.length > 0) {
                        const firstKey = accountKeys[0];
                        if (Buffer.isBuffer(firstKey)) {
                            // Convert buffer to base58 string
                            sourceWallet = bs58.encode(firstKey);
                        } else if (firstKey && firstKey.pubkey) {
                            sourceWallet = firstKey.pubkey.toString();
                        } else if (typeof firstKey === 'string') {
                            sourceWallet = firstKey;
                        } else if (firstKey && typeof firstKey === 'object') {
                            sourceWallet = firstKey.toString();
                        }
                    }
                    
                    if (!sourceWallet) {
                        console.log(`[LASERSTREAM-PIPE] ⚠️ Could not extract source wallet from transaction`);
                        return;
                    }

                    // DEBUG: Log wallet detection (SILENCED FOR CLEAN TERMINAL)
                    // console.log(`[LASERSTREAM-PIPE] 🔍 DEBUG: Source wallet: ${shortenAddress(sourceWallet)}`);
                    // console.log(`[LASERSTREAM-PIPE] 🔍 DEBUG: Active wallets: ${Array.from(this.activeTraderWallets).map(w => shortenAddress(w)).join(', ')}`);
                    // console.log(`[LASERSTREAM-PIPE] 🔍 DEBUG: Is monitored? ${this.activeTraderWallets.has(sourceWallet)}`);

                    // Check if the source wallet is one we are monitoring.
                    if (!this.activeTraderWallets.has(sourceWallet)) {
                        // console.log(`[LASERSTREAM-PIPE] ⏭️ Not from monitored trader: ${shortenAddress(sourceWallet)}`); // SILENCED FOR CLEAN TERMINAL
                        return; // Not from a monitored trader, ignore.
                    }

                    // 2. Its ONLY job is to emit the RAW, unprocessed transaction.
                    // It does NOT do any analysis itself.
                    // console.log(`[LASERSTREAM-PIPE] ✅ Detected activity from monitored trader: ${shortenAddress(sourceWallet)}`); // SILENCED FOR CLEAN TERMINAL
                    
                    // Use the explicit callback set by the monitor.
                    if (typeof this.transactionNotificationCallback === 'function') {
                        this.transactionNotificationCallback(sourceWallet, signature, transactionUpdate);
                    }

                } catch (handlerError) {
                    console.error('❌ FATAL ERROR in LaserStream DATA PIPE', { errorMessage: handlerError.message });
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
            
            // Add heartbeat to track if we're receiving any data at all
            setInterval(() => {
                console.log(`[LASERSTREAM-PRO] 💓 Heartbeat - Stream status: ${this.streamStatus}, Active wallets: ${this.activeTraderWallets.size}`);
            }, 30000); // Every 30 seconds
    
        } catch (error) {
            console.error(`[LASERSTREAM-PRO] ❌ Failed to subscribe:`, error);
            this.streamStatus = 'error';
        }
    }
    

    // Enhanced transaction handling with refined data extraction
    async handleTransactionUpdate(transactionUpdate) {
        try {
            // console.log(`[LASERSTREAM-PRO] 📡 Received transaction update from LaserStream`); // SILENCED FOR CLEAN TERMINAL
            
            // Use the new normalizeTransaction function
            const normalizedTx = normalizeTransaction(transactionUpdate);
            if (!normalizedTx) {
                // console.log(`[LASERSTREAM-PRO] ⚠️ Transaction filtered out (vote/failed) - ignoring`); // SILENCED FOR CLEAN TERMINAL
                return;
            }
            
            // 🔧 DUPLICATE DETECTION: Check if we've already processed this signature
            if (this.processedSignatures.has(normalizedTx.signature)) {
                // console.log(`[LASERSTREAM-PRO] ⚠️ Duplicate transaction detected: ${normalizedTx.signature.substring(0, 8)}...${normalizedTx.signature.substring(-8)} - SKIPPING`); // SILENCED FOR CLEAN TERMINAL
                return;
            }
            
            // Mark as processed
            this.processedSignatures.add(normalizedTx.signature);
            // console.log(`[LASERSTREAM-PRO] 🔍 Processing NEW transaction: ${normalizedTx.signature.substring(0, 8)}...${normalizedTx.signature.substring(-8)}`); // SILENCED FOR CLEAN TERMINAL
            
            // console.log(`[LASERSTREAM-PRO] 🔍 Normalized transaction: ${normalizedTx.signature.substring(0, 8)}...${normalizedTx.signature.substring(-8)}`); // SILENCED FOR CLEAN TERMINAL
            // console.log(`[LASERSTREAM-PRO] 🔍 SOL Change: ${normalizedTx.solChange}`); // SILENCED FOR CLEAN TERMINAL
            // console.log(`[LASERSTREAM-PRO] 🔍 Token Changes: ${normalizedTx.tokenChanges.length}`); // SILENCED FOR CLEAN TERMINAL
            // console.log(`[LASERSTREAM-PRO] 🔍 Significant Change: ${normalizedTx.significantChange}`); // SILENCED FOR CLEAN TERMINAL
            
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
                        // console.log(`[LASERSTREAM-DEBUG] Failed to parse account key:`, key, error.message); // SILENCED FOR CLEAN TERMINAL
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
                // console.log(`[LASERSTREAM-DEBUG] ⚠️ No active trader wallets set, skipping transaction`); // SILENCED FOR CLEAN TERMINAL
                return;
            }
            const sourceWallet = accountKeys.find(key => this.activeTraderWallets && this.activeTraderWallets.has(key));
            
            // DEBUG: Log transaction structure and wallet detection details (SILENCED FOR CLEAN TERMINAL)
            // console.log(`[LASERSTREAM-DEBUG] 🔍 Transaction Structure Debug:`);
            // console.log(`[LASERSTREAM-DEBUG] 🔍 Transaction keys:`, Object.keys(transaction));
            // console.log(`[LASERSTREAM-DEBUG] 🔍 Message keys:`, transaction.message ? Object.keys(transaction.message) : 'No message');
            // console.log(`[LASERSTREAM-DEBUG] 🔍 AccountKeys type:`, transaction.message?.accountKeys ? typeof transaction.message.accountKeys : 'No accountKeys');
            // console.log(`[LASERSTREAM-DEBUG] 🔍 AccountKeys length:`, transaction.message?.accountKeys?.length || 0);
            // console.log(`[LASERSTREAM-DEBUG] 🔍 First accountKey sample:`, transaction.message?.accountKeys?.[0]);
            
            // console.log(`[LASERSTREAM-DEBUG] 🔍 Wallet Detection Debug:`);
            // console.log(`[LASERSTREAM-DEBUG] 🔍 Active Trader Wallets: ${Array.from(this.activeTraderWallets).join(', ')}`);
            // console.log(`[LASERSTREAM-DEBUG] 🔍 Account Keys in Transaction: ${accountKeys.slice(0, 5).join(', ')}${accountKeys.length > 5 ? '...' : ''}`);
            // console.log(`[LASERSTREAM-DEBUG] 🔍 Source Wallet Found: ${sourceWallet || 'NONE'}`);
            
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
                // console.log(`[LASERSTREAM-PROFESSIONAL] 🎯 High-quality transaction detected for ${shortenAddress(sourceWallet)} | Sig: ${shortenAddress(signatureStr)}`); // SILENCED FOR CLEAN TERMINAL
                
                // 🚀 REDIS CACHE ENHANCEMENT: Store pre-fetched data for instant access
                try {
                    const preFetchedData = this.extractRefinedTransactionData(transactionUpdate, sourceWallet);
                    
                    // Cache for 30 seconds (enough for analysis)
                    const cacheKey = `laserstream:prefetch:${signatureStr}`;
                    if (this.redisManager) {
                        await this.redisManager.setWithExpiry(cacheKey, JSON.stringify(preFetchedData), 30);
                        // console.log(`[LASERSTREAM-PROFESSIONAL] 💎 Pre-fetched data cached for ${shortenAddress(signatureStr)}`); // SILENCED FOR CLEAN TERMINAL
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
                // console.log(`[LASERSTREAM-DEBUG] 🚫 No active trader wallet found in transaction. Skipping.`); // SILENCED FOR CLEAN TERMINAL
            }
            
        } catch (error) {
            console.error('[LASERSTREAM-PROFESSIONAL] ❌ Error handling transaction update:', error);
        }
    }

    // ====================================================================
    // ====== EXTRACT REFINED DATA (SIMPLIFIED) ======
    // ====================================================================
    extractRefinedTransactionData(transactionUpdate, sourceWallet) {
        try {
            // SIMPLIFIED: Direct access to transaction data
            const transaction = transactionUpdate.transaction;
            if (!transaction) {
                return { isCopyable: false, reason: "No transaction data found" };
            }
            
            const refinedData = {
                signature: transactionUpdate.signature ? bs58.encode(transactionUpdate.signature) : 'unknown',
                slot: transactionUpdate.slot,
                blockTime: transactionUpdate.blockTime,
                
                // Direct access to transaction data
                accountKeys: transaction.message?.accountKeys || [],
                instructions: transaction.message?.instructions || [],
                innerInstructions: transaction.meta?.innerInstructions || [],
                preBalances: transaction.meta?.preBalances || [],
                postBalances: transaction.meta?.postBalances || [],
                preTokenBalances: transaction.meta?.preTokenBalances || [],
                postTokenBalances: transaction.meta?.postTokenBalances || [],
                fee: transaction.meta?.fee || 0,
                computeUnitsConsumed: transaction.meta?.computeUnitsConsumed || 0,
                err: transaction.meta?.err || null,
                logMessages: transaction.meta?.logMessages || [],
                
                isCopyable: true,
                sourceWallet,
                detectedAt: Date.now(),
                dataSource: 'singapore-laserstream-simplified'
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
            const currentWallets = await this.parentWorker.getMasterTraderWallets();
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

    /**
     * Get trader name from wallet address - ULTRA-FAST Redis lookup
     */
    async getTraderNameFromWallet(walletAddress) {
        try {
            console.log(`[LASERSTREAM] 🔍 Looking up trader name for wallet: ${walletAddress}`);
            
            // ULTRA-FAST: Try Redis lookup first (instant)
            const traderName = await this.redisManager.get(`trader_name:${walletAddress}`);
            if (traderName) {
                console.log(`[LASERSTREAM] ⚡ INSTANT Redis lookup: ${traderName} (${walletAddress})`);
                return traderName;
            }
            
            // Fallback: Load from JSON and sync to Redis for future lookups
            console.log(`[LASERSTREAM] 🔍 Redis miss, loading from JSON for wallet: ${walletAddress}`);
            
            const traders = await this.dataManager.readJsonFile('traders.json');
            if (!traders?.traders) {
                console.warn(`[LASERSTREAM] ⚠️ No traders data found in JSON file`);
                return 'Unknown';
            }

            // Search through all users and traders to find the name
            for (const [userId, userTraders] of Object.entries(traders.traders)) {
                for (const [name, trader] of Object.entries(userTraders)) {
                    if (trader.wallet === walletAddress) {
                        // SYNC TO REDIS for instant future lookups
                        await this.redisManager.set(`trader_name:${walletAddress}`, name, 3600); // 1 hour TTL
                        console.log(`[LASERSTREAM] ✅ Found & synced to Redis: ${name} (${walletAddress})`);
                        return name;
                    }
                }
            }
            
            console.warn(`[LASERSTREAM] ⚠️ Trader not found for wallet: ${walletAddress}`);
            return 'Unknown';
            
        } catch (error) {
            console.warn(`[LASERSTREAM] ❌ Error getting trader name for wallet ${walletAddress}:`, error.message);
            return 'Unknown';
        }
    }
}

module.exports = { LaserStreamManager };