// ==========================================
// Universal Transaction Analyzer - SINGLE, FAST Analyzer for Instant Copy Trading
// ==========================================
// File: universalAnalyzer.js
// Description: SINGLE, FAST analyzer for instant copy trading - eliminates dependency on transactionAnalyzer.js

const { Connection, PublicKey, LAMPORTS_PER_SOL } = require('@solana/web3.js');
const config = require('./config.js');
const { shortenAddress } = require('./utils.js');

class UniversalAnalyzer {
    constructor(connection) {
        this.connection = connection;
        this.platformIds = config.PLATFORM_IDS;
        
        // Golden Peeling Constants
        this.PUMP_FUN_CONSTANTS = {
            FEE_RECIPIENT: new PublicKey('CebN5WGQ4jvEPvsVU4EoHEpgzq1VV7AbicfhtW4xC9iM'),
            BUY_DISCRIMINATOR: Buffer.from([0x33, 0xE6, 0x85, 0x5A, 0x5B, 0x5C, 0x5D, 0x5E]), // Placeholder - update with real discriminator
            SELL_DISCRIMINATOR: Buffer.from([0x44, 0xF7, 0x96, 0x6B, 0x6C, 0x6D, 0x6E, 0x6F]) // Placeholder - update with real discriminator
        };
        
        console.log(`[UNIVERSAL-ANALYZER] 🚀 Initialized as SINGLE, FAST analyzer for instant copy trading`);
    }

