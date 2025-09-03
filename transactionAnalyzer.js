// ==========================================
// ====== ZapBot TransactionAnalyzer (v4 - Enhanced Library Powered) ======
// ==========================================
// File: transactionAnalyzer.js
// Description: Uses the official Shyft parser library for maximum reliability.

const { Connection, PublicKey, LAMPORTS_PER_SOL, VersionedTransaction, TransactionMessage, MessageV0, Message, CompiledInstruction } = require('@solana/web3.js');
const { Buffer } = require('buffer'); // Explicitly import Buffer for clarity
const config = require('./config.js');
const { shortenAddress } = require('./utils.js');
const bs58 = require('bs58');
const BN = require('bn.js');
const bufferLayout = require('@solana/buffer-layout');
const { u64 } = bufferLayout;



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

        // Validate required platform IDs
        const requiredPlatformIds = ['RAYDIUM_V4', 'RAYDIUM_LAUNCHPAD', 'RAYDIUM_CPMM', 'RAYDIUM_CLMM',
            'PUMP_FUN', 'PUMP_FUN_VARIANT', 'PUMP_FUN_AMM', 'PHOTON', 'AXIOM',
            'METEORA_DBC', 'METEORA_DLMM', 'METEORA_CP_AMM', 'Jupiter Aggregator'];
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

        console.log(`[BalanceAnalysis] Trader ${shortenAddress(traderPkString)} SOL change: ${solChange / LAMPORTS_PER_SOL} SOL (Raw: ${solChange})`);

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

        const SOL_CHANGE_THRESHOLD_LAMPORTS = 100; // Very low threshold to catch all trades including those with minimal SOL changes
        console.log(`[BalanceAnalysis] SOL Change Threshold for swap detection: ${SOL_CHANGE_THRESHOLD_LAMPORTS} lamports.`);

        // Cases: SOL out, Token in (Buy); SOL in, Token out (Sell); Token-to-Token
        if (solChange < -SOL_CHANGE_THRESHOLD_LAMPORTS && tokenReceivedMint && tokenReceivedMint !== this.NATIVE_SOL_MINT) {
            console.log(`[BalanceAnalysis] ✅ BUY Detected (SOL out, Token in). SOL change: ${solChange}, Token received: ${shortenAddress(tokenReceivedMint)}`);
            return { isSwap: true, details: { tradeType: 'buy', inputMint: this.NATIVE_SOL_MINT, outputMint: tokenReceivedMint, inputAmountLamports: Math.abs(solChange), outputAmountRaw: tokenReceivedAmount.toString(), tokenDecimals: tokenDecimalsForChange } };
        }
        if (solChange > SOL_CHANGE_THRESHOLD_LAMPORTS && tokenSentMint && tokenSentMint !== this.NATIVE_SOL_MINT) {
            console.log(`[BalanceAnalysis] ✅ SELL Detected (SOL in, Token out). SOL change: ${solChange}, Token sent: ${shortenAddress(tokenSentMint)}`);
            return { isSwap: true, details: { tradeType: 'sell', inputMint: tokenSentMint, outputMint: this.NATIVE_SOL_MINT, inputAmountRaw: tokenSentAmount.toString(), outputAmountRaw: Math.abs(solChange).toString(), tokenDecimals: tokenDecimalsForChange } };
        }
        if (tokenReceivedMint && tokenSentMint && tokenReceivedMint !== this.NATIVE_SOL_MINT && tokenSentMint !== this.NATIVE_SOL_MINT) {
            console.log(`[BalanceAnalysis] ✅ TOKEN-TO-TOKEN SWAP Detected (Token out, Token in). Token sent: ${shortenAddress(tokenSentMint)}, Token received: ${shortenAddress(tokenReceivedMint)}`);
            return { isSwap: true, details: { tradeType: 'buy', inputMint: tokenSentMint, outputMint: tokenReceivedMint, inputAmountRaw: tokenSentAmount.toString(), outputAmountRaw: tokenReceivedAmount.toString(), tokenDecimals: tokenDecimalsForChange } };
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
        let transactionResponse = preFetchedTx;
        let isWebhookData = !!preFetchedTx;
    
        try {
            if (!transactionResponse) {
                console.log(`[ANALYZER] No pre-fetched data, fetching from RPC...`);
                transactionResponse = await this.connection.getParsedTransaction(signature, { maxSupportedTransactionVersion: 0 });
                if (!transactionResponse) throw new Error("RPC returned no result for transaction.");
            } else {
                console.log(`[ANALYZER] Using pre-fetched data, type: ${transactionResponse.type || 'unknown'}`);
            }
            
            if (!transactionResponse.meta || transactionResponse.meta.err) {
                console.log(`[ANALYZER] ❌ Transaction failed or lacks metadata:`, {
                    hasMeta: !!transactionResponse.meta,
                    hasError: !!transactionResponse.meta?.err,
                    error: transactionResponse.meta?.err
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
        const { meta } = transactionResponse;
        
        // SAFETY CHECK: Validate meta object exists
        if (!meta) {
            console.log(`[ANALYZER] ❌ Missing transaction metadata`);
            return { isCopyable: false, reason: "Transaction metadata missing", rawTransaction: transactionResponse };
        }
        const finalTraderPk = new PublicKey(traderPublicKey);
        
        // SAFETY CHECK: Validate transaction structure before accessing instructions
        if (!transactionResponse.transaction) {
            console.log(`[ANALYZER] ❌ Invalid transaction structure: missing transaction object`);
            return { isCopyable: false, reason: "Invalid transaction structure - transaction object missing", rawTransaction: transactionResponse };
        }
        
        if (!transactionResponse.transaction.message) {
            console.log(`[ANALYZER] ❌ Invalid transaction structure: missing message object`);
            return { isCopyable: false, reason: "Invalid transaction structure - message object missing", rawTransaction: transactionResponse };
        }
        
        const instructions = isWebhookData
            ? transactionResponse.transaction.instructions || []
            : transactionResponse.transaction.message.instructions || [];
        
        // VALIDATION: Ensure instructions is an array
        if (!Array.isArray(instructions)) {
            console.log(`[ANALYZER] ❌ Invalid instructions structure:`, {
                hasTransaction: !!transactionResponse.transaction,
                hasMessage: !!transactionResponse.transaction?.message,
                instructionsType: typeof instructions,
                isArray: Array.isArray(instructions),
                instructionsValue: instructions
            });
            return { isCopyable: false, reason: "Invalid transaction structure - instructions not found or not an array", rawTransaction: transactionResponse };
        }
        
        const rawAccountKeys = transactionResponse.transaction.message.accountKeys;
        
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
        // ========== STAGE 3: CORE ANALYSIS ===============
        // ===============================================
        console.log(`[ANALYZER] 🔍 Starting core analysis...`);
        
        let balanceAnalysis;
        try {
            balanceAnalysis = this.analyzeBalanceChangesInternal(meta, accountKeys, finalTraderPk);
            console.log(`[ANALYZER] Balance analysis result:`, balanceAnalysis);
        } catch (error) {
            console.error(`[ANALYZER] ❌ Balance analysis failed:`, error);
            balanceAnalysis = { isSwap: false, reason: `Balance analysis error: ${error.message}` };
        }
    
        let instructionAnalysis = {
            found: false,
            dexPlatform: 'Unknown DEX',
            platformProgramId: null,
            platformSpecificData: {}
        };
    
        // VITAL UPGRADE: Combine outer and inner instructions for a full analysis
        let allInstructions = [...instructions];
        
        // SAFELY process inner instructions if they exist
        if (meta.innerInstructions && Array.isArray(meta.innerInstructions)) {
            try {
                const innerInstructions = meta.innerInstructions.flatMap(i => i.instructions || []);
                allInstructions = [...allInstructions, ...innerInstructions];
            } catch (error) {
                console.log(`[ANALYZER] ⚠️ Error processing inner instructions:`, error.message);
                // Continue with just the outer instructions
            }
        }
        
        if (config.LOG_LEVEL === 'debug') {
            console.log(`[ANALYZER] 🔍 Analyzing ${allInstructions.length} instructions for DEX programs...`);
        }
        
        // SAFETY CHECK: Ensure we have instructions to analyze
        if (allInstructions.length === 0) {
            if (config.LOG_LEVEL === 'debug') {
                console.log(`[ANALYZER] ⚠️ No instructions found to analyze`);
            }
            instructionAnalysis = { 
                found: false, 
                dexPlatform: 'Unknown DEX', 
                reason: 'No instructions found in transaction' 
            };
        } else {
            try {
                for (const ix of allInstructions) {
                    const programId = this._resolveProgramId(ix, accountKeys);
                    if (!programId) {
                        if (config.LOG_LEVEL === 'debug') {
                            console.log(`[ANALYZER] ⚠️ Could not resolve program ID for instruction:`, ix);
                        }
                        continue;
                    }
                    
                    if (config.LOG_LEVEL === 'debug') {
                        console.log(`[ANALYZER] 📋 Instruction program ID: ${shortenAddress(programId.toBase58())}`);
                    }
            
                    // Find which known DEX program this instruction calls
                    const platformMatch = Object.entries(this.platformIds).find(([name, pId]) => {
                        if (Array.isArray(pId)) return pId.some(id => id.equals(programId));
                        if (pId instanceof PublicKey) return pId.equals(programId);
                        return false;
                    });
            
                    if (platformMatch) {
                        console.log(`[ANALYZER] ✅ Found DEX: ${this._mapConfigKeyToPlatformName(platformMatch[0])}`);
                        instructionAnalysis.found = true;
                        instructionAnalysis.dexPlatform = this._mapConfigKeyToPlatformName(platformMatch[0]);
                        instructionAnalysis.platformProgramId = programId.toBase58();
                        
                        // Extract more details if it's a Raydium Launchpad trade
                        if (instructionAnalysis.dexPlatform === 'Raydium Launchpad' && ix.accounts.length > 6) {
                            instructionAnalysis.platformSpecificData = {
                                poolId: ix.accounts[2]?.toBase58(),
                                configId: '4K3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3Q2xqcV' // This is a global constant for Launchpad
                            };
                        }
                        break; // Found the primary DEX instruction, we can stop searching.
                    } else if (config.LOG_LEVEL === 'debug') {
                        console.log(`[ANALYZER] ❌ No platform match found for program ID: ${shortenAddress(programId.toBase58())}`);
                    }
                }
            } catch (error) {
                console.error(`[ANALYZER] ❌ Instruction analysis failed:`, error);
                instructionAnalysis = { found: false, dexPlatform: 'Unknown DEX', reason: `Instruction analysis error: ${error.message}` };
            }
        }
        
                // --- COMBINE RESULTS ---
                if (config.LOG_LEVEL === 'debug') {
                    console.log(`[ANALYZER] 📊 Analysis Summary:`);
                    console.log(`[ANALYZER]   - Balance Analysis: ${balanceAnalysis.isSwap ? '✅ SWAP DETECTED' : '❌ No swap'}`);
                    console.log(`[ANALYZER]   - Instruction Analysis: ${instructionAnalysis.found ? '✅ DEX FOUND' : '❌ No DEX'}`);
                    console.log(`[ANALYZER]   - Balance Details:`, balanceAnalysis.details || 'None');
                    console.log(`[ANALYZER]   - Instruction Details:`, instructionAnalysis);
                }
        
                // --- NEW DECISION LOGIC ---
                let swapDetails = {};
                
                // CASE 1: BOTH AGREE - The perfect scenario
                if (balanceAnalysis.isSwap && instructionAnalysis.found) {
                    console.log(`[ANALYZER] 🤝 Consensus found between Balance and Instruction analysis.`);
                    swapDetails = {
                        ...instructionAnalysis,
                        ...balanceAnalysis.details // Balance analysis provides the definitive mints and amounts
                    };
                } 
                // CASE 2: INSTRUCTION-ONLY - Balance analysis failed (e.g., complex Meteora tx), but we KNOW the platform.
                else if (instructionAnalysis.found && !balanceAnalysis.isSwap) {
                    console.log(`[ANALYZER] ⚠️ Instruction-only match. Attempting to derive swap details...`);
                    // Attempt to extract swap details directly from the transaction metadata.
                    const derivedDetails = this._deriveDetailsFromMetadata(meta, traderPublicKey);
                    if (derivedDetails.isSwap) {
                         swapDetails = {
                            ...instructionAnalysis,
                            ...derivedDetails.details // Use derived details as a fallback
                        };
                         console.log(`[ANALYZER] ✅ Successfully derived swap details from metadata.`);
                    } else {
                         console.log(`[ANALYZER] ❌ Could not derive swap details for instruction-only match.`);
                         return { isCopyable: false, reason: `Known DEX found (${instructionAnalysis.dexPlatform}), but couldn't confirm swap details from balance changes.`, rawTransaction: transactionResponse };
                    }
                } 
                // CASE 3: BALANCE-ONLY - Instruction was unknown (e.g., new router), but balances clearly changed.
                else if (balanceAnalysis.isSwap && !instructionAnalysis.found) {
                     console.log(`[ANALYZER] ⚠️ Balance-only match. Heuristic required for platform identification.`);
                     // In a future version, you could add a heuristic here. For now, we'll call it uncopyable.
                     return { isCopyable: false, reason: `Clear swap detected, but the DEX program is unknown.`, rawTransaction: transactionResponse };
                }
                // CASE 4: BOTH FAILED
                else {
                    return { isCopyable: false, reason: `Balance analysis failed AND no known DEX instruction was found.`, rawTransaction: transactionResponse };
                }
                
                console.log(`[ANALYZER] 🔄 Finalized swap details:`, swapDetails);
    
        // ===============================================
        // ======== STAGE 4: FINAL DECISION LOGIC ==========
        // ===============================================
        if (!swapDetails.tradeType || !swapDetails.dexPlatform || swapDetails.dexPlatform === 'Unknown DEX' || !swapDetails.outputMint) {
            console.log(`[ANALYZER] ❌ Analysis incomplete. Missing:`, {
                tradeType: !!swapDetails.tradeType,
                dexPlatform: !!swapDetails.dexPlatform,
                platformValid: swapDetails.dexPlatform !== 'Unknown DEX',
                outputMint: !!swapDetails.outputMint
            });
            return { isCopyable: false, reason: `Analysis incomplete. Could not determine trade type, platform, or token. Platform Found: ${swapDetails.dexPlatform}`, rawTransaction: transactionResponse };
        }
    
        const finalDetails = {
            ...swapDetails,
            traderPubkey: finalTraderPk.toBase58()
        };
        
        // Create clean summary instead of logging raw data
        const tradeSummary = this._createTradeSummary(finalDetails, transactionResponse);
        console.log(`[ANALYZER] 🎉 SUCCESS! ${tradeSummary}`);
        
        return {
            isCopyable: true,
            reason: `Trade detected on ${finalDetails.dexPlatform}.`,
            rawTransaction: config.LOG_LEVEL === 'debug' ? transactionResponse : null, // Only include raw data in debug mode
            details: finalDetails,
            summary: tradeSummary
        };
    }
    
    _resolveProgramId(instruction, allAccountKeys) {
        try {
            if (instruction.programIdIndex !== undefined && allAccountKeys?.[instruction.programIdIndex]) {
                return allAccountKeys[instruction.programIdIndex];
            }
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

        // 2️⃣ Define Known Inner Programs
        const knownInnerPrograms = [
            // --- Pump.fun ---
            { ids: [this.platformIds.PUMP_FUN, this.platformIds.PUMP_FUN_VARIANT], name: 'Pump.fun' },
            { ids: [this.platformIds.PUMP_FUN_AMM], name: 'Pump.fun AMM' },
            // --- Raydium ---
            { ids: [this.platformIds.RAYDIUM_LAUNCHPAD], name: 'Raydium Launchpad' },
            { ids: [this.platformIds.RAYDIUM_V4], name: 'Raydium V4' },
            { ids: [this.platformIds.RAYDIUM_CLMM], name: 'Raydium CLMM' },
            { ids: [this.platformIds.RAYDIUM_CPMM], name: 'Raydium CPMM' },
            // --- Meteora ---
            { ids: [this.platformIds.METEORA_DLMM], name: 'Meteora DLMM' },
            ...(Array.isArray(this.platformIds.METEORA_DBC)
                ? this.platformIds.METEORA_DBC.map(id => ({ ids: [id], name: 'Meteora DBC' }))
                : []
            ),
            { ids: [this.platformIds.METEORA_CP_AMM], name: 'Meteora CP Amm' },
            // --- Jupiter ---
            { ids: [this.platformIds['Jupiter Aggregator']], name: 'Jupiter Aggregator' }
        ].filter(p => p.ids?.length);

        // 3️⃣ Scan Inner Instructions
        for (const innerParsedIx of parsedInstructions) {
            const innerProgramId = new PublicKey(innerParsedIx.programId);
            if (!innerProgramId) continue;

            for (const program of knownInnerPrograms) {

                // <<<<< START OF MIGRATION-AWARE LOGIC >>>>>
                if (program.ids.some(id => id instanceof PublicKey && id.equals(innerProgramId))) {
                    console.log(`[Parser] ✅ ${routerName} routed to: ${program.name}`);

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
                        originalPlatform: program.name // Keep track of where it came from
                    } : {
                        ...generalBalanceAnalysis.details,
                        dexPlatform: program.name,
                        platformProgramId: innerProgramId
                    };

                    return {
                        isCopyable: true,
                        reason: `${routerName} via ${finalDetails.dexPlatform} detected.${isMigrated ? ' (MIGRATED)' : ''}`,
                        details: finalDetails
                    };
                }
                // <<<<< END OF MIGRATION-AWARE LOGIC >>>>>
            }
        }

        // 4️⃣ Fallback: Router detected but unknown inner route
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
        if (key === 'PUMP_FUN' || key === 'PUMP_FUN_VARIANT') return 'Pump.fun BC'; // Specify BC for Bonding Curve

        if (key.includes('RAYDIUM_LAUNCHPAD')) return 'Raydium Launchpad';
        if (key.includes('RAYDIUM_V4')) return 'Raydium AMM';
        if (key.includes('RAYDIUM_CLMM')) return 'Raydium CLMM';
        if (key.includes('RAYDIUM_CPMM')) return 'Raydium CPMM';
        if (key.includes('METEORA_DLMM')) return 'Meteora DLMM';
        if (key.includes('METEORA_DBC')) return 'Meteora DBC';
        if (key.includes('METEORA_CP_AMM')) return 'Meteora CP-AMM';
        if (key.includes('Jupiter')) return 'Jupiter Aggregator';
        
        return 'Unknown DEX';
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

    // ===============================================
    // ========== NOISE FILTERING METHODS ===========
    // ===============================================
    
    /**
     * Pre-filter to identify and skip noise transactions that are clearly not trades
     */
    _isNoiseTransaction(transactionData) {
        try {
            // Quick checks for common noise patterns
            if (!transactionData?.transaction?.message?.instructions) {
                return false; // Can't analyze, let it through
            }

            const instructions = transactionData.transaction.message.instructions;
            const accountKeys = transactionData.transaction.message.accountKeys || [];
            const logMessages = transactionData.meta?.logMessages || [];

            // 1. Only ComputeBudget + System program calls (account creation/transfers)
            const hasOnlySystemPrograms = instructions.every(ix => {
                const programId = this._resolveProgramId(ix, accountKeys);
                if (!programId) return false;
                let programIdStr;
                try {
                    programIdStr = typeof programId === 'string' ? programId : programId.toBase58();
                } catch (error) {
                    console.log(`[NOISE-FILTER] Error converting programId to string: ${error.message}`);
                    return false;
                }
                return programIdStr === 'ComputeBudget111111111111111111111111111111' ||
                       programIdStr === '11111111111111111111111111111111' ||
                       programIdStr === 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';
            });

            // 2. Token account creation pattern (ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL)
            const isTokenAccountCreation = logMessages.some(log => 
                log.includes('Initialize the associated token account') ||
                log.includes('Program ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL')
            ) && !this._hasAnyDexProgram(accountKeys);

            // 3. Simple SOL transfer with minimal compute units
            const isSimpleTransfer = transactionData.meta?.computeUnitsConsumed < 5000 &&
                                   instructions.length <= 3 &&
                                   hasOnlySystemPrograms;

            // 4. Very small SOL amounts (dust transactions)
            const hasMinimalSOLMovement = this._hasMinimalSOLMovement(transactionData);

            return hasOnlySystemPrograms || isTokenAccountCreation || 
                   (isSimpleTransfer && hasMinimalSOLMovement);

        } catch (error) {
            console.log(`[NOISE-FILTER] Error checking noise: ${error.message}`);
            return false; // If we can't determine, let it through
        }
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
                    programIdStr = typeof programId === 'string' ? programId : programId.toBase58();
                } catch (error) {
                    return false;
                }
                return programIdStr === 'ComputeBudget111111111111111111111111111111' ||
                       programIdStr === '11111111111111111111111111111111' ||
                       programIdStr === 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';
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
}

// CommonJS export
module.exports = { TransactionAnalyzer };