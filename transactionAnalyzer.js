// ==========================================
// ====== ZapBot TransactionAnalyzer (v4 - Enhanced Library Powered) ======
// ==========================================
// File: transactionAnalyzer.js
// Description: Uses the official Shyft parser library for maximum reliability.

const { Connection, PublicKey, LAMPORTS_PER_SOL, VersionedTransaction, TransactionMessage, MessageV0, Message, CompiledInstruction } = require('@solana/web3.js');
const { Buffer } = require('buffer'); // Explicitly import Buffer for clarity
const config = require('./patches/config.js');
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

// Function to sanitize addresses - also correct as a function outside class
function sanitizeAddress(addr) {
    try {
        new PublicKey(addr);
        return true;
    } catch {
        return false;
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

        if (traderIndex === -1) {
            console.log(`[BalanceAnalysis] Trader (${shortenAddress(traderPkString)}) not found in transaction accounts. All account keys: ${accountKeys.map(k => shortenAddress(k.toBase58())).join(', ')}`);
            return { isSwap: false, reason: 'Trader not found in transaction accounts.' };
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
            console.log(`[BalanceAnalysis] Pre-Token ${shortenAddress(balance.mint)}: -${amount.toString()} (Owner: ${shortenAddress(balance.owner)})`);
        });

        traderPostTokenBalances.forEach(balance => {
            const amount = BigInt(balance.uiTokenAmount.amount);
            tokenChanges.set(balance.mint, (tokenChanges.get(balance.mint) || 0n) + amount);
            console.log(`[BalanceAnalysis] Post-Token ${shortenAddress(balance.mint)}: +${amount.toString()} (Owner: ${shortenAddress(balance.owner)})`);
        });

        console.log('[BalanceAnalysis] Final Token Changes Map:', Array.from(tokenChanges.entries()).map(([mint, change]) => `${shortenAddress(mint)}: ${change.toString()}`));


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

        const SOL_CHANGE_THRESHOLD_LAMPORTS = 5000;
        console.log(`[BalanceAnalysis] SOL Change Threshold for swap detection: ${SOL_CHANGE_THRESHOLD_LAMPORTS} lamports.`);

        // Cases: SOL out, Token in (Buy); SOL in, Token out (Sell); Token-to-Token
        if (solChange < -SOL_CHANGE_THRESHOLD_LAMPORTS && tokenReceivedMint && tokenReceivedMint !== this.NATIVE_SOL_MINT) {
            console.log(`[BalanceAnalysis] Result: BUY Detected (SOL out, Token in).`);
            return { isSwap: true, details: { tradeType: 'buy', inputMint: this.NATIVE_SOL_MINT, outputMint: tokenReceivedMint, inputAmountLamports: Math.abs(solChange), outputAmountRaw: tokenReceivedAmount.toString(), tokenDecimals: tokenDecimalsForChange } };
        }
        if (solChange > SOL_CHANGE_THRESHOLD_LAMPORTS && tokenSentMint && tokenSentMint !== this.NATIVE_SOL_MINT) {
            console.log(`[BalanceAnalysis] Result: SELL Detected (SOL in, Token out).`);
            return { isSwap: true, details: { tradeType: 'sell', inputMint: tokenSentMint, outputMint: this.NATIVE_SOL_MINT, inputAmountRaw: tokenSentAmount.toString(), outputAmountRaw: Math.abs(solChange).toString(), tokenDecimals: tokenDecimalsForChange } };
        }
        if (tokenReceivedMint && tokenSentMint && tokenReceivedMint !== this.NATIVE_SOL_MINT && tokenSentMint !== this.NATIVE_SOL_MINT) {
            console.log(`[BalanceAnalysis] Result: TOKEN-TOKEN SWAP Detected (Token out, Token in).`);
            return { isSwap: true, details: { tradeType: 'buy', inputMint: tokenSentMint, outputMint: tokenReceivedMint, inputAmountRaw: tokenSentAmount.toString(), outputAmountRaw: tokenReceivedAmount.toString(), tokenDecimals: tokenDecimalsForChange } };
        }

        console.log(`[BalanceAnalysis] Result: No clear swap pattern detected based on SOL/Token movements.`);
        console.log(`SOL Change: ${solChange} (Threshold: ${SOL_CHANGE_THRESHOLD_LAMPORTS})`);
        console.log(`Received Mint: ${tokenReceivedMint ? shortenAddress(tokenReceivedMint) : 'N/A'}, Amount: ${tokenReceivedAmount.toString()}`);
        console.log(`Sent Mint: ${tokenSentMint ? shortenAddress(tokenSentMint) : 'N/A'}, Amount: ${tokenSentAmount.toString()}`);
        return { isSwap: false, reason: 'No clear swap balance change pattern detected.' };
    }


    // --- MAIN TRANSACTION ANALYSIS FUNCTION ---

    async analyzeTransactionForCopy(signature, transactionResponse, traderPublicKey) {
    console.log(`[HYBRID_ANALYZER] Processing sig: ${signature}`);

    let fetchedTxn = null;
    let isParsed = false;
    let rawTransactionJson = null;

    try {
        const rpcEndpoint = this.connection.rpcEndpoint;
        const response = await fetch(rpcEndpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                jsonrpc: '2.0', id: 1, method: 'getTransaction',
                params: [signature, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0, commitment: 'confirmed' }]
            }),
        });
        const jsonResponse = await response.json();
        if (jsonResponse.error) throw new Error(`jsonParsed fetch failed: ${jsonResponse.error.message}`);
        if (!jsonResponse.result) throw new Error("RPC did not return a result for transaction.");
        
        fetchedTxn = jsonResponse.result;
        rawTransactionJson = { ...jsonResponse.result };
        isParsed = true;
        console.log(`[HYBRID_ANALYZER] ✅ Successfully decoded with jsonParsed.`);

    } catch (error) {
        console.error(`[HYBRID_ANALYZER] CRITICAL: Failed to fetch transaction ${signature}: ${error.message}`);
        return { 
            isCopyable: false, 
            reason: `Fatal error during transaction fetch: ${error.message}`,
            rawTransaction: { error: `Fatal error during transaction fetch: ${error.message}` } 
        };
    }

    if (!fetchedTxn || !fetchedTxn.meta) {
         return { isCopyable: false, reason: "Transaction data is missing metadata.", rawTransaction: rawTransactionJson };
    }

    // --- Data Normalization ---
    const meta = fetchedTxn.meta;
    const messageData = fetchedTxn.transaction.message;
    const allAccountKeys = messageData.accountKeys.map(k => new PublicKey(k.pubkey));
    const mainSigner = allAccountKeys[0];
    
    if (!mainSigner) {
        return { isCopyable: false, reason: "Unable to identify transaction signer.", rawTransaction: rawTransactionJson };
    }
    
    const finalTraderPk = traderPublicKey ? new PublicKey(traderPublicKey) : mainSigner;
    const instructionsToParse = messageData.instructions;

    // --- Core Balance Analysis ---
    const generalBalanceAnalysis = this.analyzeBalanceChangesInternal(meta, allAccountKeys, finalTraderPk);
    let copyDetails = null;

    // ===== [START] Platform Identification Block ===== //
    for (const ix of instructionsToParse) {
        const programId = isParsed 
            ? new PublicKey(ix.programId)
            : this._resolveProgramId(ix, allAccountKeys);

        if (!programId || copyDetails) continue;

        const programIdStr = programId.toBase58();
        const platformIds = this.platformIds;
        const accountKeysForIx = isParsed ? (ix.accounts || []).map(a => new PublicKey(a)) : allAccountKeys;
        const accountIndexes = isParsed ? null : ix.accountKeyIndexes;

        switch (true) {
            // PUMP.FUN
            case programIdStr === platformIds.PUMP_FUN.toBase58() || programIdStr === platformIds.PUMP_FUN_VARIANT.toBase58():
                copyDetails = { dexPlatform: 'Pump.fun', platformProgramId: programId };
                console.log(`[Analyzer] ✅ Direct Hit: Pump.fun (BC)`);
                break;
            case programIdStr === platformIds.PUMP_FUN_AMM.toBase58():
                copyDetails = { dexPlatform: 'Pump.fun AMM', platformProgramId: programId };
                console.log(`[Analyzer] ✅ Direct Hit: Pump.fun (AMM)`);
                break;

            // RAYDIUM
            case programIdStr === platformIds.RAYDIUM_LAUNCHPAD.toBase58(): {
                const poolId = isParsed ? accountKeysForIx[4]?.toBase58() : accountKeysForIx[accountIndexes[4]]?.toBase58();
                const configId = isParsed ? accountKeysForIx[3]?.toBase58() : accountKeysForIx[accountIndexes[3]]?.toBase58();
                if (poolId && configId) {
                    copyDetails = {
                        dexPlatform: 'Raydium Launchpad',
                        platformProgramId: programId,
                        platformSpecificData: { poolId, configId }
                    };
                    console.log(`[Analyzer] ✅ Direct Hit: Raydium Launchpad`);
                }
                break;
            }
            case programIdStr === platformIds.RAYDIUM_V4.toBase58():
                copyDetails = { dexPlatform: 'Raydium AMM', platformProgramId: programId };
                console.log(`[Analyzer] ✅ Direct Hit: Raydium AMM V4`);
                break;
            case programIdStr === platformIds.RAYDIUM_CLMM.toBase58(): {
                const poolId = isParsed ? accountKeysForIx[0]?.toBase58() : accountKeysForIx[accountIndexes[0]]?.toBase58();
                if (poolId) {
                    copyDetails = {
                        dexPlatform: 'Raydium CLMM',
                        platformProgramId: programId,
                        platformSpecificData: { poolId }
                    };
                    console.log(`[Analyzer] ✅ Direct Hit: Raydium CLMM`);
                }
                break;
            }
            case programIdStr === platformIds.RAYDIUM_CPMM.toBase58(): {
                const poolId = isParsed ? accountKeysForIx[3]?.toBase58() : accountKeysForIx[accountIndexes[3]]?.toBase58();
                if (poolId) {
                    copyDetails = {
                        dexPlatform: 'Raydium CPMM',
                        platformProgramId: programId,
                        platformSpecificData: { poolId }
                    };
                    console.log(`[Analyzer] ✅ Direct Hit: 'Raydium CPMM'`);
                }
                break;
            }

            // METEORA
            case programIdStr === platformIds.METEORA_DLMM.toBase58(): {
                const poolId = isParsed ? accountKeysForIx[0]?.toBase58() : accountKeysForIx[accountIndexes[0]]?.toBase58();
                if (poolId) {
                    copyDetails = {
                        dexPlatform: 'Meteora DLMM',
                        platformProgramId: programId,
                        platformSpecificData: { poolId }
                    };
                    console.log(`[Analyzer] ✅ Direct Hit: Meteora DLMM`);
                }
                break;
            }
            case (platformIds.METEORA_DBC || []).some(id => id.equals(programId)): {
                const poolId = isParsed ? accountKeysForIx[0]?.toBase58() : accountKeysForIx[accountIndexes[0]]?.toBase58();
                if (poolId) {
                    copyDetails = {
                        dexPlatform: 'Meteora DBC',
                        platformProgramId: programId,
                        platformSpecificData: { poolId }
                    };
                    console.log(`[Analyzer] ✅ Direct Hit: Meteora DBC`);
                }
                break;
            }
            case programIdStr === config.METEORA_CP_AMM_PROGRAM_ID.toBase58(): {
                const poolId = isParsed ? accountKeysForIx[0]?.toBase58() : accountKeysForIx[accountIndexes[0]]?.toBase58();
                if (poolId) {
                    copyDetails = {
                        dexPlatform: 'Meteora CP-AMM',
                        platformProgramId: programId,
                        platformSpecificData: { poolId }
                    };
                    console.log(`[Analyzer] ✅ Direct Hit: Meteora CP-AMM`);
                }
                break;
            }
            case programIdStr === this.platformIds['Jupiter Aggregator'].toBase58(): {
                copyDetails = {
                    dexPlatform: 'Jupiter Aggregator',
                    platformProgramId: programId,
                    platformSpecificData: {},
                };
                console.log(`[Analyzer] ✅ Direct Hit: Jupiter Aggregator trade detected.`);
                break;
            }
        }
    }
    // ===== [END] Platform Identification Block ===== //

    // ===== [START] Hardened Decision Matrix v2.0 ===== //
    if (!generalBalanceAnalysis.isSwap) {
        // Immediately abort for non-swap transactions
        return {
            isCopyable: false,
            reason: `Balance change analysis did not detect a valid swap.`,
            rawTransaction: rawTransactionJson,
            details: generalBalanceAnalysis.details
        };
    }

    // If it IS a swap, but we didn't find a direct platform hit...
    if (!copyDetails) {
        console.log(`[HYBRID_ANALYZER] No direct match. Engaging Quantum Heuristic...`);
        const heuristicResult = await this.runQuantumHeuristic(
            generalBalanceAnalysis.details,
            finalTraderPk.toBase58(),
            allAccountKeys,
            instructionsToParse,
            this.connection
        );
        
        if (heuristicResult.isCopyable) {
            copyDetails = { ...heuristicResult.details, dexPlatform: heuristicResult.details.dexPlatform };
        }
    }

    // Final determination based on all analysis
    if (copyDetails) {
        // Merge the confirmed swap data with the platform data we found
        const finalDetails = { 
            ...generalBalanceAnalysis.details, 
            ...copyDetails, 
            traderPubkey: finalTraderPk.toBase58() 
        };
        return { 
            isCopyable: true, 
            reason: `Trade detected on ${copyDetails.dexPlatform}.`, 
            rawTransaction: rawTransactionJson, 
            details: finalDetails 
        };
    }

    // Final fallback if no platform could be identified
    return {
        isCopyable: true,
        reason: `General swap detected, using Universal Swap.`,
        rawTransaction: rawTransactionJson,
        details: { 
            ...generalBalanceAnalysis.details, 
            dexPlatform: 'Unknown DEX', 
            traderPubkey: finalTraderPk.toBase58() 
        }
    };
    // ===== [END] Hardened Decision Matrix v2.0 ===== //
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

