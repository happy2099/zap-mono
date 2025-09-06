// ==========================================
// ====== ZapBot TransactionAnalyzer (v4 - Enhanced Library Powered) ======
// ==========================================
// File: transactionAnalyzer.js
// Description: Uses the official Shyft parser library for maximum reliability.

const { Connection, PublicKey, LAMPORTS_PER_SOL, VersionedTransaction, TransactionMessage, MessageV0, Message, CompiledInstruction } = require('@solana/web3.js');
const { Buffer } = require('buffer'); // Explicitly import Buffer for clarity
const config = require('./config.js');
const { RawTransactionFetcher } = require('./rawTransactionFetcher.js');
const { shortenAddress } = require('./utils.js');
const bs58 = require('bs58');
const BN = require('bn.js');
const bufferLayout = require('@solana/buffer-layout');
const { u64 } = bufferLayout;
const TransactionLogger = require('./transactionLogger');



// Utility to retry RPC calls - this looks correct for CJS as a function outside class
async function retry(fn, retries = 3, delay = 500) {
    for (let i = 0; i < retries; i++) {
        try {
            return await fn();
        } catch (error) {
            if (i < retries - 1) {
                await new Promise(resolve => setTimeout(resolve, delay));
            } else {
                throw error;
            }
        }
    }
}



class TransactionAnalyzer { // Changed 'export class' to 'class'
    constructor(connection, apiManager = null) {
        this.connection = connection;
        this.apiManager = apiManager; // Optional apiManager for pool lookups (TODO: Initialize if required)
        this.rawFetcher = new RawTransactionFetcher(connection._rpcEndpoint || 'https://gilligan-jn1ghl-fast-mainnet.helius-rpc.com');
        
        // Initialize unknown programs tracking
        this.unknownPrograms = new Set();
        
        // Set up periodic summary of unknown programs (every 5 minutes)
        this.unknownProgramsSummaryInterval = setInterval(() => {
            if (this.unknownPrograms && this.unknownPrograms.size > 0) {
                console.log(`[UNKNOWN-PROGRAM] ⏰ Periodic summary - ${this.unknownPrograms.size} unknown programs detected`);
                this.getUnknownProgramsSummary();
            }
        }, 5 * 60 * 1000); // 5 minutes

        // Validate required platform IDs
        const requiredPlatformIds = ['RAYDIUM_V4', 'RAYDIUM_LAUNCHPAD', 'RAYDIUM_CPMM', 'RAYDIUM_CLMM',
            'PUMP_FUN', 'PUMP_FUN_VARIANT', 'PUMP_FUN_AMM', 'PHOTON', 'AXIOM',
            'METEORA_DBC', 'METEORA_DLMM', 'METEORA_CP_AMM', 'Jupiter Aggregator', 'CUSTOM_ROUTER'];
        for (const id of requiredPlatformIds) {
            if (!config.PLATFORM_IDS[id]) {
                const platformIdVal = config.PLATFORM_IDS[id];
                if (!platformIdVal || (Array.isArray(platformIdVal) && platformIdVal.length === 0)) {
                    throw new Error(`Missing or empty required PLATFORM_IDS.${id} in config.js. Check config.js for these platform IDs and ensure they are populated.`);
                } else if (!Array.isArray(platformIdVal) && !(platformIdVal instanceof PublicKey)) {
                    throw new Error(`Invalid type for PLATFORM_IDS.${id} in config.js. Must be PublicKey or array of PublicKeys.`);
                }
            }
        }
        // Cached instances of frequently used PublicKeys and buffers from config
        this.platformIds = config.PLATFORM_IDS;
        this.NATIVE_SOL_MINT = config.NATIVE_SOL_MINT;

        // Pump.fun specific IDs and discriminators from config
        this.PUMP_FUN_GLOBAL_PK = config.PUMP_FUN_GLOBAL;
        this.PUMP_FUN_FEE_RECIPIENT_PK = config.PUMP_FUN_FEE_RECIPIENT;
        this.PUMP_FUN_BUY_DISCRIMINATOR_BUF = config.PUMP_FUN_BUY_DISCRIMINATOR;
        this.PUMP_FUN_SELL_DISCRIMINATOR_BUF = config.PUMP_FUN_SELL_DISCRIMINATOR;
        this.PUMP_FUN_PROGRAM_ID_PK = config.PUMP_FUN_PROGRAM_ID;
        this.PUMP_FUN_PROGRAM_ID_VARIANT_PK = config.PUMP_FUN_PROGRAM_ID_VARIANT;
        this.PUMP_FUN_AMM_PROGRAM_ID = config.PUMP_FUN_AMM_PROGRAM_ID;
        this.bondingCurveCache = new Map();

        // Initialize transaction logger for JSON file logging
        this.transactionLogger = new TransactionLogger();

        // General bot config related settings (if you have global trading settings here)
        this.botConfig = {
            tradeType: 'both', // Example setting
        };
    }

    // --- Core Balance Change Analysis --- (Kept as before, was working)
    analyzeBalanceChangesInternal(meta, accountKeys, traderPublicKey) {
        if (!meta || !accountKeys || !traderPublicKey) {
            console.log('[BalanceAnalysis] Missing essential inputs.');
            return { isSwap: false, reason: 'Missing inputs for balance change analysis.' };
        }

        const traderPkString = traderPublicKey.toBase58();
        const traderIndex = accountKeys.findIndex(key => key.toBase58() === traderPkString);

        // Only log in debug mode to reduce noise
        if (config.LOG_LEVEL === 'debug') {
            console.log(`[BalanceAnalysis] 🔍 Looking for trader ${shortenAddress(traderPkString)} in ${accountKeys.length} account keys...`);
            console.log(`[BalanceAnalysis] 📋 Account keys: ${accountKeys.map(k => shortenAddress(k.toBase58())).join(', ')}`);
        }

        if (traderIndex === -1) {
            console.log(`[BalanceAnalysis] ❌ Trader not found in transaction accounts`);
            return { isSwap: false, reason: 'Trader not found in transaction accounts.' };
        }
        
        if (config.LOG_LEVEL === 'debug') {
            console.log(`[BalanceAnalysis] ✅ Trader found at index ${traderIndex}`);
        }

        const preSol = meta.preBalances[traderIndex];
        const postSol = meta.postBalances[traderIndex];
        const solChange = postSol - preSol;

        console.log(`[BalanceAnalysis] Trader ${shortenAddress(traderPkString)} SOL change: ${solChange / config.LAMPORTS_PER_SOL_CONST} SOL (Raw: ${solChange})`);

        const tokenChanges = new Map();

        const traderPreTokenBalances = meta.preTokenBalances?.filter(tb => tb.owner === traderPkString) || [];
        const traderPostTokenBalances = meta.postTokenBalances?.filter(tb => tb.owner === traderPkString) || [];

        traderPreTokenBalances.forEach(balance => {
            const amount = BigInt(balance.uiTokenAmount.amount);
            tokenChanges.set(balance.mint, (tokenChanges.get(balance.mint) || 0n) - amount);
            if (config.LOG_LEVEL === 'debug') {
                console.log(`[BalanceAnalysis] Pre-Token ${shortenAddress(balance.mint)}: -${amount.toString()} (Owner: ${shortenAddress(balance.owner)})`);
            }
        });

        traderPostTokenBalances.forEach(balance => {
            const amount = BigInt(balance.uiTokenAmount.amount);
            tokenChanges.set(balance.mint, (tokenChanges.get(balance.mint) || 0n) + amount);
            if (config.LOG_LEVEL === 'debug') {
                console.log(`[BalanceAnalysis] Post-Token ${shortenAddress(balance.mint)}: +${amount.toString()} (Owner: ${shortenAddress(balance.owner)})`);
            }
        });

        if (config.LOG_LEVEL === 'debug') {
            console.log('[BalanceAnalysis] Final Token Changes Map:', Array.from(tokenChanges.entries()).map(([mint, change]) => `${shortenAddress(mint)}: ${change.toString()}`));
        }


        let tokenReceivedMint = null, tokenSentMint = null;
        let tokenReceivedAmount = 0n, tokenSentAmount = 0n;
        let tokenDecimalsForChange = 9;

        for (const [mint, change] of tokenChanges.entries()) {
            if (change > 0n) {
                tokenReceivedMint = mint;
                tokenReceivedAmount = change;
                const tokenBalanceEntry = traderPostTokenBalances.find(b => b.mint === mint);
                if (tokenBalanceEntry) tokenDecimalsForChange = tokenBalanceEntry.uiTokenAmount.decimals;
            } else if (change < 0n) {
                tokenSentMint = mint;
                tokenSentAmount = -change;
                const tokenBalanceEntry = traderPreTokenBalances.find(b => b.mint === mint);
                if (tokenBalanceEntry) tokenDecimalsForChange = tokenBalanceEntry.uiTokenAmount.decimals;
            }
        }

        const SOL_CHANGE_THRESHOLD_LAMPORTS = 0; // NO THRESHOLD - Copy EVERY trade!
        console.log(`[BalanceAnalysis] SOL Change Threshold for swap detection: ${SOL_CHANGE_THRESHOLD_LAMPORTS} lamports (NO RESTRICTIONS)`);

        // Cases: SOL out, Token in (Buy); SOL in, Token out (Sell); Token-to-Token
        if (solChange < 0 && tokenReceivedMint && tokenReceivedMint !== this.NATIVE_SOL_MINT) {
            console.log(`[BalanceAnalysis] ✅ BUY Detected (SOL out, Token in). SOL change: ${solChange}, Token received: ${shortenAddress(tokenReceivedMint)}`);
            return { isSwap: true, details: { tradeType: 'buy', inputMint: this.NATIVE_SOL_MINT, outputMint: tokenReceivedMint, inputAmountLamports: Math.abs(solChange), outputAmountRaw: tokenReceivedAmount.toString(), tokenDecimals: tokenDecimalsForChange } };
        }
        
        if (solChange > 0 && tokenSentMint && tokenSentMint !== this.NATIVE_SOL_MINT) {
            console.log(`[BalanceAnalysis] ✅ SELL Detected (SOL in, Token out). SOL change: ${solChange}, Token sent: ${shortenAddress(tokenSentMint)}`);
            return { isSwap: true, details: { tradeType: 'sell', inputMint: tokenSentMint, outputMint: this.NATIVE_SOL_MINT, inputAmountRaw: tokenSentAmount.toString(), outputAmountLamports: solChange, tokenDecimals: tokenDecimalsForChange } };
        }
        
        // Token-to-token swaps (no SOL change)
        if (solChange === 0 && tokenSentMint && tokenReceivedMint && tokenSentMint !== tokenReceivedMint) {
            console.log(`[BalanceAnalysis] ✅ TOKEN-TO-TOKEN SWAP Detected. Token sent: ${shortenAddress(tokenSentMint)}, Token received: ${shortenAddress(tokenReceivedMint)}`);
            return { isSwap: true, details: { tradeType: 'swap', inputMint: tokenSentMint, outputMint: tokenReceivedMint, inputAmountRaw: tokenSentAmount.toString(), outputAmountRaw: tokenReceivedAmount.toString(), tokenDecimals: tokenDecimalsForChange } };
        }
        
        // Only copy REAL swaps, not just any movement
        // A real swap MUST involve a change in SOL AND tokens, OR at least two different tokens
        if ((solChange !== 0 && tokenChanges.size >= 1) || tokenChanges.size >= 2) {
            // This condition is now implicitly handled by the buy/sell/swap logic above
            // If we reach this point and none of those matched, it's not a clear swap
            console.log(`[BalanceAnalysis] ⚠️ Movement detected but not a clear swap pattern. SOL: ${solChange}, Tokens: ${tokenChanges.size}`);
        }

        console.log(`[BalanceAnalysis] Result: No clear swap pattern detected based on SOL/Token movements.`);
        console.log(`SOL Change: ${solChange} (Threshold: ${SOL_CHANGE_THRESHOLD_LAMPORTS})`);
        console.log(`Received Mint: ${tokenReceivedMint ? shortenAddress(tokenReceivedMint) : 'N/A'}, Amount: ${tokenReceivedAmount.toString()}`);
        console.log(`Sent Mint: ${tokenSentMint ? shortenAddress(tokenSentMint) : 'N/A'}, Amount: ${tokenSentAmount.toString()}`);
        return { isSwap: false, reason: 'No clear swap balance change pattern detected.' };
    }