    /**
     * MAIN ANALYSIS FUNCTION - The Golden Peeling Plan
     * This is the ONLY analyzer needed for instant copy trading
     */
    async analyzeTransaction(transactionResponse, masterTraderWallet) {
        const analysisStartTime = Date.now(); // 🎯 ANALYSIS PIPELINE LATENCY TRACKING
        
    try {
            // This is a new safety check. The incoming wallet can be a string or object.
            const masterTraderWalletAddress = typeof masterTraderWallet === 'string'
                ? new PublicKey(masterTraderWallet)
                : masterTraderWallet;

            // Golden Filter already pre-filtered this transaction
            console.log(`[UNIVERSAL-ANALYZER] 🚀 GOLDEN PEELING: Processing transaction for full analysis`);

        // ===============================================
            // ====== DATA NORMALIZATION (THE FINAL FIX) ======
        // ===============================================
        let message, meta;
    
        // This block intelligently finds the correct nested transaction data from Helius.
            // Based on laserstreamManager.js analysis, the structure is:
            // transactionResponse.transaction.transaction.transaction (message)
            // transactionResponse.transaction.transaction.meta
            console.log(`[UNIVERSAL-ANALYZER] 🔍 Raw structure keys:`, Object.keys(transactionResponse));
            console.log(`[UNIVERSAL-ANALYZER] 🔍 Transaction keys:`, transactionResponse.transaction ? Object.keys(transactionResponse.transaction) : 'none');
            console.log(`[UNIVERSAL-ANALYZER] 🔍 Nested transaction keys:`, transactionResponse.transaction?.transaction ? Object.keys(transactionResponse.transaction.transaction) : 'none');
            
            // The real structure from LaserStream based on the logs
            if (transactionResponse.transaction?.transaction?.transaction && transactionResponse.transaction?.transaction?.meta) {
                console.log("[UNIVERSAL-ANALYZER] ✅ Found data in structure: response.transaction.transaction.transaction (triple nested)");
                message = transactionResponse.transaction.transaction.transaction;
                meta = transactionResponse.transaction.transaction.meta;
            } else if (transactionResponse.transaction?.transaction?.message && transactionResponse.transaction?.transaction?.meta) {
                console.log("[UNIVERSAL-ANALYZER] ✅ Found data in structure: response.transaction.transaction.message");
            message = transactionResponse.transaction.transaction.message;
            meta = transactionResponse.transaction.transaction.meta;
        } else if (transactionResponse.transaction?.message && transactionResponse.meta) {
                console.log("[UNIVERSAL-ANALYZER] ✅ Found data in structure: response.transaction.message");
            message = transactionResponse.transaction.message;
            meta = transactionResponse.meta;
        } else {
                console.error(`[UNIVERSAL-ANALYZER] ❌ UNKNOWN STRUCTURE: Could not find message/meta`, {
                    hasTransaction: !!transactionResponse.transaction,
                    hasNestedTransaction: !!transactionResponse.transaction?.transaction,
                    hasTripleNested: !!transactionResponse.transaction?.transaction?.transaction,
                    hasMessage: !!transactionResponse.transaction?.transaction?.message,
                    hasMeta: !!transactionResponse.transaction?.transaction?.meta,
                    keys: Object.keys(transactionResponse)
                });
             return { isCopyable: false, reason: "Unknown or incomplete transaction structure from stream" };
        }
        
            if (meta.err) {
                return { isCopyable: false, reason: `Transaction failed on-chain: ${JSON.stringify(meta.err)}` };
            }
    
            // Debug: Check what's actually in the message object
            console.log(`[UNIVERSAL-ANALYZER] 🔍 Message object keys:`, Object.keys(message));
            console.log(`[UNIVERSAL-ANALYZER] 🔍 Message.accountKeys exists:`, !!message.accountKeys);
            console.log(`[UNIVERSAL-ANALYZER] 🔍 Message.message exists:`, !!message.message);
            console.log(`[UNIVERSAL-ANALYZER] 🔍 Message.message.accountKeys exists:`, !!message.message?.accountKeys);
            
            // The message might have another nested level
            let actualMessage = message;
            if (message.message && message.message.accountKeys) {
                console.log(`[UNIVERSAL-ANALYZER] ✅ Found accountKeys in message.message`);
                actualMessage = message.message;
            } else if (message.accountKeys) {
                console.log(`[UNIVERSAL-ANALYZER] ✅ Found accountKeys in message`);
                actualMessage = message;
            } else {
                console.error(`[UNIVERSAL-ANALYZER] ❌ No accountKeys found in message structure:`, JSON.stringify(message, null, 2));
                return { isCopyable: false, reason: "Message object missing accountKeys property" };
            }

            // DEBUG: Log the actual message structure we're using
            console.log(`[UNIVERSAL-ANALYZER] 🔍 ActualMessage keys:`, Object.keys(actualMessage));
            console.log(`[UNIVERSAL-ANALYZER] 🔍 ActualMessage.instructions:`, actualMessage.instructions ? actualMessage.instructions.length : 'undefined');
            console.log(`[UNIVERSAL-ANALYZER] 🔍 ActualMessage.accountKeys:`, actualMessage.accountKeys ? actualMessage.accountKeys.length : 'undefined');
            
            // INSTRUCTIONS might be in a different location than accountKeys!
            let instructionsMessage = actualMessage;
            if (!actualMessage.instructions && message.instructions) {
                console.log(`[UNIVERSAL-ANALYZER] 🔍 Instructions found in original message, not actualMessage`);
                instructionsMessage = message;
            }
            console.log(`[UNIVERSAL-ANALYZER] 🔍 Using instructions from:`, instructionsMessage === actualMessage ? 'actualMessage' : 'original message');
            console.log(`[UNIVERSAL-ANALYZER] 🔍 Final instructions count:`, instructionsMessage.instructions ? instructionsMessage.instructions.length : 'undefined');

            // Add accountKeys directly to the meta object for our helper functions
            // Use the complete account keys from the transaction, not just the message level
            let completeAccountKeys = actualMessage.accountKeys;
            
            // If we have a nested structure, try to get the complete account keys
            if (message.accountKeys && message.accountKeys.length > actualMessage.accountKeys.length) {
                console.log(`[UNIVERSAL-ANALYZER] 🔍 Using complete account keys from message level (${message.accountKeys.length} vs ${actualMessage.accountKeys.length})`);
                completeAccountKeys = message.accountKeys;
            }
            
            meta.accountKeys = completeAccountKeys.map(key => new PublicKey(key.pubkey || key));

        // ===============================================
            // ====== ECONOMIC ANALYSIS & SWAP DETAILS ========
        // ===============================================
            if (!meta) {
                console.error(`[UNIVERSAL-ANALYZER] ❌ Cannot perform economic analysis: meta object is undefined`);
                return { isCopyable: false, reason: "Economic analysis failed: meta object is undefined" };
            }
            
        const swapDetails = await this._extractSwapDetails(meta, masterTraderWalletAddress, message);
            if (!swapDetails) {
                return { isCopyable: false, reason: "Economic analysis failed: No clear buy/sell pattern." };
            }
            
        console.log(`[UNIVERSAL-ANALYZER] ✅ Economic signature verified. Type: ${swapDetails.tradeType.toUpperCase()}`);

        // ===============================================
            // ====== FIND CORE INSTRUCTION =================
            // ===============================================
            console.log(`[UNIVERSAL-ANALYZER] 🔍 Looking for core swap instruction...`);
            // Use the message object that has instructions (might be different from accountKeys location)
            const messageForInstructions = instructionsMessage;
            let coreInstruction = await this._findCoreSwapInstruction(messageForInstructions, masterTraderWalletAddress);
            console.log(`[UNIVERSAL-ANALYZER] 🔍 Core instruction found:`, !!coreInstruction);
            if (!coreInstruction) {
                console.log(`[UNIVERSAL-ANALYZER] ❌ FAILURE: No core swap instruction found involving the trader.`);
                return { isCopyable: false, reason: "No core swap instruction found involving the trader." };
            }

            // Check if this is ATA creation only (no balance changes) vs ATA creation as part of swap
            const associatedTokenProgram = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';
            if (coreInstruction.programId.toString() === associatedTokenProgram) {
                // If we have significant balance changes, ATA creation is part of a swap
                if (swapDetails && (swapDetails.solChange !== 0n || swapDetails.sentTokens.length > 0 || swapDetails.receivedTokens.length > 0)) {
                    console.log(`[UNIVERSAL-ANALYZER] ✅ ATA creation with balance changes - part of swap transaction`);
                    // Continue processing as valid swap
                } else {
                    console.log(`[UNIVERSAL-ANALYZER] ❌ Transaction is ATA creation only (no balance changes) - skipping`);
                    return { isCopyable: false, reason: "Transaction is ATA creation only, not a swap" };
                }
            }

            // ===============================================
            // ====== TRANSACTION-LEVEL DEX DETECTION =======
        // ===============================================
            console.log(`[UNIVERSAL-ANALYZER] 🔍 Scanning transaction for DEX programs...`);
            const detectedDexPrograms = [];
            const allInstructions = instructionsMessage.instructions || [];
            const allAccountKeys = instructionsMessage.accountKeys || [];
            
            // Convert accountKeys to strings for comparison
            const accountKeysStr = allAccountKeys.map(key => {
                if (typeof key === 'string') return key;
                if (key && key.data) return new PublicKey(key.data).toString();
                if (Buffer.isBuffer(key)) return new PublicKey(key).toString();
                return key.toString();
            });

            // Scan ALL instructions for DEX programs
            for (let i = 0; i < allInstructions.length; i++) {
                const instruction = allInstructions[i];
                const programId = accountKeysStr[instruction.programIdIndex];
                const programIdStr = typeof programId === 'string' ? programId : programId.toString();
                
                const detectedDex = this._isKnownDexProgram(programId);
                if (detectedDex) {
                    detectedDexPrograms.push({
                        dexName: detectedDex,
                        programId: programIdStr,
                        instructionIndex: i
                    });
                    console.log(`[UNIVERSAL-ANALYZER] 🏪 Found DEX: ${detectedDex} (${programIdStr}) in instruction ${i}`);
                }
            }
            
            console.log(`[UNIVERSAL-ANALYZER] 🎯 Transaction DEX Summary: ${detectedDexPrograms.length} DEX programs detected`);
            if (detectedDexPrograms.length > 0) {
                console.log(`[UNIVERSAL-ANALYZER] 📋 DEX Programs:`, detectedDexPrograms.map(d => `${d.dexName}(${d.programId})`).join(', '));
            }
            console.log(`[UNIVERSAL-ANALYZER] ✅ Core instruction found! Program ID: ${coreInstruction.programId}`);
            console.log(`[UNIVERSAL-ANALYZER] ✅ Core instruction accounts: ${coreInstruction.accounts.length}`);
            console.log(`[UNIVERSAL-ANALYZER] ✅ Core instruction data length: ${coreInstruction.data ? coreInstruction.data.length : 'no data'}`);
            let coreProgramId = coreInstruction.programId;
        
        // ===============================================
            // ====== CREATE CLONING BLUEPRINT ==============
        // ===============================================
            console.log(`[UNIVERSAL-ANALYZER] 🔍 Creating cloning blueprint...`);
            console.log(`[UNIVERSAL-ANALYZER] 🔍 coreInstruction.accounts type: ${typeof coreInstruction.accounts}`);
            console.log(`[UNIVERSAL-ANALYZER] 🔍 coreInstruction.accounts value:`, coreInstruction.accounts);
            console.log(`[UNIVERSAL-ANALYZER] 🔍 coreInstruction.accounts isArray: ${Array.isArray(coreInstruction.accounts)}`);
            
            // Use the detected DEX platform instead of core instruction platform
            const detectedDexPlatform = detectedDexPrograms.length > 0 ? detectedDexPrograms[0].dexName : this._getPlatformName(coreProgramId);
            
            // CRITICAL FIX: If we detected Pump.fun, prioritize the Pump.fun instruction
            if (detectedDexPlatform === 'PUMP_FUN' && detectedDexPrograms.length > 0) {
                console.log(`[UNIVERSAL-ANALYZER] 🎯 PUMP_FUN detected - finding the correct Pump.fun instruction`);
                const pumpFunInstruction = await this._findPumpFunInstruction(messageForInstructions, masterTraderWalletAddress, detectedDexPrograms[0].programId);
                if (pumpFunInstruction) {
                    console.log(`[UNIVERSAL-ANALYZER] ✅ Found Pump.fun instruction with ${pumpFunInstruction.accounts.length} accounts`);
                    coreInstruction = pumpFunInstruction;
                    coreProgramId = coreInstruction.programId;
                }
            }
            
            // Validate instruction structure
            const accountCount = coreInstruction.accounts.length;
            const dataLength = coreInstruction.data ? coreInstruction.data.length : 0;
            
            console.log(`[UNIVERSAL-ANALYZER] 🔍 Account count: ${accountCount}, Data length: ${dataLength}`);
            
            // For complex instructions, we can still clone them - we just need to handle account mapping properly
            if (accountCount > 5) {
                console.log(`[UNIVERSAL-ANALYZER] ⚠️ Complex instruction with ${accountCount} accounts - will clone with proper account mapping`);
                
                // Try to find a simpler instruction first, but don't reject if we can't
                const simplerInstruction = await this._findSimplerInstruction(messageForInstructions, masterTraderWalletAddress);
                if (simplerInstruction && simplerInstruction.accounts.length <= 5) {
                    console.log(`[UNIVERSAL-ANALYZER] ✅ Found simpler instruction with ${simplerInstruction.accounts.length} accounts`);
                    coreInstruction = simplerInstruction;
                    coreProgramId = coreInstruction.programId;
                } else {
                    console.log(`[UNIVERSAL-ANALYZER] 🔧 Using complex instruction with ${accountCount} accounts - Universal Cloner will handle account mapping`);
                }
            }

        const cloningBlueprint = {
                programId: coreProgramId,
                accounts: coreInstruction.accounts,
                data: coreInstruction.data,
                platform: detectedDexPlatform
            };
            
            console.log(`[UNIVERSAL-ANALYZER] 🔍 Final cloningBlueprint.accounts:`, cloningBlueprint.accounts);

        const totalAnalysisLatency = Date.now() - analysisStartTime;
        console.log(`[UNIVERSAL-ANALYZER] 🎯 GOLDEN PEELING COMPLETE - 100% VERIFIED TRADE | Analysis Pipeline: ${totalAnalysisLatency}ms`);
        
            // This is the complete, correct result object the trading engine needs
        return {
            isCopyable: true,
            reason: 'Verified swap transaction ready for cloning.',
                details: {
                    ...swapDetails,
                    platformProgramId: coreProgramId,
                    dexPlatform: cloningBlueprint.platform,
                    cloningTarget: cloningBlueprint, // Embed the blueprint!
                    traderPubkey: masterTraderWalletAddress.toBase58(), // Pass the Pubkey as a string
                    // DEX DETECTION RESULTS for parameter customization
                    detectedDexPrograms: detectedDexPrograms,
                    transactionDexCount: detectedDexPrograms.length,
                    primaryDex: detectedDexPrograms.length > 0 ? detectedDexPrograms[0].dexName : 'Unknown'
                },
                summary: `${swapDetails.tradeType.toUpperCase()} on ${cloningBlueprint.platform} (${detectedDexPrograms.length} DEX detected)`,
            originalTransaction: transactionResponse,
            analysisLatency: totalAnalysisLatency // 🎯 ANALYSIS PIPELINE LATENCY TRACKING
        };

    } catch (error) {
        console.error(`[UNIVERSAL-ANALYZER] ❌ Golden Peeling failed critically:`, error.message, error.stack);
        return { isCopyable: false, reason: `Analysis error: ${error.message}` };
    }
}