async runQuantumHeuristic(baseDetails, traderPublicKeyStr, allAccountKeys, parsedInstructions = [], connection) {
    try {
        const tokenMintString = baseDetails.tradeType === 'buy' ? baseDetails.outputMint : baseDetails.inputMint;
        if (!tokenMintString || tokenMintString === config.NATIVE_SOL_MINT) {
            return this._quantumResponse(false, 'Heuristic skipped: Not a token trade.', null, 0);
        }

        console.log(`[QUANTUM-V4] 🔍 Analyzing token: ${shortenAddress(tokenMintString)}`);

        // ---------------------------
        // Stage 1: Ultra-fast detection (Pump.fun first, then tokenInfo)
        // ---------------------------
        const fastChecks = await Promise.allSettled([
            this._checkPumpFunBondingCurve(tokenMintString, connection),
            this.apiManager.solanaTrackerApi.getTokenInfo(tokenMintString)
        ]);

        const [pumpBcResult, tokenInfoResult] = fastChecks;

        // ✅ Priority 1: Pump.fun active bonding curve
        if (pumpBcResult.status === 'fulfilled' && pumpBcResult.value && !pumpBcResult.value.isComplete) {
            return this._quantumResponse(true, 'Active Pump.fun bonding curve detected', {
                ...baseDetails, dexPlatform: 'Pump.fun'
            }, 100);
        }

        // ✅ Priority 2: Token info primary pool detection
        let primaryPool = null;
        if (tokenInfoResult.status === 'fulfilled' && tokenInfoResult.value?.pools?.length > 0) {
            primaryPool = tokenInfoResult.value.pools[0];
            const market = primaryPool.market?.toLowerCase() || '';

            // Quick real-time match for Express Lane
             if (market.includes('raydium-cpmm')) { // <-- FIX: ADDED RAYDIUM CPMM
                return this._quantumResponse(true, 'Raydium CPMM pool detected', {
                    ...baseDetails, 
                    dexPlatform: 'Raydium CPMM',
                     platformSpecificData: { poolId: primaryPool.poolId }
                }, 97);
            }
            if (market.includes('raydium-clmm')) {
                return this._quantumResponse(true, 'Raydium CLMM pool detected', {
                    ...baseDetails,
                    dexPlatform: 'Raydium CLMM',
                    platformSpecificData: { poolId: primaryPool.poolId }
                }, 96);
            }
            if (market.includes('raydium-v4') || market.includes('raydium-amm')) {
                return this._quantumResponse(true, 'Raydium V4/AMM pool detected', {
                    ...baseDetails,
                    dexPlatform: 'Raydium V4',
                    platformSpecificData: { poolId: primaryPool.poolId }
                }, 95);
            }
            if (market.includes('meteora-dlmm')) {
                return this._quantumResponse(true, 'Meteora DLMM pool detected', {
                    ...baseDetails,
                    dexPlatform: 'Meteora DLMM',
                    platformSpecificData: { poolId: primaryPool.poolId }
                }, 93);
            }
            if (market.includes('meteora-dbc')) {
                return this._quantumResponse(true, 'Meteora DBC pool detected', {
                    ...baseDetails,
                    dexPlatform: 'Meteora DBC',
                    platformSpecificData: { poolId: primaryPool.poolId }
                }, 92);
            }
               if (market.includes('meteora-cpamm')) { // <-- FIX: STANDARDIZED NAME
                return this._quantumResponse(true, 'Meteora CP-AMM pool detected', {
                    ...baseDetails, 
                    dexPlatform: 'Meteora CP-AMM',
                     platformSpecificData: { poolId: primaryPool.poolId }
                }, 91);
            }
            if (market.includes('jupiter')) {
                return this._quantumResponse(true, 'Jupiter Aggregator detected', {
                    ...baseDetails,
                    dexPlatform: 'Jupiter Aggregator',
                    platformSpecificData: { poolId: primaryPool.poolId }
                }, 98);
            }
        }

        // ---------------------------
        // Stage 2: Async deep platform hints (Fallback, non-blocking)
        // ---------------------------
        const platformHints = this._extractPlatformHints(allAccountKeys, parsedInstructions);

        // Check for Pump.fun migration (Bonding curve completed)
        if (pumpBcResult.status === 'fulfilled' && pumpBcResult.value && pumpBcResult.value.isComplete) {
            return this._quantumResponse(true, 'Pump.fun AMM migration assumed', {
                ...baseDetails, dexPlatform: 'Pump.fun AMM'
            }, 70);
        }

        // ✅ Priority 3: Hints-based fallback
        if (platformHints.jupiter) {
            return this._quantumResponse(true, 'Jupiter hinted by program ID', {
                ...baseDetails, dexPlatform: 'Jupiter Aggregator'
            }, 85);
        }
        if (platformHints.meteoraCpAmm) {
            return this._quantumResponse(true, 'Meteora CPAMM hinted by program ID', {
                ...baseDetails, dexPlatform: 'Meteora CPAmm'
            }, 88);
        }
        if (platformHints.meteoraDlmm) {
            return this._quantumResponse(true, 'Meteora DLMM hinted by program ID', {
                ...baseDetails, dexPlatform: 'Meteora DLMM'
            }, 87);
        }
        if (platformHints.meteoraDbc) {
            return this._quantumResponse(true, 'Meteora DBC hinted by program ID', {
                ...baseDetails, dexPlatform: 'Meteora DBC'
            }, 86);
        }
        if (platformHints.raydiumV4) {
            return this._quantumResponse(true, 'Raydium V4 hinted by program ID', {
                ...baseDetails, dexPlatform: 'Raydium V4'
            }, 84);
        }
        if (platformHints.raydiumClmm) {
            return this._quantumResponse(true, 'Raydium CLMM hinted by program ID', {
                ...baseDetails, dexPlatform: 'Raydium CLMM'
            }, 83);
        }
        if (platformHints.raydiumCpAmm) {
            return this._quantumResponse(true, 'Raydium CPMM hinted by program ID', {
                ...baseDetails, dexPlatform: 'Raydium CPMM'
            }, 82);
        }
        if (platformHints.raydiumAny) {
            return this._quantumResponse(true, 'Raydium AMM hinted by program ID', {
                ...baseDetails, dexPlatform: 'Raydium AMM'
            }, 80);
        }
        

        // ❌ Final fallback: No match
        return this._quantumResponse(false, 'No definitive platform association found', null, 0);

    } catch (error) {
        console.error(`[QUANTUM-V4] ❌ Error: ${error.message}`);
        return this._quantumResponse(false, `Heuristic failure: ${error.message}`, null, 0);
    }
}