        // ===== NEW HELPER FOR INSTRUCTION-ONLY ANALYSIS =====
        _deriveDetailsFromMetadata(meta, traderPublicKey) {
            // This is a simplified version of the balance analysis logic,
            // focused on finding just one input and one output to confirm a swap.
            try {
                // Ensure traderPublicKey is a PublicKey object
                const traderPk = typeof traderPublicKey === 'string' ? new PublicKey(traderPublicKey) : traderPublicKey;
                const traderPkString = traderPk.toBase58();
    
                // Look for SOL movement
                const traderIndex = meta.accountKeys?.findIndex(key => {
                    const keyStr = key.pubkey ? key.pubkey.toBase58() : (key.toBase58 ? key.toBase58() : key);
                    return keyStr === traderPkString;
                }) || -1;
                const solChange = traderIndex !== -1 ? meta.postBalances[traderIndex] - meta.preBalances[traderIndex] : 0;
                
                // Look for the single largest token movement (positive and negative)
                const tokenChanges = new Map();
                const tokenDecimalsMap = new Map();
    
                (meta.preTokenBalances || []).filter(tb => tb.owner === traderPkString).forEach(balance => {
                    const amount = BigInt(balance.uiTokenAmount.amount);
                    tokenChanges.set(balance.mint, (tokenChanges.get(balance.mint) || 0n) - amount);
                    if (!tokenDecimalsMap.has(balance.mint)) tokenDecimalsMap.set(balance.mint, balance.uiTokenAmount.decimals);
                });
                (meta.postTokenBalances || []).filter(tb => tb.owner === traderPkString).forEach(balance => {
                    const amount = BigInt(balance.uiTokenAmount.amount);
                    tokenChanges.set(balance.mint, (tokenChanges.get(balance.mint) || 0n) + amount);
                    if (!tokenDecimalsMap.has(balance.mint)) tokenDecimalsMap.set(balance.mint, balance.uiTokenAmount.decimals);
                });
    
                const sentTokens = [];
                const receivedTokens = [];
    
                tokenChanges.forEach((change, mint) => {
                    if (change < 0n) sentTokens.push({ mint, amount: -change });
                    if (change > 0n) receivedTokens.push({ mint, amount: change });
                });
    
                // If it's a simple 1-for-1 token swap OR a SOL-for-Token swap, we can derive details.
                if ((solChange < 0 && receivedTokens.length === 1) || (solChange > 0 && sentTokens.length === 1) || (sentTokens.length === 1 && receivedTokens.length === 1)) {
                    let tradeType, inputMint, outputMint, inputAmountRaw, outputAmountRaw, tokenDecimals;
                    
                    if (solChange < 0) { // BUY with SOL
                        tradeType = 'buy';
                        inputMint = config.NATIVE_SOL_MINT;
                        outputMint = receivedTokens[0].mint;
                        inputAmountRaw = Math.abs(solChange).toString();
                        outputAmountRaw = receivedTokens[0].amount.toString();
                        tokenDecimals = tokenDecimalsMap.get(outputMint);
                    } else { // SELL for SOL
                        tradeType = 'sell';
                        inputMint = sentTokens[0].mint;
                        outputMint = config.NATIVE_SOL_MINT;
                        inputAmountRaw = sentTokens[0].amount.toString();
                        outputAmountRaw = solChange.toString();
                        tokenDecimals = tokenDecimalsMap.get(inputMint);
                    }
                    
                    return { isSwap: true, details: { tradeType, inputMint, outputMint, inputAmountRaw, outputAmountRaw, tokenDecimals } };
                }
                return { isSwap: false };
            } catch(e) {
                console.error('[DERIVE_META_ERROR]', e);
                return { isSwap: false };
            }
        }



