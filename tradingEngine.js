// ==========================================
// ====== ZapBot TradingEngine (HARDENED) ======
// ==========================================
// File: tradingEngine.js
// Description: Fully hardened trading logic with comprehensive safety checks.

const { PublicKey, ComputeBudgetProgram, VersionedTransaction, TransactionMessage } = require('@solana/web3.js');
const BN = require('bn.js');
const { getAssociatedTokenAddressSync, createAssociatedTokenAccountIdempotentInstruction } = require("@solana/spl-token");
const { Buffer } = require('buffer');

// platformBuilders removed - using universalCloner instead
const { UniversalCloner } = require('./universalCloner.js');
const config = require('./config.js');
const { shortenAddress } = require('./utils.js');
const traceLogger = require('./traceLogger.js');
const DirectSolanaSender = require('./directSolanaSender.js');
const TransactionLogger = require('./transactionLogger.js');
// const UnifiedPrebuilder = require('./unifiedPrebuilder.js');
const sellInstructionCache = new Map();

class TradingEngine {
    constructor(managers, options = {}) {
        // Option for partial initialization (used by workers for helper methods)
        if (options.partialInit) {
            if (!managers.dataManager) {
                throw new Error("TradingEngine (Partial Init): DataManager is required.");
            }
            this.dataManager = managers.dataManager;
            // Other managers will be null, which is expected
            return;
        }

        // Full initialization with safety check
        const { solanaManager, dataManager, walletManager, notificationManager, apiManager, redisManager } = managers;

        if (![solanaManager, dataManager, walletManager, notificationManager, apiManager, redisManager].every(Boolean)) {
            throw new Error("TradingEngine: Missing required manager modules for full initialization.");
        }

        // Assign all managers
        this.solanaManager = solanaManager;
        this.dataManager = dataManager;
        this.walletManager = walletManager;
        this.notificationManager = notificationManager;
        this.apiManager = apiManager;
        this.redisManager = redisManager;
        
        // Initialize Universal Analyzer for fast, lightweight analysis
        const { UniversalAnalyzer } = require('./universalAnalyzer.js');
        this.universalAnalyzer = new UniversalAnalyzer(solanaManager.connection);
        console.log(`[TRADING-ENGINE] 🚀 Universal Analyzer initialized for instant copy trading`);

        this.isProcessing = new Set();
        this.userProcessing = new Set(); // Track users currently being processed to prevent race conditions
        this.traderCutoffSignatures = new Map();
        this.failedTransactions = new Set(); // Track failed transactions to prevent retries
        this.failedTransactionBlockhashes = new Map(); // Track blockhash when transactions failed
        this.currentBlockhash = null; // Track current blockhash for cleanup
        this.lastWalletCount = null; // Track wallet count to reduce logging verbosity
        this.traceLogger = traceLogger;
        this.transactionLogger = new TransactionLogger();
        
        // Initialize Direct Solana Sender for ultra-fast execution with leader targeting
        this.directSolanaSender = new DirectSolanaSender();
        
        // Initialize Universal Cloner for platform-agnostic copy trading
        this.universalCloner = new UniversalCloner(this.solanaManager.connection, this.apiManager);
        
        // Initialize current blockhash
        this.initializeCurrentBlockhash();
        
        // Start blockhash-based cleanup for failed transactions
        this.startBlockhashBasedCleanup();
        
        // Start user processing cleanup to prevent deadlocks
        this.startUserProcessingCleanup();
        
        console.log("TradingEngine initialized with HYBRID (Polling + API) logic, Quantum Cache, and Direct Solana Sender integration (ENABLED).");
    }
    
    // Initialize current blockhash
    async initializeCurrentBlockhash() {
        try {
            const latestBlockhash = await this.solanaManager.connection.getLatestBlockhash();
            this.currentBlockhash = latestBlockhash.blockhash;
            console.log(`[FAILURE-CLEANUP] 🚀 Initialized with blockhash: ${this.currentBlockhash.substring(0, 8)}...`);
        } catch (error) {
            console.warn(`[FAILURE-CLEANUP] ⚠️ Failed to initialize blockhash:`, error.message);
        }
    }
    
    // Clean up failed transactions based on blockhash changes
    startBlockhashBasedCleanup() {
        setInterval(async () => {
            try {
                // Get current blockhash
                const latestBlockhash = await this.solanaManager.connection.getLatestBlockhash();
                const currentBlockhash = latestBlockhash.blockhash;
                
                // If blockhash changed, clean up old failed transactions
                if (this.currentBlockhash && this.currentBlockhash !== currentBlockhash) {
                    console.log(`[FAILURE-CLEANUP] 🔄 Blockhash changed, cleaning up old failed transactions`);
                    
                    // Remove failed transactions from previous blockhash
                    for (const [signature, blockhash] of this.failedTransactionBlockhashes.entries()) {
                        if (blockhash !== currentBlockhash) {
                            this.failedTransactions.delete(signature);
                            this.failedTransactionBlockhashes.delete(signature);
                        }
                    }
                }
                
                this.currentBlockhash = currentBlockhash;
            } catch (error) {
                console.warn(`[FAILURE-CLEANUP] ⚠️ Failed to get latest blockhash:`, error.message);
            }
        }, 30 * 1000); // Check every 30 seconds
    }
    