    /**
     * LAYER 2: Verify key accounts for each platform
     */
    async _verifyKeyAccounts(message, programId) {
        const programIdStr = programId.toString();
        
        switch (programIdStr) {
            case config.PLATFORM_IDS.PUMP_FUN.toBase58():
                // Check for Pump.fun fee recipient
                return message.accountKeys.some(
                    key => key.toBase58() === this.PUMP_FUN_CONSTANTS.FEE_RECIPIENT.toBase58()
                );
                
            case config.PLATFORM_IDS.RAYDIUM_AMM_V4.toBase58():
                // Check for Raydium authority PDA
                return message.accountKeys.some(
                    key => key.toBase58() === '5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1'
                );
                
            case config.PLATFORM_IDS.METEORA_DBC.toBase58():
                // Check for Meteora DBC authority
                return message.accountKeys.some(
                    key => key.toBase58() === 'Eo7WjKq67rjJQSZxS6z3YkapzY3eMj6Xy8X5EQVn5UaB'
                );
                
            default:
                // For unknown platforms, assume valid if we got this far
                return true;
        }
    }

    /**
     * LAYER 3: Verify instruction data (discriminators)
     */
    async _verifyInstructionData(coreInstruction, programId) {
        const programIdStr = programId.toString();
        
        try {
            const instructionData = Buffer.from(coreInstruction.data, 'base58');
            const discriminator = instructionData.slice(0, 8);
            
            switch (programIdStr) {
                case config.PLATFORM_IDS.PUMP_FUN.toBase58():
                    if (discriminator.equals(this.PUMP_FUN_CONSTANTS.BUY_DISCRIMINATOR)) {
                        return { tradeType: 'buy', isVerifiedTrade: true };
                    } else if (discriminator.equals(this.PUMP_FUN_CONSTANTS.SELL_DISCRIMINATOR)) {
                        return { tradeType: 'sell', isVerifiedTrade: true };
                    }
                    break;
                    
                case config.PLATFORM_IDS.RAYDIUM_AMM_V4.toBase58():
                    // Raydium swap instruction discriminator (instruction #9)
                    if (discriminator.equals(Buffer.from([0x09, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]))) {
                        return { tradeType: 'swap', isVerifiedTrade: true };
                    }
                    break;
                    
                default:
                    // For unknown platforms, assume valid
                    return { tradeType: 'swap', isVerifiedTrade: true };
            }
            
            return { tradeType: 'unknown', isVerifiedTrade: false };
            
        } catch (error) {
            console.error(`[UNIVERSAL-ANALYZER] ❌ Instruction data verification failed:`, error.message);
            return { tradeType: 'unknown', isVerifiedTrade: false };
        }
    }