    // --- MAIN TRANSACTION ANALYSIS FUNCTION ---
    async analyzeTransactionForCopy(signature, preFetchedTx, traderPublicKey) {
        console.log(`[ANALYZER-V5-HELIUS] Processing sig: ${shortenAddress(signature)}`);
    
        // ===============================================
        // ========== STAGE 0: NOISE PRE-FILTER ============
        // ===============================================
        // Quick pre-filter to reduce noise from non-trading transactions
        if (preFetchedTx && this._isNoiseTransaction(preFetchedTx)) {
            console.log(`[ANALYZER] 🔇 Filtered out noise transaction (${this._getNoiseReason(preFetchedTx)})`);
            return { 
                isCopyable: false, 
                reason: `Noise transaction filtered: ${this._getNoiseReason(preFetchedTx)}`, 
                rawTransaction: preFetchedTx,
                isNoise: true
            };
        }
    
        // ===============================================
        // =========== STAGE 1: DATA ACQUISITION ===========
        // ===============================================
        let transactionResponse = null;
        let transactionObject = null;
        let meta = null;

        try {
            // This is the structure from our JSON dump.
            // We need to pass the ENTIRE object, not just the '.transaction' part.
            if (preFetchedTx && preFetchedTx.transaction && preFetchedTx.meta) {
                console.log(`[ANALYZER] Using full pre-fetched gRPC stream object...`);
                transactionResponse = preFetchedTx; // Pass the WHOLE thing
            } 
            // This handles older webhook formats or already-unpacked data.
            else if (preFetchedTx) { 
                 console.log(`[ANALYZER] Using pre-fetched webhook data...`);
                 transactionResponse = preFetchedTx;
            }
            // The fallback if no pre-fetched data is available at all.
            else {
                console.log(`[ANALYZER] No pre-fetched data, fetching from RPC...`);
                
                try {
                    transactionResponse = await this.connection.getParsedTransaction(signature, { 
                        maxSupportedTransactionVersion: 0,
                        encoding: 'json'
                    });
                } catch (rpcError) {
                    console.log(`[ANALYZER] Regular RPC fetch failed with error: ${rpcError.message}`);
                    transactionResponse = null;
                }
                
                // If regular RPC fetch fails or returns empty transaction, try raw fetcher
                if (!transactionResponse || !transactionResponse.transaction || 
                    !transactionResponse.transaction.message || 
                    !transactionResponse.transaction.message.instructions ||
                    transactionResponse.transaction.message.instructions.length === 0) {
                    
                    console.log(`[ANALYZER] Regular RPC fetch failed, trying raw fetcher for ATL resolution...`);
                    transactionResponse = await this.rawFetcher.fetchAndParseTransaction(signature);
                    
                    if (!transactionResponse) {
                        throw new Error("Both regular RPC and raw fetcher failed to get transaction.");
                    }
                }
            }
            
            // Extract normalized data
            transactionObject = transactionResponse.transaction || transactionResponse;
            meta = transactionResponse.meta;
            
            // Set the webhook data flag based on whether we have pre-fetched data
            const isWebhookData = !!preFetchedTx;
            
            if (!meta || meta.err) {
                console.log(`[ANALYZER] ❌ Transaction failed or lacks metadata:`, {
                    hasMeta: !!meta,
                    hasError: !!meta?.err,
                    error: meta?.err
                });
                return { isCopyable: false, reason: "Transaction failed on-chain or lacks metadata.", rawTransaction: transactionResponse };
            }
            
            console.log(`[ANALYZER] ✅ Transaction metadata looks good`);
        } catch (error) {
            console.error(`[ANALYZER] ❌ Fatal error in data acquisition:`, error);
            return { isCopyable: false, reason: `Fatal error fetching transaction: ${error.message}`, rawTransaction: { error: error.message } };
        }
    
        // ===============================================
        // ============ STAGE 2: DATA NORMALIZATION ========
        // ===============================================
        // Variables already extracted in STAGE 1
        
        // SAFETY CHECK: Validate meta object exists
        if (!meta) {
            console.log(`[ANALYZER] ❌ Missing transaction metadata`);
            return { isCopyable: false, reason: "Transaction metadata missing", rawTransaction: transactionResponse };
        }
        const finalTraderPk = new PublicKey(traderPublicKey);
        
        // SAFETY CHECK: Validate transaction structure before accessing instructions
        if (!transactionObject) {
            console.log(`[ANALYZER] ❌ Invalid transaction structure: missing transaction object`);
            return { isCopyable: false, reason: "Invalid transaction structure - transaction object missing", rawTransaction: transactionResponse };
        }
        
        if (!transactionObject.message) {
            console.log(`[ANALYZER] ❌ Invalid transaction structure: missing message object`);
            return { isCopyable: false, reason: "Invalid transaction structure - message object missing", rawTransaction: transactionResponse };
        }
        
        const instructions = transactionObject.message.instructions || [];
        
        // VALIDATION: Ensure instructions is an array
        if (!Array.isArray(instructions)) {
            console.log(`[ANALYZER] ❌ Invalid instructions structure:`, {
                hasTransaction: !!transactionObject,
                hasMessage: !!transactionObject?.message,
                instructionsType: typeof instructions,
                isArray: Array.isArray(instructions),
                instructionsValue: instructions
            });
            return { isCopyable: false, reason: "Invalid transaction structure - instructions not found or not an array", rawTransaction: transactionResponse };
        }
        
        const rawAccountKeys = transactionObject.message.accountKeys;
        
        // SAFETY CHECK: Validate accountKeys before processing
        if (!Array.isArray(rawAccountKeys) || rawAccountKeys.length === 0) {
            console.log(`[ANALYZER] ❌ Invalid accountKeys structure:`, {
                hasAccountKeys: !!rawAccountKeys,
                isArray: Array.isArray(rawAccountKeys),
                length: rawAccountKeys?.length || 0
            });
            return { isCopyable: false, reason: "Invalid transaction structure - accountKeys missing or empty", rawTransaction: transactionResponse };
        }
        
        const accountKeys = rawAccountKeys.map(key => {
            if (key && key.pubkey) return new PublicKey(key.pubkey);
            if (key instanceof PublicKey) return key;
            return new PublicKey(key);
        });
    
        // ===============================================
        // ========== STAGE 3: CORE ANALYSIS (Universal) ===
        // ===============================================
        
        const balanceAnalysis = this.analyzeBalanceChangesInternal(meta, accountKeys, finalTraderPk);

        // STEP 1: Check if this is actually a trade transaction
        if (!balanceAnalysis.isSwap) {
            console.log(`[ANALYZER] ❌ Not a trade transaction - skipping platform analysis`);
            return { isCopyable: false, reason: "No swap detected in balance changes.", rawTransaction: transactionResponse };
        }

        console.log(`[ANALYZER] ✅ Trade detected! Analyzing platform...`);

        // 🔬 NEW: DEEP ANALYSIS - Dive into inner instructions, loadedAddresses, and logMessages
        console.log(`[ANALYZER] 🔬 Performing deep analysis for platform detection...`);
        const deepAnalysis = this._deepAnalyzeTransactionForPlatforms(transactionResponse, traderPublicKey);
        
        // Determine instruction analysis based on deep analysis results
        let instructionAnalysis;
        
        if (deepAnalysis.platformDetection && deepAnalysis.platformDetection.identifiedPlatforms.length > 0) {
            // Deep analysis found platform matches, apply priority sorting
            const platforms = deepAnalysis.platformDetection.identifiedPlatforms;
            
            // Define platform priorities (lower number = higher priority)
            const platformPriorities = {
                'Router': 0, // Highest priority for Router
                'Pump.fun': 1,
                'Pump.fun BC': 1,
                'Pump.fun AMM': 2,
                'Raydium V4': 3,
                'Raydium AMM': 3,
                'Raydium CLMM': 3,
                'Raydium CPMM': 3,
                'Raydium Launchpad': 3,
                'Meteora DLMM': 3,
                'Meteora DBC': 3,
                'Meteora CP-AMM': 3,
                'Photon': 4,
                'Jupiter Aggregator': 4
            };
            
            // Sort platforms by priority (lower number = higher priority)
            const sortedPlatforms = platforms.sort((a, b) => {
                const priorityA = platformPriorities[a.platform] || 999;
                const priorityB = platformPriorities[b.platform] || 999;
                return priorityA - priorityB;
            });
            
            const primaryPlatform = sortedPlatforms[0];
            console.log(`[ANALYZER] 🎯 Deep analysis found platform: ${primaryPlatform.platform} (${shortenAddress(primaryPlatform.programId)})`);
            if (sortedPlatforms.length > 1) {
                console.log(`[ANALYZER] 📋 Also detected: ${sortedPlatforms.slice(1).map(p => p.platform).join(', ')}`);
            }
            
            // Create instruction analysis from deep analysis
            instructionAnalysis = {
                found: true,
                dexPlatform: primaryPlatform.platform,
                platformProgramId: primaryPlatform.programId,
                platformSpecificData: {},
                confidence: primaryPlatform.confidence || 'high',
                source: 'deep-analysis',
                platformMatches: sortedPlatforms,
                unknownProgramIds: deepAnalysis.platformDetection.unknownPrograms
            };
            
            console.log(`[ANALYZER] ✅ Platform detected via deep analysis: ${instructionAnalysis.dexPlatform}`);
            console.log(`[ANALYZER] ⏭️ Skipping traditional analysis - platform already identified`);
        } else {
            // Deep analysis found no platforms, fall back to traditional analysis
            console.log(`[ANALYZER] 🔄 Deep analysis found no platforms, falling back to traditional analysis...`);
            
            instructionAnalysis = (() => {
                // This is our universal "Dive Deep" loop.
                // It will check every single instruction against our entire platform library.
                console.log(`[ANALYZER] 🔍 Analyzing ${instructions.length} instructions for platform detection...`);
                console.log(`[ANALYZER] 📝 Transaction Signature: ${signature}`);
                    
                for (const ix of instructions) {
                    const programId = this._resolveProgramId(ix, accountKeys);
                    if (!programId) continue;
                    
                    // Find a match in our entire DEX library (from config.js)
                    const platformMatch = Object.entries(this.platformIds).find(([key, pId]) => {
                        if (Array.isArray(pId)) return pId.some(id => id.equals(programId));
                        return pId instanceof PublicKey && pId.equals(programId);
                    });
                
                    if (platformMatch) {
                        const platformName = this._mapConfigKeyToPlatformName(platformMatch[0]);
                        console.log(`[ANALYZER] ✅ Platform detected: ${platformName} (${shortenAddress(programId.toBase58())})`);
                        
                        let platformSpecificData = {};
                        // Extract crucial data if possible (like Meteora Pool ID)
                        if (platformName === 'Meteora DBC' && ix.accounts.length > 0) {
                            // For Meteora DBC, the pool is typically the first account in the instruction
                            // But we need to handle loaded addresses (ATL) properly
                            let poolAccountIndex = ix.accounts[0];
                            
                            // Check if this is a loaded address (ATL)
                            if (poolAccountIndex >= accountKeys.length) {
                                // This is a loaded address, we need to get it from the loaded addresses
                                const loadedAddressIndex = poolAccountIndex - accountKeys.length;
                                const loadedAddresses = this._getLoadedAddresses(transaction);
                                
                                if (loadedAddresses && loadedAddresses.writable && loadedAddresses.writable[loadedAddressIndex]) {
                                    platformSpecificData.poolId = loadedAddresses.writable[loadedAddressIndex];
                                    console.log(`[ANALYZER] 🔍 Extracted Meteora DBC pool from loaded addresses: ${shortenAddress(platformSpecificData.poolId)}`);
                                } else {
                                    // Fallback to first account if loaded address extraction fails
                                    platformSpecificData.poolId = accountKeys[ix.accounts[0]].toBase58();
                                    console.log(`[ANALYZER] 🔍 Extracted Meteora DBC pool from first account: ${shortenAddress(platformSpecificData.poolId)}`);
                                }
                            } else {
                                // Regular account
                                platformSpecificData.poolId = accountKeys[ix.accounts[0]].toBase58();
                                console.log(`[ANALYZER] 🔍 Extracted Meteora DBC pool from first account: ${shortenAddress(platformSpecificData.poolId)}`);
                            }
                        }
                        
                        // Extract Raydium Launchpad poolId and configId
                        if (platformName === 'Raydium Launchpad' && ix.accounts.length >= 5) {
                            // For Raydium Launchpad, based on the instruction structure:
                            // Index 1: authPda, Index 2: configId, Index 4: poolId, Index 7: vaultA, Index 8: vaultB
                            const authPda = accountKeys[ix.accounts[1]];
                            const configId = accountKeys[ix.accounts[2]];
                            const poolId = accountKeys[ix.accounts[4]];
                            const vaultA = ix.accounts.length > 7 ? accountKeys[ix.accounts[7]] : null;
                            const vaultB = ix.accounts.length > 8 ? accountKeys[ix.accounts[8]] : null;
                            
                            if (configId && poolId) {
                                platformSpecificData.configId = configId.toBase58();
                                platformSpecificData.poolId = poolId.toBase58();
                                
                                // Extract additional accounts if available
                                if (authPda) {
                                    platformSpecificData.authPda = authPda.toBase58();
                                }
                                if (vaultA) {
                                    platformSpecificData.vaultA = vaultA.toBase58();
                                }
                                if (vaultB) {
                                    platformSpecificData.vaultB = vaultB.toBase58();
                                }
                                
                                console.log(`[ANALYZER] 🔍 Extracted Raydium Launchpad data: poolId=${shortenAddress(platformSpecificData.poolId)}, configId=${shortenAddress(platformSpecificData.configId)}`);
                                if (platformSpecificData.authPda) console.log(`[ANALYZER] 🔍 Auth PDA: ${shortenAddress(platformSpecificData.authPda)}`);
                                if (platformSpecificData.vaultA) console.log(`[ANALYZER] 🔍 Vault A: ${shortenAddress(platformSpecificData.vaultA)}`);
                                if (platformSpecificData.vaultB) console.log(`[ANALYZER] 🔍 Vault B: ${shortenAddress(platformSpecificData.vaultB)}`);
                                console.log(`[ANALYZER] 🔍 Raydium Launchpad instruction accounts (${ix.accounts.length}):`, ix.accounts.map((accIdx, i) => `${i}: ${shortenAddress(accountKeys[accIdx].toBase58())}`).join(', '));
                            } else {
                                console.warn(`[ANALYZER] ⚠️ Failed to extract Raydium Launchpad accounts: configId=${!!configId}, poolId=${!!poolId}`);
                            }
                        }
                        
                        // We found our match, we can return the result and stop looping.
                        return {
                            found: true,
                            dexPlatform: platformName,
                            platformProgramId: programId.toBase58(),
                            platformSpecificData: platformSpecificData
                        };
                    }
                }
                
                // If the loop finishes without finding any known DEX program ID.
                console.log(`[ANALYZER] ❌ No known platform detected in any instruction`);
                
                // Show unique program IDs found for debugging
                const foundProgramIds = new Set();
                for (const ix of instructions) {
                    const programId = this._resolveProgramId(ix, accountKeys);
                    if (programId) {
                        foundProgramIds.add(programId.toBase58());
                    }
                }
                
                if (foundProgramIds.size > 0) {
                    console.log(`[ANALYZER] 🔍 Program IDs found (SHORTENED): ${Array.from(foundProgramIds).map(id => shortenAddress(id)).join(', ')}`);
                    console.log(`[ANALYZER] 🔍 Program IDs found (COMPLETE): ${Array.from(foundProgramIds).join(', ')}`);
                }
                
                // Fallback: Try to detect Pump.fun by transaction pattern
                const pumpFunDetected = this._detectPumpFunByPattern(instructions, accountKeys);
                if (pumpFunDetected) {
                    console.log(`[ANALYZER] 🔍 Fallback detection: Pump.fun detected by transaction pattern`);
                    return {
                        found: true,
                        dexPlatform: 'Pump.fun',
                        platformProgramId: 'Pump.fun (pattern detected)',
                        platformSpecificData: {}
                    };
                }

                // STEP 2: For unknown platforms, just log them (don't try to execute)
                console.log(`[ANALYZER] 🔍 Unknown platform detected - logging for investigation`);
                console.log(`[ANALYZER] 📝 Transaction signature: ${signature}`);
                console.log(`[ANALYZER] 🔍 All program IDs found: ${Array.from(foundProgramIds).join(', ')}`);
                console.log(`[ANALYZER] ⚠️ This transaction will NOT be executed - platform unknown`);
                
                return { 
                    found: false, 
                    dexPlatform: 'Unknown DEX (Logged for Investigation)',
                    reason: 'Platform not recognized - needs investigation'
                };
            })();
        }
        
        // ===============================================
        // =========== STAGE 4: FINAL DECISION ===========
        // ===============================================
        
        // STEP 3: Only execute if we have a known platform
        if (!instructionAnalysis.dexPlatform) {
            console.log(`[ANALYZER] ❌ Platform is undefined - cannot proceed`);
            return { 
                isCopyable: false, 
                reason: 'Platform detection failed - platform is undefined' 
            };
        }
        
        if (instructionAnalysis.dexPlatform.includes('Unknown DEX')) {
            console.log(`[ANALYZER] 🚫 Unknown platform - transaction will NOT be executed`);
            console.log(`[ANALYZER] 📊 Trade details: ${balanceAnalysis.details.tradeType} ${balanceAnalysis.details.inputMint} → ${balanceAnalysis.details.outputMint}`);
            console.log(`[ANALYZER] 🔍 Platform: ${instructionAnalysis.dexPlatform}`);
            console.log(`[ANALYZER] ⚠️ Add this platform to config.js to enable copy trading`);
            
            return { 
                isCopyable: false, 
                reason: `Platform not recognized: ${instructionAnalysis.reason || 'Unknown DEX'}`,
                rawTransaction: transactionResponse,
                tradeDetails: balanceAnalysis.details,
                platformInfo: instructionAnalysis
            };
        }
        
        // We have a confirmed swap with a KNOWN platform. We will execute it.
        const finalDetails = {
            ...balanceAnalysis.details, // The definitive amounts and mints
            dexPlatform: instructionAnalysis.dexPlatform, // Known platform
            platformProgramId: instructionAnalysis.platformProgramId,
            platformSpecificData: instructionAnalysis.platformSpecificData,
            traderPubkey: finalTraderPk.toBase58(),
            // NEW: Pass original transaction data for universal instruction building
            originalTransaction: transactionResponse
        };
        
        const tradeSummary = this._createTradeSummary(finalDetails, transactionResponse);
        console.log(`[ANALYZER] 🎉 SUCCESS! ${tradeSummary}`);
        
        // Add Router-specific data if this is a Router trade
        if (finalDetails.dexPlatform === 'Router') {
            const routerDetection = instructionAnalysis.platformMatches?.[0];
            if (routerDetection?.cloningTarget) {
                finalDetails.cloningTarget = routerDetection.cloningTarget;
                finalDetails.masterTraderWallet = finalDetails.traderPubkey;
                console.log(`[ANALYZER] 🎯 Added Router cloning data to final details`);
            }
        }

        return {
            isCopyable: true,
            reason: `Trade detected on ${finalDetails.dexPlatform}.`,
            details: finalDetails,
            summary: tradeSummary
        };
    }
    
    _resolveProgramId(instruction, allAccountKeys) {
        try {
            // Handle compiled instructions (like from LaserStream/Jupiter)
            if (instruction.programIdIndex !== undefined && allAccountKeys?.[instruction.programIdIndex]) {
                const resolved = allAccountKeys[instruction.programIdIndex];
                return resolved;
            }
            
            // Handle direct program IDs (like from RPC)
            if (instruction.programId instanceof PublicKey) {
                return instruction.programId;
            }
            if (typeof instruction.programId === 'string') {
                return new PublicKey(instruction.programId);
            }
            
            return null;
        } catch (e) {
            console.warn(`Error resolving programId for instruction: ${e.message}`);
            return null;
        }
    }