    // Clean up user processing locks to prevent deadlocks
    startUserProcessingCleanup() {
        setInterval(() => {
            // Log current processing users for debugging
            if (this.userProcessing.size > 0) {
                console.log(`[USER-CLEANUP] 🔄 Currently processing ${this.userProcessing.size} users:`, Array.from(this.userProcessing));
            }
            
            // Clear all user processing locks every 2 minutes to prevent deadlocks
            if (this.userProcessing.size > 0) {
                console.log(`[USER-CLEANUP] 🧹 Clearing ${this.userProcessing.size} user processing locks to prevent deadlocks`);
                this.userProcessing.clear();
            }
        }, 2 * 60 * 1000); // Run every 2 minutes
    }

handleLaserStreamData(sourceWallet, signature, txData) {
    // This is now just a clean entry point. All logic is in _executeCopyForUser.
    this._executeCopyForUser(sourceWallet, signature, txData)
        .catch(error => {
            console.error(`[LASERSTREAM] Uncaught error for sig ${signature}:`, error);
        });
}


async getMasterTraderWallets() {
    console.log("--- DEBUGGING getMasterTraderWallets ---");
    
    // Load users data - loadUsers() already returns the users object
    const usersData = await this.dataManager.loadUsers(); 
    const users = Object.values(usersData || {});
    console.log("Found users:", users.map(u => u.chat_id));

    const allActiveWallets = new Set();
    for (const user of users) {
        const traders = await this.dataManager.getTraders(user.chat_id);
        console.log(`User ${user.chat_id} has traders:`, traders.map(t => `${t.name} (Active: ${t.active})`));
        
        const activeTraders = traders.filter(t => t.active);
        console.log(`User ${user.chat_id} has ACTIVE traders:`, activeTraders.map(t => t.wallet));
        
        activeTraders.forEach(t => allActiveWallets.add(t.wallet));
    }

    const finalWallets = Array.from(allActiveWallets);
    console.log("--- FINAL WALLETS TO BE MONITORED ---", finalWallets);
    
    return finalWallets;
}

/**
 * Get trader name from wallet address
 */
async getTraderName(walletAddress) {
    try {
        const tradersByUser = await this.dataManager.getTradersGroupedByUser();
        
        for (const [userId, userTraders] of Object.entries(tradersByUser)) {
            for (const [traderName, trader] of Object.entries(userTraders)) {
                if (trader.wallet === walletAddress) {
                    return traderName;
                }
            }
        }
        return 'Unknown Trader';
    } catch (error) {
        console.error(`[HELPER] Error getting trader name for ${walletAddress}:`, error);
        return 'Unknown Trader';
    }
}

async processTrader(trader) {
    if (this.isProcessing.has(trader.wallet)) return;
    this.isProcessing.add(trader.wallet);
    try {
        let cutoffSignature = this.traderCutoffSignatures.get(trader.wallet);
        if (!cutoffSignature) {
            const signatures = await this.solanaManager.connection.getSignaturesForAddress(
                new PublicKey(trader.wallet), { limit: 1 }
            );
            if (signatures.length > 0) {
                cutoffSignature = signatures[0].signature;
                this.traderCutoffSignatures.set(trader.wallet, cutoffSignature);
                console.log(`[SCAN] Initialized cutoff for ${trader.name}: ${shortenAddress(cutoffSignature)}`);
            }
            return;
        }
        const newSignatures = await this._getNewTransactions(trader.wallet, cutoffSignature);
        if (!newSignatures.length) return;

        this.traderCutoffSignatures.set(trader.wallet, newSignatures[0]);
        if (newSignatures.length > 0) {
            console.log(`[ACTIVITY] ${trader.name} has ${newSignatures.length} new TX(s)`);
        }
        for (const signature of newSignatures.reverse()) {
            await this.processSignature(trader.wallet, signature, trader);
        }
    } catch (error) {
        console.error(`[SCAN] Error processing ${trader.name}:`, error.message);
    } finally {
        this.isProcessing.delete(trader.wallet);
    }
}

async _getNewTransactions(walletAddress, cutoffSignature) {
    try {
        const signatures = await this.solanaManager.connection.getSignaturesForAddress(
            new PublicKey(walletAddress), { limit: 25 } // Increase limit to catch bursts
        );
        const newSigs = [];
        for (const sig of signatures) {
            if (sig.signature === cutoffSignature) break;
            if (!sig.err) newSigs.push(sig.signature);
        }
        return newSigs;
    } catch (error) {
        console.warn(`[POLLER] Failed to get new TXs for ${shortenAddress(walletAddress)}: ${error.message}`);
        return [];
    }
}

async processSignature(sourceWalletAddress, signature, polledTraderInfo = null, rawTxData = null, analysisResult = null) {
    console.log(`[PROCESS_SIG] 🎯 Processing signature for copy trade:`);
    
    // Get trader name for better logging
    const traderName = await this.getTraderName(sourceWalletAddress);
    console.log(`   📍 Source trader: ${traderName} (${shortenAddress(sourceWalletAddress)})`);
    console.log(`   🔑 Signature: ${shortenAddress(signature)}`);
    console.log(`   📊 Has pre-fetched data: ${!!rawTxData}`);
    console.log(`   📋 Pre-fetched data: ${rawTxData ? '✅ Present' : '❌ None'}`);
    console.log(`   🧪 Has analysis result: ${!!analysisResult}`);
    console.log(`   🎯 Analysis result: ${analysisResult ? (analysisResult.isCopyable ? '✅ COPYABLE' : '❌ NOT COPYABLE') : '❌ None'}`);
    
    // This is the universal entry point now for both streams and polling.
    // We delegate immediately to the master execution function.
    this._executeCopyForUser(sourceWalletAddress, signature, rawTxData, analysisResult)
        .catch(error => {
            console.error(`[PROCESS_SIG] ❌ Uncaught error for sig ${shortenAddress(signature)}:`, error);
        });
}

// async _handleCopyError(error, userChatId, traderName, config) {

//     console.error(`[EXEC-USER-${userChatId}] Copy failed for ${traderName}:`, error.message);

//     await this.notificationManager.notifyFailedCopy(
//         parseInt(userChatId), traderName, 'Unknown', 'copy', `Execution failed: ${error.message}`
//     ).catch(e => console.error(`[EXEC-USER-${userChatId}] Notification failed:`, e.message));
// }

// THIS IS THE FINAL, COMBAT-READY VERSION WITH IMPROVEMENTS
// ====== [START OF V2.1 CODE] ====== //


async handleWalletStreamEvent(txData) {
    // Destructure IMMEDIATELY for error safety
    const { signature, traderAddress } = txData;
    try {
        // Get trader name for better logging
        const traderName = await this.getTraderName(traderAddress);
        console.log(`[EXPRESS_LANE] Event from ${traderName} (${shortenAddress(traderAddress)}) | Sig: ${shortenAddress(signature)}`);

        // STEP 1: Mint Extraction
        const targetMint = this._extractMintFromStreamData(txData);
        if (!targetMint) {
            return this.processSignature(traderAddress, signature); // Early exit
        }

        // STEP 2: Dagger Strike (Pre-Signed TX Only)
        const preSignedTxString = this.redisManager.getPreSignedTx(targetMint);
        if (preSignedTxString) {
            console.log(`[EXPRESS_LANE] 🚀 Dagger hit for ${shortenAddress(targetMint)}!`);

            const userInfo = await this._mapTraderToUser(traderAddress);
            if (!userInfo) return; // Abort if no copier

            // Fire pre-signed TX
            const sendResult = await this.solanaManager.sendRawSerializedTransaction(preSignedTxString);
            if (sendResult.error) throw new Error(`Dagger execution failed: ${sendResult.error}`);

            // Post-trade workflow
            await this._handlePostTradeActions(userInfo, targetMint, sendResult.signature);
            return; // Mission complete
        }

        // STEP 3: Fallback (No Dagger)
        console.log(`[EXPRESS_LANE] No Dagger. Falling back to Standard Lane.`);
        return this.processSignature(traderAddress, signature);

    } catch (error) {
        console.error(`[EXPRESS_LANE] Failure: ${error.message}`);
        return this.processSignature(traderAddress, signature); // Error-safe fallback
    }
}

async executeManualSell(userChatId, tokenMint) {
    console.log(`[MANUAL_SELL-${userChatId}] Order received for token: ${shortenAddress(tokenMint)}`);
    const keypairPacket = await this.walletManager.getFirstTradingKeypair(userChatId);
    if (!keypairPacket) {
        return this.notificationManager.notifyFailedCopy(userChatId, 'Manual Sell', 'N/A', 'sell', 'No trading wallet found.');
    }
    const { keypair, wallet } = keypairPacket;

    try {
        // STEP 1: Get the user's position for this token from our database.
        const sellDetails = this.dataManager.getUserSellDetails(String(userChatId), tokenMint);
        if (!sellDetails || sellDetails.amountToSellBN.isZero()) {
            throw new Error(`You do not have a recorded position for this token.`);
        }
        const { amountToSellBN, originalSolSpent } = sellDetails;

        // STEP 2: DYNAMICALLY RE-ANALYZE the token's current platform. THIS IS THE CORE FIX.
        console.log(`[MANUAL_SELL-${userChatId}] Re-analyzing current platform for ${shortenAddress(tokenMint)}...`);
        // Migration status check removed - using UniversalAnalyzer instead
        const migrationStatus = { isMigrated: false, currentPlatform: 'Unknown' };

        let tradeDetails;

        if (migrationStatus.hasMigrated) {
            console.log(`[MANUAL_SELL-${userChatId}] ✅ Migration confirmed to ${migrationStatus.newDexPlatform}. Building for new platform.`);
            tradeDetails = {
                dexPlatform: migrationStatus.newDexPlatform,
                platformSpecificData: migrationStatus.platformSpecificData,
                // other details
            };
        } else {
            // If no migration, we use the cached platform info from the buy.
            const cachedBuyInfo = this.redisManager.getTradeData(tokenMint);
            if (!cachedBuyInfo || !cachedBuyInfo.platform) {
                // As a last resort, check pump.fun AMM using direct connection
                try {
                    const pumpAmmPool = await this.solanaManager.connection.getAccountInfo(new PublicKey(tokenMint));
                    if (pumpAmmPool) {
                        tradeDetails = { dexPlatform: 'Pump.fun AMM' };
                    } else {
                        throw new Error(`Could not determine a valid platform to sell on. Migration may have happened to an unsupported DEX.`);
                    }
                } catch (error) {
                    throw new Error(`Could not determine a valid platform to sell on. Migration may have happened to an unsupported DEX.`);
                }
            } else {
                tradeDetails = { dexPlatform: cachedBuyInfo.platform };
            }
        }

        tradeDetails = {
            ...tradeDetails,
            tradeType: 'sell',
            inputMint: tokenMint,
            outputMint: config.NATIVE_SOL_MINT,
            originalSolSpent: originalSolSpent
        };

        console.log(`[MANUAL_SELL-${userChatId}] Final trade platform determined: ${tradeDetails.dexPlatform}`);

        // STEP 3: EXECUTE a universal API swap. It's safer and covers all platforms.
        // We bypass the complex _sendTradeTransaction to reduce points of failure for sells.
        await this.executeUniversalApiSwap(
            tradeDetails,
            "Manual Sell",
            userChatId,
            keypairPacket
        );

    } catch (error) {
        console.error(`[MANUAL_SELL-${userChatId}] CRITICAL SELL FAILURE for ${shortenAddress(tokenMint)}:`, error);
        await this.notificationManager.notifyFailedCopy(userChatId, 'Manual Sell', wallet.label, 'sell', error.message);
    }
}
// ===== [END] NEW STRATEGIC SELL EXECUTION FUNCTION ===== //



async _executeCopyForUser(sourceWalletAddress, signature, rawTxData, analysisResult = null) {
    if (this.isProcessing.has(signature)) {
        console.log(`[EXECUTE_MASTER] ⚠️ Already processing signature ${shortenAddress(signature)}, skipping...`);
        return;
    }
    
    // Check if this transaction has already failed - prevent retries
    if (this.failedTransactions.has(signature)) {
        console.log(`[EXECUTE_MASTER] ❌ Transaction ${shortenAddress(signature)} already failed, skipping retry...`);
        return;
    }
    
        // ✅ ADDITIONAL TIME-BASED FILTERING: Final check before processing
        if (!this.isTransactionRecentForCopyTrading(rawTxData, signature)) {
            console.log(`[EXECUTE_MASTER] ⏰ Skipping old transaction ${shortenAddress(signature)} - too old for copy trading`);
            return;
        }
    
    this.isProcessing.add(signature);

    try {
        console.log(`[EXECUTE_MASTER] 🔍 Starting analysis for transaction ${shortenAddress(signature)}...`);
        
        // Get trader name for better logging
        const traderName = await this.getTraderName(sourceWalletAddress);
        console.log(`[EXECUTE_MASTER] 📍 Source trader: ${traderName} (${shortenAddress(sourceWalletAddress)})`);
        console.log(`[EXECUTE_MASTER] 📊 Pre-fetched data available: ${!!rawTxData}`);
        console.log(`[EXECUTE_MASTER] 🔍 Pre-fetched data type: ${typeof rawTxData}`);
        console.log(`[EXECUTE_MASTER] 🔍 Pre-fetched data keys: ${rawTxData ? Object.keys(rawTxData) : 'null'}`);
        console.log(`[EXECUTE_MASTER] 🧪 Has analysis result: ${!!analysisResult}`);
        console.log(`[EXECUTE_MASTER] 🔍 Analysis result type: ${typeof analysisResult}`);
        console.log(`[EXECUTE_MASTER] 🔍 Analysis result keys: ${analysisResult ? Object.keys(analysisResult) : 'null'}`);
        
        // EARLY EXIT: If we have analysis result and it's NOT copyable, stop here
        if (analysisResult && !analysisResult.isCopyable) {
            console.log(`[EXECUTE_MASTER] ❌ Pre-analysis shows NOT COPYABLE: ${analysisResult.reason}`);
            this.isProcessing.delete(signature);
            return;
        }
        
        // ANALYSIS PHASE: Use pre-analyzed results OR fail (no re-analysis!)
        if (analysisResult && analysisResult.isCopyable) {
            console.log(`[EXECUTE_MASTER] 🎯 Using pre-analyzed results from monitor worker!`);
            console.log(`[EXECUTE_MASTER] ✅ Analysis: ${analysisResult.reason}`);
            console.log(`[EXECUTE_MASTER] 🏪 Platform: ${analysisResult.details?.dexPlatform}`);
            console.log(`[EXECUTE_MASTER] 🎯 Trade Type: ${analysisResult.details?.tradeType}`);
            console.log(`[EXECUTE_MASTER] 📋 Has Cloning Target: ${!!analysisResult.details?.cloningTarget}`);
        } else {
            console.log(`[EXECUTE_MASTER] ❌ NO PRE-ANALYZED RESULTS - This should not happen!`);
            console.log(`[EXECUTE_MASTER] ❌ Monitor worker should have provided analysis results.`);
            this.isProcessing.delete(signature);
            return;
        }
        
        // CONTINUE WITH UNIFIED EXECUTION FLOW
        
        // Extract real mint addresses from transaction data
        let inputMint = 'So11111111111111111111111111111111111111112'; // Default to SOL
        let outputMint = 'unknown';
        
        try {
            if (rawTxData && rawTxData.transaction && rawTxData.transaction.transaction) {
                const tx = rawTxData.transaction.transaction;
                if (tx.message && tx.message.accountKeys) {
                    console.log(`[EXECUTE_MASTER] 🔍 Extracting mints from ${tx.message.accountKeys.length} account keys`);
                    
                    // For Pump.fun and most DEX swaps, we need to look at token balances
                    if (tx.meta && tx.meta.preTokenBalances && tx.meta.postTokenBalances) {
                        // Find token balance changes to identify the token mint
                        const preBalances = tx.meta.preTokenBalances || [];
                        const postBalances = tx.meta.postTokenBalances || [];
                        
                        // Look for new token balances (indicating a token was received)
                        for (const postBalance of postBalances) {
                            const preBalance = preBalances.find(pb => pb.accountIndex === postBalance.accountIndex);
                            if (!preBalance || preBalance.uiTokenAmount.uiAmount === 0) {
                                // This is a new token balance - this is our output mint
                                outputMint = postBalance.mint;
                                console.log(`[EXECUTE_MASTER] 🎯 Found output mint: ${shortenAddress(outputMint)}`);
                                break;
                            }
                        }
                        
                        // If we didn't find a new token, look for existing token changes
                        if (outputMint === 'unknown') {
                            for (const postBalance of postBalances) {
                                const preBalance = preBalances.find(pb => pb.accountIndex === postBalance.accountIndex);
                                if (preBalance && preBalance.uiTokenAmount.uiAmount !== postBalance.uiTokenAmount.uiAmount) {
                                    // Token balance changed - this could be our output mint
                                    outputMint = postBalance.mint;
                                    console.log(`[EXECUTE_MASTER] 🎯 Found changing token mint: ${shortenAddress(outputMint)}`);
                                    break;
                                }
                            }
                        }
                    }
                    
                    // If still no output mint found, use a placeholder that won't cause validation errors
                    if (outputMint === 'unknown') {
                        // For Pump.fun, we'll use a generic token mint that won't cause validation issues
                        outputMint = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'; // USDC as fallback
                        console.log(`[EXECUTE_MASTER] ⚠️ Using fallback output mint: ${shortenAddress(outputMint)}`);
                    }
                }
            }
        } catch (error) {
            console.log(`[EXECUTE_MASTER] ⚠️ Could not extract mint addresses, using defaults: ${error.message}`);
            // Use fallback mints that won't cause validation errors
            outputMint = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'; // USDC as fallback
        }
        
        // DIRECT EXECUTION - Use pre-analyzed blueprint (NO re-analysis!)
        console.log(`[EXECUTE_MASTER] 🚀 DIRECT EXECUTION - Using pre-analyzed blueprint from Monitor`);

        // =========================================================
        // ======= REMOVED: HIGH-CONFIDENCE EXECUTION GATE ========
        // =========================================================
        // ALL trades are now copyable - we'll use Jupiter fallback for unknown DEX
        // =========================================================
        // =================== END EXECUTION GATE ==================
        // =========================================================
        
        // Clean summary instead of massive JSON dump
        if (analysisResult.isCopyable && analysisResult.summary) {
            console.log(`[EXECUTE_MASTER] 📊 ${analysisResult.summary}`);
        } else if (analysisResult.isCopyable) {
            console.log(`[EXECUTE_MASTER] ✅ Copyable: ${analysisResult.details?.dexPlatform} ${analysisResult.details?.tradeType}`);
        } else {
            console.log(`[EXECUTE_MASTER] ❌ Not copyable: ${analysisResult.reason}`);
        }
        
        if (!analysisResult.isCopyable) {
            console.log(`[EXECUTE_MASTER] ❌ Transaction not copyable. Reason: ${analysisResult.reason || 'Unknown'}`);
            return;
        }
        
        console.log(`[EXECUTE_MASTER] ✅ Transaction is copyable! Platform: ${analysisResult.details.dexPlatform}, Type: ${analysisResult.details.tradeType}`);

        // Use platform from deep analysis result
        const detectedPlatform = analysisResult.details.dexPlatform;
        console.log(`[EXECUTE_MASTER] 🎯 Using platform from analysis: ${detectedPlatform}`);

        // ✅ UNIVERSAL CLONING ENGINE: All platforms use the same cloning approach
        console.log(`[EXECUTE_MASTER] 🎯 Using Universal Cloning Engine for all platforms`);
        
        // Platform-specific compute unit configurations (for optimization)
        const platformConfigs = {
            'UniversalCloner': { units: 800000 }, // Default compute units
            'Photon': { units: 1000000 },          // A known router that might need more gas
            'F5tfvbLog9VdGUPqBDTT8rgXvTTcq7e5UiGnupL1zvBq': { units: 1200000 } // Custom router by address
        };
        
        const platformId = analysisResult.details.platformProgramId;
        const platformConfig = platformConfigs[platformId] || platformConfigs['UniversalCloner'];
        const computeUnits = platformConfig.units;
        
        console.log(`[EXECUTE_MASTER] 🔧 Platform: ${detectedPlatform} | Program ID: ${shortenAddress(platformId)} | Compute Units: ${computeUnits}`);

        console.log(`[EXECUTE_MASTER] 🔍 Loading traders from database...`);
        const syndicateData = await this.dataManager.loadTraders();
        console.log(`[EXECUTE_MASTER] 📊 Found ${Object.keys(syndicateData.user_traders || {}).length} users with traders`);
        
        // Get the actual detected trader name for consistency
        const detectedTraderName = await this.getTraderName(sourceWalletAddress);
        
        const copyJobs = [];
        for (const [userChatId, userTraders] of Object.entries(syndicateData.user_traders || {})) {
            // Check if user has any active traders (regardless of which specific trader is making the trade)
            const hasActiveTraders = Object.values(userTraders).some(traderConfig => traderConfig.active);
            if (hasActiveTraders) {
                // Use the actual detected trader name instead of first active trader
                copyJobs.push({ userChatId: parseInt(userChatId), traderName: detectedTraderName });
                console.log(`[EXECUTE_MASTER] ✅ Found user ${userChatId} copying trader: ${detectedTraderName}`);
            }
        }
        
        if (copyJobs.length === 0) {
            const traderName = await this.getTraderName(sourceWalletAddress);
            console.log(`[EXECUTE_MASTER] ⚠️ No active traders found for ${traderName} (${shortenAddress(sourceWalletAddress)})`);
            return;
        }
        
        console.log(`[EXECUTE_MASTER] 🚀 Dispatching copy for ${detectedPlatform} trade to ${copyJobs.length} user(s).`);
        
        // Add Router-specific data to analysis result details
        if (analysisResult.details.dexPlatform === 'Router') {
            const routerDetection = analysisResult.platformDetection?.identifiedPlatforms?.[0];
            if (routerDetection?.cloningTarget) {
                analysisResult.details.cloningTarget = routerDetection.cloningTarget;
                analysisResult.details.masterTraderWallet = analysisResult.details.traderPubkey;
                console.log(`[EXECUTE_MASTER] 🎯 Added Router cloning data to analysis result`);
            }
        }

        // Debug: Log the analysisResult.details before passing to Direct Solana Sender
        console.log(`[EXECUTE_MASTER] 🔍 AnalysisResult.details before Direct Solana Sender:`, {
            tradeType: analysisResult.details.tradeType,
            inputMint: analysisResult.details.inputMint,
            outputMint: analysisResult.details.outputMint,
            dexPlatform: analysisResult.details.dexPlatform,
            hasInputMint: !!analysisResult.details.inputMint,
            hasOutputMint: !!analysisResult.details.outputMint,
            inputMintType: typeof analysisResult.details.inputMint,
            outputMintType: typeof analysisResult.details.outputMint,
            hasCloningTarget: !!analysisResult.details.cloningTarget
        });
        
        // Debug: Log cloning target accounts structure
        if (analysisResult.details.cloningTarget?.accounts) {
            console.log(`[EXECUTE_MASTER] 🔍 DEBUG: Cloning Target Accounts:`, JSON.stringify(analysisResult.details.cloningTarget.accounts.slice(0, 3), null, 2));
        }

        await Promise.allSettled(
            copyJobs.map(job => 
                this._executeCopyTradeWithDirectSolanaSender( // Use Direct Solana Sender for ultra-fast execution
                    analysisResult.details, 
                    job.traderName, 
                    job.userChatId, 
                    signature,
                    { computeUnits }, // Pass compute units instead of executor config
                    analysisResult.originalTransaction // Pass the original transaction for structure cloning
                )
            )
        );

    } catch (error) {
        console.error(`[MASTER_EXECUTION] ❌ Top-level error for sig ${shortenAddress(signature)}:`, error.message);
        console.error(`[MASTER_EXECUTION] Stack trace:`, error.stack);
        
        // Mark transaction as failed to prevent retries
        this.failedTransactions.add(signature);
        const blockhash = this.currentBlockhash || 'unknown';
        this.failedTransactionBlockhashes.set(signature, blockhash);
        console.log(`[MASTER_EXECUTION] 🚫 Marked transaction ${shortenAddress(signature)} as failed - will not retry`);
    } finally {
        this.isProcessing.delete(signature);
    }
}

async _precacheSellInstruction(buySignature, tradeDetails, strategy = 'preSign') {
    if (!buySignature || !tradeDetails?.outputMint) {
        console.warn(`[PRE-SELL] Skipping precache: Missing buy signature or token mint.`);
        return;
    }

    const tokenMint = tradeDetails.outputMint;
    const userChatId = tradeDetails.userChatId;
    console.log(`[PRE-SELL-${userChatId}] Initiated for ${shortenAddress(tokenMint)} | Sig: ${shortenAddress(buySignature)}`);

    try {
        // === 1️⃣ WALLET & BUY VALIDATION ===
        const walletPacket = await this.walletManager.getPrimaryTradingKeypair(userChatId);
        if (!walletPacket) throw new Error("No trading wallet found to build sell instruction.");

        const { keypair, wallet } = walletPacket;

        const amountReceivedBN = await this._getAmountReceivedFromBuy(buySignature, keypair.publicKey.toBase58(), tokenMint);

        if (amountReceivedBN.isZero()) {
            throw new Error("Could not determine exact token amount received from the buy transaction.");
        }

        console.log(`[PRE-SELL-${userChatId}] Confirmed ${amountReceivedBN.toString()} raw units of ${shortenAddress(tokenMint)} received.`);

        // === 2️⃣ BUILD SELL DETAILS ===
        const sellTradeDetails = {
            ...tradeDetails,
            tradeType: 'sell',
            inputMint: tradeDetails.outputMint,
            outputMint: config.NATIVE_SOL_MINT, // Always selling for SOL
            inputAmountRaw: amountReceivedBN.toString(), // Important for PnL
        };

        // 🚫 LAUNCHPAD SELL BLOCKER
        if (sellTradeDetails.dexPlatform === 'Raydium Launchpad') {
            console.warn(`[PRE-SELL-${userChatId}] ❌ LOGICAL OVERRIDE: Cannot prebuild sell for Raydium Launchpad. Awaiting migration.`);
            // Don't cache bad data. We just wait for a migration event.
            return;
        }

        // ✅ UNIVERSAL CLONING ENGINE: No need for platform-specific builders
        console.log(`[PRE-SELL-${userChatId}] 🎯 Using Universal Cloning Engine for all platforms`);
        console.log(`[PRE-SELL-${userChatId}] 📍 Universal Cloner handles all platforms without platform-specific builders`);

        // Get nonce info for durable transactions (eliminates old hash errors)
        let nonceInfo = null;
        if (wallet.nonceAccountPubkey) {
            try {
                const { nonce, nonceAuthority } = await this.solanaManager.getLatestNonce(wallet.nonceAccountPubkey);
                nonceInfo = {
                    noncePubkey: wallet.nonceAccountPubkey,
                    authorizedPubkey: nonceAuthority,
                    nonce: nonce
                };
                console.log(`[PRE-SELL-${userChatId}] 🔐 Using durable nonce: ${shortenAddress(nonce)} from account: ${shortenAddress(wallet.nonceAccountPubkey.toString())}`);
            } catch (nonceError) {
                console.warn(`[PRE-SELL-${userChatId}] ⚠️ Failed to get nonce info: ${nonceError.message}. Using regular blockhash.`);
            }
        }

        // ✅ UNIVERSAL CLONING ENGINE: Use Universal Cloner for pre-cached sells too
        const builderOptions = {
            userPublicKey: keypair.publicKey,
            masterTraderWallet: sellTradeDetails.traderPubkey,
            cloningTarget: sellTradeDetails.cloningTarget,
            tradeType: sellTradeDetails.tradeType,
            inputMint: sellTradeDetails.inputMint,
            outputMint: sellTradeDetails.outputMint,
            amountBN: amountReceivedBN, // Use the precise amount we received
            slippageBps: 9000, // High slippage for "get me out" sells
            userChatId: userChatId,
            userSolAmount: new (require('bn.js'))(Math.floor(0.01 * 1e9)), // Default for sells
            userTokenBalance: amountReceivedBN,
            userRiskSettings: { slippageTolerance: 9000, maxTradesPerDay: 10 },
            // NEW: Durable nonce support
            nonceInfo: nonceInfo
        };

        const cloneResult = await this.universalCloner.buildClonedInstruction(builderOptions);
        const sellInstructions = cloneResult.instructions;
        if (!sellInstructions?.length) {
            throw new Error(`Sell builder for ${sellTradeDetails.dexPlatform} returned no instructions.`);
        }

        const sellReadyPacket = {
            platform: sellTradeDetails.dexPlatform,
            prebuiltSellInstructions: sellInstructions,
            sellAmountRaw: amountReceivedBN.toString(),
            solSpent: tradeDetails.solSpent,
            buyTimestamp: Date.now(),
            sellReady: true // A flag to indicate we can trigger this sell
        };

        this.redisManager.addTradeData(tokenMint, sellReadyPacket);
        console.log(`[PRE-SELL-${userChatId}] ✅ PRE-BUILT (Instruction-only) sell is cached & ready for ${shortenAddress(tokenMint)}.`);

    } catch (error) {
        console.error(`[PRE-SELL] ❌ FAILED to precache sell for ${shortenAddress(tradeDetails.outputMint)}: ${error.message}`);
    }
}

async _sendTradeForUser(tradeDetails, traderName, userChatId, masterTxSignature, executorConfig) {
    await traceLogger.initTrace(masterTxSignature, tradeDetails.traderPubkey, userChatId);
    
    // ✅ USER-FRIENDLY FIX: Graceful handling of missing wallets.
    const keypairPacket = await this.walletManager.getPrimaryTradingKeypair(userChatId);
    if (!keypairPacket) {
        this.notificationManager.notifyFailedCopy(userChatId, traderName, "N/A", "copy", "No trading wallet found.");
        await traceLogger.recordOutcome(masterTxSignature, 'FAILURE', "User has no trading wallet.");
        return; // Exit gracefully for this user.
    }
    const { keypair, wallet } = keypairPacket;

    // ====== ONE-BUY-ONE-SELL GATEKEEPER ======
    // ENABLED: One buy per token, complete sell on sell
    const isBuy = tradeDetails.tradeType === 'buy';
    if (isBuy) {
        const userPositions = await this.dataManager.getUserPositions(String(userChatId));
        const tokenToBuy = tradeDetails.outputMint;

        // Check if the user ALREADY has a position and it's not empty.
        if (userPositions.has(tokenToBuy) && userPositions.get(tokenToBuy).amountRaw > 0n) {
            const reason = `You already have an active position for ${shortenAddress(tokenToBuy)}. One buy per token is allowed.`;
            console.log(`[GATEKEEPER-${userChatId}] SKIPPING BUY for ${traderName}. Reason: ${reason}`);
            
            // CRITICAL: Stop the function here to prevent the buy.
            return; 
        }
    }
// ===========================================

    try {
        // ✅ UNIVERSAL CLONING ENGINE: All platforms use Universal Cloner now
        console.log(`[PIVOT-EXEC] Using Universal Cloning Engine for "${tradeDetails.dexPlatform}" for user ${userChatId}.`);
        
        const computeUnits = 800000; // Default compute units for Universal Cloner
        const isBuy = tradeDetails.tradeType === 'buy';
        let amountBN, solAmountForNotification = 0;
        let preInstructions = [];

        if (isBuy) {
            const solAmounts = await this.dataManager.loadSolAmounts();
            solAmountForNotification = solAmounts[String(userChatId)] || config.DEFAULT_SOL_TRADE_AMOUNT;
            amountBN = new BN(Math.floor(solAmountForNotification * config.LAMPORTS_PER_SOL_CONST));
            tradeDetails.solSpent = solAmountForNotification;
            preInstructions.push(createAssociatedTokenAccountIdempotentInstruction(keypair.publicKey, getAssociatedTokenAddressSync(new PublicKey(tradeDetails.outputMint), keypair.publicKey), keypair.publicKey, new PublicKey(tradeDetails.outputMint)));
        } else { // ✅ ENHANCED SELL logic with better validation
            const sellDetails = this.dataManager.getUserSellDetails(String(userChatId), tradeDetails.inputMint);
            
            if (!sellDetails || !sellDetails.amountToSellBN || sellDetails.amountToSellBN.isZero()) {
                console.warn(`[SELL-VALIDATION] No recorded position found in database, trying on-chain balance check...`);
                
                // ✅ FALLBACK: Check on-chain balance if database position is missing
                try {
                    const onChainBalance = await this._getOnChainTokenBalance(keypair.publicKey.toBase58(), tradeDetails.inputMint);
                    if (onChainBalance.gt(new BN(0))) {
                        console.log(`[SELL-VALIDATION] Found ${onChainBalance.toString()} tokens on-chain, using this amount`);
                        amountBN = onChainBalance;
                        tradeDetails.originalSolSpent = 0; // Unknown original amount
                        
                        // ✅ RECORD the position for future reference
                        await this.dataManager.recordBuyPosition(userChatId, tradeDetails.inputMint, onChainBalance.toString(), 0);
                        console.log(`[SELL-VALIDATION] Recorded on-chain position in database for future reference`);
                    } else {
                        throw new Error(`No recorded position for this token and no tokens found on-chain.`);
                    }
                } catch (balanceError) {
                    console.error(`[SELL-VALIDATION] On-chain balance check failed: ${balanceError.message}`);
                    throw new Error(`No recorded position for this token and unable to verify on-chain balance.`);
                }
            } else {
                console.log(`[SELL-VALIDATION] Using database position: ${sellDetails.amountToSellBN.toString()} tokens`);
                // ✅ ONE-BUY-ONE-SELL: Always sell the complete position (all tokens)
                amountBN = sellDetails.amountToSellBN;
                tradeDetails.originalSolSpent = sellDetails.originalSolSpent;
                console.log(`[ONE-SELL] Selling complete position: ${amountBN.toString()} tokens`);
            }
        }

        // Get nonce info for durable transactions (eliminates old hash errors)
        let nonceInfo = null;
        if (wallet.nonceAccountPubkey) {
            try {
                const { nonce, nonceAuthority } = await this.solanaManager.getLatestNonce(wallet.nonceAccountPubkey);
                nonceInfo = {
                    noncePubkey: wallet.nonceAccountPubkey,
                    authorizedPubkey: nonceAuthority,
                    nonce: nonce
                };
                console.log(`[PIVOT-EXEC] 🔐 Using durable nonce: ${shortenAddress(nonce)} from account: ${shortenAddress(wallet.nonceAccountPubkey.toString())}`);
            } catch (nonceError) {
                console.warn(`[PIVOT-EXEC] ⚠️ Failed to get nonce info: ${nonceError.message}. Using regular blockhash.`);
            }
        }

        // ✅ UNIVERSAL CLONING ENGINE: Use Universal Cloner instead of old builders
        const buildOptions = {
            userPublicKey: keypair.publicKey,
            masterTraderWallet: tradeDetails.traderPubkey,
            cloningTarget: tradeDetails.cloningTarget,
            tradeType: tradeDetails.tradeType,
            inputMint: tradeDetails.inputMint,
            outputMint: tradeDetails.outputMint,
            amountBN: amountBN,
            slippageBps: isBuy ? 5000 : 9000, // 50% for buys, 90% for sells 
            userChatId: userChatId,
            userSolAmount: isBuy ? amountBN : new (require('bn.js'))(Math.floor(0.01 * 1e9)),
            userTokenBalance: isBuy ? null : amountBN,
            userRiskSettings: { slippageTolerance: isBuy ? 5000 : 9000, maxTradesPerDay: 10 },
            // NEW: Durable nonce support
            nonceInfo: nonceInfo
        };
        
        const preSellBalance = await this.solanaManager.connection.getBalance(keypair.publicKey);
        const cloneResult = await this.universalCloner.buildClonedInstruction(buildOptions);
        const instructions = cloneResult.instructions;
        if (!instructions || !instructions.length) throw new Error("Platform builder returned no instructions.");
        
        // ✅ HELIUS SENDER HANDLES COMPUTE BUDGET AUTOMATICALLY
        // No need to add compute budget instructions - Helius Sender will add them
        const finalInstructions = [
            ...preInstructions,
            ...instructions
        ];
        
        console.log(`[TRADING-ENGINE] 🎯 Letting Helius Sender handle compute budget automatically`);

        const { signature, error: sendError } = await this.solanaManager.sendVersionedTransaction({ instructions: finalInstructions, signer: keypair });
                // ======= FEE CAPTURE START =======
        let solFee = 0;
        try {
            const txDetails = await this.solanaManager.connection.getTransaction(signature, { 
                maxSupportedTransactionVersion: 0,
                encoding: 'json'
            });
            if (txDetails && txDetails.meta) {
                solFee = (txDetails.meta.fee || 0) / config.LAMPORTS_PER_SOL_CONST;
            }
        } catch (feeError) {
            console.warn(`[FEE_CAPTURE] Could not fetch tx details for ${signature}:`, feeError.message);
        }
        // ======= FEE CAPTURE END =========

        if (sendError) throw new Error(sendError);

        await traceLogger.recordOutcome(masterTxSignature, 'SUCCESS', signature);
        console.log(`[EXECUTION] ✅ Success for user ${userChatId} on ${tradeDetails.dexPlatform}. Sig: ${signature}`);

        const finalizedDetails = { 
            ...tradeDetails, 
            signature, 
            solSpent: solAmountForNotification, 
            solFee: solFee,
            tradeType: tradeDetails.tradeType || 'copy' // Ensure tradeType is present
        };
        await this.notificationManager.notifySuccessfulCopy(userChatId, traderName, wallet.label, finalizedDetails);
        if (isBuy) {
            // ✅ FIX: Ensure we have a valid token amount before recording position
            let tokenAmount = finalizedDetails.outputAmountRaw;
            if (!tokenAmount || tokenAmount === "0") {
                console.warn(`[POSITION-FIX] No outputAmountRaw in finalizedDetails, calculating from transaction...`);
                try {
                    const calculatedAmount = await this._getAmountReceivedFromBuy(signature, keypair.publicKey.toBase58(), finalizedDetails.outputMint);
                    tokenAmount = calculatedAmount.toString();
                    console.log(`[POSITION-FIX] Calculated amount: ${tokenAmount} for token ${shortenAddress(finalizedDetails.outputMint)}`);
                } catch (calcError) {
                    console.error(`[POSITION-FIX] Failed to calculate token amount: ${calcError.message}`);
                    // Don't record position if we can't determine the amount
                    console.warn(`[POSITION-FIX] Skipping position recording due to amount calculation failure`);
                    return;
                }
            }
            
            // Only record position if we have a valid non-zero amount
            if (tokenAmount && tokenAmount !== "0" && BigInt(tokenAmount) > 0n) {
                await this.dataManager.recordBuyPosition(userChatId, finalizedDetails.outputMint, tokenAmount, solAmountForNotification);
                console.log(`[POSITION-FIX] ✅ Position recorded: ${tokenAmount} tokens for ${shortenAddress(finalizedDetails.outputMint)}`);
                finalizedDetails.userChatId = userChatId;
                await this._precacheSellInstruction(signature, finalizedDetails);
            } else {
                console.error(`[POSITION-FIX] ❌ Invalid token amount (${tokenAmount}), skipping position recording`);
            }
               } else {
            // Get post-sell balance to calculate solReceived accurately
            const postSellBalance = await this.solanaManager.connection.getBalance(keypair.publicKey);
            const solReceived = (postSellBalance - preSellBalance + finalizedDetails.solFee * config.LAMPORTS_PER_SOL_CONST) / config.LAMPORTS_PER_SOL_CONST;
            finalizedDetails.solReceived = solReceived;

            await this.dataManager.updatePositionAfterSell(
                userChatId, 
                tradeDetails.inputMint, 
                amountBN.toString(), 
                finalizedDetails.solFee, 
                solReceived
            );
        }
    } catch (error) {
        console.error(`[EXECUTION] ❌ FAILED for user ${userChatId} (${shortenAddress(masterTxSignature)}):`, error.message);
        await traceLogger.recordOutcome(masterTxSignature, 'FAILURE', error.message);
        this.notificationManager.notifyFailedCopy(userChatId, traderName, wallet.label, tradeDetails.tradeType, error.message);
    }
}


// Helper function extracted for clarity
async _getAmountReceivedFromBuy(buySignature, walletAddress, tokenMint) {
    try {
        console.log(`[AMOUNT-CALC] Calculating amount received for ${shortenAddress(tokenMint)} from tx ${shortenAddress(buySignature)}`);
        
        const txInfo = await this.solanaManager.connection.getTransaction(buySignature, { 
            maxSupportedTransactionVersion: 0,
            encoding: 'json'
        });
        
        if (!txInfo) {
            throw new Error(`Transaction ${buySignature} not found`);
        }
        
        if (txInfo.meta.err) {
            throw new Error(`Transaction ${buySignature} failed with error: ${JSON.stringify(txInfo.meta.err)}`);
        }

        // ✅ IMPROVED: Better token balance detection
        const postBalance = txInfo.meta.postTokenBalances?.find(tb => 
            tb.owner === walletAddress && tb.mint === tokenMint
        );
        const preBalance = txInfo.meta.preTokenBalances?.find(tb => 
            tb.owner === walletAddress && tb.mint === tokenMint
        );

        console.log(`[AMOUNT-CALC] Pre-balance: ${preBalance?.uiTokenAmount?.amount || '0'}, Post-balance: ${postBalance?.uiTokenAmount?.amount || '0'}`);

        const postAmount = new BN(postBalance?.uiTokenAmount?.amount || '0');
        const preAmount = new BN(preBalance?.uiTokenAmount?.amount || '0');
        const amountReceived = postAmount.sub(preAmount);

        console.log(`[AMOUNT-CALC] Calculated amount received: ${amountReceived.toString()}`);

        // ✅ FALLBACK: If transaction metadata fails, try on-chain balance check
        if (amountReceived.isZero()) {
            console.warn(`[AMOUNT-CALC] Transaction metadata shows 0 amount, trying on-chain balance check...`);
            try {
                const currentBalance = await this._getOnChainTokenBalance(walletAddress, tokenMint);
                if (currentBalance.gt(new BN(0))) {
                    console.log(`[AMOUNT-CALC] On-chain balance shows ${currentBalance.toString()} tokens, using this as fallback`);
                    return currentBalance;
                }
            } catch (balanceError) {
                console.warn(`[AMOUNT-CALC] On-chain balance check failed: ${balanceError.message}`);
            }
        }

        return amountReceived;
    } catch (error) {
        console.error(`[AMOUNT-CALC] Error calculating amount received: ${error.message}`);
        throw error;
    }
}

// ✅ NEW: Helper function to get on-chain token balance as fallback
async _getOnChainTokenBalance(walletAddress, tokenMint) {
    try {
        const { getAssociatedTokenAddressSync } = require('@solana/spl-token');
        const { PublicKey } = require('@solana/web3.js');
        
        const userPublicKey = new PublicKey(walletAddress);
        const mintPublicKey = new PublicKey(tokenMint);
        
        // Get the associated token account address
        const tokenAccountAddress = getAssociatedTokenAddressSync(mintPublicKey, userPublicKey);
        
        // First check if the token account exists
        const accountInfo = await this.solanaManager.connection.getAccountInfo(tokenAccountAddress);
        
        if (!accountInfo) {
            console.log(`[ON-CHAIN-BALANCE] Token account for ${shortenAddress(tokenMint)} does not exist - user has never held this token`);
            return new BN(0);
        }
        
        // If account exists, get the balance
        const tokenAccountInfo = await this.solanaManager.connection.getTokenAccountBalance(tokenAccountAddress);
        
        if (tokenAccountInfo.value) {
            const balance = new BN(tokenAccountInfo.value.amount);
            console.log(`[ON-CHAIN-BALANCE] Found ${balance.toString()} tokens for ${shortenAddress(tokenMint)}`);
            return balance;
        }
        
        return new BN(0);
    } catch (error) {
        // Handle specific error cases
        if (error.message.includes('could not find account') || error.message.includes('Invalid param')) {
            console.log(`[ON-CHAIN-BALANCE] Token account for ${shortenAddress(tokenMint)} does not exist - user has never held this token`);
        } else {
            console.warn(`[ON-CHAIN-BALANCE] Failed to get balance for ${shortenAddress(tokenMint)}: ${error.message}`);
        }
        return new BN(0);
    }
}


// async processLivePoolCreation(instructionData) {
//     try {
//         console.log(`[LIVE_POOL] Detected new pool creation event. Sig: ${instructionData.Transaction.Signature}`);

//         // Access the parsed data we passed from apiManager
//         const poolId = instructionData.parsedPoolData?.poolId;
//         const configId = instructionData.parsedPoolData?.configId; // New
//         if (!poolId || !configId) {
//             console.warn('[LIVE_POOL] Skipping event: Missing poolId or configId from parsed data.');
//             return;
//         }

//         // ... Existing tokenMint and metadata extraction from instructionData.Instruction.Program.Arguments ...
//         // No change for metadata:
//         const args = instructionData.Instruction.Program.Arguments;
//         const findArgValue = (name) => {
//             const arg = args.find(a => a.Name === name);
//             return arg?.Value?.json;
//         };
//         const tokenMint = findArgValue("base_mint_param");
//         const metadata = findArgValue("metadata");

//         if (!tokenMint || !metadata?.symbol) {
//             console.warn(`[LIVE_POOL] Skipping event: Missing tokenMint or metadata. Token: ${tokenMint}, Metadata:`, metadata);
//             return;
//         }

//         console.log(`[LIVE_POOL] ⚡ Sniper Target Acquired: ${metadata.symbol} (${shortenAddress(tokenMint)})`);

//         const tradeDetails = {
//             tradeType: 'buy',
//             dexPlatform: 'Raydium Launchpad',
//             inputMint: config.NATIVE_SOL_MINT,
//             outputMint: tokenMint,
//             platformSpecificData: {
//                 poolId: poolId,
//                 configId: configId // CRITICAL: Pass configId to tradeDetails
//             },
//             inputAmountRaw: '0',
//             outputAmountRaw: '0'
//         };

//         await this.executeRaydiumLaunchpadTrade(tradeDetails, "RaydiumLaunchpadSniper"); // Note: You'll still need userChatId and keypairPacket logic if calling from sniper context

//     } catch (error) {
//         console.error(`[LIVE_POOL] CRITICAL FAILURE processing new pool. Error: ${error.message}`);
//     }
// }

async handleTokenMigration(migrationEvent) {
    const { tokenMint, signature, fromPlatform, toPlatform } = migrationEvent;

    console.log(`[MIGRATION-HUB] Event received: ${shortenAddress(tokenMint)} from ${fromPlatform} -> ${toPlatform}.`);

    // Step 1: Load the entire syndicate's positions.
    const allPositions = await this.dataManager.loadPositions();
    if (!allPositions?.user_positions) return;

    // Step 2: Loop through every single user in the bot.
    for (const chatId in allPositions.user_positions) {
        const userPositions = allPositions.user_positions[chatId];

        // Step 3: Check if THIS specific user holds the token.
        const position = userPositions[tokenMint];
        if (position && position.amountRaw > 0n) {
            console.log(`[MIGRATION-HUB] ✅ User ${chatId} holds this token. Sending notification...`);

            // Step 4: Send a private, pinned notification ONLY to that user.
            this.notificationManager.notifyMigrationEvent(
                chatId,
                tokenMint,
                fromPlatform,
                toPlatform,
                signature
            ).catch(e => console.error(`[MIGRATE-NOTIFY-ERR] Failed to notify user ${chatId}: ${e.message}`));
        }
    }
}



async processRaydiumV4PoolCreation(signature) {
    try {
        console.log(`[V4-SNIPER] Detected new Raydium V4 pool creation. Sig: ${shortenAddress(signature, 10)}`);

        // Use getParsedTransaction, as shown in the QuickNode video.
        const tx = await this.solanaManager.connection.getParsedTransaction(signature, { 
            maxSupportedTransactionVersion: 0,
            encoding: 'json'
        });
        if (!tx || !tx.meta) {
            console.warn('[V4-SNIPER] Failed to fetch or parse the transaction.');
            return;
        }

        // Find the 'initialize2' instruction.
        const initInstruction = tx.transaction.message.instructions.find(ix =>
            tx.meta.logMessages.some(log => log.includes(`Instruction: ${ix.programId}`) && log.includes("initialize2"))
        );

        if (!initInstruction) {
            console.warn('[V4-SNIPER] Could not find the "initialize2" instruction in the transaction.');
            return;
        }

        // The Golden Goose: Extract mints from the fixed account indexes.
        const tokenA_Mint = initInstruction.accounts[8].toBase58();
        const tokenB_Mint = initInstruction.accounts[9].toBase58();

        const tokenMint = tokenA_Mint === config.NATIVE_SOL_MINT ? tokenB_Mint : tokenA_Mint;
        console.log(`[V4-SNIPER] ⚡ Target Acquired: ${shortenAddress(tokenMint)}`);

        const tradeDetails = {
            tradeType: 'buy',
            dexPlatform: 'Raydium AMM', // Correctly label it as V4
            inputMint: config.NATIVE_SOL_MINT,
            outputMint: tokenMint,
        };

        await this.executeRaydiumV4Trade(tradeDetails, "Raydium V4 Sniper");

    } catch (error) {
        console.error(`[V4-SNIPER] CRITICAL FAILURE processing new V4 pool: ${error.message}`);
    }
}



async executeUniversalApiSwap(tradeDetails, traderName, userChatId, keypairPacket, masterTxSignature) {
    const { keypair, wallet } = keypairPacket;

    try {
        console.log(`[UniversalAPI-USER-${userChatId}] Engaging Jupiter API for ${tradeDetails.tradeType} trade...`);
        await traceLogger.appendTrace(masterTxSignature, 'step5_jupiterBuild', { status: 'PENDING' });

        const isBuy = tradeDetails.tradeType === 'buy';
        let amountToSwap;

        if (isBuy) {
            const solAmounts = await this.dataManager.loadSolAmounts();
            const solAmountToUse = solAmounts[String(userChatId)] || config.DEFAULT_SOL_TRADE_AMOUNT;
            amountToSwap = parseInt((solAmountToUse * config.LAMPORTS_PER_SOL_CONST).toString());
            tradeDetails.solSpent = solAmountToUse;
        } else {
            // ✅ ENHANCED: Same improved sell validation for Jupiter API
            const sellDetails = this.dataManager.getUserSellDetails(String(userChatId), tradeDetails.inputMint);
            
            if (!sellDetails || !sellDetails.amountToSellBN || sellDetails.amountToSellBN.isZero()) {
                console.warn(`[JUPITER-SELL] No recorded position found in database, trying on-chain balance check...`);
                
                // ✅ FALLBACK: Check on-chain balance if database position is missing
                try {
                    const onChainBalance = await this._getOnChainTokenBalance(keypair.publicKey.toBase58(), tradeDetails.inputMint);
                    if (onChainBalance.gt(new BN(0))) {
                        console.log(`[JUPITER-SELL] Found ${onChainBalance.toString()} tokens on-chain, using this amount`);
                        amountToSwap = parseInt(onChainBalance.toString());
                        tradeDetails.originalSolSpent = 0; // Unknown original amount
                        tradeDetails.inputAmountRaw = onChainBalance.toString();
                        
                        // ✅ RECORD the position for future reference
                        await this.dataManager.recordBuyPosition(userChatId, tradeDetails.inputMint, onChainBalance.toString(), 0);
                        console.log(`[JUPITER-SELL] Recorded on-chain position in database for future reference`);
                    } else {
                        throw new Error(`Sell copy failed: User has no recorded position for this token and no tokens found on-chain.`);
                    }
                } catch (balanceError) {
                    console.error(`[JUPITER-SELL] On-chain balance check failed: ${balanceError.message}`);
                    throw new Error(`Sell copy failed: User has no recorded position for this token and unable to verify on-chain balance.`);
                }
            } else {
                console.log(`[JUPITER-SELL] Using database position: ${sellDetails.amountToSellBN.toString()} tokens`);
                // ✅ ONE-BUY-ONE-SELL: Always sell the complete position (all tokens)
                amountToSwap = parseInt(sellDetails.amountToSellBN.toString());
                tradeDetails.originalSolSpent = sellDetails.originalSolSpent;
                tradeDetails.inputAmountRaw = sellDetails.amountToSellBN.toString();
                console.log(`[ONE-SELL] Jupiter selling complete position: ${amountToSwap} tokens`);
            }
        }

        const serializedTxs = await this.apiManager.getSwapTransactionFromJupiter({
            inputMint: tradeDetails.inputMint,
            outputMint: tradeDetails.outputMint,
            amount: amountToSwap,
            userWallet: keypair.publicKey.toBase58(),
            slippageBps: 5000, // 50% slippage for Jupiter fallback
        });
        
        // V6 API FIX: Handle both single object and array responses from Jupiter
        const txArray = Array.isArray(serializedTxs) ? serializedTxs : [serializedTxs];
        await traceLogger.appendTrace(masterTxSignature, 'step5_jupiterBuild', { status: 'SUCCESS', transactionCount: txArray.length });

        // **SAFETY CHECK for Jupiter API**
        if (!txArray || txArray.length === 0) {
            throw new Error("Jupiter API failed to return a valid transaction route.");
        }

        let finalSignature = null;
        for (const txString of txArray) {
            // Step 1: Decode the base64 string into a Buffer
            const txBuffer = Buffer.from(txString, 'base64');

            // Step 2: Deserialize the Buffer into a VersionedTransaction object
            const transaction = VersionedTransaction.deserialize(txBuffer);

            // Step 3: Send the object, not the string, to our sender function
            const sendResult = await this.solanaManager.sendVersionedTransaction({
                prebuiltTx: transaction,
                signer: keypair
            });

            if (sendResult.error) {
                throw new Error(`Jupiter transaction failed on-chain: ${sendResult.error}`);
            }
            finalSignature = sendResult.signature; // Capture the last signature for notifications
        }

        await traceLogger.recordOutcome(masterTxSignature, 'SUCCESS', finalSignature);

        if (!finalSignature) throw new Error("Transaction was sent but no signature was returned.");

        // Unified post-trade logic
        if (isBuy) {
            await this.dataManager.recordBuyPosition(userChatId, tradeDetails.outputMint, "0", tradeDetails.solSpent);
        } else {
            await this.dataManager.updatePositionAfterSell(userChatId, tradeDetails.inputMint, String(amountToSwap));
        }
        await this.notificationManager.notifySuccessfulCopy(userChatId, traderName, wallet.label, { 
            ...tradeDetails, 
            signature: finalSignature,
            tradeType: tradeDetails.tradeType || 'copy' // Ensure tradeType is present
        });


   } catch (e) {
    console.error(`[EXEC-UNIVERSAL-API] FAILED: ${e.message}`);
    await traceLogger.recordOutcome(masterTxSignature, 'FAILURE', `Jupiter Fallback Failed: ${e.message}`);
    
    // HARDENED NOTIFICATION: Use the keypairPacket which is always defined.
    const walletLabel = keypairPacket?.wallet?.label || 'Unknown Primary';
    this.notificationManager.notifyFailedCopy(userChatId, traderName, walletLabel, 'copy', e.message);
}
}

//     try {
//         const signature = instructionData.Transaction.Signature;
//         // From the 'create' instruction, the new token mint is always the FIRST account.
//         const tokenMint = instructionData.Instruction.Accounts[0]?.Address;
//         const symbol = instructionData.Instruction.Program.AccountNames.find(arg => arg.Name === "symbol")?.Value; // Example, adapt if needed

//         if (!tokenMint || !signature) {
//             console.warn('[PUMP-SNIPER] Skipping event: Could not extract tokenMint or signature from instruction data.');
//             return;
//         }

//         console.log(`[PUMP-SNIPER] ⚡ Target Acquired: ${symbol || 'New Token'} (${shortenAddress(tokenMint)}) via Instruction Subscription`);

//         const tradeDetails = {
//             tradeType: 'buy',
//             dexPlatform: 'Pump.fun',
//             inputMint: config.NATIVE_SOL_MINT,
//             outputMint: tokenMint,
//         };

//         // This part correctly fans out the trade to all subscribed users.
//         const syndicateData = await this.dataManager.loadTraders();
//         for (const userChatId in syndicateData.user_traders) {
//             const userTraders = syndicateData.user_traders[userChatId];
//             // Here you'd check if a user has pump.fun sniping enabled. For now, we assume yes.
//             const keypairPacket = await this.walletManager.getPrimaryTradingKeypair(userChatId);
//             if (keypairPacket) {
//                 this.executePumpFunTrade(tradeDetails, "Pump.fun Sniper", userChatId, keypairPacket)
//                     .catch(e => console.error(`[PUMP-SNIPER-EXEC] Error for user ${userChatId}: ${e.message}`));
//             }
//         }

//     } catch (error) {
//         console.error(`[PUMP-SNIPER] CRITICAL FAILURE processing new Pump.fun token from instruction: ${error.message}`);
//     }
// }

// async prebuildAndCachePumpTrade(tokenMint) {
//     try {
//         const keypairPacket = await this.walletManager.getPrimaryTradingKeypair();
//         if (!keypairPacket) {
//             console.warn(`[PRE-BUILD] Skipping Pump.fun pre-build. No trading wallet available.`);
//             return;
//         }

//         console.log(`[PRE-BUILD] Building pump.fun trade for ${shortenAddress(tokenMint)}`);

//         // Get pool data for the token
//         const poolData = await this.getPumpFunPoolData(tokenMint);
//         if (!poolData) {
//             console.warn(`[PRE-BUILD] No pool data found for ${shortenAddress(tokenMint)}`);
//             return;
//         }

//         // Prebuild multiple trade sizes for different scenarios
//         const tradeSizes = [
//             { amount: 0.01, label: 'micro' },
//             { amount: 0.05, label: 'small' },
//             { amount: 0.1, label: 'medium' },
//             { amount: 0.5, label: 'large' }
//         ];

//         for (const size of tradeSizes) {
//             try {
//                 const amountIn = new BN(size.amount * 1e9); // Convert SOL to lamports
                
//                 // Calculate expected output based on pool state
//                 const amountOut = this.calculatePumpFunOutput(amountIn, poolData);
                
//                 const swapDetails = {
//                     signature: `prebuild_${Date.now()}_${size.label}`,
//                     traderWallet: keypairPacket.publicKey.toBase58(),
//                     userChatId: 0, // Prebuild doesn't have a specific user
//                     tokenMint: tokenMint,
//                     amountIn: amountIn,
//                     amountOut: amountOut,
//                     poolId: poolData.poolId
//                 };

//                 // Prebuild the transaction
//                 const prebuiltResult = await this.pumpFunPrebuilder.prebuildSwap(swapDetails);
                
//                 if (prebuiltResult.success) {
//                     // Cache the prebuilt transaction
//                     const cacheKey = `pump_${tokenMint.toBase58()}_${size.label}`;
//                     const cacheData = {
//                         dex: 'Pump.fun',
//                         presignedTransaction: prebuiltResult.presignedTransaction,
//                         poolData: poolData,
//                         amountIn: amountIn.toString(),
//                         amountOut: amountOut.toString(),
//                         timestamp: Date.now(),
//                         expiresAt: Date.now() + (5 * 60 * 1000) // 5 minutes expiry
//                     };
                    
//                     this.redisManager.addTradeData(cacheKey, cacheData);
//                     console.log(`[QUANTUM CACHE] ✅ PRE-BUILT ${size.label} trade for PUMP token ${shortenAddress(tokenMint)} stored.`);
//                 }

//             } catch (error) {
//                 console.warn(`[PRE-BUILD] Failed to prebuild ${size.label} trade for ${shortenAddress(tokenMint)}: ${error.message}`);
//             }
//         }

//     } catch (error) {
//         console.error(`[PRE-BUILD] ❌ Error pre-building trade for PUMP token ${tokenMint}: ${error.message}`);
//     }
// }


// async getPumpFunPoolData(tokenMint) {
//     try {
//         // Get pool ID for the token (this would need to be implemented based on pump.fun's API)
//         const poolId = await this.getPumpFunPoolId(tokenMint);
//         if (!poolId) {
//             return null;
//         }

//         // Get pool metrics
//         const poolMetrics = await this.pumpFunPrebuilder.getPoolMetrics(poolId);
//         return {
//             poolId: poolId,
//             ...poolMetrics
//         };

//     } catch (error) {
//         console.error(`[PUMP.FUN] Error getting pool data: ${error.message}`);
//         return null;
//     }
// }

// async getPumpFunPoolId(tokenMint) {
//     try {
//         // This would need to be implemented based on pump.fun's API
//         // For now, we'll use a placeholder
//         // In a real implementation, you'd query pump.fun's API or on-chain data
        
//         // Placeholder: return a mock pool ID
//         // In reality, you'd need to find the actual pool ID for this token
//         return new PublicKey('11111111111111111111111111111111'); // Placeholder
        
//     } catch (error) {
//         console.error(`[PUMP.FUN] Error getting pool ID: ${error.message}`);
//         return null;
//     }
// }

// calculatePumpFunOutput(amountIn, poolData) {
//     try {
//         // Simplified output calculation for pump.fun
//         // In reality, this would use the actual bonding curve formula
        
//         const inputAmount = amountIn.toNumber();
//         const poolLiquidity = parseFloat(poolData.liquidity);
        
//         // Simple linear calculation (this should be replaced with actual bonding curve math)
//         const outputAmount = inputAmount * 0.95; // 5% fee
        
//         return new BN(Math.floor(outputAmount));
        
//     } catch (error) {
//         console.error(`[PUMP.FUN] Error calculating output: ${error.message}`);
//         return new BN(0);
//     }
// }

// async executePrebuiltPumpTrade(tokenMint, tradeSize = 'medium', signature) {
//     try {
//         const cacheKey = `pump_${tokenMint.toBase58()}_${tradeSize}`;
//         const cachedData = this.redisManager.getTradeData(cacheKey);
        
//         if (!cachedData || !cachedData.presignedTransaction) {
//             console.warn(`[PUMP.FUN] No prebuilt transaction found for ${shortenAddress(tokenMint)} (${tradeSize})`);
//             return { success: false, reason: 'No prebuilt transaction found' };
//         }

//         // Check if transaction is still valid (not expired)
//         if (cachedData.expiresAt && Date.now() > cachedData.expiresAt) {
//             console.warn(`[PUMP.FUN] Prebuilt transaction expired for ${shortenAddress(tokenMint)}`);
//             this.redisManager.removeTradeData(cacheKey);
//             return { success: false, reason: 'Transaction expired' };
//         }

//         await traceLogger.appendTrace(signature, 'pump_execute_prebuilt_start', {
//             tokenMint: tokenMint.toBase58(),
//             tradeSize: tradeSize,
//             cacheKey: cacheKey
//         });

//         // Execute the prebuilt transaction
//         const result = await this.pumpFunPrebuilder.executePresignedTransaction(
//             cachedData.presignedTransaction,
//             signature
//         );

//         if (result.success) {
//             // Remove from cache after successful execution
//             this.redisManager.removeTradeData(cacheKey);
            
//             await traceLogger.appendTrace(signature, 'pump_execute_prebuilt_success', {
//                 txSignature: result.signature,
//                 tradeSize: tradeSize
//             });

//             console.log(`[PUMP.FUN] ✅ Successfully executed prebuilt ${tradeSize} trade for ${shortenAddress(tokenMint)}`);
//             return { success: true, signature: result.signature };
//         } else {
//             throw new Error('Transaction execution failed');
//         }

//     } catch (error) {
//         await traceLogger.appendTrace(signature, 'pump_execute_prebuilt_error', {
//             error: error.message,
//             tradeSize: tradeSize
//         });

//         console.error(`[PUMP.FUN] ❌ Error executing prebuilt trade for ${shortenAddress(tokenMint)}: ${error.message}`);
//         return { success: false, reason: error.message };
//     }
// }

// async simulatePrebuiltPumpTrade(tokenMint, tradeSize = 'medium', signature) {
//     try {
//         const cacheKey = `pump_${tokenMint.toBase58()}_${tradeSize}`;
//         const cachedData = this.redisManager.getTradeData(cacheKey);
        
//         if (!cachedData || !cachedData.presignedTransaction) {
//             return { success: false, reason: 'No prebuilt transaction found' };
//         }

//         await traceLogger.appendTrace(signature, 'pump_simulate_prebuilt_start', {
//             tokenMint: tokenMint.toBase58(),
//             tradeSize: tradeSize
//         });

//         // Simulate the prebuilt transaction
//         const result = await this.pumpFunPrebuilder.simulateTransaction(
//             cachedData.presignedTransaction,
//             signature
//         );

//         await traceLogger.appendTrace(signature, 'pump_simulate_prebuilt_success', {
//             computeUnits: result.simulation.unitsConsumed
//         });

//         return { success: true, simulation: result.simulation };

//     } catch (error) {
//         await traceLogger.appendTrace(signature, 'pump_simulate_prebuilt_error', {
//             error: error.message
//         });

//         console.error(`[PUMP.FUN] ❌ Error simulating prebuilt trade: ${error.message}`);
//         return { success: false, reason: error.message };
//     }
// }

// Handle pump.fun pool creation events

async processPumpFunPoolCreation(instructionData) {
    try {
        const accounts = instructionData.Instruction.Accounts.map(a => a.Address);
        
        // Pump.fun pool creation typically involves specific accounts
        // This is a simplified detection - in reality you'd need to parse the specific instruction
        const poolId = accounts[0]; // Usually the first account is the pool
        const tokenMint = accounts[1]; // The token being launched
        
        console.log(`[REAL-TIME] ⚡ New Pump.fun Pool Detected! Token: ${shortenAddress(tokenMint)}, Pool: ${shortenAddress(poolId)}`);

        // Prebuild trades for this new token
        await this.prebuildAndCachePumpTrade(new PublicKey(tokenMint));

        const tradeDataPacket = {
            dexPlatform: 'Pump.fun',
            tradeType: 'buy',
            inputMint: config.NATIVE_SOL_MINT,
            outputMint: tokenMint,
            platformSpecificData: { poolId }
        };

        this.redisManager.addTradeData(tokenMint, tradeDataPacket);

    } catch (error) {
        console.error('[PUMP.FUN HANDLER] Error processing new pool:', error);
    }
}

// Enhanced pump.fun trading with prebuilt transactions
async executePumpFunTrade(tradeDetails, signature) {
    try {
        const { tokenMint, amount } = tradeDetails;
        
        // Determine trade size based on amount
        let tradeSize = 'medium';
        if (amount <= 0.01) tradeSize = 'micro';
        else if (amount <= 0.05) tradeSize = 'small';
        else if (amount <= 0.1) tradeSize = 'medium';
        else tradeSize = 'large';

        await traceLogger.appendTrace(signature, 'pump_trade_start', {
            tokenMint: tokenMint.toBase58(),
            amount: amount,
            tradeSize: tradeSize
        });

        // Try to use prebuilt transaction first
        const prebuiltResult = await this.executePrebuiltPumpTrade(tokenMint, tradeSize, signature);
        
        if (prebuiltResult.success) {
            console.log(`[PUMP.FUN] ✅ Used prebuilt ${tradeSize} trade for ${shortenAddress(tokenMint)}`);
            return prebuiltResult;
        }

        // Fallback to live building if prebuilt fails
        console.log(`[PUMP.FUN] 🔄 Prebuilt trade failed, building live for ${shortenAddress(tokenMint)}`);
        
        const keypairPacket = await this.walletManager.getPrimaryTradingKeypair();
        const swapDetails = {
            signature: signature,
            traderWallet: keypairPacket.wallet.publicKey.toBase58(),
            userChatId: 0,
            tokenMint: tokenMint,
            amountIn: new BN(amount * 1e9),
            amountOut: new BN(0), // Will be calculated
            poolId: await this.getPumpFunPoolId(tokenMint)
        };

        const result = await this.unifiedPrebuilder.prebuildTrade('pump.fun', await this.getPumpFunPoolId(tokenMint), amount * 1e9, keypairPacket.wallet.publicKey, 50);
        
        if (result.instructions) {
            const executionResult = await this.unifiedPrebuilder.executeWithRetry(
                result.instructions,
                keypairPacket.wallet,
                result.metadata
            );
            
            return executionResult;
        } else {
            throw new Error('Failed to build pump.fun transaction');
        }

    } catch (error) {
        await traceLogger.appendTrace(signature, 'pump_trade_error', {
            error: error.message
        });
        
        console.error(`[PUMP.FUN] ❌ Trade execution failed: ${error.message}`);
        throw error;
    }
}

// ✅ Handler for new Meteora DLMM pools found by the real-time scanner
// async processMeteoraDlmmPoolCreation(instructionData) {
//     try {
//         const accounts = instructionData.Instruction.Accounts.map(a => a.Address);

//         // From DLMM `initializeLbPair` docs, we know the account order:
//         // accounts[0] = new LbPair account (poolId)
//         // accounts[1] = base token mint
//         // accounts[2] = quote token mint
//         const poolId = accounts[0];
//         const tokenMintA = accounts[1];
//         const tokenMintB = accounts[2];

//         // For sniping, we only care about pools paired with SOL.
//         const tokenMint = tokenMintA === config.NATIVE_SOL_MINT ? tokenMintB : tokenMintA;
//         if (tokenMintB !== config.NATIVE_SOL_MINT && tokenMintA !== config.NATIVE_SOL_MINT) {
//             return; // Not a SOL pair, we ignore it.
//         }

//         console.log(`[REAL-TIME] ⚡ New Meteora DLMM Pool Detected! Token: ${shortenAddress(tokenMint)}, Pool: ${shortenAddress(poolId)}`);

//         const tradeDataPacket = {
//             dexPlatform: 'Meteora DLMM',
//             tradeType: 'buy',
//             inputMint: config.NATIVE_SOL_MINT,
//             outputMint: tokenMint,
//             platformSpecificData: { poolId }
//         };

//         this.redisManager.addTradeData(tokenMint, tradeDataPacket);

//     } catch (error) {
//         console.error('[DLMM HANDLER] Error processing new DLMM pool:', error);
//     }
// }

// ✅ Handler for new Meteora DBC pools found by the real-time scanner
// async processMeteoraDbcPoolCreation(instructionData) {
//     try {
//         const accounts = instructionData.Instruction.Accounts.map(a => a.Address);

//         // From DBC `initializeVirtualPoolWithSplToken` docs:
//         // accounts[0] = virtual pool account (poolId)
//         // accounts[2] = quote token (usually SOL)
//         // accounts[3] = base token (the new token)
//         const poolId = accounts[0];
//         const quoteMint = accounts[2];
//         const baseMint = accounts[3];

//         // Only process if it's a SOL-paired pool
//         if (quoteMint !== config.NATIVE_SOL_MINT) {
//             return; // Ignore non-SOL pools
//         }

//         console.log(`[REAL-TIME] ⚡ New Meteora DBC Pool Detected! Token: ${shortenAddress(baseMint)}, Pool: ${shortenAddress(poolId)}`);

//         const tradeDataPacket = {
//             dexPlatform: 'Meteora DBC',
//             tradeType: 'buy',
//             inputMint: config.NATIVE_SOL_MINT,
//             outputMint: baseMint,
//             platformSpecificData: { poolId }
//         };

//         this.redisManager.addTradeData(baseMint, tradeDataPacket);

//     } catch (error) {
//         console.error('[DBC HANDLER] Error processing new DBC pool:', error);
//     }
// }

// async handleNewPumpToken({ mint, Symbol, Name, Uri, timestamp }) {
//     try {
//         console.log(`[ENGINE] 🪙 New Pump.fun token detected: ${mint} (${Symbol || 'No Symbol'})`);

//         // Avoid duplicate processing
//         if (this.isProcessing.has(mint)) return;
//         this.isProcessing.add(mint);

//         // Optional: Try fetching token metadata from your own Bitquery/Shyft logic
//         const tokenMeta = await this.apiManager.fetchTokenMetadataFromMint?.(mint).catch(() => null);

//         // Build minimal trade details object for caching
//         const tradeDetails = {
//             inputMint: config.NATIVE_SOL_MINT,
//             outputMint: mint,
//             tradeType: "buy",
//             platform: "pumpfun",
//             platformSpecificData: {
//                 source: "realtime-tracker",
//                 detectedAt: timestamp,
//             },
//             name: Name,
//             symbol: Symbol,
//             uri: Uri,
//             metadata: tokenMeta || {}
//         };

//         // Cache it for fast matching when trader buys
//         this.redisManager.setTradeData(mint, tradeDetails);

//         // Optionally notify dev team or simulate
//         // await this.notificationManager.sendDevAlert("New Pump.fun token cached: " + mint);
//         // Simulation removed - using UniversalAnalyzer instead

//         console.log(`[ENGINE] ✅ Pump.fun token ${mint} cached for instant copy match.`);

//     } catch (err) {
//         console.error(`[ENGINE] ❌ Error in handleNewPumpToken for ${mint}:`, err.message);
//     } finally {
//         this.isProcessing.delete(mint);
//     }
// }

// Add checkPumpFunMigration method:

async checkPumpFunMigration(tokenMint) {
    for (let attempt = 1; attempt <= this.retryAttempts; attempt++) {
        try {
            const raydiumPool = await this.apiManager.findAmmPoolForToken(tokenMint);
            // Fetch pump.fun account data directly
            const onChainData = await this.solanaManager.connection.getAccountInfo(new PublicKey(tokenMint));
            return raydiumPool || onChainData.isComplete;
        } catch (error) {
            console.warn(`[MIGRATION-CHECK] Attempt ${attempt}/${this.retryAttempts} failed for ${shortenAddress(tokenMint)}: ${error.message}`);
            if (attempt < this.retryAttempts) await sleep(this.retryDelayMs);
        }
    }
    return false;
}