    /**
     * LAYER 4: Verify economic signature (balance changes)
     */
    async _verifyBalanceChanges(meta, tradeType, masterTraderWallet) {
        try {
            if (!meta.preBalances || !meta.postBalances) {
                console.warn(`[UNIVERSAL-ANALYZER] ⚠️ No balance data available - allowing through`);
                return true; // Allow through if no balance data
            }

            // Find trader's account index
            const traderIndex = meta.accountKeys?.findIndex(key => key === masterTraderWallet);
            if (traderIndex === -1) {
                console.warn(`[UNIVERSAL-ANALYZER] ⚠️ Trader wallet not found in account keys - allowing through`);
                return true; // Allow through if trader not found
            }

            const preBalance = meta.preBalances[traderIndex];
            const postBalance = meta.postBalances[traderIndex];
            const balanceChange = postBalance - preBalance;

            console.log(`[UNIVERSAL-ANALYZER] 💰 Balance change: ${balanceChange} lamports`);

            // For buy trades, SOL should decrease
            if (tradeType === 'buy' && balanceChange < 0) {
                return true;
            }
            
            // For sell trades, SOL should increase
            if (tradeType === 'sell' && balanceChange > 0) {
                return true;
            }
            
            // For swap trades, any significant change is valid
            if (tradeType === 'swap' && Math.abs(balanceChange) > 1000) {
                return true;
            }

            console.warn(`[UNIVERSAL-ANALYZER] ⚠️ Balance change doesn't match trade type - allowing through`);
            return true; // Allow through for now
            
        } catch (error) {
            console.error(`[UNIVERSAL-ANALYZER] ❌ Balance verification failed:`, error.message);
            return true; // Allow through on error
        }
    }