    _getInstructionDataAsBuffer(instruction) {
        if (!instruction?.data) return null;
        try {
            if (instruction.data instanceof Uint8Array) {
                return Buffer.from(instruction.data);
            }
            if (Buffer.isBuffer(instruction.data)) {
                return instruction.data;
            }
            if (typeof instruction.data === 'string') {
                console.warn(`Attempting to base58 decode string instruction data: ${instruction.data.substring(0, 50)}...`);
                return bs58.decode(instruction.data);
            }
            return null;
        } catch (e) {
            console.warn(`Failed to decode instruction data to Buffer: ${e.message}`);
            return null;
        }
    }

    async _parseRouterSwap(routerName, routerProgramIds, instruction, parsedInstructions, allAccountKeys, traderPublicKey, generalBalanceAnalysis) {
        const routerProgramId = this._resolveProgramId(instruction, allAccountKeys);

        // 1️⃣ Router Program Validation
        const routerIdArray = Array.isArray(routerProgramIds)
            ? routerProgramIds
            : [routerProgramIds].filter(Boolean);
        if (!routerProgramId || !routerIdArray.some(id => id.equals(routerProgramId))) {
            return null;
        }

        console.log(`[Parser] Detected ${routerName} router transaction. Checking inner instructions...`);

        // 2️⃣ Define Known Inner Programs (PRIORITIZED ORDER)
        const knownInnerPrograms = [
            // --- Pump.fun (HIGHEST PRIORITY - BC trades) ---
            { ids: [this.platformIds.PUMP_FUN, this.platformIds.PUMP_FUN_VARIANT], name: 'Pump.fun', priority: 1 },
            // --- Pump.fun Router (HIGH PRIORITY - Router that calls Pump.fun) ---
            { ids: [this.platformIds.PUMP_FUN_ROUTER], name: 'Pump.fun Router', priority: 1 },
            // --- Pump.fun AMM (LOWER PRIORITY - only if no BC detected) ---
            { ids: [this.platformIds.PUMP_FUN_AMM], name: 'Pump.fun AMM', priority: 2 },
            // --- Raydium ---
            { ids: [this.platformIds.RAYDIUM_LAUNCHPAD], name: 'Raydium Launchpad', priority: 3 },
            { ids: [this.platformIds.RAYDIUM_V4], name: 'Raydium V4', priority: 3 },
            { ids: [this.platformIds.RAYDIUM_CLMM], name: 'Raydium CLMM', priority: 3 },
            { ids: [this.platformIds.RAYDIUM_CPMM], name: 'Raydium CPMM', priority: 3 },
            // --- Meteora ---
            { ids: [this.platformIds.METEORA_DLMM], name: 'Meteora DLMM', priority: 3 },
            ...(Array.isArray(this.platformIds.METEORA_DBC)
                ? this.platformIds.METEORA_DBC.map(id => ({ ids: [id], name: 'Meteora DBC', priority: 3 }))
                : []
            ),
            { ids: [this.platformIds.METEORA_CP_AMM], name: 'Meteora CP Amm', priority: 3 },
            // --- Jupiter ---
            { ids: [this.platformIds['Jupiter Aggregator']], name: 'Jupiter Aggregator', priority: 3 }
        ].filter(p => p.ids?.length);

        // 3️⃣ Scan Inner Instructions with Priority System
        let detectedPlatforms = [];
        
        for (const innerParsedIx of parsedInstructions) {
            const innerProgramId = new PublicKey(innerParsedIx.programId);
            if (!innerProgramId) continue;

            for (const program of knownInnerPrograms) {
                if (program.ids.some(id => id instanceof PublicKey && id.equals(innerProgramId))) {
                    detectedPlatforms.push({
                        ...program,
                        programId: innerProgramId
                    });
                }
            }
        }

        // 4️⃣ Select Best Platform Based on Priority
        if (detectedPlatforms.length > 0) {
            // Sort by priority (lower number = higher priority)
            detectedPlatforms.sort((a, b) => a.priority - b.priority);
            const bestPlatform = detectedPlatforms[0];
            
            console.log(`[Parser] ✅ ${routerName} routed to: ${bestPlatform.name} (Priority: ${bestPlatform.priority})`);
            if (detectedPlatforms.length > 1) {
                console.log(`[Parser] 📋 Also detected: ${detectedPlatforms.slice(1).map(p => `${p.name} (${p.priority})`).join(', ')}`);
            }

            const tokenMintForCheck = (generalBalanceAnalysis.details.tradeType === 'buy')
                ? generalBalanceAnalysis.details.outputMint
                : generalBalanceAnalysis.details.inputMint;

            let isMigrated = false;
            let newPlatformDetails = null;

            // Only check for migration if we have a token to check
            if (tokenMintForCheck) {
                const migrationInfo = await this._checkTokenMigrationStatus(tokenMintForCheck);
                if (migrationInfo?.hasMigrated) {
                    isMigrated = true;
                    newPlatformDetails = migrationInfo;
                    console.log(`[MIGRATION AWARE] Token ${shortenAddress(tokenMintForCheck)} has migrated to ${newPlatformDetails.newDexPlatform}! Overriding trade platform.`);
                }
            }

            // If a migration is detected, we override the platform details with the NEW platform.
            const finalDetails = isMigrated ? {
                ...generalBalanceAnalysis.details,
                dexPlatform: newPlatformDetails.newDexPlatform, // e.g., 'Raydium V4'
                platformProgramId: new PublicKey(newPlatformDetails.newPlatformProgramId), // Use the new program ID
                platformSpecificData: newPlatformDetails.platformSpecificData, // e.g., { poolId: 'newPool123' }
                originalPlatform: bestPlatform.name // Keep track of where it came from
            } : {
                ...generalBalanceAnalysis.details,
                dexPlatform: bestPlatform.name,
                platformProgramId: bestPlatform.programId
            };

            // Add Router-specific data if this is a Router trade
            if (finalDetails.dexPlatform === 'Router') {
                const routerDetection = bestPlatform;
                if (routerDetection?.cloningTarget) {
                    finalDetails.cloningTarget = routerDetection.cloningTarget;
                    finalDetails.masterTraderWallet = finalDetails.traderPubkey;
                    console.log(`[ANALYZER] 🎯 Added Router cloning data to final details (router case)`);
                }
            }

            return {
                isCopyable: true,
                reason: `${routerName} via ${finalDetails.dexPlatform} detected.${isMigrated ? ' (MIGRATED)' : ''}`,
                details: finalDetails
            };
        }

        // 5️⃣ Fallback: Router detected but unknown inner route
        return {
            isCopyable: false,
            reason: `${routerName} router (unknown underlying route) detected.`,
            details: {
                ...generalBalanceAnalysis.details,
                dexPlatform: `${routerName} (Unknown Route)`,
                platformProgramId: routerProgramId
            }
        };
    }


    /**
     * Specific Router Parsers using the unified method
     */
    async _parsePhotonRouterSwap(instruction, parsedInstructions, allAccountKeys, traderPublicKey, generalBalanceAnalysis) {
        return this._parseRouterSwap(
            'Photon',
            this.platformIds.PHOTON,
            instruction,
            parsedInstructions,
            allAccountKeys,
            traderPublicKey,
            generalBalanceAnalysis
        );
    }

    async _parseAxiomRouterSwap(instruction, parsedInstructions, allAccountKeys, traderPublicKey, generalBalanceAnalysis) {
        return this._parseRouterSwap(
            'Axiom',
            this.platformIds.AXIOM,
            instruction,
            parsedInstructions,
            allAccountKeys,
            traderPublicKey,
            generalBalanceAnalysis
        );
    }

    // --- Quantum Heuristic Analysis ---

    // async runQuantumHeuristic(baseDetails, traderPublicKeyStr, allAccountKeys, parsedInstructions = [], connection) {
    //     try {
    //         const tokenMintString = baseDetails.tradeType === 'buy' ? baseDetails.outputMint : baseDetails.inputMint;
    //         if (!tokenMintString || tokenMintString === config.NATIVE_SOL_MINT) {
    //             return this._quantumResponse(false, 'Heuristic skipped: Not a token trade.', null, 0);
    //         }

    //         console.log(`[QUANTUM-V4] 🔍 Analyzing token: ${shortenAddress(tokenMintString)}`);

    //         // ---------------------------
    //         // Stage 1: Ultra-fast detection (Pump.fun first, then tokenInfo)
    //         // ---------------------------
    //         const fastChecks = await Promise.allSettled([
    //             this._checkPumpFunBondingCurve(tokenMintString, connection),
    //             this.apiManager.solanaTrackerApi.getTokenInfo(tokenMintString)
    //         ]);

    //         const [pumpBcResult, tokenInfoResult] = fastChecks;

    //         // ✅ Priority 1: Pump.fun active bonding curve
    //         if (pumpBcResult.status === 'fulfilled' && pumpBcResult.value && !pumpBcResult.value.isComplete) {
    //             return this._quantumResponse(true, 'Active Pump.fun bonding curve detected', {
    //                 ...baseDetails, dexPlatform: 'Pump.fun'
    //             }, 100);
    //         }

    //         // ✅ Priority 2: Token info primary pool detection
    //         let primaryPool = null;
    //         if (tokenInfoResult.status === 'fulfilled' && tokenInfoResult.value?.pools?.length > 0) {
    //             primaryPool = tokenInfoResult.value.pools[0];
    //             const market = primaryPool.market?.toLowerCase() || '';

    //             // Quick real-time match for Express Lane
    //             if (market.includes('raydium-cpmm')) { // <-- FIX: ADDED RAYDIUM CPMM
    //                 return this._quantumResponse(true, 'Raydium CPMM pool detected', {
    //                     ...baseDetails,
    //                     dexPlatform: 'Raydium CPMM',
    //                     platformSpecificData: { poolId: primaryPool.poolId }
    //                 }, 97);
    //             }
    //             if (market.includes('raydium-clmm')) {
    //                 return this._quantumResponse(true, 'Raydium CLMM pool detected', {
    //                     ...baseDetails,
    //                     dexPlatform: 'Raydium CLMM',
    //                     platformSpecificData: { poolId: primaryPool.poolId }
    //                 }, 96);
    //             }
    //             if (market.includes('raydium-v4') || market.includes('raydium-amm')) {
    //                 return this._quantumResponse(true, 'Raydium V4/AMM pool detected', {
    //                     ...baseDetails,
    //                     dexPlatform: 'Raydium V4',
    //                     platformSpecificData: { poolId: primaryPool.poolId }
    //                 }, 95);
    //             }
    //             if (market.includes('meteora-dlmm')) {
    //                 return this._quantumResponse(true, 'Meteora DLMM pool detected', {
    //                     ...baseDetails,
    //                     dexPlatform: 'Meteora DLMM',
    //                     platformSpecificData: { poolId: primaryPool.poolId }
    //                 }, 93);
    //             }
    //             if (market.includes('meteora-dbc')) {
    //                 return this._quantumResponse(true, 'Meteora DBC pool detected', {
    //                     ...baseDetails,
    //                     dexPlatform: 'Meteora DBC',
    //                     platformSpecificData: { poolId: primaryPool.poolId }
    //                 }, 92);
    //             }
    //             if (market.includes('meteora-cpamm')) { // <-- FIX: STANDARDIZED NAME
    //                 return this._quantumResponse(true, 'Meteora CP-AMM pool detected', {
    //                     ...baseDetails,
    //                     dexPlatform: 'Meteora CP-AMM',
    //                     platformSpecificData: { poolId: primaryPool.poolId }
    //                 }, 91);
    //             }
    //             if (market.includes('jupiter')) {
    //                 return this._quantumResponse(true, 'Jupiter Aggregator detected', {
    //                     ...baseDetails,
    //                     dexPlatform: 'Jupiter Aggregator',
    //                     platformSpecificData: { poolId: primaryPool.poolId }
    //                 }, 98);
    //             }
    //         }

    //         // ---------------------------
    //         // Stage 2: Async deep platform hints (Fallback, non-blocking)
    //         // ---------------------------
    //         const platformHints = this._extractPlatformHints(allAccountKeys, parsedInstructions);