    // ===============================================
    // ========== TRANSACTION FILTERING METHODS ===========
    // ===============================================
    
    /**
     * Check if transaction is recent enough for copy trading
     * @param {Object} rawTxData - The raw transaction data from LaserStream
     * @param {string} signature - Transaction signature for logging
     * @returns {boolean} - True if transaction is recent enough
     */
    isTransactionRecentForCopyTrading(rawTxData, signature) {
        try {
            const config = require('./config.js');
            if (!config.TRANSACTION_FILTERING || !config.TRANSACTION_FILTERING.ENABLED) {
                return true; // Filtering disabled or not configured
            }
            
            const currentTime = Date.now();
            const maxAge = config.TRANSACTION_FILTERING.MAX_AGE_SECONDS * 1000; // Convert to milliseconds
            
            // Check blockTime if available (most reliable)
            if (rawTxData?.transaction?.blockTime) {
                const transactionTime = rawTxData.transaction.blockTime * 1000; // Convert to milliseconds
                const age = currentTime - transactionTime;
                
                if (age > maxAge) {
                    console.log(`[FILTER] ⏰ Transaction ${shortenAddress(signature)} is too old (age: ${Math.round(age/1000)}s) - skipping copy trade`);
                    return false;
                }
                
                console.log(`[FILTER] ✅ Transaction age: ${Math.round(age/1000)}s - proceeding with copy trade`);
                return true;
            }
            
            // If no blockTime, assume it's recent (should have been filtered earlier)
            console.log(`[FILTER] ⚠️ No blockTime available for ${shortenAddress(signature)} - allowing through`);
            return true;
            
        } catch (error) {
            console.error(`[FILTER] ❌ Error checking transaction age for ${shortenAddress(signature)}:`, error.message);
            // On error, allow the transaction through to avoid missing trades
            return true;
        }
    }