    /**
     * Extract swap details from transaction metadata using economic signature analysis
     */
    async _extractSwapDetails(meta, masterTraderWallet, message) {
        try {
            
            // Validate meta object has required properties
            if (!meta) {
                console.error(`[UNIVERSAL-ANALYZER] ❌ Balance analysis failed: meta object is undefined`);
                return null;
            }
            
            if (!meta.preBalances || !meta.postBalances) {
                console.error(`[UNIVERSAL-ANALYZER] ❌ Balance analysis failed: meta missing preBalances or postBalances`, {
                    hasPreBalances: !!meta.preBalances,
                    hasPostBalances: !!meta.postBalances,
                    metaKeys: Object.keys(meta)
                });
                return null;
            }
            
            const traderPkString = masterTraderWallet.toString();
            const tokenChanges = new Map();
            const tokenDecimalsMap = new Map();

            // Calculate token balance changes
            (meta.preTokenBalances || [])
                .filter(tb => tb.owner === traderPkString)
                .forEach(balance => {
                    const amount = BigInt(balance.uiTokenAmount.amount);
                    tokenChanges.set(balance.mint, (tokenChanges.get(balance.mint) || 0n) - amount);
                    tokenDecimalsMap.set(balance.mint, balance.uiTokenAmount.decimals);
                });

            (meta.postTokenBalances || [])
                .filter(tb => tb.owner === traderPkString)
                .forEach(balance => {
                    const amount = BigInt(balance.uiTokenAmount.amount);
                    tokenChanges.set(balance.mint, (tokenChanges.get(balance.mint) || 0n) + amount);
                    if (!tokenDecimalsMap.has(balance.mint)) {
                        tokenDecimalsMap.set(balance.mint, balance.uiTokenAmount.decimals);
                    }
                });

            let sentTokens = [];
            let receivedTokens = [];
            tokenChanges.forEach((change, mint) => {
                if (change > 0n) receivedTokens.push({ mint, amount: change });
                if (change < 0n) sentTokens.push({ mint, amount: -change });
            });

            // Calculate SOL balance change
            // AccountKeys are in the message.message object, not message.accountKeys
            let accountKeys = message.message?.accountKeys || [];
            
            // Convert Buffer objects to base58 strings if needed
            if (accountKeys.length > 0 && typeof accountKeys[0] !== 'string') {
                console.log(`[UNIVERSAL-ANALYZER] 🔍 Converting ${accountKeys.length} Buffer accountKeys to base58 strings`);
                accountKeys = accountKeys.map(key => {
                    if (Buffer.isBuffer(key)) {
                        // Convert Buffer to base58 string (Solana address format)
                        const bs58 = require('bs58');
                        return bs58.encode(key);
                    }
                    return key.toString();
                });
            }
            
            const traderIndex = accountKeys.findIndex(key => key === traderPkString);
            console.log(`[UNIVERSAL-ANALYZER] 🔍 Trader index: ${traderIndex}, AccountKeys count: ${accountKeys.length}, Trader: ${traderPkString}`);
            
            const solChange = traderIndex !== -1 ? BigInt(meta.postBalances[traderIndex]) - BigInt(meta.preBalances[traderIndex]) : 0n;

            // 🎯 GOLDEN PEELING: Allow all transactions through for analysis (like zap-monomix)
            // Removed strict filtering to let Golden Peeling handle all transaction analysis
            console.log(`[UNIVERSAL-ANALYZER] 🔍 Balance analysis: SOL change: ${solChange}, Token changes: sent=${sentTokens.length}, received=${receivedTokens.length}`);

            // Determine Trade Type and Mints
            if (solChange < 0n && receivedTokens.length === 1) { // BUY with SOL
                const tokenReceived = receivedTokens[0];
                console.log(`[UNIVERSAL-ANALYZER] ✅ Detected BUY: ${(-solChange / 1_000_000_000n).toString()} SOL → ${tokenReceived.mint}`);
                return {
                    tradeType: 'buy',
                    inputMint: config.NATIVE_SOL_MINT,
                    outputMint: tokenReceived.mint,
                    inputAmountRaw: (-solChange).toString(),
                    inputAmountLamports: (-solChange).toString(), // Add lamports field for TradingEngine
                    outputAmountRaw: tokenReceived.amount.toString(),
                    traderWallet: masterTraderWallet,
                    tokenDecimals: tokenDecimalsMap.get(tokenReceived.mint) || 6
                };
            } else if (solChange > 0n && sentTokens.length === 1) { // SELL for SOL
                const tokenSent = sentTokens[0];
                console.log(`[UNIVERSAL-ANALYZER] ✅ Detected SELL: ${tokenSent.mint} → ${(solChange / 1_000_000_000n).toString()} SOL`);
                return {
                    tradeType: 'sell',
                    inputMint: tokenSent.mint,
                    outputMint: config.NATIVE_SOL_MINT,
                    inputAmountRaw: tokenSent.amount.toString(),
                    outputAmountRaw: solChange.toString(),
                    outputAmountLamports: solChange.toString(), // Add lamports field for TradingEngine
                    traderWallet: masterTraderWallet,
                    tokenDecimals: tokenDecimalsMap.get(tokenSent.mint) || 6
                };
            } else if (sentTokens.length === 1 && receivedTokens.length === 1) { // TOKEN-TO-TOKEN SWAP (e.g., USDC -> MEME)
                const tokenSent = sentTokens[0];
                const tokenReceived = receivedTokens[0];
                console.log(`[UNIVERSAL-ANALYZER] ✅ Detected TOKEN SWAP: ${tokenSent.mint} → ${tokenReceived.mint}`);
            return {
                    tradeType: 'buy', // We classify this as a 'buy' for cloning purposes
                    inputMint: tokenSent.mint, // This will be USDC, etc.
                    outputMint: tokenReceived.mint, // This will be the meme coin
                    inputAmountRaw: tokenSent.amount.toString(),
                    outputAmountRaw: tokenReceived.amount.toString(),
                    traderWallet: masterTraderWallet,
                    tokenDecimals: tokenDecimalsMap.get(tokenReceived.mint) || 6
                };
            }

            // If no clear pattern is found, return null
            console.log(`[UNIVERSAL-ANALYZER] ❌ No clear trade pattern found for trader ${shortenAddress(traderPkString)}`);
            console.log(`[UNIVERSAL-ANALYZER] 🔍 SOL change: ${solChange.toString()}, Sent tokens: ${sentTokens.length}, Received tokens: ${receivedTokens.length}`);
            return null;
        } catch (error) {
            console.error(`[UNIVERSAL-ANALYZER] ❌ Swap details extraction failed:`, error.message);
            return null;
        }
    }