    //         // Check for Pump.fun migration (Bonding curve completed)
    //         if (pumpBcResult.status === 'fulfilled' && pumpBcResult.value && pumpBcResult.value.isComplete) {
    //             return this._quantumResponse(true, 'Pump.fun AMM migration assumed', {
    //                 ...baseDetails, dexPlatform: 'Pump.fun AMM'
    //             }, 70);
    //         }

    //         // ✅ Priority 3: Hints-based fallback
    //         if (platformHints.jupiter) {
    //             return this._quantumResponse(true, 'Jupiter hinted by program ID', {
    //                 ...baseDetails, dexPlatform: 'Jupiter Aggregator'
    //             }, 85);
    //         }
    //         if (platformHints.meteoraCpAmm) {
    //             return this._quantumResponse(true, 'Meteora CPAMM hinted by program ID', {
    //                 ...baseDetails, dexPlatform: 'Meteora CPAmm'
    //             }, 88);
    //         }
    //         if (platformHints.meteoraDlmm) {
    //             return this._quantumResponse(true, 'Meteora DLMM hinted by program ID', {
    //                 ...baseDetails, dexPlatform: 'Meteora DLMM'
    //             }, 87);
    //         }
    //         if (platformHints.meteoraDbc) {
    //             return this._quantumResponse(true, 'Meteora DBC hinted by program ID', {
    //                 ...baseDetails, dexPlatform: 'Meteora DBC'
    //             }, 86);
    //         }
    //         if (platformHints.raydiumV4) {
    //             return this._quantumResponse(true, 'Raydium V4 hinted by program ID', {
    //                 ...baseDetails, dexPlatform: 'Raydium V4'
    //             }, 84);
    //         }
    //         if (platformHints.raydiumClmm) {
    //             return this._quantumResponse(true, 'Raydium CLMM hinted by program ID', {
    //                 ...baseDetails, dexPlatform: 'Raydium CLMM'
    //             }, 83);
    //         }
    //         if (platformHints.raydiumCpAmm) {
    //             return this._quantumResponse(true, 'Raydium CPMM hinted by program ID', {
    //                 ...baseDetails, dexPlatform: 'Raydium CPMM'
    //             }, 82);
    //         }
    //         if (platformHints.raydiumAny) {
    //             return this._quantumResponse(true, 'Raydium AMM hinted by program ID', {
    //                 ...baseDetails, dexPlatform: 'Raydium AMM'
    //             }, 80);
    //         }


    //         // ❌ Final fallback: No match
    //         return this._quantumResponse(false, 'No definitive platform association found', null, 0);

    //     } catch (error) {
    //         console.error(`[QUANTUM-V4] ❌ Error: ${error.message}`);
    //         return this._quantumResponse(false, `Heuristic failure: ${error.message}`, null, 0);
    //     }
    // }


    // _extractPlatformHints(allAccountKeys, parsedInstructions = []) {
    //     const hints = {
    //         pumpFun: false,
    //         raydiumV4: false, raydiumLaunchpad: false, raydiumClmm: false, raydiumCpAmm: false, raydiumAny: false,
    //         meteoraDlmm: false, meteoraDbc: false, meteoraCpAmm: false, meteoraAny: false,
    //         jupiter: false,
    //         any: false
    //     };

    //     for (const key of allAccountKeys) {
    //         const keyStr = key.toBase58();
    //         // Pump.fun
    //         if ([
    //             config.PLATFORM_IDS.PUMP_FUN.toBase58(),
    //             config.PLATFORM_IDS.PUMP_FUN_VARIANT.toBase58(),
    //             config.PLATFORM_IDS.PUMP_FUN_AMM.toBase58()
    //         ].includes(keyStr)) {
    //             hints.pumpFun = true; hints.any = true;
    //         }
    //         // Raydium
    //         else if (keyStr === config.PLATFORM_IDS.RAYDIUM_V4.toBase58()) {
    //             hints.raydiumV4 = true; hints.raydiumAny = true; hints.any = true;
    //         } else if (keyStr === config.PLATFORM_IDS.RAYDIUM_LAUNCHPAD.toBase58()) {
    //             hints.raydiumLaunchpad = true; hints.raydiumAny = true; hints.any = true;
    //         } else if (keyStr === config.PLATFORM_IDS.RAYDIUM_CLMM.toBase58()) {
    //             hints.raydiumClmm = true; hints.raydiumAny = true; hints.any = true;
    //         } else if (keyStr === config.PLATFORM_IDS.RAYDIUM_CPMM.toBase58()) { // <-- FIX: ADDED RAYDIUM CPMM CHECK
    //             hints.raydiumCpAmm = true; hints.raydiumAny = true; hints.any = true;
    //         }
    //         // Meteora
    //         else if (keyStr === config.PLATFORM_IDS.METEORA_DLMM.toBase58()) {
    //             hints.meteoraDlmm = true; hints.meteoraAny = true; hints.any = true;
    //         } else if ((config.PLATFORM_IDS.METEORA_DBC || []).some(id => id.toBase58() === keyStr)) {
    //             hints.meteoraDbc = true; hints.meteoraAny = true; hints.any = true;
    //         } else if (keyStr === config.PLATFORM_IDS.METEORA_CP_AMM.toBase58()) { // <-- FIX: CORRECT KEY LOOKUP
    //             hints.meteoraCpAmm = true; hints.meteoraAny = true; hints.any = true;
    //         }
    //         // Jupiter
    //         else if (keyStr === config.PLATFORM_IDS['Jupiter Aggregator'].toBase58()) {
    //             hints.jupiter = true; hints.any = true;
    //         }
    //     }
    //     return hints;
    // }

    // Helper: DIRECTLY checks Pump.fun bonding curve status (Reliable)
    // async _checkPumpFunBondingCurve(tokenMintString, connection) {
    //     // This is safer as we defined these in the constructor
    //     const pumpProgramId = this.PUMP_FUN_PROGRAM_ID_PK;

    //     const [bondingCurveAddress] = PublicKey.findProgramAddressSync(
    //         [Buffer.from('bonding-curve'), new PublicKey(tokenMintString).toBuffer()],
    //         pumpProgramId
    //     );
    //     try {
    //         const accountInfo = await connection.getAccountInfo(bondingCurveAddress);
    //         return { isComplete: !accountInfo }; // Simpler logic: if account exists, it's not complete.
    //     } catch (e) {
    //         return { isComplete: true };
    //     }
    // }

    async _checkTokenMigrationStatus(tokenMint) {
        if (!this.apiManager || !tokenMint) {
            return { hasMigrated: false };
        }
        try {
            // This API call checks if the token has a pool on a DEX other than Pump.fun
            const migratedPool = await this.apiManager.findAmmPoolForToken(tokenMint);

            if (migratedPool) {
                // We found a new home for the token. Now, map the API market name
                // to the internal dexPlatform name our tradingEngine understands.
                const market = migratedPool.market;
                let newDexPlatform = 'Unknown DEX';
                let programId = null;

                if (market.includes('raydium-amm') || market.includes('raydium-v4')) {
                    newDexPlatform = 'Raydium V4';
                    programId = config.PLATFORM_IDS.RAYDIUM_V4;
                } else if (market.includes('raydium-clmm')) {
                    newDexPlatform = 'Raydium CLMM';
                    programId = config.PLATFORM_IDS.RAYDIUM_CLMM;
                } else if (market.includes('raydium-cpmm')) {
                    newDexPlatform = 'Raydium CPMM';
                    programId = config.PLATFORM_IDS.RAYDIUM_CPMM;
                }
                // Add other Meteora/etc. mappings here if needed

                if (programId) {
                    return {
                        hasMigrated: true,
                        newDexPlatform: newDexPlatform,
                        newPlatformProgramId: programId.toBase58(),
                        platformSpecificData: { poolId: migratedPool.poolId }
                    };
                }
            }
            return { hasMigrated: false };
        } catch (error) {
            console.warn(`[MigrationCheck] Error checking status for ${shortenAddress(tokenMint)}: ${error.message}`);
            return { hasMigrated: false };
        }
    }

    // Helper: Formats the response from the heuristic (Good practice)
    // _quantumResponse(isCopyable, reason, details, certainty) {
    //     return {
    //         isCopyable,
    //         reason,
    //         details,
    //         quantumCertainty: certainty
    //     };
    // }

    _mapConfigKeyToPlatformName(key) {
        // More specific checks must come first
        if (key === 'PUMP_FUN_AMM') return 'Pump.fun AMM';
        if (key === 'PUMP_FUN' || key === 'PUMP_FUN_VARIANT' || key === 'PUMP_FUN_NEW') return 'Pump.fun'; // All Pump.fun variants

        if (key.includes('RAYDIUM_LAUNCHPAD')) return 'Raydium Launchpad';
        if (key.includes('RAYDIUM_V4')) return 'Raydium AMM';
        if (key.includes('RAYDIUM_CLMM')) return 'Raydium CLMM';
        if (key.includes('RAYDIUM_CPMM')) return 'Raydium CPMM';
        if (key.includes('METEORA_DLMM')) return 'Meteora DLMM';
        if (key.includes('METEORA_DBC')) return 'Meteora DBC';
        if (key.includes('METEORA_CP_AMM')) return 'Meteora CP-AMM';
        if (key.includes('Jupiter')) return 'Jupiter Aggregator';
        if (key.includes('PHOTON')) return 'Photon';
        if (key.includes('AXIOM')) return 'Axiom';
        if (key.includes('OPENBOOK')) return 'Openbook';
        if (key.includes('UNKNOWN_DEX_1')) return 'Unknown DEX 1';
        if (key.includes('UNKNOWN_DEX_2')) return 'Unknown DEX 2';
        if (key.includes('UNKNOWN_DEX_3')) return 'Unknown DEX 3';
        if (key.includes('UNKNOWN_DEX_4')) return 'Unknown DEX 4';
        if (key.includes('UNKNOWN_DEX_5')) return 'Unknown DEX 5';
        if (key.includes('CUSTOM_DEX_BUY')) return 'Custom DEX Buy'; // New platform for BUY trades
        
        return 'Unknown DEX';
    }

    /**
     * Extract loaded addresses from transaction for ATL (Address Table Lookup) support
     */
    _getLoadedAddresses(transaction) {
        try {
            if (!transaction || !transaction.meta || !transaction.meta.loadedAddresses) {
                return null;
            }
            
            return transaction.meta.loadedAddresses;
        } catch (error) {
            console.error(`[ANALYZER] ❌ Error extracting loaded addresses:`, error.message);
            return null;
        }
    }

    /**
     * Track unknown program IDs for investigation and potential addition to config
     */
    _trackUnknownProgram(programId) {
        try {
            // Skip system programs - these are not DEX programs
            const systemPrograms = [
                '11111111111111111111111111111111', // System Program
                'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', // Token Program
                'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL', // Associated Token Program
                'SysvarRecentB1ockHashes11111111111111111111', // Recent Blockhashes Sysvar
                'SysvarRent111111111111111111111111111111111', // Rent Sysvar
                'SysvarC1ock11111111111111111111111111111111', // Clock Sysvar
                'ComputeBudget111111111111111111111111111111', // Compute Budget Program
                'jitodontfrontd1111111TradeWithAxiomDotTrade', // Jito Program
            ];

            if (systemPrograms.includes(programId)) {
                return; // Skip system programs
            }

            // Initialize unknown programs tracking if not exists
            if (!this.unknownPrograms) {
                this.unknownPrograms = new Set();
            }

            // Add to tracking set (Set automatically handles duplicates)
            this.unknownPrograms.add(programId);

            // Log for investigation
            console.log(`[UNKNOWN-PROGRAM] 🔍 NEW UNKNOWN PROGRAM DETECTED: ${shortenAddress(programId)}`);
            console.log(`[UNKNOWN-PROGRAM] 📋 Add this to config.js as UNKNOWN_DEX_${this.unknownPrograms.size}:`);
            console.log(`[UNKNOWN-PROGRAM] 📋 UNKNOWN_DEX_${this.unknownPrograms.size}: new PublicKey('${programId}'),`);
            console.log(`[UNKNOWN-PROGRAM] 📋 Total unknown programs tracked: ${this.unknownPrograms.size}`);

            // Also log all currently tracked unknown programs for reference
            if (this.unknownPrograms.size > 0) {
                console.log(`[UNKNOWN-PROGRAM] 📊 All tracked unknown programs:`);
                Array.from(this.unknownPrograms).forEach((pid, index) => {
                    console.log(`[UNKNOWN-PROGRAM] 📊 ${index + 1}. ${shortenAddress(pid)} → UNKNOWN_DEX_${index + 1}`);
                });
            }

        } catch (error) {
            console.error(`[UNKNOWN-PROGRAM] ❌ Error tracking unknown program:`, error.message);
        }
    }