    // ==========================================================
    // =========== [DISABLED] HELIUS WEBHOOK PROCESSOR ===========
    // ==========================================================
    // DISABLED: Using LaserStream → Monitor → Executor flow instead
    async processWebhookData(masterTraderAddress, signature, fullWebhookData) {
        console.log(`[WEBHOOK-PROCESSOR] ❌ DISABLED - Using LaserStream path instead`);
        return; // Early exit to prevent webhook processing
        if (this.isProcessing.has(signature)) {
            console.log(`[WEBHOOK-LOCK] Signature ${shortenAddress(signature)} is already being processed. Aborting webhook dispatch.`);
            return;
        }
        this.isProcessing.add(signature);
        
        console.log(`[WEBHOOK-PROCESSOR] Analyzing Helius data for sig: ${shortenAddress(signature)}`);

        try {
            // Get all users who are actively copying this specific master trader
            const syndicateData = await this.dataManager.loadTraders();
            if (!syndicateData?.user_traders) return;

            const jobs = [];
            for (const [userChatId, userTraders] of Object.entries(syndicateData.user_traders)) {
                for (const [traderName, traderConfig] of Object.entries(userTraders)) {
                    if (traderConfig.active && traderConfig.wallet === masterTraderAddress) {
                        jobs.push({
                            userChatId: parseInt(userChatId),
                            traderName,
                            traderConfig,
                            signature
                        });
                    }
                }
            }
            
            if (jobs.length === 0) {
                 console.log(`[WEBHOOK-PROCESSOR] No active followers for trader ${shortenAddress(masterTraderAddress)}. Standing down.`);
                 return;
            }

            // --- THIS IS THE KEY SPEED ADVANTAGE ---
            // We pass the FULL webhook data to the Universal Analyzer, skipping the need for another RPC call.
            const analysisResult = await this.universalAnalyzer.analyzeTransaction(
                fullWebhookData, // Pass the pre-fetched, parsed Helius data
                masterTraderAddress
            );

            // Log analysis result for debugging
            await traceLogger.initTrace(signature, masterTraderAddress, jobs.map(j => j.userChatId).join('_'));
            await traceLogger.appendTrace(signature, 'step2_heliusWebhookData', { eventType: fullWebhookData.type });
            await traceLogger.appendTrace(signature, 'step3_webhookAnalysis', { 
                isCopyable: analysisResult.isCopyable, 
                reason: analysisResult.reason, 
                details: analysisResult.details 
            });


            if (!analysisResult.isCopyable) {
                console.log(`[WEBHOOK-PROCESSOR] Analysis determined not to copy. Reason: ${analysisResult.reason}`);
                await traceLogger.recordOutcome(signature, 'FAILURE', `Analysis Aborted (Webhook): ${analysisResult.reason}`);
                return;
            }
            
            // ✅ REMOVED: Old platform-specific builders - now using Universal Cloning Engine
            // All platforms are handled by the Universal Cloner via _executeCopyTradeWithDirectSolanaSender

            // Add Router-specific data to analysis result details
            if (analysisResult.details.dexPlatform === 'Router') {
                const routerDetection = analysisResult.platformDetection?.identifiedPlatforms?.[0];
                if (routerDetection?.cloningTarget) {
                    analysisResult.details.cloningTarget = routerDetection.cloningTarget;
                    analysisResult.details.masterTraderWallet = analysisResult.details.traderPubkey;
                    console.log(`[WEBHOOK-DISPATCH] 🎯 Added Router cloning data to analysis result`);
                }
            }

            const copyPromises = jobs.map(job => {
                console.log(`[WEBHOOK-DISPATCH] User ${job.userChatId} copying ${job.traderName}'s TX: ${shortenAddress(job.signature)}`);
                
                // ✅ UNIVERSAL CLONING ENGINE: Use Direct Solana Sender for all webhook trades too
                return this._executeCopyTradeWithDirectSolanaSender(
                    analysisResult.details, 
                    job.traderName, 
                    job.userChatId, 
                    job.signature, 
                    { computeUnits: 800000 }, // Default compute units for Universal Cloner
                    analysisResult.originalTransaction // Pass the original transaction for structure cloning
                );
            });

            await Promise.allSettled(copyPromises);

        } catch (error) {
            console.error(`[WEBHOOK-PROCESSOR] CRITICAL Unhandled Error for sig ${shortenAddress(signature)}:`, error);
            await traceLogger.recordOutcome(signature, 'FAILURE', `Webhook Processor Error: ${error.message}`);
        } finally {
            this.isProcessing.delete(signature);
        }
    }