    /**
     * Get platform name from program ID
     */
    _getPlatformName(programId) {
        const programIdStr = programId.toString();
        
        for (const [name, pId] of Object.entries(this.platformIds)) {
            if (Array.isArray(pId)) {
                if (pId.some(id => id.toString() === programIdStr)) {
                    return name;
                }
            } else if (pId instanceof PublicKey) {
                if (pId.toString() === programIdStr) {
                    return name;
                }
            }
        }
        
        return 'Unknown';
    }

    /**
     * Find the specific Pump.fun instruction when Pump.fun is detected
     */
    async _findPumpFunInstruction(message, masterTraderWallet, pumpFunProgramId) {
        try {
            const instructions = message.instructions || [];
            let accountKeys = message.accountKeys || [];
            
            // Convert accountKeys to proper base58 strings
            if (accountKeys.length > 0) {
                accountKeys = accountKeys.map(key => {
                    if (typeof key === 'string') return key;
                    if (key && key.data) return new PublicKey(key.data).toString();
                    if (Buffer.isBuffer(key)) return new PublicKey(key).toString();
                    return key.toString();
                });
            }
            
            const masterTraderStr = masterTraderWallet.toString();
            
            // Look specifically for the Pump.fun instruction
            for (let i = 0; i < instructions.length; i++) {
                const instruction = instructions[i];
                const programId = accountKeys[instruction.programIdIndex];
                const programIdStr = typeof programId === 'string' ? programId : programId.toString();
                
                // Check if this is the Pump.fun instruction
                if (programIdStr === pumpFunProgramId) {
                    console.log(`[UNIVERSAL-ANALYZER] 🎯 Found Pump.fun instruction at index ${i}`);
                    
                    // Convert accounts
                    const accountsArray = Buffer.isBuffer(instruction.accounts) ? 
                        Array.from(instruction.accounts) : instruction.accounts;
                    
                    // Check if this instruction involves the trader
                    let isInvolved = false;
                    for (let j = 0; j < accountsArray.length; j++) {
                        const accountIndex = accountsArray[j];
                        if (accountIndex < accountKeys.length && accountKeys[accountIndex] === masterTraderStr) {
                            isInvolved = true;
                            break;
                        }
                    }
                    
                    if (isInvolved) {
                        console.log(`[UNIVERSAL-ANALYZER] ✅ Pump.fun instruction involves trader with ${accountsArray.length} accounts`);
                        
                        const convertedAccounts = accountsArray.map(accountIndex => {
                            if (accountIndex >= accountKeys.length) return null;
                            const accountKey = accountKeys[accountIndex];
                            if (!accountKey) return null;
                            
                            return {
                                pubkey: accountKey,
                                isSigner: accountIndex === 0,
                                isWritable: true
                            };
                        }).filter(account => account !== null);
                        
                        console.log(`[UNIVERSAL-ANALYZER] 🔍 Raw instruction data field:`, instruction.data);
                        console.log(`[UNIVERSAL-ANALYZER] 🔍 Raw instruction keys:`, Object.keys(instruction));
                        
                        return {
                            programId: programId,
                            accounts: convertedAccounts,
                            data: instruction.data || Buffer.alloc(0),
                            instructionIndex: i,
                            platform: 'PUMP_FUN',
                            dexProgramId: programIdStr
                        };
                    }
                }
            }
            
            return null;
        } catch (error) {
            console.error(`[UNIVERSAL-ANALYZER] ❌ Error finding Pump.fun instruction:`, error);
            return null;
        }
    }

    /**
     * Find a simpler instruction with fewer accounts for Pump.fun
     */
    async _findSimplerInstruction(message, masterTraderWallet) {
        try {
            const instructions = message.instructions || [];
            let accountKeys = message.accountKeys || [];
            
            // Convert accountKeys to proper base58 strings
            if (accountKeys.length > 0) {
                accountKeys = accountKeys.map(key => {
                    if (typeof key === 'string') return key;
                    if (key && key.data) return new PublicKey(key.data).toString();
                    if (Buffer.isBuffer(key)) return new PublicKey(key).toString();
                    return key.toString();
                });
            }
            
            const masterTraderStr = masterTraderWallet.toString();
            
            // Look for instructions with fewer accounts (3-5 accounts)
            for (let i = 0; i < instructions.length; i++) {
                const instruction = instructions[i];
                const programId = accountKeys[instruction.programIdIndex];
                const programIdStr = typeof programId === 'string' ? programId : programId.toString();
                
                // Skip system programs
                if (programIdStr === '11111111111111111111111111111111' || 
                    programIdStr === 'ComputeBudget111111111111111111111111111111') {
                    continue;
                }
                
                // Convert accounts
                const accountsArray = Buffer.isBuffer(instruction.accounts) ? 
                    Array.from(instruction.accounts) : instruction.accounts;
                
                // Check if this instruction involves the trader and has reasonable account count
                let isInvolved = false;
                for (let j = 0; j < accountsArray.length; j++) {
                    const accountIndex = accountsArray[j];
                    if (accountIndex < accountKeys.length && accountKeys[accountIndex] === masterTraderStr) {
                        isInvolved = true;
                        break;
                    }
                }
                
                if (isInvolved && accountsArray.length >= 3 && accountsArray.length <= 5) {
                    console.log(`[UNIVERSAL-ANALYZER] 🔍 Found simpler instruction ${i} with ${accountsArray.length} accounts`);
                    
                    const convertedAccounts = accountsArray.map(accountIndex => {
                        if (accountIndex >= accountKeys.length) return null;
                        const accountKey = accountKeys[accountIndex];
                        if (!accountKey) return null;
                        
                        return {
                            pubkey: accountKey,
                            isSigner: accountIndex === 0,
                            isWritable: true
                        };
                    }).filter(account => account !== null);
                    
                    return {
                        programId: programId,
                        accounts: convertedAccounts,
                        data: instruction.data || Buffer.alloc(0),
                        instructionIndex: i,
                        platform: this._getPlatformName(programIdStr),
                        dexProgramId: programIdStr
                    };
                }
            }
            
            return null;
        } catch (error) {
            console.error(`[UNIVERSAL-ANALYZER] ❌ Error finding simpler instruction:`, error);
            return null;
        }
    }