    /**
     * Get summary of all tracked unknown programs for easy config addition
     */
    getUnknownProgramsSummary() {
        if (!this.unknownPrograms || this.unknownPrograms.size === 0) {
            console.log(`[UNKNOWN-PROGRAM] 📊 No unknown programs tracked yet.`);
            return [];
        }

        console.log(`[UNKNOWN-PROGRAM] 📊 SUMMARY: ${this.unknownPrograms.size} unknown programs detected`);
        console.log(`[UNKNOWN-PROGRAM] 📋 Add these to config.js:`);
        
        const summary = [];
        Array.from(this.unknownPrograms).forEach((pid, index) => {
            const configLine = `UNKNOWN_DEX_${index + 1}: new PublicKey('${pid}'),`;
            console.log(`[UNKNOWN-PROGRAM] 📋 ${configLine}`);
            summary.push({
                programId: pid,
                configKey: `UNKNOWN_DEX_${index + 1}`,
                configLine: configLine
            });
        });

        return summary;
    }

    /**
     * Cleanup method to clear intervals and resources
     */
    destroy() {
        if (this.unknownProgramsSummaryInterval) {
            clearInterval(this.unknownProgramsSummaryInterval);
            this.unknownProgramsSummaryInterval = null;
        }
    }

    async _checkTokenMigrationStatus(tokenMint) {
        if (!this.apiManager || !tokenMint) {
            return { hasMigrated: false };
        }
        try {
            // This API call checks if the token has a pool on a DEX other than Pump.fun
            const migratedPool = await this.apiManager.findAmmPoolForToken(tokenMint);

            if (migratedPool) {
                // We found a new home for the token. Now, map the API market name
                // to the internal dexPlatform name our tradingEngine understands.
                const market = migratedPool.market;
                let newDexPlatform = null;
                let programId = null;

                if (market.includes('raydium-amm') || market.includes('raydium-v4')) {
                    newDexPlatform = 'Raydium V4';
                    programId = config.PLATFORM_IDS.RAYDIUM_V4;
                } else if (market.includes('raydium-clmm')) {
                    newDexPlatform = 'Raydium CLMM';
                    programId = config.PLATFORM_IDS.RAYDIUM_CLMM;
                } else if (market.includes('raydium-cpmm')) {
                    newDexPlatform = 'Raydium CPMM';
                    programId = config.PLATFORM_IDS.RAYDIUM_CPMM;
                } else if (market.includes('meteora-dlmm')) {
                    newDexPlatform = 'Meteora DLMM';
                    programId = config.PLATFORM_IDS.METEORA_DLMM;
                } else if (market.includes('meteora-dbc')) {
                    newDexPlatform = 'Meteora DBC';
                    programId = config.METEORA_DBC_PROGRAM_IDS[0]; // Use the first one
                } else if (market.includes('meteora-cpamm')) {
                    newDexPlatform = 'Meteora CP-AMM';
                    programId = config.METEORA_CP_AMM_PROGRAM_ID;
                }

                if (programId && newDexPlatform) {
                    console.log(`[MigrationCheck] ✅ MIGRATION DETECTED for ${shortenAddress(tokenMint)} -> ${newDexPlatform}`);
                    return {
                        hasMigrated: true,
                        newDexPlatform: newDexPlatform,
                        newPlatformProgramId: programId.toBase58(),
                        platformSpecificData: { poolId: migratedPool.poolId }
                    };
                }
            }
            return { hasMigrated: false };
        } catch (error) {
            console.warn(`[MigrationCheck] Error checking status for ${shortenAddress(tokenMint)}: ${error.message}`);
            return { hasMigrated: false };
        }
    }
    // ===== [END] NEW MIGRATION-AWARE HELPER ===== //

    /**
     * Identify which program IDs from a transaction are missing from our config
     * This helps us know what to add to support new platforms
     */
    _identifyMissingProgramIds(foundProgramIds) {
        const missing = [];
        const knownProgramIds = new Set();
        
        // Collect all known program IDs from config
        Object.values(this.platformIds).forEach(pId => {
            if (Array.isArray(pId)) {
                pId.forEach(id => knownProgramIds.add(id.toBase58()));
            } else if (pId instanceof PublicKey) {
                knownProgramIds.add(id.toBase58());
            }
        });
        
        // Find which ones we don't have
        foundProgramIds.forEach(programId => {
            if (!knownProgramIds.has(programId)) {
                missing.push(programId);
            }
        });
        
        return missing;
    }

    /**
     * Check if an address is a valid program ID (not an account address)
     */
    _isValidProgramId(address) {
        try {
            // Known system program IDs that are NOT DEX platforms
            const systemPrograms = [
                '11111111111111111111111111111111',           // System Program
                'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', // SPL Token
                'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb', // Token-2022
                'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25YtWvfZMj8cng', // Associated Token
                'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL', // Associated Token (variant)
                'ComputeBudget111111111111111111111111111111', // Compute Budget
                'SysvarRent111111111111111111111111111111111', // Sysvar Rent
                'SysvarC1ock11111111111111111111111111111111', // Sysvar Clock
                'jito1bA6L9erHapzQJv2HmzMSPByND3e3HmkLcBfsdCJ', // Jito
                'jitodontfront111111111111111tradewithPhoton', // Jito Front
                'pfeeB5h3jqo3qo3qo3qo3qo3qo3qo3qo3qo3qo3qo', // Pump.fun Fee
                '4wTV1YmiEkRvAtNtsSGPtUrqRYQMe5SKy2uB4JCNsSNk', // Pump.fun Global
                'CebN5WGQ4jvEPvsVU4EoHEpgzq1S77jyZ52gXSJGTk5M' // Pump.fun Fee Recipient
            ];
            
            // If it's a known system program, it's not a DEX platform
            if (systemPrograms.includes(address)) {
                return false;
            }
            
            // Check if it's in our known platform IDs
            for (const [key, pId] of Object.entries(this.platformIds)) {
                if (Array.isArray(pId)) {
                    if (pId.some(id => id.toBase58() === address)) {
                        return true; // This is a known DEX platform
                    }
                } else if (pId instanceof PublicKey && pId.toBase58() === address) {
                    return true; // This is a known DEX platform
                }
            }
            
            // For now, only consider known platforms as valid program IDs
            // This prevents us from picking up random account addresses
            return false;
            
        } catch (error) {
            console.warn(`[DEEP-ANALYSIS] Error validating program ID: ${error.message}`);
            return false;
        }
    }