_extractPlatformHints(allAccountKeys, parsedInstructions = []) {
    const hints = { 
        pumpFun: false, 
        raydiumV4: false, raydiumLaunchpad: false, raydiumClmm: false, raydiumCpAmm: false, raydiumAny: false,
        meteoraDlmm: false, meteoraDbc: false, meteoraCpAmm: false, meteoraAny: false,
        jupiter: false, 
        any: false 
    };

    for (const key of allAccountKeys) {
        const keyStr = key.toBase58();
        // Pump.fun
        if ([
            config.PLATFORM_IDS.PUMP_FUN.toBase58(),
            config.PLATFORM_IDS.PUMP_FUN_VARIANT.toBase58(),
            config.PLATFORM_IDS.PUMP_FUN_AMM.toBase58()
        ].includes(keyStr)) {
            hints.pumpFun = true; hints.any = true;
        }
        // Raydium
        else if (keyStr === config.PLATFORM_IDS.RAYDIUM_V4.toBase58()) {
            hints.raydiumV4 = true; hints.raydiumAny = true; hints.any = true;
        } else if (keyStr === config.PLATFORM_IDS.RAYDIUM_LAUNCHPAD.toBase58()) {
            hints.raydiumLaunchpad = true; hints.raydiumAny = true; hints.any = true;
        } else if (keyStr === config.PLATFORM_IDS.RAYDIUM_CLMM.toBase58()) {
            hints.raydiumClmm = true; hints.raydiumAny = true; hints.any = true;
        } else if (keyStr === config.PLATFORM_IDS.RAYDIUM_CPMM.toBase58()) { // <-- FIX: ADDED RAYDIUM CPMM CHECK
            hints.raydiumCpAmm = true; hints.raydiumAny = true; hints.any = true;
        }
        // Meteora
        else if (keyStr === config.PLATFORM_IDS.METEORA_DLMM.toBase58()) {
            hints.meteoraDlmm = true; hints.meteoraAny = true; hints.any = true;
        } else if ((config.PLATFORM_IDS.METEORA_DBC || []).some(id => id.toBase58() === keyStr)) {
            hints.meteoraDbc = true; hints.meteoraAny = true; hints.any = true;
        } else if (keyStr === config.PLATFORM_IDS.METEORA_CP_AMM.toBase58()) { // <-- FIX: CORRECT KEY LOOKUP
            hints.meteoraCpAmm = true; hints.meteoraAny = true; hints.any = true;
        }
        // Jupiter
        else if (keyStr === config.PLATFORM_IDS['Jupiter Aggregator'].toBase58()) {
            hints.jupiter = true; hints.any = true;
        }
    }
    return hints;
}

    // Helper: DIRECTLY checks Pump.fun bonding curve status (Reliable)
   async _checkPumpFunBondingCurve(tokenMintString, connection) {
    // This is safer as we defined these in the constructor
    const pumpProgramId = this.PUMP_FUN_PROGRAM_ID_PK; 

    const [bondingCurveAddress] = PublicKey.findProgramAddressSync(
        [Buffer.from('bonding-curve'), new PublicKey(tokenMintString).toBuffer()],
        pumpProgramId
    );
    try {
        const accountInfo = await connection.getAccountInfo(bondingCurveAddress);
        return { isComplete: !accountInfo }; // Simpler logic: if account exists, it's not complete.
    } catch (e) {
        return { isComplete: true };
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
    _quantumResponse(isCopyable, reason, details, certainty) {
    return { 
        isCopyable, 
        reason, 
        details, 
        quantumCertainty: certainty 
    };
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
}

// CommonJS export
module.exports = { TransactionAnalyzer };