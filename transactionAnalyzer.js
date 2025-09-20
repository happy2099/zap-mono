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
        this.rawFetcher = new RawTransactionFetcher(connection._rpcEndpoint || config.HELIUS_ENDPOINTS.rpc);
        
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
            'PUMP_FUN', 'PUMP_FUN_AMM', 'METEORA_DBC', 'METEORA_DLMM', 'METEORA_CP_AMM', 'JUPITER'];
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
                console.log(`[ANALYZER] No pre-fetched data, using raw fetcher for instant transactions...`);
                
                // For instant copy trading with processed commitment, use raw fetcher with retry
                // This handles very recent transactions that might not be immediately available
                let retryCount = 0;
                const maxRetries = 3;
                const retryDelays = [500, 1000, 2000]; // Progressive delays
                
                while (retryCount < maxRetries) {
                    transactionResponse = await this.rawFetcher.fetchAndParseTransaction(signature);
                    
                    if (transactionResponse) {
                        console.log(`[ANALYZER] ✅ Transaction fetched successfully on attempt ${retryCount + 1}`);
                        break;
                    }
                    
                    retryCount++;
                    if (retryCount < maxRetries) {
                        console.log(`[ANALYZER] ⏳ Transaction too recent, retrying in ${retryDelays[retryCount - 1]}ms... (attempt ${retryCount + 1}/${maxRetries})`);
                        await new Promise(resolve => setTimeout(resolve, retryDelays[retryCount - 1]));
                    }
                }
                
                if (!transactionResponse) {
                    console.log(`[ANALYZER] ❌ Transaction still too recent after ${maxRetries} attempts. Signature: ${signature}`);
                    throw new Error(`Transaction too recent for instant copy trading. Tried ${maxRetries} times with progressive delays.`);
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

        console.log(`[ANALYZER] ✅ Trade detected! Using Universal Cloning Engine...`);

        // --- NEW STAGE 3: UNIVERSAL CLONING ANALYSIS ---
        
        // 1. Check for a valid swap
        console.log(`[ANALYZER] ✅ Swap confirmed via balance changes. Type: ${balanceAnalysis.details.tradeType}`);

        // 2. Blueprint Creation: Create detailed blueprint with account roles
        const blueprint = await this._createCloningBlueprint(transactionResponse, traderPublicKey);

        if (!blueprint) {
            return { isCopyable: false, reason: "Could not create cloning blueprint." };
        }

        // 3. Success: Package the result for the engine.
        // Note: We convert PublicKeys to strings for safe message passing between workers.
        const finalDetails = {
            ...balanceAnalysis.details,
            dexPlatform: 'UniversalCloner', // A generic name, as we no longer care about the specific platform.
            platformProgramId: blueprint.programId, // Already a string from blueprint
            traderPubkey: finalTraderPk.toBase58(),
            originalTransaction: transactionResponse,
            
            // This is the critical blueprint for the forger.
            cloningTarget: blueprint, // Rich blueprint with account roles and metadata
        };
        
        const tradeSummary = this._createTradeSummary(finalDetails, transactionResponse);
        console.log(`[ANALYZER] 🎉 SUCCESS! ${tradeSummary}`);

                        return {
            isCopyable: true,
            reason: `Trade detected and ready for Universal Cloning.`,
            details: finalDetails,
            summary: tradeSummary
        };
    }
    
    /**
     * BLUEPRINT CREATOR: Create a rich, detailed blueprint of the master instruction
     * This creates a context-aware blueprint that preserves account roles and relationships
     */
    async _createCloningBlueprint(transactionResponse, traderPublicKey) {
        console.log(`[BLUEPRINT-CREATOR] 🔍 Creating detailed blueprint for transaction...`);
        
        const { transaction, meta } = transactionResponse;
        const traderPk = new PublicKey(traderPublicKey);
        
        // First, find the core instruction using our existing detective logic
        const coreInstructionResult = this._findCoreSwapInstruction(transactionResponse, traderPublicKey);
        if (!coreInstructionResult) {
            console.log('[BLUEPRINT-CREATOR] ❌ Core instruction not found, cannot create blueprint.');
            return null;
        }
        
        // Get balance analysis for mint information
        const rawAccountKeys = transaction.message.accountKeys || transaction.message.staticAccountKeys;
        const accountKeys = rawAccountKeys.map(key => {
            if (key && key.pubkey) return new PublicKey(key.pubkey);
            if (key instanceof PublicKey) return key;
            return new PublicKey(key);
        });
        
        const balanceAnalysis = this.analyzeBalanceChangesInternal(meta, accountKeys, traderPk);
        if (!balanceAnalysis.isSwap) {
            console.log('[BLUEPRINT-CREATOR] ❌ Not a swap, cannot create blueprint.');
            return null;
        }
        
        const { inputMint, outputMint } = balanceAnalysis.details;
        
        return await this._annotateAccountRoles(coreInstructionResult, traderPk, inputMint, outputMint, transaction, meta);
    }

    /**
     * Annotate each account in the instruction with its role for context-aware cloning
     */
    async _annotateAccountRoles(coreInstructionResult, traderPk, inputMint, outputMint, transaction, meta) {
        console.log(`[BLUEPRINT-CREATOR] 🏷️ Annotating account roles for context preservation...`);
        
        const { getAssociatedTokenAddressSync } = require('@solana/spl-token');
        
        // Calculate expected ATAs for the master trader
        const masterInputATA = (inputMint !== this.NATIVE_SOL_MINT) ? 
            getAssociatedTokenAddressSync(new PublicKey(inputMint), traderPk) : null;
        const masterOutputATA = (outputMint !== this.NATIVE_SOL_MINT) ? 
            getAssociatedTokenAddressSync(new PublicKey(outputMint), traderPk) : null;
        
        // Annotate each account with its role
        const annotatedAccounts = coreInstructionResult.accounts.map((account, index) => {
            const pubkey = new PublicKey(account.pubkey);
            let role = 'UNKNOWN_ACCOUNT'; // Default role
            
            // Identify account roles
            if (pubkey.equals(traderPk)) {
                role = 'TRADER_WALLET';
            } else if (masterInputATA && pubkey.equals(masterInputATA)) {
                role = 'INPUT_ATA';
            } else if (masterOutputATA && pubkey.equals(masterOutputATA)) {
                role = 'OUTPUT_ATA';
            } else if (pubkey.equals(config.TOKEN_PROGRAM_ID)) {
                role = 'TOKEN_PROGRAM';
            } else if (pubkey.equals(config.TOKEN_2022_PROGRAM_ID)) {
                role = 'TOKEN_2022_PROGRAM';
            } else if (pubkey.equals(config.ASSOCIATED_TOKEN_PROGRAM_ID)) {
                role = 'ASSOCIATED_TOKEN_PROGRAM';
            } else if (pubkey.equals(config.SYSTEM_PROGRAM_ID)) {
                role = 'SYSTEM_PROGRAM';
            } else if (pubkey.toString() === inputMint) {
                role = 'INPUT_MINT';
            } else if (pubkey.toString() === outputMint) {
                role = 'OUTPUT_MINT';
            } else {
                role = 'PLATFORM_OR_PDA'; // DEX-specific accounts, PDAs, etc.
            }
            
            return {
                pubkey: account.pubkey, // Keep as string for consistency
                role: role,
                isSigner: account.isSigner,
                isWritable: account.isWritable,
                index: index
            };
        });
        
        // Create the final blueprint
        const blueprint = {
            programId: coreInstructionResult.programId,
            accounts: annotatedAccounts,
            data: coreInstructionResult.data,
            metadata: {
                inputMint,
                outputMint,
                traderWallet: traderPk.toBase58(),
                totalAccounts: annotatedAccounts.length
            }
        };
        
        console.log(`[BLUEPRINT-CREATOR] ✅ Blueprint created with ${annotatedAccounts.length} annotated accounts`);
        console.log(`[BLUEPRINT-CREATOR] 📋 Account roles:`, annotatedAccounts.map(acc => `${acc.role}(${acc.index})`).join(', '));
        
        return blueprint;
    }
    
    /**
     * Find the core swap instruction signed by the trader - the heart of the Universal Cloning Engine
     * This method implements the "Detective" logic to identify the exact instruction to clone
     */
    _findCoreSwapInstruction(transactionResponse, traderPublicKey) {
        console.log(`[ANALYZER-V2] 🔍 Searching for core swap instruction using advanced CPI detection...`);
        const { transaction, meta } = transactionResponse;
        const traderPk = new PublicKey(traderPublicKey);

        // Get all account keys from the transaction message - handle both legacy and versioned transactions
        let accountKeysFromMessage;
        if (transaction.message.accountKeys) {
            // Legacy transaction
            accountKeysFromMessage = transaction.message.accountKeys.map(k => new PublicKey(k));
        } else if (transaction.message.staticAccountKeys) {
            // Versioned transaction
            accountKeysFromMessage = transaction.message.staticAccountKeys.map(k => new PublicKey(k));
                                } else {
            // Try to get account keys using the getAccountKeys method
            try {
                const accountKeys = transaction.message.getAccountKeys();
                accountKeysFromMessage = [];
                for (let i = 0; i < accountKeys.length; i++) {
                    accountKeysFromMessage.push(accountKeys.get(i));
                }
            } catch (error) {
                console.error('[ANALYZER-V2] ❌ Could not extract account keys from transaction:', error.message);
                return null;
            }
        }

        // Address Lookup Tables (ATL) are critical for complex transactions
        // We need to resolve all possible accounts - create a simple account resolver
        const allAccountKeys = [...accountKeysFromMessage];
        
        // Add loaded addresses from ATL if available
        if (meta && meta.loadedAddresses) {
            if (meta.loadedAddresses.writable) {
                allAccountKeys.push(...meta.loadedAddresses.writable.map(k => new PublicKey(k)));
            }
            if (meta.loadedAddresses.readonly) {
                allAccountKeys.push(...meta.loadedAddresses.readonly.map(k => new PublicKey(k)));
            }
        }
        
        // Create a simple account resolver that mimics getAccountKeys behavior
        const accountMeta = {
            get: (index) => {
                if (index >= 0 && index < allAccountKeys.length) {
                    return allAccountKeys[index];
                }
                return null;
            }
        };

        console.log(`[ANALYZER-V2] 📊 Transaction has ${allAccountKeys.length} accounts and ${transaction.message.instructions.length} instructions`);
        
        // Find trader's account index
        const traderAccountIndex = accountKeysFromMessage.findIndex(pk => pk.equals(traderPk));
        if (traderAccountIndex === -1) {
            console.warn(`[ANALYZER-V2] ⚠️ Trader ${traderPk.toBase58()} not found in transaction accounts`);
            return null;
        }
        
        console.log(`[ANALYZER-V2] 👤 Trader found at account index: ${traderAccountIndex}`);
        
        // Helper to get program ID from instruction
        const getProgramId = (ix) => allAccountKeys[ix.programIdIndex];
        
        // Helper to check if a program is a known DEX/Router
        const isKnownPlatform = (programId) => {
            if (!programId) return false;
            const programIdStr = programId.toBase58();
            return this._identifyPlatform(programIdStr) !== null;
        };
        
        // System and utility programs to ignore
        const systemPrograms = new Set([
            '11111111111111111111111111111111', // System Program
            'ComputeBudget111111111111111111111111111111', // Compute Budget
            'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL', // Associated Token Program
            'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' // Token Program
        ]);
        
        // --- STRATEGY 1: Direct Call Detection (Trader signs the DEX instruction) ---
        console.log("[ANALYZER-V2] 🎯 Strategy 1: Checking for direct calls signed by the trader...");
        
        for (const [index, instruction] of transaction.message.instructions.entries()) {
            const programId = getProgramId(instruction);
            const programIdStr = programId.toBase58();
            
            // Skip system programs
            if (systemPrograms.has(programIdStr)) continue;
            
            // Check if trader is involved in this instruction
            const isTraderInvolved = instruction.accounts && instruction.accounts.includes(traderAccountIndex);
            
            if (isTraderInvolved && isKnownPlatform(programId)) {
                console.log(`[ANALYZER-V2] ✅ SUCCESS (Direct Call): Found instruction ${index} for ${programIdStr.substring(0, 8)}... signed by trader.`);
                return this._packageInstructionForCloning(instruction, transaction, meta, allAccountKeys, programIdStr);
            }
        }
        
        // --- STRATEGY 2: Router CPI Detection (Trader signs Router, Router calls DEX) ---
        console.log("[ANALYZER-V2] 🔄 Strategy 2: Checking for Router CPI patterns...");
        
        for (const [outerIndex, outerInstruction] of transaction.message.instructions.entries()) {
            // Check if trader signed this outer instruction
            const isTraderSignedOuter = outerInstruction.accounts && outerInstruction.accounts.includes(traderAccountIndex);
            if (!isTraderSignedOuter) continue;
            
            const outerProgramId = getProgramId(outerInstruction);
            const outerProgramIdStr = outerProgramId.toBase58();
            
            // Skip system programs for outer instruction too
            if (systemPrograms.has(outerProgramIdStr)) continue;
            
            console.log(`[ANALYZER-V2] 🔍 Outer instruction ${outerIndex} signed by trader: ${outerProgramIdStr.substring(0, 8)}...`);
            
            // Find the inner instructions triggered by this outer instruction
            const innerInstructionGroup = (meta.innerInstructions || []).find(group => group.index === outerIndex);
            if (!innerInstructionGroup) {
                console.log(`[ANALYZER-V2] ⏭️ No inner instructions for outer instruction ${outerIndex}`);
                continue;
            }
            
            console.log(`[ANALYZER-V2] 🔍 Found ${innerInstructionGroup.instructions.length} inner instructions for outer ${outerIndex}`);
            
            // Search inner instructions for known DEX calls
            for (const [innerIndex, innerInstruction] of innerInstructionGroup.instructions.entries()) {
                const innerProgramId = getProgramId(innerInstruction);
                const innerProgramIdStr = innerProgramId.toBase58();
                
                // Skip system programs in inner instructions too
                if (systemPrograms.has(innerProgramIdStr)) continue;
                
                if (isKnownPlatform(innerProgramId)) {
                    console.log(`[ANALYZER-V2] ✅ SUCCESS (Router CPI): Found inner instruction ${innerIndex} for ${innerProgramIdStr.substring(0, 8)}... triggered by trader's signed call.`);
                    return this._packageInstructionForCloning(innerInstruction, transaction, meta, allAccountKeys, innerProgramIdStr);
                }
            }
        }
        
        // --- STRATEGY 3: Fallback - Use the old heuristic for unknown patterns ---
        console.log("[ANALYZER-V2] 🔄 Strategy 3: Fallback to best candidate heuristic...");
        
        const candidateInstructions = [];
        
        for (const instruction of transaction.message.instructions) {
            // Find which account pubkey corresponds to the trader in this instruction
            const isSignerPresent = instruction.accounts.some(accountIndex => {
                const accountPubkey = accountMeta.get(accountIndex);
                return accountPubkey && accountPubkey.equals(traderPk);
            });

            // The instruction must actually have the trader's key AND that key must be a signer in the transaction header
            const isTraderSignerInHeader = traderAccountIndex >= 0 && traderAccountIndex < transaction.message.header.numRequiredSignatures;

            if (isSignerPresent && isTraderSignerInHeader) {
                const programId = allAccountKeys[instruction.programIdIndex];
                const programIdStr = programId.toBase58();
                
                // Skip system programs
                if (systemPrograms.has(programIdStr)) continue;
                
                // Create candidate instruction
                const candidate = {
                    programId: programId,
                    programIdStr: programIdStr,
                    instruction: instruction,
                    instructionIndex: transaction.message.instructions.indexOf(instruction),
                    accountCount: instruction.accounts.length
                };
                
                candidateInstructions.push(candidate);
            }
        }

        if (candidateInstructions.length === 0) {
            console.warn(`[ANALYZER-V2] ❌ All strategies failed. Could not find a core swap instruction.`);
            return null;
        }

        // Sort candidates by priority: More accounts first, then later instructions
        candidateInstructions.sort((a, b) => {
            if (a.accountCount !== b.accountCount) {
                return b.accountCount - a.accountCount; // More accounts first
            }
            return b.instructionIndex - a.instructionIndex; // Later instructions first
        });

        const bestCandidate = candidateInstructions[0];
        console.log(`[ANALYZER-V2] ✅ SUCCESS (Fallback): Using best candidate instruction.`);
        console.log(`[ANALYZER-V2]   -> Program ID: ${bestCandidate.programIdStr.substring(0, 8)}...`);
        console.log(`[ANALYZER-V2]   -> Instruction Index: ${bestCandidate.instructionIndex}`);
        console.log(`[ANALYZER-V2]   -> Account Count: ${bestCandidate.accountCount}`);
        console.log(`[ANALYZER-V2]   -> Candidates Found: ${candidateInstructions.length}`);

        return this._packageInstructionForCloning(bestCandidate.instruction, transaction, meta, allAccountKeys, bestCandidate.programIdStr);
    }
    
    // NEW HELPER to consistently package the result
    _packageInstructionForCloning(instruction, transaction, meta, allAccountKeys, programIdStr) {
        // Build the accounts array for this instruction
        const accounts = instruction.accounts.map(accountIndex => {
            const pubkey = allAccountKeys[accountIndex];
            if (!pubkey) {
                throw new Error(`Failed to resolve account at index ${accountIndex}. Possible ATL issue.`);
            }
            
            // Determine signer and writable status using transaction header
            const header = transaction.message.header;
            
            // Determine if account is signer
            const isSigner = accountIndex < header.numRequiredSignatures;
            
            // Determine if account is writable
            const numSigners = header.numRequiredSignatures;
            const numReadonlySigners = header.numReadonlySignedAccounts;
            const numWritableSigners = numSigners - numReadonlySigners;
            
            let isWritable;
            if (accountIndex < numWritableSigners) {
                // Writable signer
                isWritable = true;
            } else if (accountIndex < numSigners) {
                // Readonly signer
                isWritable = false;
            } else {
                // Unsigned account
                const totalAccounts = allAccountKeys.length;
                const numReadonlyUnsigned = header.numReadonlyUnsignedAccounts;
                const numWritableUnsigned = totalAccounts - numSigners - numReadonlyUnsigned;
                isWritable = (accountIndex - numSigners) < numWritableUnsigned;
            }
            
            return { 
                pubkey: pubkey.toBase58(),
                isSigner,
                isWritable
            };
        });
        
        // Package the instruction data properly
        let instructionData;
        if (typeof instruction.data === 'string') {
            instructionData = instruction.data; // Already Base58 encoded
        } else if (instruction.data instanceof Uint8Array || Buffer.isBuffer(instruction.data)) {
            instructionData = bs58.encode(instruction.data); // Encode to Base58
        } else {
            console.warn(`[ANALYZER-V2] ⚠️ Unexpected instruction data type: ${typeof instruction.data}`);
            instructionData = instruction.data.toString();
        }
        
        const platformInfo = this._identifyPlatform(programIdStr);
        
        console.log(`[ANALYZER-V2] ✅ SUCCESS: Packaged instruction for cloning.`);
        console.log(`[ANALYZER-V2]   -> Platform/Router Program ID: ${programIdStr.substring(0, 8)}...${programIdStr.substring(programIdStr.length - 8)} (${platformInfo?.name || 'Unknown'})`);
        console.log(`[ANALYZER-V2]   -> Accounts: ${accounts.length}`);
        console.log(`[ANALYZER-V2]   -> Data length: ${instructionData.length} chars`);
            
            return { 
            programId: programIdStr, // Keep as string for consistency with existing code
            accounts: accounts,
            data: instructionData
        };
    }
    
    /**
     * Identify platform based on program ID
     */
    _identifyPlatform(programIdStr) {
        if (!programIdStr) return null;
        
        // Check against known platform IDs from config
        const platforms = [
            { name: 'Jupiter V6', ids: [this.platformIds.JUPITER_V6] },
            { name: 'Pump.fun', ids: [this.platformIds.PUMP_FUN, this.platformIds.PUMP_FUN_AMM] },
            { name: 'Raydium V4', ids: [this.platformIds.RAYDIUM_V4] },
            { name: 'Raydium AMM V4', ids: [this.platformIds.RAYDIUM_AMM_V4] },
            { name: 'Raydium Launchpad', ids: [this.platformIds.RAYDIUM_LAUNCHPAD] },
            { name: 'Raydium CPMM', ids: [this.platformIds.RAYDIUM_CPMM] },
            { name: 'Raydium CLMM', ids: [this.platformIds.RAYDIUM_CLMM] },
            { name: 'Meteora DLMM', ids: [this.platformIds.METEORA_DLMM] },
            { name: 'Meteora DBC', ids: this.platformIds.METEORA_DBC || [] },
            { name: 'Meteora CP-AMM', ids: [this.platformIds.METEORA_CP_AMM] },
            { name: 'Jupiter Aggregator', ids: [this.platformIds['Jupiter Aggregator']] },
            { name: 'Photon Router', ids: [this.platformIds.PHOTON] },
            { name: 'Axiom', ids: [this.platformIds.AXIOM] }
        ];
        
        for (const platform of platforms) {
            if (!platform.ids) continue;
            
            const ids = Array.isArray(platform.ids) ? platform.ids : [platform.ids];
            for (const id of ids) {
                if (id && id.toBase58 && id.toBase58() === programIdStr) {
                    return { name: platform.name, programId: programIdStr };
                }
            }
        }
        
        return null;
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
            { ids: [this.platformIds.PUMP_FUN], name: 'Pump.fun', priority: 1 },
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
        if (key === 'PUMP_FUN') return 'Pump.fun';

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
                        discriminator.equals(config.PUMP_FUN_SELL_DISCRIMINATOR)) {
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
                        
                        // Create cloning target with proper account structure
                        const message = transactionResponse.transaction.message;
                        const allAccountKeys = message.accountKeys || [];
                        
                        // Build properly structured accounts array
                        const accountsForCloning = instruction.accounts.map(accountIndex => {
                            const pubkey = allAccountKeys[accountIndex];
                            const header = message.header;
                            
                            // Determine if account is signer
                            const isSigner = accountIndex < header.numRequiredSignatures;
                            
                            // Determine if account is writable
                            const numSigners = header.numRequiredSignatures;
                            const numReadonlySigners = header.numReadonlySignedAccounts;
                            const numWritableSigners = numSigners - numReadonlySigners;
                            
                            let isWritable;
                            if (accountIndex < numWritableSigners) {
                                // Writable signer
                                isWritable = true;
                            } else if (accountIndex < numSigners) {
                                // Readonly signer
                                isWritable = false;
                            } else {
                                // Unsigned account
                                const totalAccounts = allAccountKeys.length;
                                const numReadonlyUnsigned = header.numReadonlyUnsignedAccounts;
                                const numWritableUnsigned = totalAccounts - numSigners - numReadonlyUnsigned;
                                isWritable = (accountIndex - numSigners) < numWritableUnsigned;
                            }
                            
                            return {
                                pubkey: pubkey,
                                isSigner: isSigner,
                                isWritable: isWritable
                            };
                        });
                        
                        const cloningTarget = {
                            programId: programId,
                            accounts: accountsForCloning,
                            data: typeof instruction.data === 'string' ? instruction.data : bs58.encode(instruction.data), // CRITICAL FIX: Handle both string and Uint8Array data
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