    /**
     * EVENT-BASED ANALYSIS: Use transaction events, inner instructions, and program execution traces
     * to identify the REAL platform program IDs that executed the trade
     */
    _deepAnalyzeTransactionForPlatforms(transactionResponse, traderAddress = null) {
        try {
            console.log(`[EVENT-ANALYSIS] 🔍 Analyzing transaction events for platform detection...`);
            
            // 🎯 PRIORITY 1: Router Detection (F5tfvb...)
            const routerDetection = this._detectRouterInstruction(transactionResponse, traderAddress);
            if (routerDetection.found) {
                console.log(`[EVENT-ANALYSIS] 🎯 Router detected at instruction ${routerDetection.instructionIndex}`);
                return {
                    platformDetection: {
                        identifiedPlatforms: [{
                            platform: 'Router',
                            programId: routerDetection.programId,
                            confidence: 'high',
                            source: 'outer_instruction',
                            instructionIndex: routerDetection.instructionIndex,
                            cloningTarget: routerDetection.cloningTarget
                        }],
                        primaryPlatform: 'Router',
                        analysisMethod: 'router_detection'
                    }
                };
            }
            
            const allProgramIds = new Set();
            const platformMatches = new Map();
            const eventTraces = [];
            
            // 1️⃣ Extract all possible program IDs from different sources (prioritizing events)
            const sources = {
                outerInstructions: [],
                innerInstructions: [],
                loadedAddresses: [],
                programExecutionTraces: [],
                accountKeys: []
            };

            // Outer instructions
            if (transactionResponse.transaction?.message?.instructions) {
                sources.outerInstructions = transactionResponse.transaction.message.instructions;
                console.log(`[DEEP-ANALYSIS] 📋 Found ${sources.outerInstructions.length} outer instructions`);
            }

            // Inner instructions (CRITICAL for platform detection - these are the actual execution events)
            if (transactionResponse.meta?.innerInstructions) {
                sources.innerInstructions = transactionResponse.meta.innerInstructions;
                console.log(`[EVENT-ANALYSIS] 🔬 Found ${sources.innerInstructions.length} inner instruction groups (execution events)`);
                
                // Flatten all inner instructions and analyze execution patterns
                const allInnerIx = sources.innerInstructions.flatMap(group => group.instructions || []);
                console.log(`[EVENT-ANALYSIS] 🔬 Total inner instructions: ${allInnerIx.length}`);
                
                // Extract program IDs from inner instructions with execution context
                allInnerIx.forEach((ix, index) => {
                    if (ix.programId) {
                        const programId = typeof ix.programId === 'string' ? ix.programId : ix.programId.toString();
                        allProgramIds.add(programId);
                        
                        // Create execution trace event
                        const executionEvent = {
                            type: 'program_execution',
                            programId: programId,
                            instructionIndex: index,
                            stackHeight: ix.stackHeight || 0,
                            accounts: ix.accounts || [],
                            data: ix.data || '',
                            timestamp: Date.now()
                        };
                        eventTraces.push(executionEvent);
                        
                        // console.log(`[EVENT-ANALYSIS] 🔬 Execution Event: ${shortenAddress(programId)} (stack: ${ix.stackHeight || 0})`);
                    }
                });
            }

            // Loaded addresses (address table lookups)
            if (transactionResponse.meta?.loadedAddresses) {
                sources.loadedAddresses = transactionResponse.meta.loadedAddresses;
                console.log(`[DEEP-ANALYSIS] 📚 Loaded addresses found:`, Object.keys(sources.loadedAddresses));
                
                // Extract program IDs from loaded addresses
                Object.values(sources.loadedAddresses).forEach(addressGroup => {
                    if (Array.isArray(addressGroup)) {
                        addressGroup.forEach(addr => {
                            if (addr && typeof addr === 'string') {
                                allProgramIds.add(addr);
                                console.log(`[DEEP-ANALYSIS] 📚 Loaded Address: ${shortenAddress(addr)}`);
                            }
                        });
                    }
                });
            }

            // Log messages (CRITICAL for program execution traces)
            if (transactionResponse.meta?.logMessages) {
                sources.programExecutionTraces = transactionResponse.meta.logMessages;
                console.log(`[EVENT-ANALYSIS] 📝 Found ${sources.programExecutionTraces.length} program execution traces`);
                
                // Extract program execution events from log messages
                sources.programExecutionTraces.forEach((log, index) => {
                    // Look for "Program X invoke [Y]" patterns
                    const programInvokeMatch = log.match(/Program ([A-Za-z0-9]{32,44}) invoke \[(\d+)\]/);
                    if (programInvokeMatch) {
                        const programId = programInvokeMatch[1];
                        const stackHeight = programInvokeMatch[2];
                        
                        // Validate this is actually a program ID (not an account address)
                        if (this._isValidProgramId(programId)) {
                            allProgramIds.add(programId);
                            
                            // Create program invocation event
                            const invocationEvent = {
                                type: 'program_invocation',
                                programId: programId,
                                stackHeight: parseInt(stackHeight),
                                logIndex: index,
                                logMessage: log,
                                timestamp: Date.now()
                            };
                            eventTraces.push(invocationEvent);
                            
                            // console.log(`[EVENT-ANALYSIS] 📝 Invocation Event: ${shortenAddress(programId)} (stack: ${stackHeight})`);
                        } else {
                            // Skip invalid program IDs silently to reduce noise
                            // console.log(`[EVENT-ANALYSIS] ⚠️ Skipping invalid program ID: ${shortenAddress(programId)}`);
                        }
                    }
                    
                    // Look for "Program X success" patterns
                    const programSuccessMatch = log.match(/Program ([A-Za-z0-9]{32,44}) success/);
                    if (programSuccessMatch) {
                        const programId = programSuccessMatch[1];
                        
                        // Validate this is actually a program ID
                        if (this._isValidProgramId(programId)) {
                            allProgramIds.add(programId);
                            
                            // Create program completion event
                            const completionEvent = {
                                type: 'program_completion',
                                programId: programId,
                                logIndex: index,
                                logMessage: log,
                                timestamp: Date.now()
                            };
                            eventTraces.push(completionEvent);
                            
                            // console.log(`[EVENT-ANALYSIS] ✅ Completion Event: ${shortenAddress(programId)}`);
                        } else {
                            // Skip invalid program IDs silently to reduce noise
                            // console.log(`[EVENT-ANALYSIS] ⚠️ Skipping invalid program ID: ${shortenAddress(programId)}`);
                        }
                    }
                });
            }

            // Account keys (from outer transaction)
            if (transactionResponse.transaction?.message?.accountKeys) {
                sources.accountKeys = transactionResponse.transaction.message.accountKeys;
                // console.log(`[DEEP-ANALYSIS] 🔑 Found ${sources.accountKeys.length} account keys`);
            }

            // 2️⃣ Check each program ID against our known platforms
            console.log(`[DEEP-ANALYSIS] 🎯 Checking ${allProgramIds.size} unique program IDs against known platforms...`);
            
            // Debug: Show what we're looking for
            console.log(`[DEEP-ANALYSIS] 🔍 Looking for actual program IDs in transaction...`);
            console.log(`[DEEP-ANALYSIS] 📊 Found ${allProgramIds.size} program IDs to analyze`);
            
            allProgramIds.forEach(programId => {
                // Find which config key this program ID matches
                let matchedConfigKey = null;
                for (const [key, pId] of Object.entries(this.platformIds)) {
                    if (Array.isArray(pId)) {
                        if (pId.some(id => id.toBase58() === programId)) {
                            matchedConfigKey = key;
                            break;
                        }
                    } else if (pId instanceof PublicKey && pId.toBase58() === programId) {
                        matchedConfigKey = key;
                        break;
                    }
                }
                
                if (matchedConfigKey) {
                    const platformName = this._mapConfigKeyToPlatformName(matchedConfigKey);
                    platformMatches.set(programId, platformName);
                    console.log(`[DEEP-ANALYSIS] ✅ PLATFORM MATCH: ${shortenAddress(programId)} → ${platformName} (via ${matchedConfigKey})`);
                } else {
                    // Unknown program detected - add to tracking and log for investigation
                    this._trackUnknownProgram(programId);
                }
            });

            // 3️⃣ Return comprehensive event-based analysis with enhanced structure
            const identifiedPlatforms = Array.from(platformMatches.entries()).map(([programId, platformName]) => ({
                programId,
                platform: platformName, // Use 'platform' to match Router detection format
                platformName, // Keep for backward compatibility
                confidence: 'high',
                detectionMethod: 'program_id_match',
                description: this._getPlatformDescription(platformName)
            }));

            const unknownPrograms = Array.from(allProgramIds).filter(id => !platformMatches.has(id)).map(programId => ({
                programId,
                type: this._categorizeUnknownProgram(programId),
                description: this._getProgramDescription(programId)
            }));

            const result = {
                analysisType: 'comprehensive_transaction_analysis',
                summary: {
                    totalProgramsExecuted: allProgramIds.size,
                    identifiedPlatforms: identifiedPlatforms.length,
                    unknownPrograms: unknownPrograms.length,
                    analysisConfidence: this._calculateAnalysisConfidence(identifiedPlatforms.length, allProgramIds.size)
                },
                platformDetection: {
                    identifiedPlatforms,
                    unknownPrograms
                },
                transactionStructure: {
                    outerInstructions: sources.outerInstructions.length,
                    innerInstructions: sources.innerInstructions.length,
                    loadedAddresses: Object.keys(sources.loadedAddresses).length,
                    programExecutionTraces: sources.programExecutionTraces.length,
                    accountKeys: sources.accountKeys.length,
                    complexity: this._assessTransactionComplexity(sources)
                },
                eventTraces: eventTraces,
                analysisMetadata: {
                    analysisVersion: '2.0',
                    eventBasedDetection: true,
                    logMessageAnalysis: false,
                    innerInstructionAnalysis: true,
                    programExecutionTracing: true
                },
                recommendations: this._generateRecommendations(identifiedPlatforms, unknownPrograms, sources)
            };

            // Log deep analysis results to JSON file with signature-specific naming
            const signature = transactionResponse.transaction?.signatures?.[0] || 'unknown_signature';
            const actualTraderAddress = traderAddress || transactionResponse.transaction?.message?.accountKeys?.[0] || signature;
            this.transactionLogger.logDeepAnalysis(signature, result, actualTraderAddress);

            return result;

        } catch (error) {
            console.error(`[DEEP-ANALYSIS] ❌ Error in deep analysis:`, error.message);
            return {
                analysisType: 'comprehensive_transaction_analysis',
                summary: {
                    totalProgramsExecuted: 0,
                    identifiedPlatforms: 0,
                    unknownPrograms: 0,
                    analysisConfidence: 'low'
                },
                platformDetection: {
                    identifiedPlatforms: [],
                    unknownPrograms: []
                },
                transactionStructure: {
                    outerInstructions: 0,
                    innerInstructions: 0,
                    loadedAddresses: 0,
                    programExecutionTraces: 0,
                    accountKeys: 0,
                    complexity: 'unknown'
                },
                eventTraces: [],
                analysisMetadata: {
                    analysisVersion: '2.0',
                    eventBasedDetection: true,
                    logMessageAnalysis: false,
                    innerInstructionAnalysis: true,
                    programExecutionTracing: true
                },
                recommendations: ['Analysis failed - check transaction data'],
                error: error.message
            };
        }
    }

    /**
     * Helper method to get platform description
     */
    _getPlatformDescription(platformName) {
        const descriptions = {
            'Raydium': 'Primary DEX platform for token trading and liquidity provision',
            'Pump.fun': 'Meme token launchpad and trading platform',
            'Jupiter': 'Token swap aggregator for best price routing',
            'Meteora': 'Dynamic AMM with concentrated liquidity',
            'Orca': 'User-friendly DEX with concentrated liquidity',
            'Serum': 'High-performance DEX with order book model',
            'Raydium Launchpad': 'Token launch and trading platform on Raydium'
        };
        return descriptions[platformName] || `Trading platform: ${platformName}`;
    }

    /**
     * Helper method to categorize unknown programs
     */
    _categorizeUnknownProgram(programId) {
        if (programId.includes('Sysvar') || programId.includes('11111111111111111111')) {
            return 'system_program';
        }
        if (programId.includes('So11111111111111111111111111111111111111112')) {
            return 'wrapped_sol';
        }
        if (programId.includes('Trade') || programId.includes('Swap')) {
            return 'unknown_dex';
        }
        return 'unknown';
    }

    /**
     * Helper method to get program description
     */
    _getProgramDescription(programId) {
        if (programId.includes('SysvarRecentB1ockHashes')) {
            return 'Solana system program for recent block hashes';
        }
        if (programId.includes('So11111111111111111111111111111111111111112')) {
            return 'Wrapped SOL token program';
        }
        if (programId.includes('Trade') || programId.includes('Swap')) {
            return 'Unknown DEX or trading program - requires further investigation';
        }
        return 'Unknown program - requires platform identification';
    }

    /**
     * Helper method to calculate analysis confidence
     */
    _calculateAnalysisConfidence(identifiedCount, totalCount) {
        if (totalCount === 0) return 'low';
        const ratio = identifiedCount / totalCount;
        if (ratio >= 0.8) return 'high';
        if (ratio >= 0.5) return 'medium';
        return 'low';
    }

    /**
     * Helper method to assess transaction complexity
     */
    _assessTransactionComplexity(sources) {
        const totalInstructions = sources.outerInstructions.length + sources.innerInstructions.length;
        const totalTraces = sources.programExecutionTraces.length;
        
        if (totalInstructions > 20 || totalTraces > 100) return 'high';
        if (totalInstructions > 10 || totalTraces > 50) return 'medium';
        return 'low';
    }

    /**
     * Helper method to generate recommendations
     */
    _generateRecommendations(identifiedPlatforms, unknownPrograms, sources) {
        const recommendations = [];
        
        if (identifiedPlatforms.length > 0) {
            recommendations.push(`Primary platform identified: ${identifiedPlatforms[0].platformName}`);
        }
        
        if (unknownPrograms.length > 0) {
            recommendations.push(`${unknownPrograms.length} unknown programs require platform identification`);
        }
        
        const complexity = this._assessTransactionComplexity(sources);
        recommendations.push(`Transaction shows ${complexity} complexity with nested instructions`);
        
        recommendations.push('Event-based detection successfully identified main trading platform');
        
        return recommendations;
    }

    // Enhanced DEX detection by analyzing instruction patterns and account structures
    _detectDexByInstructionPatterns(instructions, accountKeys, meta) {
        try {
            console.log(`[ENHANCED-DEX] 🔍 Analyzing instruction patterns for DEX detection...`);
            
            // Look for common DEX patterns
            const patterns = {
                // Raydium-like patterns
                raydium: {
                    hasTokenSwap: false,
                    hasPoolInstruction: false,
                    hasLiquidityInstruction: false
                },
                // Meteora-like patterns  
                meteora: {
                    hasWhirlpoolInstruction: false,
                    hasLiquidityInstruction: false
                },
                // Jupiter-like patterns
                jupiter: {
                    hasSwapInstruction: false,
                    hasTokenTransfer: false
                },
                // Custom DEX patterns
                custom: {
                    hasComplexSwap: false,
                    hasMultipleTokenTransfers: false
                }
            };

            // Analyze each instruction for patterns
            for (const ix of instructions) {
                const programId = this._resolveProgramId(ix, accountKeys);
                if (!programId) continue;
                
                const programIdStr = programId.toBase58();
                
                // Check for token transfers (indicates swap activity)
                if (ix.accounts && ix.accounts.length >= 3) {
                    // Look for token program involvement
                    const hasTokenProgram = accountKeys.some(key => 
                        key.toBase58() === 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'
                    );
                    
                    if (hasTokenProgram && ix.accounts.length >= 4) {
                        patterns.custom.hasComplexSwap = true;
                        patterns.custom.hasMultipleTokenTransfers = true;
                    }
                }

                // Check for specific instruction data patterns
                if (ix.data && ix.data.length > 0) {
                    const dataStr = ix.data.toString('base64');
                    
                    // Look for swap-like instruction discriminators
                    if (dataStr.startsWith('6vx8P') || dataStr.startsWith('1GqUcqN2sBtddBCfmeWeGYf')) {
                        patterns.custom.hasComplexSwap = true;
                        console.log(`[ENHANCED-DEX] 🔍 Found swap-like instruction data: ${dataStr.substring(0, 10)}...`);
                    }
                }
            }

            // Check log messages for DEX hints
            if (meta && meta.logMessages) {
                const logs = meta.logMessages.join(' ').toLowerCase();
                
                // Look for DEX-specific log patterns
                if (logs.includes('instruction: buy') || logs.includes('instruction: swap')) {
                    patterns.custom.hasComplexSwap = true;
                    console.log(`[ENHANCED-DEX] 🔍 Found swap instruction in logs`);
                }
                
                if (logs.includes('program') && logs.includes('invoke')) {
                    // Count program invocations to identify complexity
                    const programInvocations = logs.match(/program [a-zA-Z0-9]{32,44} invoke/g);
                    if (programInvocations && programInvocations.length > 3) {
                        patterns.custom.hasComplexSwap = true;
                        console.log(`[ENHANCED-DEX] 🔍 Complex transaction with ${programInvocations.length} program invocations`);
                    }
                }
            }

            // Determine the most likely DEX platform
            if (patterns.custom.hasComplexSwap && patterns.custom.hasMultipleTokenTransfers) {
                console.log(`[ENHANCED-DEX] ✅ Detected custom DEX with complex swap pattern`);
                return {
                    found: true,
                    dexPlatform: 'Custom DEX (Pattern Detected)',
                    platformProgramId: 'Custom DEX (Enhanced Detection)',
                    platformSpecificData: {
                        detectionMethod: 'instruction_pattern_analysis',
                        complexity: 'high',
                        instructionCount: instructions.length
                    }
                };
            }

            return { found: false };
            
        } catch (error) {
            console.error(`[ENHANCED-DEX] ❌ Error in enhanced DEX detection:`, error);
            return { found: false };
        }
    }