    // ==========================================================
    // ============ DIRECT SOLANA SENDER INTEGRATION ============
    // ==========================================================

    /**
     * Validate if a trade is actually copyable
     * Filters out fee-only transactions, same-token swaps, and invalid trades
     */
    _validateTradeForCopy(tradeDetails) {
        console.log(`[TRADE-VALIDATION] 🔍 Validating trade for copy...`);
        
        try {
            if (!tradeDetails) throw new Error("tradeDetails object is missing.");

            const { tradeType, inputMint, outputMint, inputAmountRaw, outputAmountRaw, outputAmountLamports } = tradeDetails;

            // 1. Must have valid mints, and they must be different.
            if (!inputMint || !outputMint || inputMint === outputMint) {
                throw new Error('Invalid or identical mint addresses.');
            }
            
            // 2. For raw data cloning, allow 'unknown' mints to pass through
            if (outputMint === 'unknown') {
                console.log(`[TRADE-VALIDATION] ⚠️ Unknown output mint detected - allowing through for raw cloning`);
                console.log(`[TRADE-VALIDATION] ✅ Trade validation passed! Type: ${tradeType} (raw cloning mode)`);
                return true;
            }

            const isBuy = tradeType === 'buy';

            if (isBuy) {
                // For a BUY, we must be spending SOL and receiving tokens.
                const solIn = new BN(tradeDetails.inputAmountLamports || inputAmountRaw || '0');
                const tokensOut = new BN(outputAmountRaw || '0');
                if (solIn.isZero() || tokensOut.isZero()) {
                    throw new Error(`Invalid BUY: Must have non-zero SOL input and Token output.`);
                }
            } else { // It's a SELL
                // For a SELL, we must be sending tokens and receiving SOL.
                const tokensIn = new BN(inputAmountRaw || '0');
                const solOut = new BN(outputAmountLamports || outputAmountRaw || '0');
                if (tokensIn.isZero() || solOut.isZero()) {
                    throw new Error(`Invalid SELL: Must have non-zero Token input and SOL output.`);
                }
            }

            console.log(`[TRADE-VALIDATION] ✅ Trade validation passed! Type: ${tradeType}`);
            return true;

        } catch (error) {
            console.error(`[TRADE-VALIDATION] ❌ FAILED: ${error.message}`);
            // We re-throw the error so the calling function can catch it and log it.
            throw error; 
        }
    }