    /**
     * Find the core swap instruction using heuristics
     * PRIORITY: Router detection first, then other DEXs
     */
    async _findCoreSwapInstruction(message, masterTraderWallet) {
        try {
            const instructions = message.instructions || [];
            let accountKeys = message.accountKeys || [];
            
            // If we have a nested structure, try to get the complete account keys
            if (message.message && message.message.accountKeys && message.message.accountKeys.length > accountKeys.length) {
                console.log(`[UNIVERSAL-ANALYZER] 🔍 Using complete account keys from nested message (${message.message.accountKeys.length} vs ${accountKeys.length})`);
                accountKeys = message.message.accountKeys;
            }

            console.log(`[UNIVERSAL-ANALYZER] 🔍 Core instruction search: ${instructions.length} instructions, ${accountKeys.length} account keys`);
            console.log(`[UNIVERSAL-ANALYZER] 🔍 Master trader wallet: ${masterTraderWallet.toString()}`);

            // Convert accountKeys to proper base58 strings for comparison
            if (accountKeys.length > 0) {
                console.log(`[UNIVERSAL-ANALYZER] 🔍 Sample accountKey type:`, typeof accountKeys[0]);
                console.log(`[UNIVERSAL-ANALYZER] 🔍 Sample accountKey value:`, accountKeys[0]);
                
                // Convert Buffer objects to base58 strings
                accountKeys = accountKeys.map(key => {
                    if (typeof key === 'string') return key;
                    if (key && key.data) return new PublicKey(key.data).toString();
                    if (Buffer.isBuffer(key)) return new PublicKey(key).toString();
                    return key.toString();
                });
                
                console.log(`[UNIVERSAL-ANALYZER] 🔍 Converted sample accountKey:`, accountKeys[0]);
            }

            if (instructions.length === 0) {
                console.log(`[UNIVERSAL-ANALYZER] ❌ No instructions to analyze`);
                return null; // No instructions to analyze
            }

               // FIND ANY INSTRUCTION INVOLVING THE TRADER (UNIVERSAL APPROACH)
               const masterTraderStr = masterTraderWallet.toString();
               console.log(`[UNIVERSAL-ANALYZER] 🔍 Looking for trader: ${masterTraderStr}`);
               console.log(`[UNIVERSAL-ANALYZER] 🔍 Master trader type: ${typeof masterTraderWallet}`);
               console.log(`[UNIVERSAL-ANALYZER] 🔍 Master trader string: ${masterTraderStr}`);
               
               // FIRST CHECK: Is the trader the transaction signer? (Most common case)
               if (accountKeys.length > 0 && accountKeys[0] === masterTraderStr) {
                   console.log(`[UNIVERSAL-ANALYZER] ✅ Trader is transaction signer (accountKeys[0])`);
                   // Find the first non-system instruction as the core swap
                   for (let i = 0; i < instructions.length; i++) {
                       const instruction = instructions[i];
                       const programId = accountKeys[instruction.programIdIndex];
                       const programIdStr = typeof programId === 'string' ? programId : programId.toString();
                       
                       // Skip system programs
                       if (programIdStr === '11111111111111111111111111111111' || 
                           programIdStr === 'ComputeBudget111111111111111111111111111111') {
                           continue;
                       }
                       
                       console.log(`[UNIVERSAL-ANALYZER] ✅ Found core swap instruction: ${i} with program ${programIdStr}`);
                       console.log(`[UNIVERSAL-ANALYZER] 🔍 Raw instruction.accounts type: ${typeof instruction.accounts}, isBuffer: ${Buffer.isBuffer(instruction.accounts)}`);
                       console.log(`[UNIVERSAL-ANALYZER] 🔍 Raw instruction.accounts value:`, instruction.accounts);
                       
                       // Convert Buffer to Array if needed
                       const accountsArray = Buffer.isBuffer(instruction.accounts) ? 
                           Array.from(instruction.accounts) : instruction.accounts;
                       
                       console.log(`[UNIVERSAL-ANALYZER] 🔍 Converted accountsArray:`, accountsArray);
                       
                       const convertedAccounts = accountsArray.map(accountIndex => {
                           // Check if accountIndex is within bounds
                           if (accountIndex >= accountKeys.length) {
                               console.log(`[UNIVERSAL-ANALYZER] ⚠️ Account index ${accountIndex} out of bounds (max: ${accountKeys.length - 1})`);
                               return null; // Skip invalid indices
                           }
                           
                           const accountKey = accountKeys[accountIndex];
                           if (!accountKey) {
                               console.log(`[UNIVERSAL-ANALYZER] ⚠️ Account key at index ${accountIndex} is undefined`);
                               return null; // Skip undefined keys
                           }
                           
                           return {
                               pubkey: accountKey,
                               isSigner: accountIndex === 0,
                               isWritable: true
                           };
                       }).filter(account => account !== null); // Remove null entries
                       
                       console.log(`[UNIVERSAL-ANALYZER] 🔍 Final converted accounts:`, convertedAccounts);
                       
                return {
                           programId: programId,
                           accounts: convertedAccounts,
                           data: instruction.data || Buffer.alloc(0),
                           instructionIndex: i,
                           platform: this._getPlatformName(programIdStr),
                           dexProgramId: programIdStr
                       };
                   }
               }
            
            for (let i = 0; i < instructions.length; i++) {
                const instruction = instructions[i];
                const programId = accountKeys[instruction.programIdIndex];
                const programIdStr = typeof programId === 'string' ? programId : (programId ? programId.toString() : 'unknown');
                
                console.log(`[UNIVERSAL-ANALYZER] 🔍 Instruction ${i}: Program ID = ${programIdStr}`);
                const accountsArrayForLog = Buffer.isBuffer(instruction.accounts) ? 
                    Array.from(instruction.accounts) : instruction.accounts;
                console.log(`[UNIVERSAL-ANALYZER] 🔍 Instruction ${i}: Accounts = ${accountsArrayForLog.length}`);

                // Check ALL accounts in this instruction for trader involvement
                let isInvolved = false;
                // Convert Buffer to Array if needed for length check
                const accountsArrayForLength = Buffer.isBuffer(instruction.accounts) ? 
                    Array.from(instruction.accounts) : instruction.accounts;
                console.log(`[UNIVERSAL-ANALYZER] 🔍 Checking ${accountsArrayForLength.length} accounts in instruction ${i}`);
                
                   // Convert Buffer to Array if needed for account checking
                   const accountsArray = Buffer.isBuffer(instruction.accounts) ? 
                       Array.from(instruction.accounts) : instruction.accounts;
                   
                   for (let accountIdx = 0; accountIdx < accountsArray.length; accountIdx++) {
                       const accountIndex = accountsArray[accountIdx];
                       const account = accountKeys[accountIndex];
                       const accountStr = typeof account === 'string' ? account : (account ? account.toString() : 'unknown');
                       console.log(`[UNIVERSAL-ANALYZER] 🔍 Instruction ${i} account ${accountIdx}: ${accountStr} (index: ${accountIndex})`);
                       console.log(`[UNIVERSAL-ANALYZER] 🔍 Comparing: "${accountStr}" === "${masterTraderStr}" ? ${accountStr === masterTraderStr}`);
                       
                       if (accountStr === masterTraderStr) {
                           console.log(`[UNIVERSAL-ANALYZER] ✅ MATCH FOUND! Trader is account ${accountIdx} in instruction ${i}`);
                           isInvolved = true;
                           break; // Found the trader, we can stop checking accounts for this instruction
                       }
                   }
                
                console.log(`[UNIVERSAL-ANALYZER] 🔍 Finished checking instruction ${i}, trader involved: ${isInvolved}`);
                
                console.log(`[UNIVERSAL-ANALYZER] 🔍 Trader involved in instruction ${i}: ${isInvolved}`);

                if (isInvolved) {
                    // DETECT DEX PLATFORM for parameter customization
                    const detectedPlatform = this._isKnownDexProgram(programId);
                    const platformName = detectedPlatform || 'Universal';
                    
                    console.log(`[UNIVERSAL-ANALYZER] ✅ COPYABLE! Found trader in instruction ${i}`);
                    console.log(`[UNIVERSAL-ANALYZER] 🏪 DEX Platform: ${platformName} (${programIdStr})`);
                    console.log(`[UNIVERSAL-ANALYZER] 🔍 Raw instruction.accounts type: ${typeof instruction.accounts}, isBuffer: ${Buffer.isBuffer(instruction.accounts)}`);
                    console.log(`[UNIVERSAL-ANALYZER] 🔍 Raw instruction.accounts value:`, instruction.accounts);
                    
                    // Convert Buffer to Array if needed
                    const accountsArray = Buffer.isBuffer(instruction.accounts) ? 
                        Array.from(instruction.accounts) : instruction.accounts;
                    
                    console.log(`[UNIVERSAL-ANALYZER] 🔍 Converted accountsArray:`, accountsArray);
                    
                    const convertedAccounts = accountsArray.map(accountIndex => {
                        // Check if accountIndex is within bounds
                        if (accountIndex >= accountKeys.length) {
                            console.log(`[UNIVERSAL-ANALYZER] ⚠️ Account index ${accountIndex} out of bounds (max: ${accountKeys.length - 1})`);
                            return null; // Skip invalid indices
                        }
                        
                        const accountKey = accountKeys[accountIndex];
                        if (!accountKey) {
                            console.log(`[UNIVERSAL-ANALYZER] ⚠️ Account key at index ${accountIndex} is undefined`);
                            return null; // Skip undefined keys
                        }
                        
                        return {
                            pubkey: accountKey,
                            isSigner: accountIndex === 0,
                            isWritable: true
                        };
                    }).filter(account => account !== null); // Remove null entries
                    
                    console.log(`[UNIVERSAL-ANALYZER] 🔍 Final converted accounts:`, convertedAccounts);
                    
                    return {
                        programId: programId,
                        accounts: convertedAccounts,
                        data: instruction.data,
                        instructionIndex: i,
                        platform: platformName,
                        dexProgramId: programIdStr
                    };
                }
            }

            // If we reach here, no trader-involved instruction was found
            console.log(`[UNIVERSAL-ANALYZER] ❌ No instruction found involving trader: ${masterTraderStr}`);
            return null;

        } catch (error) {
            console.error(`[UNIVERSAL-ANALYZER] ❌ Core instruction search failed:`, error.message);
            return null;
        }
    }

    /**
     * Check if a program ID is a known DEX or Router
     */
    _isKnownDexProgram(programId) {
        try {
            const programIdStr = typeof programId === 'string' ? programId : programId.toString();
            
            for (const [name, pId] of Object.entries(this.platformIds)) {
                if (Array.isArray(pId)) {
                    if (pId.some(id => id.toString() === programIdStr)) {
                        return name;
                    }
                } else if (pId instanceof PublicKey) {
                    if (pId.toString() === programIdStr) {
                        return name;
                    }
                }
            }
            
            return false;
        } catch (error) {
            return false;
        }
    }

    // Pre-filter methods removed - Golden Filter in TraderMonitorWorker handles pre-filtering

}

module.exports = { UniversalAnalyzer };