    /**
     * Fallback method to detect Pump.fun transactions by pattern
     * This helps catch transactions that might use newer program IDs
     */
    _detectPumpFunByPattern(instructions, accountKeys) {
        try {
            console.log(`[ANALYZER] 🔍 Attempting Pump.fun pattern detection...`);
            
            // Look for Pump.fun-specific accounts in the transaction
            const pumpFunAccounts = [
                '4wTV1YmiEkRvAtNtsSGPtUrqRYQMe5SKy2uB4JCNsSNk', // PUMP_FUN_GLOBAL
                'CebN5WGQ4jvEPvsVU4EoHEpgzq1S77jyZ52gXSJGTk5M', // PUMP_FUN_FEE_RECIPIENT
            ];
            
            // Check if any Pump.fun accounts are present
            const hasPumpFunAccounts = accountKeys.some(key => 
                pumpFunAccounts.includes(key.toBase58())
            );
            
            if (hasPumpFunAccounts) {
                console.log(`[ANALYZER] 🔍 Pump.fun accounts detected in transaction`);
                return true;
            }
            
            // Look for Pump.fun discriminators in instruction data
            for (const ix of instructions) {
                if (ix.data && ix.data.length >= 8) {
                    const data = Buffer.from(ix.data);
                    const discriminator = data.slice(0, 8);
                    
                    // Check against known Pump.fun discriminators
                    if (discriminator.equals(config.PUMP_FUN_BUY_DISCRIMINATOR) ||
                        discriminator.equals(config.PUMP_FUN_SELL_DISCRIMINATOR) ||
                        discriminator.equals(config.PUMP_AMM_BUY_DISCRIMINATOR) ||
                        discriminator.equals(config.PUMP_AMM_SELL_DISCRIMINATOR)) {
                        console.log(`[ANALYZER] 🔍 Pump.fun discriminator detected in instruction data`);
                        return true;
                    }
                }
            }
            
            // Additional check: Look for common Pump.fun instruction patterns
            // Pump.fun often has specific account structures
            if (instructions.length >= 2 && accountKeys.length >= 5) {
                console.log(`[ANALYZER] 🔍 Checking for Pump.fun instruction patterns...`);
                // This is a heuristic - Pump.fun transactions often have multiple instructions
                // and specific account structures
            }
            
            console.log(`[ANALYZER] ❌ No Pump.fun pattern detected`);
            return false;
        } catch (error) {
            console.warn(`[ANALYZER] ⚠️ Error in Pump.fun pattern detection:`, error.message);
            return false;
        }
    }

    // ===============================================
    // ========== NOISE FILTERING METHODS ===========
    // ===============================================
    
    /**
     * Pre-filter to identify and skip noise transactions that are clearly not trades
     * PURE COPY BOT: NO NOISE FILTERING - Copy everything!
     */
    _isNoiseTransaction(transactionData) {
        // PURE COPY BOT: Copy EVERY transaction, no matter what!
        console.log(`[NOISE-FILTER] 🎯 PURE COPY BOT: NO NOISE FILTERING - Copying everything!`);
        return false; // Never filter anything out
    }

    /**
     * Get the reason why a transaction was classified as noise
     */
    _getNoiseReason(transactionData) {
        try {
            const instructions = transactionData.transaction.message.instructions;
            const accountKeys = transactionData.transaction.message.accountKeys || [];
            const logMessages = transactionData.meta?.logMessages || [];
            const computeUnits = transactionData.meta?.computeUnitsConsumed || 0;

            if (logMessages.some(log => log.includes('Initialize the associated token account'))) {
                return 'Token account creation';
            }

            if (computeUnits < 5000 && instructions.length <= 3) {
                return 'Simple system transaction';
            }

            if (this._hasMinimalSOLMovement(transactionData)) {
                return 'Minimal SOL movement (dust)';
            }

            const hasOnlySystemPrograms = instructions.every(ix => {
                const programId = this._resolveProgramId(ix, accountKeys);
                if (!programId) return false;
                let programIdStr;
                try {
                    // Handle different types of programId
                    if (typeof programId === 'string') {
                        programIdStr = programId;
                    } else if (programId && typeof programId.toBase58 === 'function') {
                        programIdStr = programId.toBase58();
                    } else {
                        // If it's neither string nor has toBase58, try to convert it
                        programIdStr = String(programId);
                    }
                } catch (error) {
                    console.log(`[NOISE-FILTER] Error converting programId: ${error.message}`);
                    return false;
                }
                        return programIdStr === config.COMPUTE_BUDGET_PROGRAM_ID.toBase58() ||
               programIdStr === config.SYSTEM_PROGRAM_ID.toBase58() ||
                       programIdStr === config.ASSOCIATED_TOKEN_PROGRAM_ID.toBase58();
            });

            if (hasOnlySystemPrograms) {
                return 'Only system/compute programs';
            }

            return 'Non-trading transaction';
        } catch (error) {
            return 'Unknown noise pattern';
        }
    }

    /**
     * Check if transaction has any known DEX programs
     */
    _hasAnyDexProgram(accountKeys) {
        try {
            for (const key of accountKeys) {
                const keyStr = typeof key === 'string' ? key : key.toBase58();
                
                // Check against known DEX program IDs
                for (const [name, pId] of Object.entries(this.platformIds)) {
                    if (Array.isArray(pId)) {
                        if (pId.some(id => id.toBase58() === keyStr)) return true;
                    } else if (pId instanceof PublicKey) {
                        if (pId.toBase58() === keyStr) return true;
                    }
                }
            }
            return false;
        } catch (error) {
            return false;
        }
    }

    /**
     * Check if transaction has minimal SOL movement (likely dust/noise)
     */
    _hasMinimalSOLMovement(transactionData) {
        try {
            const preBalances = transactionData.meta?.preBalances || [];
            const postBalances = transactionData.meta?.postBalances || [];
            
            if (preBalances.length !== postBalances.length) return false;

            let maxSOLChange = 0;
            for (let i = 0; i < preBalances.length; i++) {
                const change = Math.abs(postBalances[i] - preBalances[i]);
                if (change > maxSOLChange) {
                    maxSOLChange = change;
                }
            }

            // Consider it minimal if the largest balance change is less than 0.001 SOL (excluding fees)
            const MINIMAL_SOL_THRESHOLD = 1000000; // 0.001 SOL in lamports
            return maxSOLChange < MINIMAL_SOL_THRESHOLD;
        } catch (error) {
            return false;
        }
    }

    /**
     * Create a clean, readable trade summary
     */
    _createTradeSummary(details, transactionResponse) {
        try {
            const platform = details.dexPlatform || 'Unknown';
            const type = details.tradeType?.toUpperCase() || 'UNKNOWN';
            const fee = transactionResponse?.meta?.fee || 0;
            const slot = transactionResponse?.slot || 'N/A';
            
            let amountInfo = '';
            if (details.tradeType === 'buy') {
                const solAmount = details.inputAmountLamports ? 
                    (details.inputAmountLamports / 1000000000).toFixed(4) : 'N/A';
                const tokenMint = details.outputMint ? shortenAddress(details.outputMint) : 'Unknown';
                amountInfo = `${solAmount} SOL → ${tokenMint}`;
            } else if (details.tradeType === 'sell') {
                const solAmount = details.outputAmountRaw ? 
                    (parseInt(details.outputAmountRaw) / 1000000000).toFixed(4) : 'N/A';
                const tokenMint = details.inputMint ? shortenAddress(details.inputMint) : 'Unknown';
                const tokenAmount = details.inputAmountRaw ? 
                    this._formatTokenAmount(details.inputAmountRaw, details.tokenDecimals || 6) : 'N/A';
                amountInfo = `${tokenAmount} ${tokenMint} → ${solAmount} SOL`;
            }

            return `${type} on ${platform} | ${amountInfo} | Fee: ${(fee / 1000000000).toFixed(6)} SOL | Slot: ${slot}`;
            
        } catch (error) {
            return `Trade detected on ${details.dexPlatform || 'Unknown'} (summary error: ${error.message})`;
        }
    }

    /**
     * Format token amount with proper decimals
     */
    _formatTokenAmount(rawAmount, decimals = 6) {
        try {
            const amount = BigInt(rawAmount);
            const divisor = BigInt(10 ** decimals);
            const formatted = Number(amount) / Number(divisor);
            
            if (formatted > 1000000) {
                return `${(formatted / 1000000).toFixed(2)}M`;
            } else if (formatted > 1000) {
                return `${(formatted / 1000).toFixed(2)}K`;
            } else {
                return formatted.toFixed(4);
            }
        } catch (error) {
            return 'N/A';
        }
    }

    /**
     * 🎯 Router Detection - Priority detection for Router program (F5tfvb...)
     */
    _detectRouterInstruction(transactionResponse, traderAddress) {
        try {
            console.log(`[ROUTER-DETECTION] 🔍 Searching for Router instruction...`);
            
            const instructions = transactionResponse.transaction?.message?.instructions || [];
            const accountKeys = transactionResponse.transaction?.message?.accountKeys || [];
            
            // Look for Router programs (F5tfvb... and Photon Router)
            const routerProgramIds = [
                'F5tfvbLog9VdGUPqBDTT8rgXvTTcq7e5UiGnupL1zvBq', // Custom Router
                'BSfD6SHZigAfDWSjzD5Q41jw8LmKwtmjskPH9XW1mrRW'  // Photon Router
            ];
            
            for (let i = 0; i < instructions.length; i++) {
                const instruction = instructions[i];
                const programId = accountKeys[instruction.programIdIndex];
                
                if (routerProgramIds.includes(programId)) {
                    const routerType = programId === 'F5tfvbLog9VdGUPqBDTT8rgXvTTcq7e5UiGnupL1zvBq' ? 'Custom Router' : 'Photon Router';
                    console.log(`[ROUTER-DETECTION] 🎯 Found ${routerType} instruction at index ${i}`);
                    
                    // Verify trader is a signer
                    const isSigner = instruction.accounts.some(accountIndex => {
                        const account = accountKeys[accountIndex];
                        return account === traderAddress;
                    });
                    
                    if (isSigner) {
                        console.log(`[ROUTER-DETECTION] ✅ Router instruction confirmed with trader as signer`);
                        
                        // Create cloning target
                        const cloningTarget = {
                            programId: programId,
                            accounts: instruction.accounts.map(accountIndex => ({
                                pubkey: accountKeys[accountIndex],
                                isSigner: accountIndex === 0,
                                isWritable: true
                            })),
                            data: instruction.data,
                            isSigner: true,
                            isWritable: true,
                            instructionIndex: i
                        };
                        
                        return {
                            found: true,
                            programId: programId,
                            instructionIndex: i,
                            cloningTarget: cloningTarget
                        };
                    }
                }
            }
            
            return { found: false };
            
        } catch (error) {
            console.error(`[ROUTER-DETECTION] ❌ Router detection failed:`, error.message);
            return { found: false };
        }
    }

}

// CommonJS export
module.exports = { TransactionAnalyzer };