    /**
     * Execute copy trade using Direct Solana Sender for ultra-fast execution
     */


    // Calculate user's copy trade amount based on trade type and database data
    async _calculateUserCopyTradeAmount(userChatId, tradeDetails) {
        try {
            const BN = require('bn.js');
            
            // FIX: Treat 'swap' as a 'buy' for amount calculation purposes.
            // The analyzer will now provide correct 'buy' or 'sell', but this makes the code safer.
            const tradeType = tradeDetails.tradeType === 'swap' ? 'buy' : tradeDetails.tradeType;
    
            if (tradeType === 'buy') {
                const solAmounts = await this.dataManager.loadSolAmounts();
                const userSolAmount = solAmounts[String(userChatId)] || 0.01;
                const solAmountLamports = Math.floor(userSolAmount * 1e9);
                console.log(`[DIRECT-SOLANA-SENDER] 💰 User ${userChatId} SOL amount for BUY: ${userSolAmount} SOL`);
                return new BN(solAmountLamports);
            } 
            
            if (tradeType === 'sell') {
                const userPositions = await this.dataManager.getUserPositions(userChatId);
                console.log(`[DIRECT-SOLANA-SENDER] 🔍 getUserPositions result for user ${userChatId}:`, {
                    isMap: userPositions instanceof Map,
                    size: userPositions?.size,
                    keys: userPositions ? Array.from(userPositions.keys()) : 'undefined'
                });
                const userTokenBalance = userPositions.get(tradeDetails.inputMint);
                
                if (!userTokenBalance || userTokenBalance.amountRaw === 0n) {
                    console.log(`[DIRECT-SOLANA-SENDER] ⚠️ SELL detected, but no database position for ${shortenAddress(tradeDetails.inputMint)}.`);
                    
                    // On-chain balance check fallback
                    const walletPacket = await this.walletManager.getPrimaryTradingKeypair(userChatId);
                    if (walletPacket) {
                        const onChainBalance = await this._getOnChainTokenBalance(walletPacket.keypair.publicKey.toBase58(), tradeDetails.inputMint);
                        if (onChainBalance.gt(new BN(0))) {
                            console.log(`[DIRECT-SOLANA-SENDER] ✅ Found ${onChainBalance.toString()} tokens on-chain, will sell entire balance.`);
                            await this.dataManager.recordBuyPosition(userChatId, tradeDetails.inputMint, onChainBalance.toString(), 0);
                            return onChainBalance;
                        }
                    }
                    console.log(`[DIRECT-SOLANA-SENDER] ❌ No tokens found on-chain. Skipping trade.`);
                    return null;
                }
                
                console.log(`[DIRECT-SOLANA-SENDER] 💰 User ${userChatId} token balance for SELL: ${userTokenBalance.amountRaw.toString()} raw units`);
                return new BN(userTokenBalance.amountRaw.toString());
            }
    
            // This part should now be unreachable with the fix above
            throw new Error(`Unhandled trade type: ${tradeDetails.tradeType}`);
        } catch (error) {
            console.error(`[DIRECT-SOLANA-SENDER] ❌ Error calculating user copy trade amount:`, error);
            throw error; // Re-throw the error to be caught by the main execution function
        }
    }


