
// ==========================================
// ====== ZapBot TradingEngine (HARDENED) ======
// ==========================================
// File: tradingEngine.js
// Description: Fully hardened trading logic with comprehensive safety checks.

const { PublicKey, ComputeBudgetProgram, VersionedTransaction, TransactionMessage } = require('@solana/web3.js');
const BN = require('bn.js');
const { getAssociatedTokenAddressSync, createAssociatedTokenAccountIdempotentInstruction } = require("@solana/spl-token");
const { Buffer } = require('buffer');

const platformBuilders = require('./platformBuilders.js');
const config = require('./config.js');
const { shortenAddress } = require('./utils.js');
const traceLogger = require('./traceLogger.js');
// const UnifiedPrebuilder = require('./unifiedPrebuilder.js');
const sellInstructionCache = new Map();

class TradingEngine {
constructor(solanaManager, databaseManager, walletManager, transactionAnalyzer, notificationManager, apiManager, cacheManager) {
if (![solanaManager, databaseManager, walletManager, transactionAnalyzer, notificationManager, apiManager, cacheManager].every(Boolean)) {
throw new Error("TradingEngine: Missing required manager modules.");
}

// Initialize TradingEngine
this.solanaManager = solanaManager;
    this.databaseManager = databaseManager;
    this.walletManager = walletManager;
    this.transactionAnalyzer = transactionAnalyzer;
    this.notificationManager = notificationManager;
    this.apiManager = apiManager;
    this.cacheManager = cacheManager;

    this.isProcessing = new Set();
    this.traderCutoffSignatures = new Map();
    
    // Initialize unified prebuilder
    // this.unifiedPrebuilder = new UnifiedPrebuilder(solanaManager, walletManager);
    
    console.log("TradingEngine initialized with HYBRID (Polling + API) logic and Quantum Cache.");
}

handleLaserStreamData(sourceWallet, signature, txData) {
    // This is now just a clean entry point. All logic is in _executeCopyForUser.
    this._executeCopyForUser(sourceWallet, signature, txData)
        .catch(error => {
            console.error(`[LASERSTREAM] Uncaught error for sig ${signature}:`, error);
        });
}


async getMasterTraderWallets() {
    console.log(`[HELPER] Compiling list of all active trader wallets to monitor...`);
    try {
        // Use database instead of old dataManager
        const tradersByUser = await this.databaseManager.getTradersGroupedByUser();
        const walletsToMonitor = new Set();
        
        // Iterate through all users and their traders
        for (const [userId, traders] of Object.entries(tradersByUser)) {
            for (const trader of traders) {
                if (trader.active && trader.wallet_address) {
                    walletsToMonitor.add(trader.wallet_address);
                }
            }
        }
        
        const walletArray = Array.from(walletsToMonitor);
        console.log(`[HELPER] Found ${walletArray.length} unique active trader wallets to monitor.`);
        return walletArray;
    } catch (error) {
        console.error(`[HELPER] Error compiling master trader list:`, error);
        return [];
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

async processSignature(sourceWalletAddress, signature, polledTraderInfo = null, preFetchedTxData = null) {
     // This is the fallback entry point for manual /copy or future polling systems.
     // It simply calls the same master execution function.
    this._executeCopyForUser(sourceWalletAddress, signature, preFetchedTxData)
        .catch(error => {
            console.error(`[PROCESS_SIG] Uncaught error for sig ${signature}:`, error);
        });
}

// async _handleCopyError(error, userChatId, traderName, config) {
//     const primaryWalletLabel = config?.primaryWalletLabel || 'Unknown';
//     console.error(`[EXEC-USER-${userChatId}] Copy failed for ${traderName}:`, error.message);

//     await this.notificationManager.notifyFailedCopy(
//         parseInt(userChatId), traderName, primaryWalletLabel, 'copy', `Execution failed: ${error.message}`
//     ).catch(e => console.error(`[EXEC-USER-${userChatId}] Notification failed:`, e.message));
// }

// THIS IS THE FINAL, COMBAT-READY VERSION WITH IMPROVEMENTS
// ====== [START OF V2.1 CODE] ====== //


// async handleWalletStreamEvent(txData) {
//     // Destructure IMMEDIATELY for error safety
//     const { signature, traderAddress } = txData;
//     try {
//         console.log(`[EXPRESS_LANE] Event from ${shortenAddress(traderAddress)} | Sig: ${shortenAddress(signature)}`);

//         // STEP 1: Mint Extraction
//         const targetMint = this._extractMintFromStreamData(txData);
//         if (!targetMint) {
//             return this.processSignature(traderAddress, signature); // Early exit
//         }

//         // STEP 2: Dagger Strike (Pre-Signed TX Only)
//         const preSignedTxString = this.cacheManager.getPreSignedTx(targetMint);
//         if (preSignedTxString) {
//             console.log(`[EXPRESS_LANE] 🚀 Dagger hit for ${shortenAddress(targetMint)}!`);

//             const userInfo = await this._mapTraderToUser(traderAddress);
//             if (!userInfo) return; // Abort if no copier

//             // Fire pre-signed TX
//             const sendResult = await this.solanaManager.sendRawSerializedTransaction(preSignedTxString);
//             if (sendResult.error) throw new Error(`Dagger execution failed: ${sendResult.error}`);

//             // Post-trade workflow
//             await this._handlePostTradeActions(userInfo, targetMint, sendResult.signature);
//             return; // Mission complete
//         }

//         // STEP 3: Fallback (No Dagger)
//         console.log(`[EXPRESS_LANE] No Dagger. Falling back to Standard Lane.`);
//         return this.processSignature(traderAddress, signature);

//     } catch (error) {
//         console.error(`[EXPRESS_LANE] Failure: ${error.message}`);
//         return this.processSignature(traderAddress, signature); // Error-safe fallback
//     }
// }

async executeManualSell(userChatId, tokenMint) {
    console.log(`[MANUAL_SELL-${userChatId}] Order received for token: ${shortenAddress(tokenMint)}`);
    const keypairPacket = await this.walletManager.getPrimaryTradingKeypair(userChatId);
    if (!keypairPacket) {
        return this.notificationManager.notifyFailedCopy(userChatId, 'Manual Sell', 'N/A', 'sell', 'No primary wallet found.');
    }
    const { keypair, wallet } = keypairPacket;

    try {
        // STEP 1: Get the user's position for this token from our database.
        const sellDetails = this.databaseManager.getUserSellDetails(String(userChatId), tokenMint);
        if (!sellDetails || sellDetails.amountToSellBN.isZero()) {
            throw new Error(`You do not have a recorded position for this token.`);
        }
        const { amountToSellBN, originalSolSpent } = sellDetails;

        // STEP 2: DYNAMICALLY RE-ANALYZE the token's current platform. THIS IS THE CORE FIX.
        console.log(`[MANUAL_SELL-${userChatId}] Re-analyzing current platform for ${shortenAddress(tokenMint)}...`);
        const migrationStatus = await this.transactionAnalyzer._checkTokenMigrationStatus(tokenMint);

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
            const cachedBuyInfo = this.cacheManager.getTradeData(tokenMint);
            if (!cachedBuyInfo || !cachedBuyInfo.platform) {
                // As a last resort, check pump.fun AMM
                const pumpAmmPool = await platformBuilders.getPumpAmmPoolState(tokenMint).catch(() => null);
                if (pumpAmmPool) {
                    tradeDetails = { dexPlatform: 'Pump.fun AMM' };
                } else {
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


// ====== [CRITICAL HELPER] ====== //
// async _handlePostTradeActions(userInfo, targetMint, signature) {
//     const { userChatId, traderName, primaryWalletLabel } = userInfo;

//     // Get trade metadata (SOL spent, token amount, etc.)
//     const metadata = this.cacheManager.getTradeData(targetMint) || {};

//     // Update position in database
//     await this.databaseManager.recordBuyPosition(
//         userChatId,
//         targetMint,
//         metadata.outputAmountRaw || "0",
//         metadata.solSpent || 0
//     );

//     // Send success notification
//     const notificationResult = {
//         ...metadata,
//         signature,
//         solSpent: metadata.solSpent || 0
//     };
//     await this.notificationManager.notifySuccessfulCopy(
//         userChatId,
//         traderName,
//         primaryWalletLabel,
//         notificationResult
//     );

//     // Pre-cache NEXT sell dagger
//     await this._precacheSellInstruction(signature, {
//         ...notificationResult,
//         userChatId
//     });
// }
// ====== [END OF V2.1 CODE] ====== //

// _extractMintFromStreamData(txData) {
//     try {
//         if (txData?.tokenTransfers?.length) {
//             return txData.tokenTransfers.find(t =>
//                 t.mint !== config.NATIVE_SOL_MINT
//             )?.mint;
//         }
//         if (txData?.swaps?.length) {
//             const swap = txData.swaps[0];
//             return [swap.token_in.address, swap.token_out.address]
//                 .find(mint => mint !== config.NATIVE_SOL_MINT);
//         }
//         console.warn(`[MINT_EXTRACT] No valid mint found in txData:`, txData); // Log unhandled case
//         return null;
//     } catch (e) {
//         console.warn(`[MINT_EXTRACT] Error:`, e);
//         return null;
//     }
// }

// async _mapTraderToUser(traderWallet) {
//     try {
//         const syndicateData = await this.databaseManager.loadTraders();
//         for (const userChatId in syndicateData.user_traders) {
//             const userTraders = syndicateData.user_traders[userChatId];
//             for (const traderName in userTraders) {
//                 const traderConfig = userTraders[traderName];
//                 if (traderConfig.wallet === traderWallet && traderConfig.active) {
//                     const keypairPacket = await this.walletManager.getPrimaryTradingKeypair(userChatId);
//                     if (!keypairPacket) continue;

//                     return {
//                         userChatId: parseInt(userChatId),
//                         keypair: keypairPacket.keypair,
//                         traderName: traderName,
//                         primaryWalletLabel: keypairPacket.wallet.label
//                     };
//                 }
//             }
//         }
//     } catch (error) {
//         console.error(`[MAP_TRADER] Error during user mapping:`, error);
//     }
//     return null;
// }


async _executeCopyForUser(sourceWalletAddress, signature, preFetchedTxData) {
    if (this.isProcessing.has(signature)) return;
    this.isProcessing.add(signature);

    try {
        const analysisResult = await this.transactionAnalyzer.analyzeTransactionForCopy(signature, preFetchedTxData, sourceWalletAddress);
        if (!analysisResult.isCopyable) return;

        // ✅ ARCHITECTURE WIN: Platform is analyzed ONCE per trader event.
        const platformExecutorMap = {
            'Pump.fun': { builder: platformBuilders.buildPumpFunInstruction, units: 400000 },
            'Pump.fun BC': { builder: platformBuilders.buildPumpFunInstruction, units: 400000 },
            'Pump.fun AMM': { builder: platformBuilders.buildPumpFunAmmInstruction, units: 800000 },
            'Raydium Launchpad': { builder: platformBuilders.buildRaydiumLaunchpadInstruction, units: 1400000 },
            'Raydium AMM': { builder: platformBuilders.buildRaydiumV4Instruction, units: 800000 },
            'Raydium V4': { builder: platformBuilders.buildRaydiumV4Instruction, units: 800000 },
            'Raydium CLMM': { builder: platformBuilders.buildRaydiumClmmInstruction, units: 1400000 },
            'Raydium CPMM': { builder: platformBuilders.buildRaydiumCpmmInstruction, units: 1000000 },
            'Meteora DLMM': { builder: platformBuilders.buildMeteoraDLMMInstruction, units: 1000000 },
            'Meteora DBC': { builder: platformBuilders.buildMeteoraDBCInstruction, units: 1000000 },
            'Meteora CP-AMM': { builder: platformBuilders.buildMeteoraCpAmmInstruction, units: 1000000 },
        };
        const executorConfig = platformExecutorMap[analysisResult.details.dexPlatform];

        const syndicateData = await this.databaseManager.loadTraders();
        const copyJobs = [];
        for (const [userChatId, userTraders] of Object.entries(syndicateData.user_traders || {})) {
            for (const [traderName, traderConfig] of Object.entries(userTraders)) {
                if (traderConfig.active && traderConfig.wallet === sourceWalletAddress) {
                    copyJobs.push({ userChatId: parseInt(userChatId), traderName });
                }
            }
        }
        
        if (copyJobs.length === 0) return;
        console.log(`[EXECUTE_MASTER] Dispatching copy for ${analysisResult.details.dexPlatform} trade to ${copyJobs.length} user(s).`);

        await Promise.allSettled(
            copyJobs.map(job => 
                this._sendTradeForUser( // Renamed for clarity
                    analysisResult.details, 
                    job.traderName, 
                    job.userChatId, 
                    signature,
                    executorConfig // ✅ Correctly passing the pre-calculated config
                )
            )
        );

    } catch (error) {
        console.error(`[MASTER_EXECUTION] Top-level error for sig ${shortenAddress(signature)}:`, error.message);
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
        const primaryWalletPacket = await this.walletManager.getPrimaryTradingKeypair(userChatId);
        if (!primaryWalletPacket) throw new Error("No primary keypair found to build sell instruction.");

        const { keypair, wallet } = primaryWalletPacket;

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

        // === 3️⃣ DYNAMIC PLATFORM BUILDER MAP ===
        const builderMap = {
            'Pump.fun': platformBuilders.buildPumpFunInstruction,
            'Pump.fun AMM': platformBuilders.buildPumpFunAmmInstruction,
            'Raydium V4': platformBuilders.buildRaydiumV4Instruction,
            'Raydium AMM': platformBuilders.buildRaydiumV4Instruction,
            'Raydium CLMM': platformBuilders.buildRaydiumClmmInstruction,
            'Raydium CPMM': platformBuilders.buildRaydiumCpmmInstruction,
            'Meteora DLMM': platformBuilders.buildMeteoraDLMMInstruction,
            'Meteora DBC': platformBuilders.buildMeteoraDBCInstruction,
            'Meteora CP-AMM': platformBuilders.buildMeteoraCpAmmInstruction,
            'Jupiter Aggregator': platformBuilders.buildJupiterSwapInstruction,
        };

        const builder = builderMap[sellTradeDetails.dexPlatform];
        if (!builder) {
            console.log(`[PRE-SELL-${userChatId}] ⚠️ No direct SDK builder for selling on ${sellTradeDetails.dexPlatform}. Sell will default to Jupiter API when triggered.`);
            return; // No pre-sign if builder unsupported
        }

        const builderOptions = {
            connection: this.solanaManager.connection,
            keypair,
            userPublicKey: keypair.publicKey,
            swapDetails: sellTradeDetails,
            amountBN: amountReceivedBN, // Use the precise amount we received
            slippageBps: 9000, // High slippage for "get me out" sells
            cacheManager: this.cacheManager,
        };

        const sellInstructions = await builder(builderOptions);
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

        this.cacheManager.addTradeData(tokenMint, sellReadyPacket);
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
        this.notificationManager.notifyFailedCopy(userChatId, traderName, "N/A", "copy", "No primary trading wallet set.");
        await traceLogger.recordOutcome(masterTxSignature, 'FAILURE', "User has no primary wallet.");
        return; // Exit gracefully for this user.
    }
    const { keypair, wallet: primaryWallet } = keypairPacket;

    // ====== ONE-BUY-ONE-SELL GATEKEEPER ======
const isBuy = tradeDetails.tradeType === 'buy';
if (isBuy) {
    const userPositions = this.databaseManager.getUserPositions(String(userChatId));
    const tokenToBuy = tradeDetails.outputMint;

    // Check if the user ALREADY has a position and it's not empty.
    if (userPositions.has(tokenToBuy) && userPositions.get(tokenToBuy).amountRaw > 0n) {
        const reason = `You already have an active position for ${shortenAddress(tokenToBuy)}. One buy per token is allowed.`;
        console.log(`[GATEKEEPER-${userChatId}] SKIPPING BUY for ${traderName}. Reason: ${reason}`);
        
        // Notify the user why the copy was skipped.
        this.notificationManager.notifyNoCopy(userChatId, traderName, primaryWallet.label, reason)
            .catch(e => console.error(`[Notification Error] Gatekeeper notification failed: ${e.message}`));
        
        // CRITICAL: Stop the function here to prevent the buy.
        return; 
    }
}
// ===========================================

    try {
        if (!executorConfig || !executorConfig.builder) {
            console.log(`[PIVOT-EXEC] No direct builder for "${tradeDetails.dexPlatform}". Defaulting to Jupiter for user ${userChatId}.`);
            return await this.executeUniversalApiSwap(tradeDetails, traderName, userChatId, keypairPacket, masterTxSignature);
        }

        const { builder, units: computeUnits } = executorConfig;
        const isBuy = tradeDetails.tradeType === 'buy';
        let amountBN, solAmountForNotification = 0;
        let preInstructions = [];

        if (isBuy) {
            const solAmounts = await this.databaseManager.loadSolAmounts();
            solAmountForNotification = solAmounts[String(userChatId)] || config.DEFAULT_SOL_TRADE_AMOUNT;
            amountBN = new BN(Math.floor(solAmountForNotification * config.LAMPORTS_PER_SOL_CONST));
            tradeDetails.solSpent = solAmountForNotification;
            preInstructions.push(createAssociatedTokenAccountIdempotentInstruction(keypair.publicKey, getAssociatedTokenAddressSync(new PublicKey(tradeDetails.outputMint), keypair.publicKey), keypair.publicKey, new PublicKey(tradeDetails.outputMint)));
        } else { // SELL logic remains the same
            const sellDetails = this.databaseManager.getUserSellDetails(String(userChatId), tradeDetails.inputMint);
            if (!sellDetails || !sellDetails.amountToSellBN || sellDetails.amountToSellBN.isZero()) throw new Error(`No recorded position for this token.`);
            amountBN = sellDetails.amountToSellBN;
            tradeDetails.originalSolSpent = sellDetails.originalSolSpent;
        }

        const buildOptions = { connection: this.solanaManager.connection, keypair, swapDetails: tradeDetails, amountBN, slippageBps: isBuy ? 2500 : 9000, cacheManager: this.cacheManager };
        const preSellBalance = await this.solanaManager.connection.getBalance(keypair.publicKey);
        const instructions = await builder(buildOptions);
        if (!instructions || !instructions.length) throw new Error("Platform builder returned no instructions.");
        
        // ✅ CRITICAL FIX: Add compute budget instructions.
        // NOTE: Helius Sender API adds the Jito tip for us, so we only need these two.
        // ✅ DYNAMIC FEE LOGIC: Call the new estimator
const priorityFee = await this.solanaManager.getPriorityFeeEstimate(
    [...preInstructions, ...instructions], // Pass all non-fee instructions
    keypair.publicKey
);

const finalInstructions = [
    ComputeBudgetProgram.setComputeUnitLimit({ units: computeUnits || 1400000 }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: priorityFee }), // Use the dynamic fee
    ...preInstructions,
    ...instructions
];

        const { signature, error: sendError } = await this.solanaManager.sendVersionedTransaction({ instructions: finalInstructions, signer: keypair });
                // ======= FEE CAPTURE START =======
        let solFee = 0;
        try {
            const txDetails = await this.solanaManager.connection.getTransaction(signature, { maxSupportedTransactionVersion: 0 });
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

        const finalizedDetails = { ...tradeDetails, signature, solSpent: solAmountForNotification, solFee: solFee };
        await this.notificationManager.notifySuccessfulCopy(userChatId, traderName, primaryWallet.label, finalizedDetails);
        if (isBuy) {
            await this.databaseManager.recordBuyPosition(userChatId, finalizedDetails.outputMint, finalizedDetails.outputAmountRaw || "0", solAmountForNotification);
            finalizedDetails.userChatId = userChatId;
            await this._precacheSellInstruction(signature, finalizedDetails);
               } else {
            // Get post-sell balance to calculate solReceived accurately
            const postSellBalance = await this.solanaManager.connection.getBalance(keypair.publicKey);
            const solReceived = (postSellBalance - preSellBalance) / config.LAMPORTS_PER_SOL_CONST;
            finalizedDetails.solReceived = solReceived;

            await this.databaseManager.updatePositionAfterSell(userChatId, tradeDetails.inputMint, amountBN.toString(), solFee, solReceived);
        }
    } catch (error) {
        console.error(`[EXECUTION] ❌ FAILED for user ${userChatId} (${shortenAddress(masterTxSignature)}):`, error.message);
        await traceLogger.recordOutcome(masterTxSignature, 'FAILURE', error.message);
        this.notificationManager.notifyFailedCopy(userChatId, traderName, primaryWallet.label, tradeDetails.tradeType, error.message);
    }
}


// Helper function extracted for clarity
async _getAmountReceivedFromBuy(buySignature, walletAddress, tokenMint) {
    const txInfo = await this.solanaManager.connection.getTransaction(buySignature, { maxSupportedTransactionVersion: 0 });
    if (!txInfo || txInfo.meta.err) throw new Error(`Buy transaction ${buySignature} failed or not found.`);

    const postBalance = txInfo.meta.postTokenBalances.find(tb => tb.owner === walletAddress && tb.mint === tokenMint);
    const preBalance = txInfo.meta.preTokenBalances.find(tb => tb.owner === walletAddress && tb.mint === tokenMint);

    const postAmount = new BN(postBalance?.uiTokenAmount.amount || '0');
    const preAmount = new BN(preBalance?.uiTokenAmount.amount || '0');
    return postAmount.sub(preAmount);
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
    const allPositions = await this.databaseManager.loadPositions();
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


// async processPumpMigration(migrationData) {
//     try {
//         const accounts = migrationData.Instruction.Program.AccountNames;
//         if (!accounts || accounts.length < 5) return;
//         const tokenMint = accounts[4]; // coinMint

//         if (tokenMint) {
//             // Call the central hub with the details.
//             this.handleTokenMigration({
//                 tokenMint,
//                 signature: migrationData.Transaction.Signature,
//                 fromPlatform: 'Pump.fun',
//                 toPlatform: 'Raydium AMM'
//             });
//         }
//     } catch (error) {
//         console.error(`[PROCESS_PUMP_MIGRATE] Error parsing event: ${error.message}`);
//     }
// }


// async processPumpAmmMigration(migrationData) {
//     try {
//         const accountNames = migrationData.Instruction.Program.AccountNames;
//         const accounts = migrationData.Instruction.Accounts.map(a => a.Address);
//         const tokenMint = accounts[accountNames.indexOf('mint')];

//         if (tokenMint) {
//             this.handleTokenMigration({
//                 tokenMint,
//                 signature: migrationData.Transaction.Signature,
//                 fromPlatform: 'Pump.fun BC',
//                 toPlatform: 'Pump.fun AMM'
//             });
//         }
//     } catch (error) {
//         console.error(`[PROCESS_PUMP_AMM_MIGRATE] Error parsing event: ${error.message}`);
//     }
// }



// async processLaunchpadMigration(migrationData) {
//     try {
//         // Step 1: Parse the event data to get the essential info.
//         const accountNames = migrationData.Instruction.Program.AccountNames;
//         const accounts = migrationData.Instruction.Accounts.map(a => a.Address);
//         const tokenMint = accounts[accountNames.indexOf('base_mint')];
//         const toPlatform = migrationData.Instruction.Program.Method === 'migrate_to_amm' ? 'Raydium AMM' : 'Raydium CPMM';

//         // Step 2: If we successfully found the token mint, call the central hub.
//         if (tokenMint) {
//             // The hub will handle checking all users and sending all notifications.
//             this.handleTokenMigration({
//                 tokenMint,
//                 signature: migrationData.Transaction.Signature,
//                 fromPlatform: 'Raydium Launchpad',
//                 toPlatform: toPlatform
//             });
//         }
//     } catch (error) {
//         // Keep the error log for diagnostics.
//         console.error(`[PROCESS_LAUNCHPAD_MIGRATE] Error parsing event: ${error.message}`);
//     }
// }


async processRaydiumV4PoolCreation(signature) {
    try {
        console.log(`[V4-SNIPER] Detected new Raydium V4 pool creation. Sig: ${shortenAddress(signature, 10)}`);

        // Use getParsedTransaction, as shown in the QuickNode video.
        const tx = await this.solanaManager.connection.getParsedTransaction(signature, { maxSupportedTransactionVersion: 0 });
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
    const { keypair, wallet: primaryWallet } = keypairPacket;

    try {
        console.log(`[UniversalAPI-USER-${userChatId}] Engaging Jupiter API for ${tradeDetails.tradeType} trade...`);
        await traceLogger.appendTrace(masterTxSignature, 'step5_jupiterBuild', { status: 'PENDING' });

        const isBuy = tradeDetails.tradeType === 'buy';
        let amountToSwap;

        if (isBuy) {
            const solAmounts = await this.databaseManager.loadSolAmounts();
            const solAmountToUse = solAmounts[String(userChatId)] || config.DEFAULT_SOL_TRADE_AMOUNT;
            amountToSwap = parseInt((solAmountToUse * config.LAMPORTS_PER_SOL_CONST).toString());
            tradeDetails.solSpent = solAmountToUse;
        } else {
            const sellDetails = this.databaseManager.getUserSellDetails(String(userChatId), tradeDetails.inputMint);
            if (!sellDetails || !sellDetails.amountToSellBN || sellDetails.amountToSellBN.isZero()) {
                throw new Error(`Sell copy failed: User has no recorded position for this token.`);
            }
            amountToSwap = parseInt(sellDetails.amountToSellBN.toString());
            tradeDetails.originalSolSpent = sellDetails.originalSolSpent;
            tradeDetails.inputAmountRaw = sellDetails.amountToSellBN.toString();
        }

        const serializedTxs = await this.apiManager.getSwapTransactionFromJupiter({
            inputMint: tradeDetails.inputMint,
            outputMint: tradeDetails.outputMint,
            amount: amountToSwap,
            userWallet: keypair.publicKey.toBase58(),
            slippageBps: 2500,
        });
        await traceLogger.appendTrace(masterTxSignature, 'step5_jupiterBuild', { status: 'SUCCESS', transactionCount: serializedTxs.length });

        // **SAFETY CHECK for Jupiter API**
        if (!serializedTxs || serializedTxs.length === 0) {
            throw new Error("Jupiter API failed to return a valid transaction route.");
        }

        let finalSignature = null;
        for (const txString of serializedTxs) {
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
            await this.databaseManager.recordBuyPosition(userChatId, tradeDetails.outputMint, "0", tradeDetails.solSpent);
        } else {
            await this.databaseManager.updatePositionAfterSell(userChatId, tradeDetails.inputMint, String(amountToSwap));
        }
        await this.notificationManager.notifySuccessfulCopy(userChatId, traderName, primaryWallet.label, { ...tradeDetails, signature: finalSignature });


   } catch (e) {
    console.error(`[EXEC-UNIVERSAL-API] FAILED: ${e.message}`);
    await traceLogger.recordOutcome(masterTxSignature, 'FAILURE', `Jupiter Fallback Failed: ${e.message}`);
    
    // HARDENED NOTIFICATION: Use the keypairPacket which is always defined.
    const walletLabel = keypairPacket?.wallet?.label || 'Unknown Primary';
    this.notificationManager.notifyFailedCopy(userChatId, traderName, walletLabel, 'copy', e.message);
}
}


// async processPumpFunCreation(instructionData) {
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
//         const syndicateData = await this.databaseManager.loadTraders();
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
//             console.warn(`[PRE-BUILD] Skipping Pump.fun pre-build. No primary wallet set.`);
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
                    
//                     this.cacheManager.addTradeData(cacheKey, cacheData);
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
//         const cachedData = this.cacheManager.getTradeData(cacheKey);
        
//         if (!cachedData || !cachedData.presignedTransaction) {
//             console.warn(`[PUMP.FUN] No prebuilt transaction found for ${shortenAddress(tokenMint)} (${tradeSize})`);
//             return { success: false, reason: 'No prebuilt transaction found' };
//         }

//         // Check if transaction is still valid (not expired)
//         if (cachedData.expiresAt && Date.now() > cachedData.expiresAt) {
//             console.warn(`[PUMP.FUN] Prebuilt transaction expired for ${shortenAddress(tokenMint)}`);
//             this.cacheManager.removeTradeData(cacheKey);
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
//             this.cacheManager.removeTradeData(cacheKey);
            
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
//         const cachedData = this.cacheManager.getTradeData(cacheKey);
        
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

        this.cacheManager.addTradeData(tokenMint, tradeDataPacket);

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

//         this.cacheManager.addTradeData(tokenMint, tradeDataPacket);

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

//         this.cacheManager.addTradeData(baseMint, tradeDataPacket);

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
//         this.cacheManager.setTradeData(mint, tradeDetails);

//         // Optionally notify dev team or simulate
//         // await this.notificationManager.sendDevAlert("New Pump.fun token cached: " + mint);
//         // const simResult = await this.transactionAnalyzer.simulateTrade(tradeDetails);

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
            const onChainData = await platformBuilders.fetchPumpFunAccountData({
                connection: this.solanaManager.connection,
                tokenMint
            });
            return raydiumPool || onChainData.isComplete;
        } catch (error) {
            console.warn(`[MIGRATION-CHECK] Attempt ${attempt}/${this.retryAttempts} failed for ${shortenAddress(tokenMint)}: ${error.message}`);
            if (attempt < this.retryAttempts) await sleep(this.retryDelayMs);
        }
    }
    return false;
}



    // ==========================================================
    // =========== [START] HELIUS WEBHOOK PROCESSOR ===========
    // ==========================================================
    async processWebhookData(masterTraderAddress, signature, fullWebhookData) {
        if (this.isProcessing.has(signature)) {
            console.log(`[WEBHOOK-LOCK] Signature ${shortenAddress(signature)} is already being processed. Aborting webhook dispatch.`);
            return;
        }
        this.isProcessing.add(signature);
        
        console.log(`[WEBHOOK-PROCESSOR] Analyzing Helius data for sig: ${shortenAddress(signature)}`);

        try {
            // Get all users who are actively copying this specific master trader
            const syndicateData = await this.databaseManager.loadTraders();
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
            // We pass the FULL webhook data to the analyzer, skipping the need for another RPC call.
            const analysisResult = await this.transactionAnalyzer.analyzeTransactionForCopy(
                signature,
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
            
            // --- Execute the copy trade for ALL subscribed users in parallel ---
            const platformExecutorMap = {
                'Pump.fun': { builder: platformBuilders.buildPumpFunInstruction, units: 400000 },
                'Pump.fun BC': { builder: platformBuilders.buildPumpFunInstruction, units: 400000 },
                'Pump.fun AMM': { builder: platformBuilders.buildPumpFunAmmInstruction, units: 800000 },
                'Raydium Launchpad': { builder: platformBuilders.buildRaydiumLaunchpadInstruction, units: 1400000 },
                'Raydium AMM': { builder: platformBuilders.buildRaydiumV4Instruction, units: 800000 },
                'Raydium V4': { builder: platformBuilders.buildRaydiumV4Instruction, units: 800000 },
                'Raydium CLMM': { builder: platformBuilders.buildRaydiumClmmInstruction, units: 1400000 },
                'Raydium CPMM': { builder: platformBuilders.buildRaydiumCpmmInstruction, units: 1000000 },
                'Meteora DLMM': { builder: platformBuilders.buildMeteoraDLMMInstruction, units: 1000000 },
                'Meteora DBC': { builder: platformBuilders.buildMeteoraDBCInstruction, units: 1000000 },
                'Meteora CP-AMM': { builder: platformBuilders.buildMeteoraCpAmmInstruction, units: 1000000 },
            };
            const executorConfig = platformExecutorMap[analysisResult.details.dexPlatform];

            const copyPromises = jobs.map(job => {
                console.log(`[WEBHOOK-DISPATCH] User ${job.userChatId} copying ${job.traderName}'s TX: ${shortenAddress(job.signature)}`);
                
                // CRITICAL FIX: We call the CORRECT function, _sendTradeForUser, with the already-analyzed details.
                return this._sendTradeForUser(
                    analysisResult.details, 
                    job.traderName, 
                    job.userChatId, 
                    job.signature, 
                    executorConfig
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
    // ============ [END] HELIUS WEBHOOK PROCESSOR ============
    // ==========================================================

}

// CommonJS Export
module.exports = { TradingEngine };