    async _executeCopyTradeWithDirectSolanaSender(tradeDetails, traderName, userChatId, masterSignature, config, originalTransaction = null) {
        // ====== ONE-BUY-ONE-SELL GATEKEEPER ======
        const isBuy = tradeDetails.tradeType === 'buy';
        if (isBuy) {
            const userPositions = await this.dataManager.getUserPositions(String(userChatId));
            const tokenToBuy = tradeDetails.outputMint;
    
            // Check if the user ALREADY has a position and it's not empty.
            if (userPositions.has(tokenToBuy) && userPositions.get(tokenToBuy).amountRaw > 0n) {
                const reason = `You already have an active position for ${shortenAddress(tokenToBuy)}. One buy per token is allowed.`;
                console.log(`[GATEKEEPER-${userChatId}] SKIPPING BUY for ${traderName}. Reason: ${reason}`);
                
                // CRITICAL: Stop the function here to prevent the buy.
                return; 
            }
        }
        // ===========================================
        // 🚀 PERFORMANCE TRACKING: Start timing the entire copy trade process
        const performanceTracker = {
            startTime: Date.now(),
            steps: {},
            logStep: function(stepName) {
                const now = Date.now();
                const elapsed = now - this.startTime;
                this.steps[stepName] = {
                    timestamp: now,
                    elapsed: elapsed,
                    stepDuration: stepName === 'start' ? 0 : elapsed - (this.lastStepTime || this.startTime)
                };
                this.lastStepTime = now;
                console.log(`[PERF-TRACKER] ⏱️ ${stepName}: ${elapsed}ms total, ${this.steps[stepName].stepDuration}ms since last step`);
            }
        };
        
        performanceTracker.logStep('start');
        // Prevent race conditions by checking if user is already being processed
        if (this.userProcessing.has(userChatId)) {
            console.log(`[DIRECT-SOLANA-SENDER] ⚠️ User ${userChatId} is already being processed, skipping to prevent race condition`);
            return;
        }
        
        this.userProcessing.add(userChatId);
        performanceTracker.logStep('race_condition_check');
        
        // Set a timeout to automatically clear the user from processing state after 30 seconds
        const timeoutId = setTimeout(() => {
            if (this.userProcessing.has(userChatId)) {
                console.log(`[DIRECT-SOLANA-SENDER] ⏰ Timeout reached for user ${userChatId}, clearing processing state`);
                this.userProcessing.delete(userChatId);
            }
        }, 30000); // 30 seconds timeout
        
        try {
            console.log(`[DIRECT-SOLANA-SENDER] 🚀 Starting copy trade execution for user ${userChatId}`);
            console.log(`[DIRECT-SOLANA-SENDER] 🚀 COPY TRADE: ${tradeDetails.tradeType.toUpperCase()} ${tradeDetails.dexPlatform} | Token: ${shortenAddress(tradeDetails.outputMint)} | User: ${userChatId}`);
            performanceTracker.logStep('trade_start');
            // console.log(`[DIRECT-SOLANA-SENDER] 🔑 Master signature: ${masterSignature}`);
            // console.log(`[DIRECT-SOLANA-SENDER] 📍 Platform: ${tradeDetails.dexPlatform}`);
            // console.log(`[DIRECT-SOLANA-SENDER] 🎯 Token: ${shortenAddress(tradeDetails.outputMint)}`);
    
            // Get user's trading wallet
            const walletPacket = await this.walletManager.getPrimaryTradingKeypair(userChatId);
            if (!walletPacket) {
                throw new Error(`No trading wallet found for user ${userChatId}`);
            }
    
            const { keypair, wallet } = walletPacket;
            console.log(`[DIRECT-SOLANA-SENDER] 💼 Using wallet: ${wallet?.label || wallet?.name || 'Unknown'}`);
            performanceTracker.logStep('wallet_retrieval');
    
            // ✅ UNIVERSAL CLONING ENGINE: All platforms use the same cloning approach
            console.log(`[DIRECT-SOLANA-SENDER] 🎯 Using Universal Cloning Engine for platform: ${tradeDetails.dexPlatform}`);
    
            // Validate trade before processing
            try {
                this._validateTradeForCopy(tradeDetails);
            } catch (validationError) {
                console.log(`[DIRECT-SOLANA-SENDER] ❌ Trade validation failed: ${validationError.message}`);
                console.log(`[DIRECT-SOLANA-SENDER] 🚫 Skipping invalid trade - not a real swap`);
                throw new Error(`Trade validation failed: ${validationError.message}`);
            }
    
            // Calculate user's copy trade amount based on trade type FIRST
            let userAmountBN = await this._calculateUserCopyTradeAmount(userChatId, tradeDetails);
            performanceTracker.logStep('amount_calculation');
            
            // Only skip SELL trades when no position exists - BUY trades should always proceed
            if (userAmountBN === null && tradeDetails.tradeType === 'sell') {
                console.log(`[DIRECT-SOLANA-SENDER] ⏭️ Skipping SELL trade for user ${userChatId} - no position found`);
                return; // Exit gracefully without throwing error
            }
            
            // For BUY trades, userAmountBN should never be null, but if it is, use default SOL amount
            if (userAmountBN === null && tradeDetails.tradeType === 'buy') {
                console.log(`[DIRECT-SOLANA-SENDER] ⚠️ BUY trade returned null amount, using default SOL amount`);
                const BN = require('bn.js');
                const defaultSolAmount = 0.01; // 0.01 SOL default
                const defaultLamports = Math.floor(defaultSolAmount * 1e9);
                userAmountBN = new BN(defaultLamports);
            }
            
            // ✅ UNIVERSAL CLONING ENGINE: No need for platform-specific builders
            console.log(`[DIRECT-SOLANA-SENDER] 🎯 Using Universal Cloning Engine for platform: ${tradeDetails.dexPlatform}`);
            console.log(`[DIRECT-SOLANA-SENDER] 📍 Universal Cloner handles all platforms without platform-specific builders`);
    
            // For SELL trades, check if user has position before proceeding
            if (tradeDetails.tradeType === 'sell') {
                try {
                    const userPositions = await this.dataManager.getUserPositions(userChatId);
                    const userTokenBalance = userPositions.get(tradeDetails.inputMint);
                    
                    if (!userTokenBalance || userTokenBalance.amountRaw === 0n) {
                        console.log(`[DIRECT-SOLANA-SENDER] ⚠️ SELL detected but user ${userChatId} has no ${shortenAddress(tradeDetails.inputMint)} tokens. Skipping trade.`);
                        this.userProcessing.delete(userChatId); // Clean up user processing lock
                        return; // Skip this trade, don't build transaction
                    }
                    console.log(`[DIRECT-SOLANA-SENDER] ✅ SELL trade validated - user has ${userTokenBalance.amountRaw} raw units of ${shortenAddress(tradeDetails.inputMint)}`);
                } catch (error) {
                    console.error(`[DIRECT-SOLANA-SENDER] ❌ Error checking user position for SELL:`, error);
                    this.userProcessing.delete(userChatId); // Clean up user processing lock
                    return; // Skip on error
                }
            }
    
            // userAmountBN is already calculated above
    
            // Validate cloning target exists
            if (!tradeDetails.cloningTarget) {
                throw new Error("Analysis failed to provide a cloningTarget. Cannot proceed with Universal Cloning.");
            }
            
            // Enhanced validation and logging for tradeDetails
            console.log(`[DIRECT-SOLANA-SENDER] 🔍 TradeDetails validation:`, {
                tradeType: tradeDetails.tradeType,
                inputMint: tradeDetails.inputMint,
                outputMint: tradeDetails.outputMint,
                dexPlatform: tradeDetails.dexPlatform,
                hasInputMint: !!tradeDetails.inputMint,
                hasOutputMint: !!tradeDetails.outputMint,
                hasCloningTarget: !!tradeDetails.cloningTarget,
                traderPubkey: tradeDetails.traderPubkey,
                platformProgramId: tradeDetails.platformProgramId
            });
            
            // Validate required fields before building instructions
            if (!tradeDetails.inputMint || !tradeDetails.outputMint) {
                console.error(`[DIRECT-SOLANA-SENDER] ❌ Missing required mint fields:`, {
                    inputMint: tradeDetails.inputMint,
                    outputMint: tradeDetails.outputMint,
                    tradeType: tradeDetails.tradeType,
                    dexPlatform: tradeDetails.dexPlatform
                });
                throw new Error(`Cannot execute ${tradeDetails.dexPlatform} trade: missing inputMint or outputMint fields`);
            }
    
            // Get user-specific configuration (SOL amount + slippage)
            const userSettings = await this.dataManager.getUserSettings(userChatId);
            const userSolAmount = userSettings.solAmount; // SOL amount per trade
            const userSlippageBps = userSettings.slippageBps; // Slippage in basis points
            
            console.log(`[DIRECT-SOLANA-SENDER] 💰 User ${userChatId} settings: ${userSolAmount} SOL, ${userSlippageBps} BPS slippage`);
            
            // Get user positions for SELL trades
            let userTokenBalance = null;
            if (tradeDetails.tradeType === 'sell') {
                const userPositions = await this.dataManager.getUserPositions(userChatId);
                userTokenBalance = userPositions.get(tradeDetails.inputMint);
            }
    
            // Get nonce info for durable transactions (eliminates old hash errors)
            let nonceInfo = null;
            if (wallet.nonceAccountPubkey) {
                try {
                    const { nonce, nonceAuthority } = await this.solanaManager.getLatestNonce(wallet.nonceAccountPubkey);
                    nonceInfo = {
                        noncePubkey: wallet.nonceAccountPubkey,
                        authorizedPubkey: nonceAuthority,
                        nonce: nonce
                    };
                    console.log(`[DIRECT-SOLANA-SENDER] 🔐 Using durable nonce: ${shortenAddress(nonce)} from account: ${shortenAddress(wallet.nonceAccountPubkey.toString())}`);
                } catch (nonceError) {
                    console.warn(`[DIRECT-SOLANA-SENDER] ⚠️ Failed to get nonce info: ${nonceError.message}. Using regular blockhash.`);
                }
            } else {
                console.log(`[DIRECT-SOLANA-SENDER] ⚠️ No nonce account found for wallet. Using regular blockhash (may cause old hash errors).`);
            }
    
            // 1. Analyze the blueprint to see what the master spent
            const masterInputMint = tradeDetails.inputMint;
            let userPaymentMethod = 'sol'; // Our default is always SOL
            let userAmountToSpend = userAmountBN; // This is the user's configured SOL amount
    
            // 2. The CRITICAL check: Is the master trader paying with something OTHER than raw SOL?
            if (masterInputMint !== config.NATIVE_SOL_MINT) {
                console.log(`[FORGER-OVERRIDE] Master paid with TOKEN (${shortenAddress(masterInputMint)}). We will pay with RAW SOL.`);
                
                // 🚀 PERFORMANCE OPTIMIZATION: Skip price fetching for copy trading
                // Users set their own SOL amounts, so we don't need exact price conversion
                const masterTokenAmountSpent = tradeDetails.inputAmountRaw / (10 ** tradeDetails.tokenDecimals);
                console.log(`[FORGER-OVERRIDE] Master spent ${masterTokenAmountSpent} of token. Using user's configured SOL amount for copy trade.`);
                
                // Use user's pre-configured SOL amount for simplicity, safety, and speed
                userAmountToSpend = new BN(Math.floor(userSettings.solAmount * 1e9));
                
                console.log(`[FORGER-OVERRIDE] Using user's configured trade size: ${userSettings.solAmount} SOL (saved ~100-300ms by skipping DAS API)`);
            }
    
            // 3. Extract the actual transaction from LaserStream response
            let actualTransaction = originalTransaction;
            if (originalTransaction && originalTransaction.transaction && originalTransaction.transaction.transaction) {
                // Go one level deeper - the actual transaction is at transaction.transaction.transaction
                const nestedTransaction = originalTransaction.transaction.transaction;
                if (nestedTransaction && nestedTransaction.transaction) {
                    actualTransaction = nestedTransaction.transaction;
                    console.log(`[DIRECT-SOLANA-SENDER] 🔍 DEBUG: Extracted actual transaction from LaserStream response (4 levels deep)`);
                    console.log(`[DIRECT-SOLANA-SENDER] 🔍 DEBUG: Actual transaction has instructions: ${actualTransaction?.instructions?.length || 'undefined'}`);
                } else {
                    actualTransaction = nestedTransaction;
                    console.log(`[DIRECT-SOLANA-SENDER] 🔍 DEBUG: Extracted actual transaction from LaserStream response (3 levels deep)`);
                    console.log(`[DIRECT-SOLANA-SENDER] 🔍 DEBUG: Actual transaction has instructions: ${actualTransaction?.instructions?.length || 'undefined'}`);
                }
            }

            // 4. Pass this decision to the cloner with currency abstraction logic
            const isSolBuy = tradeDetails.inputMint === config.NATIVE_SOL_MINT;

            const builderOptions = {
                userPublicKey: keypair.publicKey,
                masterTraderWallet: tradeDetails.traderPubkey,
                cloningTarget: tradeDetails.cloningTarget,
                tradeType: tradeDetails.tradeType,
                inputMint: tradeDetails.inputMint,
                outputMint: tradeDetails.outputMint,
                amountBN: userAmountToSpend, // The user's specific amount (SOL for buys, token for sells)
                slippageBps: userSlippageBps,
                
                // User-specific parameters
                userChatId: userChatId,
                userSolAmount: tradeDetails.tradeType === 'buy' ? userAmountToSpend : new BN('0'),
                userTokenBalance: tradeDetails.tradeType === 'sell' ? userAmountToSpend : null,
                
                // *** THIS IS THE CURRENCY ABSTRACTION LOGIC ***
                // We tell the cloner how we want to pay.
                userPaymentMethod: isSolBuy ? 'sol' : 'sol_override', // 'sol_override' tells it to build a SOL tx even if the original was different
                
                userRiskSettings: {
                    slippageTolerance: userSlippageBps,
                    maxTradesPerDay: 10
                },
                // NEW: Durable nonce support
                nonceInfo: nonceInfo,
                // NEW: Pass original transaction for complete instruction cloning
                originalTransaction: actualTransaction
            };
    
            console.log(`[DIRECT-SOLANA-SENDER] 🔧 Building Universal Cloned instructions...`);
            console.log(`[DIRECT-SOLANA-SENDER] 🔑 Transaction signature: ${masterSignature}`);
            console.log(`[DIRECT-SOLANA-SENDER] 💰 Master trader amount: ${tradeDetails.inputAmountRaw} raw units`);
            console.log(`[DIRECT-SOLANA-SENDER] 💰 User copy trade amount: ${userAmountToSpend.toString()} raw units`);
            console.log(`[DIRECT-SOLANA-SENDER] 🔍 DEBUG: originalTransaction type: ${typeof originalTransaction}`);
            console.log(`[DIRECT-SOLANA-SENDER] 🔍 DEBUG: originalTransaction has instructions: ${originalTransaction?.instructions?.length || 'undefined'}`);
            console.log(`[DIRECT-SOLANA-SENDER] 🔍 DEBUG: actualTransaction has instructions: ${actualTransaction?.instructions?.length || 'undefined'}`);
            
            // Log builder options to JSON file for detailed analysis
            this.transactionLogger.logCopyTradeExecution(masterSignature, {
                platform: tradeDetails.dexPlatform,
                builderOptions: builderOptions,
                userAmount: userAmountToSpend.toString(),
                masterAmount: tradeDetails.inputAmountRaw
            }, { status: 'building_universal_instructions' });
            
            // Build Universal Cloned instructions
            let instructions;
            try {
                const cloneResult = await this.universalCloner.buildClonedInstruction(builderOptions);
                instructions = cloneResult.instructions;
            } catch (cloneError) {
                console.error(`[DIRECT-SOLANA-SENDER] ❌ Universal Cloner failed:`, cloneError.message);
                console.error(`[DIRECT-SOLANA-SENDER] ❌ Clone error stack:`, cloneError.stack);
                throw new Error(`Universal Cloner failed: ${cloneError.message}`);
            }
    
            if (!instructions || instructions.length === 0) {
                throw new Error(`Universal Cloner failed to produce any instructions`);
            }
    
            console.log(`[DIRECT-SOLANA-SENDER] ✅ Universal Cloner built ${instructions.length} instructions`);
    
            // DEBUG: Log platform information before passing to Direct Solana Sender
            console.log(`[DIRECT-SOLANA-SENDER] 🔍 DEBUG Platform Tracing:`);
            console.log(`[DIRECT-SOLANA-SENDER] 🔍 tradeDetails.dexPlatform: ${tradeDetails.dexPlatform}`);
            console.log(`[DIRECT-SOLANA-SENDER] 🔍 tradeDetails keys:`, Object.keys(tradeDetails));
            
            // Prepare trade details for Direct Solana Sender with user's amounts
            const enhancedTradeDetails = {
                ...tradeDetails,
                tokenMint: tradeDetails.outputMint,
                tradeSize: 'Standard',
                userChatId,
                traderName,
                masterSignature,
                // Use user's calculated amounts, not master trader's
                inputAmountRaw: userAmountToSpend.toString(),
                userAmountBN: userAmountToSpend.toString()
            };
    
            // ULTRA-FAST execution - minimal logging for speed
            performanceTracker.logStep('pre_execution');
            
            try {
                // Use the new direct Solana execution method with leader targeting
                const result = await this.directSolanaSender.executeCopyTrade(
                    originalTransaction || tradeDetails.originalTransaction, // Pass the original transaction for structure cloning
                    keypair,
                    {
                        // ULTRA-FAST execution options
                        platform: tradeDetails.dexPlatform,
                        tradeType: tradeDetails.tradeType,
                        userChatId,
                        traderName,
                        masterSignature,
                        clonedInstructions: instructions, // Pass the cloned instructions from Universal Cloner
                        // 🚀 HARDCODED FEE STRATEGY: Pass user's SOL amount for 15% fee calculation
                        userSolAmount: userAmountToSpend.toNumber(), // Pass the calculated SOL amount in lamports
                        computeUnits: 'dynamic', // Let directSolanaSender handle compute units
                        simulate: true, // Enable simulation for debugging (non-blocking)
                        nonceInfo: nonceInfo // Pass nonce info for durable transactions
                    }
                );
    
                if (result.success) {
                    console.log(`[DIRECT-SOLANA-SENDER] 🎉 ULTRA-FAST copy trade executed successfully!`);
                    console.log(`[DIRECT-SOLANA-SENDER] 🔑 Copy signature: ${result.signature}`);
                    
                    // FALSE POSITIVE CHECK: Verify BUY transactions actually received tokens
                    if (tradeDetails.tradeType === 'buy') {
                        console.log(`[DIRECT-SOLANA-SENDER] 🔍 Performing false positive check for BUY transaction...`);
                        try {
                            // Wait a moment for the transaction to be fully processed
                            await new Promise(resolve => setTimeout(resolve, 2000));
                            
                            // Check if user actually received tokens
                            const userTokenAccount = getAssociatedTokenAddressSync(
                                new PublicKey(tradeDetails.outputMint), 
                                keypair.publicKey
                            );
                            
                            const tokenAccountInfo = await this.solanaManager.connection.getTokenAccountBalance(userTokenAccount);
                            const userTokenBalance = new BN(tokenAccountInfo.value.amount);
                            
                            console.log(`[DIRECT-SOLANA-SENDER] 🔍 User token balance after BUY: ${userTokenBalance.toString()} raw units`);
                            
                            if (userTokenBalance.gt(new BN(0))) {
                                console.log(`[DIRECT-SOLANA-SENDER] ✅ FALSE POSITIVE CHECK PASSED: User received ${userTokenBalance.toString()} tokens`);
                                
                                // ✅ FIX: Use enhanced recordBuyPosition with validation
                                await this.dataManager.recordBuyPosition(
                                    userChatId,
                                    tradeDetails.outputMint,
                                    userTokenBalance.toString(),
                                    userSolAmount || 0 // Use user's SOL amount
                                );
                                console.log(`[DIRECT-SOLANA-SENDER] 💾 ✅ Position recorded: ${userTokenBalance.toString()} tokens for ${shortenAddress(tradeDetails.outputMint)}`);
                                
                            } else {
                                console.log(`[DIRECT-SOLANA-SENDER] ❌ FALSE POSITIVE DETECTED: Transaction reported success but user received 0 tokens!`);
                                console.log(`[DIRECT-SOLANA-SENDER] 🔍 This indicates the transaction may have failed despite reporting success`);
                                
                                // Log this as a false positive for analysis
                                await traceLogger.appendTrace(masterSignature, 'false_positive_buy', {
                                    copySignature: result.signature,
                                    expectedToken: tradeDetails.outputMint,
                                    actualBalance: '0',
                                    platform: tradeDetails.dexPlatform
                                });
                            }
                            
                        } catch (falsePositiveError) {
                            console.error(`[DIRECT-SOLANA-SENDER] ❌ False positive check failed: ${falsePositiveError.message}`);
                            // Don't throw - this is just a verification step
                        }
                    }
                    
                } else {
                    console.log(`[DIRECT-SOLANA-SENDER] ❌ ULTRA-FAST copy trade FAILED!`);
                    console.log(`[DIRECT-SOLANA-SENDER] 🔑 Failed signature: ${result.signature}`);
                }
                console.log(`[DIRECT-SOLANA-SENDER] ⚡ Execution time: ${result.executionTime}ms`);
                console.log(`[DIRECT-SOLANA-SENDER] 🔍 Confirmation time: ${result.confirmationTime}ms`);
                console.log(`[DIRECT-SOLANA-SENDER] 📊 Result:`, {
                    signature: shortenAddress(result.signature),
                    executionTime: result.executionTime,
                    confirmationTime: result.confirmationTime,
                    tipAmount: result.tipAmount,
                    tipAccount: shortenAddress(result.tipAccount)
                });
    
                // Check if execution meets ultra-fast targets
                if (result.executionTime < 200) {
                    console.log(`[DIRECT-SOLANA-SENDER] ⚡ ULTRA-FAST TARGET ACHIEVED: ${result.executionTime}ms execution!`);
                } else if (result.executionTime < 400) {
                    console.log(`[DIRECT-SOLANA-SENDER] 🚀 FAST TARGET ACHIEVED: ${result.executionTime}ms execution`);
                } else {
                    console.log(`[DIRECT-SOLANA-SENDER] ⚠️ Execution time: ${result.executionTime}ms (above target)`);
                }
    
                // Send notification with proper tradeResult object
                if (this.notificationManager) {
                    const tradeResult = {
                        signature: result.signature,
                        tradeType: tradeDetails.tradeType,
                        inputMint: tradeDetails.inputMint,
                        outputMint: tradeDetails.outputMint,
                        inputAmountRaw: tradeDetails.inputAmountRaw,
                        outputAmountRaw: tradeDetails.outputAmountRaw,
                        solSpent: tradeDetails.tradeType === 'buy' ? tradeDetails.outputAmountLamports / 1e9 : 0,
                        solReceived: tradeDetails.tradeType === 'sell' ? tradeDetails.outputAmountLamports / 1e9 : 0,
                        tokenDecimals: tradeDetails.tokenDecimals || 9,
                        solFee: result.tipAmount / 1e9
                    };
    
                    await this.notificationManager.notifySuccessfulCopy(
                        userChatId,
                        traderName,
                        'zap', // copyWalletLabel
                        tradeResult
                    );
                }
    
                // Log success
                await traceLogger.appendTrace(masterSignature, 'step4_directSolanaSenderExecution', {
                    userChatId,
                    success: true,
                    signature: result.signature,
                    tipAmount: result.tipAmount
                });
    
                return result;
    
            } catch (executionError) {
                console.error(`[DIRECT-SOLANA-SENDER] ❌ Real execution failed: ${executionError.message}`);
                
                // Send error notification
                if (this.notificationManager) {
                    await this.notificationManager.sendErrorNotification(
                        userChatId,
                        `Copy trade execution failed: ${executionError.message}`,
                        'direct-solana-sender-execution'
                    );
                }
    
                throw executionError;
            }
    
        } catch (error) {
            console.error(`[DIRECT-SOLANA-SENDER] ❌ Copy trade execution failed for user ${userChatId}:`, error);
            
            // Mark transaction as failed to prevent retries
            if (masterSignature) {
                this.failedTransactions.add(masterSignature);
                const blockhash = this.currentBlockhash || 'unknown';
                this.failedTransactionBlockhashes.set(masterSignature, blockhash);
                console.log(`[DIRECT-SOLANA-SENDER] 🚫 Marked transaction ${shortenAddress(masterSignature)} as failed - will not retry`);
            }
            
            // Log failure
            if (masterSignature) {
                await traceLogger.appendTrace(masterSignature, 'step4_directSolanaSenderExecution', {
                    userChatId,
                    success: false,
                    error: error.message
                });
            }
    
            // Send error notification
            if (this.notificationManager) {
                await this.notificationManager.sendErrorNotification(
                    userChatId,
                    `Copy trade failed: ${error.message}`,
                    'direct-solana-sender'
                );
            }
    
            throw error;
        } finally {
            // Clear the timeout
            clearTimeout(timeoutId);
            // Always remove user from processing set to prevent deadlock
            this.userProcessing.delete(userChatId);
        }
    }

    // ==========================================================
    // ============ [END] DIRECT SOLANA SENDER INTEGRATION ============
    // ==========================================================


}

// CommonJS Export
module.exports = { TradingEngine };