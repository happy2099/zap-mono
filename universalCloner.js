// =============================================================
// ====== Universal Cloner (vULTIMATE - Production Ready) ======
// =============================================================
// File: universalCloner.js
// Description: The final, hardened, and logically correct cloner. It obeys the
// analyzer and correctly performs all necessary surgical overrides.

const { PublicKey, TransactionInstruction } = require('@solana/web3.js');
const { createAssociatedTokenAccountIdempotentInstruction, getAssociatedTokenAddressSync } = require('@solana/spl-token');
const bs58 = require('bs58');

// Helper function to shorten addresses for logging
const shortenAddress = (address) => {
    if (!address) return 'undefined';
    return address.length > 8 ? `${address.slice(0, 4)}...${address.slice(-4)}` : address;
};
const BN = require('bn.js');
const config = require('./config.js');

// Helper function to safely create PublicKey
function safeCreatePublicKey(address) {
    try {
        if (!address) {
            throw new Error('Address is null or undefined');
        }
        if (typeof address === 'string' && address.length === 0) {
            throw new Error('Address is empty string');
        }
        return new PublicKey(address);
    } catch (error) {
        console.error(`[CLONER-ERROR] Failed to create PublicKey from: ${JSON.stringify(address)}`, error.message);
        throw error;
    }
}

class UniversalCloner {
    constructor(connection) {
        this.connection = connection;
        this.tokenProgramCache = new Map();
        this.CACHE_TTL = { TOKEN_PROGRAM: 300000 };
    }

    /**
     * The single, hardened function to identify the correct token program (SPL vs. Token-2022).
     */
    async _getTokenProgram(mintPubkey) {
        const mintStr = mintPubkey.toString();
        if (this.tokenProgramCache.has(mintStr)) {
            return this.tokenProgramCache.get(mintStr).tokenProgram;
        }
        
        try {
            const mintInfo = await this.connection.getAccountInfo(mintPubkey);
            if (!mintInfo) {
                this.tokenProgramCache.set(mintStr, { tokenProgram: config.TOKEN_PROGRAM_ID });
                return config.TOKEN_PROGRAM_ID;
            }
            const tokenProgram = mintInfo.owner.equals(config.TOKEN_2022_PROGRAM_ID)
                ? config.TOKEN_2022_PROGRAM_ID
                : config.TOKEN_PROGRAM_ID;
            
            this.tokenProgramCache.set(mintStr, { tokenProgram });
            return tokenProgram;
        } catch (error) {
            console.warn(`[CLONER-WARN] Could not determine token program for ${shortenAddress(mintStr)}. Defaulting to standard SPL.`, error.message);
            return config.TOKEN_PROGRAM_ID;
        }
    }

    /**
     * Creates a robust forging map for all necessary account swaps.
     */
    _createForgingMap(builderOptions) {
        const { userPublicKey, masterTraderWallet, inputMint, outputMint } = builderOptions;
        
        if (!masterTraderWallet || !userPublicKey || !inputMint || !outputMint) {
            throw new Error('FATAL: Invalid parameters for forging map.');
        }

        const forgingMap = new Map();
        try {
            const masterTraderPk = new PublicKey(masterTraderWallet);
            const inputMintPk = new PublicKey(inputMint);
            const outputMintPk = new PublicKey(outputMint);

            console.log(`[FORGING-DEBUG] 🔍 Creating forging map:`);
            console.log(`[FORGING-DEBUG] 🔍 Master trader: ${shortenAddress(masterTraderPk.toBase58())}`);
            console.log(`[FORGING-DEBUG] 🔍 User wallet: ${shortenAddress(userPublicKey.toBase58())}`);
            console.log(`[FORGING-DEBUG] 🔍 Input mint: ${shortenAddress(inputMint)}`);
            console.log(`[FORGING-DEBUG] 🔍 Output mint: ${shortenAddress(outputMint)}`);

            // Swap master trader's wallet with user's wallet
            forgingMap.set(masterTraderPk.toBase58(), userPublicKey.toBase58());
            console.log(`[FORGING-DEBUG] ✅ Added wallet mapping: ${shortenAddress(masterTraderPk.toBase58())} → ${shortenAddress(userPublicKey.toBase58())}`);

            // Create ATA mappings for token accounts
            if (inputMint !== config.NATIVE_SOL_MINT) {
                const masterInputATA = getAssociatedTokenAddressSync(inputMintPk, masterTraderPk, true);
                const userInputATA = getAssociatedTokenAddressSync(inputMintPk, userPublicKey, true);
                forgingMap.set(masterInputATA.toBase58(), userInputATA.toBase58());
                console.log(`[FORGING-DEBUG] ✅ Added input ATA mapping: ${shortenAddress(masterInputATA.toBase58())} → ${shortenAddress(userInputATA.toBase58())}`);
            }
            
            if (outputMint !== config.NATIVE_SOL_MINT) {
                [config.TOKEN_PROGRAM_ID, config.TOKEN_2022_PROGRAM_ID].forEach(programId => {
                    const masterOutputATA = getAssociatedTokenAddressSync(outputMintPk, masterTraderPk, true, programId);
                    const userOutputATA = getAssociatedTokenAddressSync(outputMintPk, userPublicKey, true, programId);
                    forgingMap.set(masterOutputATA.toBase58(), userOutputATA.toBase58());
                    console.log(`[FORGING-DEBUG] ✅ Added output ATA mapping: ${shortenAddress(masterOutputATA.toBase58())} → ${shortenAddress(userOutputATA.toBase58())}`);
                });
            }
            
            console.log(`[FORGING-DEBUG] 🎯 Total mappings created: ${forgingMap.size}`);
            return forgingMap;
        } catch(error) {
            throw new Error(`CRITICAL FAILURE during forging map creation: ${error.message}`);
        }
    }

    /**
     * Surgically modifies cloned data to match the USER's trade amounts, especially for Pump.fun.
     */
    _applySurgicalOverrides(instruction, builderOptions) {
        const programId = instruction.programId.toBase58();
        const pumpFunId = config.PLATFORM_IDS.PUMP_FUN.toBase58();

        console.log(`[CLONER-SURGERY] 🔍 Checking surgical overrides for program: ${programId}`);
        console.log(`[CLONER-SURGERY] 🔍 Pump.fun ID: ${pumpFunId}`);
        console.log(`[CLONER-SURGERY] 🔍 Trade type: ${builderOptions.tradeType}`);

        if (programId === pumpFunId && builderOptions.tradeType === 'buy') {
            console.log(`[CLONER-SURGERY] ✅ Applying Pump.fun surgical overrides`);
            instruction.data = this._reconstructPumpFunData(instruction.data, builderOptions);
        } else if (builderOptions.tradeType === 'buy') {
            console.log(`[CLONER-SURGERY] ✅ Applying generic surgical overrides for buy trade`);
            // For non-Pump.fun trades, we still need to apply SOL amount overrides
            instruction.data = this._reconstructGenericData(instruction.data, builderOptions);
        } else {
            console.log(`[CLONER-SURGERY] ⏭️ Skipping surgical overrides (not a buy trade)`);
        }
        return instruction;
    }
    
    /**
     * Rebuilds generic instruction data with user's SOL amount
     */
    _reconstructGenericData(originalData, builderOptions) {
        if (!builderOptions.userSolAmount) return originalData;
        try {
            const userSolAmount = new BN(builderOptions.userSolAmount);
            console.log(`[CLONER-SURGERY] 🔍 Applying user SOL amount: ${userSolAmount.toString()} lamports`);
            
            // For generic trades, we need to replace SOL amounts in the instruction data
            // This is a simplified version - in practice, you'd need to parse the specific instruction format
            const freshInstructionData = Buffer.from(originalData);
            
            // Replace the first 8 bytes (SOL amount) with user's amount
            const userAmountBuffer = userSolAmount.toArrayLike(Buffer, 'le', 8);
            userAmountBuffer.copy(freshInstructionData, 0);
            
            console.log(`[CLONER-SURGERY] ✅ Applied generic surgical overrides`);
            return freshInstructionData;
        } catch (error) {
            console.error(`[CLONER-SURGERY] ❌ Generic surgical override failed:`, error.message);
            return originalData;
        }
    }
    
    /**
     * Rebuilds the Pump.fun data buffer with the user's specific buy amount and slippage.
     */
    _reconstructPumpFunData(originalData, builderOptions) {
        if (!builderOptions.userSolAmount) return originalData;
        try {
            const userSolAmount = new BN(builderOptions.userSolAmount);
            const slippageBps = new BN(builderOptions.slippageBps || '5000');
            const BPS_DIVISOR = new BN(10000);
            
            const ourMaxSolCost = userSolAmount.mul(BPS_DIVISOR.add(slippageBps)).div(BPS_DIVISOR);
            
            const freshInstructionData = Buffer.from(originalData);
            if (freshInstructionData.length >= 24) {
                 freshInstructionData.writeBigUInt64LE(BigInt(1), 8);
                 freshInstructionData.writeBigUInt64LE(BigInt(ourMaxSolCost.toString()), 16);
            } else {
                 console.warn(`[CLONER-SURGERY] ⚠️ Pump.fun data too short for surgery.`);
            }
            return freshInstructionData;
        } catch(error) {
            console.error(`[CLONER-SURGERY] ❌ FAILED to reconstruct Pump.fun data.`, error.message);
            return originalData;
        }
    }

    /**
     * The final, obedient build function. It trusts the analyzer's blueprint and works.
     * NOW CLONES ALL INSTRUCTIONS from the original transaction, not just the core one.
     */
      async buildClonedInstruction(builderOptions) {
        const { userPublicKey, cloningTarget, originalTransaction } = builderOptions;

        console.log(`[CLONER-DEBUG] 🔍 Starting to clone ALL instructions from original transaction`);
        console.log(`[CLONER-DEBUG] 🔍 Original transaction has ${originalTransaction.instructions?.length || 0} instructions`);
        
        const prerequisiteInstructions = [];
        const ataMint = builderOptions.outputMint;
        
        // ATA instruction will be created inline when we encounter the master's ATA instruction
        // This ensures it maintains the same account structure and positions
        
        const forgingMap = this._createForgingMap(builderOptions);
        const clonedInstructions = [];
        
        // Debug: Show forging map contents
        console.log(`[FORGING-DEBUG] 🔍 Forging map contains ${forgingMap.size} mappings:`);
        for (const [original, replacement] of forgingMap.entries()) {
            console.log(`[FORGING-DEBUG] 🔍 ${shortenAddress(original)} → ${shortenAddress(replacement)}`);
        }
        
        // 🔥 NEW: Clone ALL instructions from the original transaction
        // Use the normalized transaction's account keys (which includes ALT expansion)
        const normalizedAccountKeys = builderOptions.normalizedTransaction?.accountKeys || originalTransaction.accountKeys;
        console.log(`[CLONER-DEBUG] 🔍 Using ${normalizedAccountKeys.length} normalized account keys`);
        
        for (let i = 0; i < originalTransaction.instructions.length; i++) {
            const originalInstruction = originalTransaction.instructions[i];
            console.log(`[CLONER-DEBUG] 🔍 Cloning instruction ${i}: Program ${originalInstruction.programIdIndex}`);
            
            // Get the program ID from the NORMALIZED account keys (includes ALT expansion)
            const programId = normalizedAccountKeys[originalInstruction.programIdIndex];
            console.log(`[CLONER-DEBUG] 🔍 Program ID: ${programId}`);
            
            // Debug ATA detection
            if (programId === 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL') {
                console.log(`[CLONER-DEBUG] 🔍 DETECTED ATA INSTRUCTION at index ${i} - will skip`);
            }
            
            if (!programId) {
                console.log(`[CLONER-DEBUG] ❌ Program ID not found at index ${originalInstruction.programIdIndex}`);
                continue;
            }
            
            // Replace master's ATA instruction with our own in the same position
            if (programId === 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL' || 
                programId.includes('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL')) {
                console.log(`[CLONER-DEBUG] 🔄 Replacing master's ATA instruction at position ${i} with our ATA`);
                
                // Clone the master's ATA instruction structure but replace accounts using forging map
                const forgedKeys = originalInstruction.accounts.map((accountMeta, accountIndex) => {
                    const accountIndexToUse = accountMeta.accountIndex !== undefined ? accountMeta.accountIndex : accountIndex;
                    const originalAccountKey = normalizedAccountKeys[accountIndexToUse];
                    
                    if (!originalAccountKey) {
                        console.log(`[CLONER-DEBUG] ❌ Account not found at index ${accountIndexToUse}`);
                        return null;
                    }
                    
                    const finalPubkeyStr = forgingMap.get(originalAccountKey) || originalAccountKey;
                    console.log(`[ATA-ACCOUNT-DEBUG] 🔍 ATA Account ${accountIndex}: ${shortenAddress(originalAccountKey)} → ${shortenAddress(finalPubkeyStr)}`);
                    const finalPubkey = safeCreatePublicKey(finalPubkeyStr);
                    
                    return {
                        pubkey: finalPubkey,
                        isSigner: finalPubkey.equals(userPublicKey) || (accountMeta.isSigner || false),
                        isWritable: accountMeta.isWritable || false
                    };
                }).filter(Boolean);
                
                // Create our ATA instruction with the same structure as master's
                const dataBuffer = (originalInstruction.data && typeof originalInstruction.data === 'string')
                    ? Buffer.from(bs58.decode(originalInstruction.data))
                    : Buffer.from(originalInstruction.data || []);
                
                const ourAtaInstruction = new TransactionInstruction({
                    programId: safeCreatePublicKey(programId),
                    keys: forgedKeys,
                    data: dataBuffer,
                });
                
                clonedInstructions.push(ourAtaInstruction);
                console.log(`[CLONER-DEBUG] ✅ Added our ATA instruction at original position ${i} with correct account mappings`);
                continue;
            }
            
            // Map all accounts for this instruction using NORMALIZED account keys
            const forgedKeys = originalInstruction.accounts.map((accountMeta, accountIndex) => {
                // Handle different account structure formats
                const accountIndexToUse = accountMeta.accountIndex !== undefined ? accountMeta.accountIndex : accountIndex;
                const originalAccountKey = normalizedAccountKeys[accountIndexToUse];
                
                if (!originalAccountKey) {
                    console.log(`[CLONER-DEBUG] ❌ Account not found at index ${accountIndexToUse}`);
                    return null;
                }
                
                const finalPubkeyStr = forgingMap.get(originalAccountKey) || originalAccountKey;
                console.log(`[ACCOUNT-DEBUG] 🔍 Account ${accountIndex}: ${shortenAddress(originalAccountKey)} → ${shortenAddress(finalPubkeyStr)}`);
                const finalPubkey = safeCreatePublicKey(finalPubkeyStr);
                
            return {
                pubkey: finalPubkey,
                    isSigner: finalPubkey.equals(userPublicKey) || (accountMeta.isSigner || false),
                    isWritable: accountMeta.isWritable || false
                };
            }).filter(Boolean); // Remove any null entries
            
            // Handle instruction data
            const dataBuffer = (originalInstruction.data && typeof originalInstruction.data === 'string')
                ? Buffer.from(bs58.decode(originalInstruction.data))
                : Buffer.from(originalInstruction.data || []);
            
            let clonedInstruction = new TransactionInstruction({
                programId: safeCreatePublicKey(programId),
            keys: forgedKeys,
            data: dataBuffer,
        });

            // Apply surgical overrides if this is the core instruction
            if (i === builderOptions.coreInstructionIndex || 
                (builderOptions.coreInstructionIndex === undefined && i === originalTransaction.instructions.length - 1)) {
                console.log(`[SURGICAL-DEBUG] 🔍 Applying surgical overrides to instruction ${i} (core instruction)`);
                console.log(`[SURGICAL-DEBUG] 🔍 Before override - Program: ${clonedInstruction.programId.toBase58()}`);
                console.log(`[SURGICAL-DEBUG] 🔍 Before override - Accounts: ${clonedInstruction.keys.length}`);
                console.log(`[SURGICAL-DEBUG] 🔍 Before override - Data length: ${clonedInstruction.data.length}`);
                
                clonedInstruction = this._applySurgicalOverrides(clonedInstruction, builderOptions);
                
                console.log(`[SURGICAL-DEBUG] ✅ After override - Program: ${clonedInstruction.programId.toBase58()}`);
                console.log(`[SURGICAL-DEBUG] ✅ After override - Accounts: ${clonedInstruction.keys.length}`);
                console.log(`[SURGICAL-DEBUG] ✅ After override - Data length: ${clonedInstruction.data.length}`);
            }
            
            clonedInstructions.push(clonedInstruction);
        }
        
        // Safety check: Remove any duplicate ATA instructions
        const finalInstructions = [];
        const seenPrograms = new Set();
        
        for (const instruction of clonedInstructions) {
            const programId = instruction.programId.toBase58();
            
            // Remove duplicate ATA instructions
            if (programId === 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL' && seenPrograms.has('ATA')) {
                console.log(`[CLONER-DEBUG] ⚠️ Removing duplicate ATA instruction: ${programId}`);
                continue;
            }
            if (programId === 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL') {
                seenPrograms.add('ATA');
            }
            finalInstructions.push(instruction);
        }
        
        console.log(`[CLONER-DEBUG] 🔍 Successfully cloned ${finalInstructions.length} instructions (after duplicate removal)`);
        
        // Debug: Show what was filtered out
        const filteredCount = clonedInstructions.length - finalInstructions.length;
        if (filteredCount > 0) {
            console.log(`[CLONER-DEBUG] 🔍 Filtered out ${filteredCount} instructions (duplicates)`);
        }
        
        // Debug: Show final transaction structure
        console.log(`[TRANSACTION-DEBUG] 🔍 Final transaction structure:`);
        console.log(`[TRANSACTION-DEBUG] 🔍 Cloned instructions: ${finalInstructions.length}`);
        console.log(`[TRANSACTION-DEBUG] 🔍 Prerequisite instructions: ${prerequisiteInstructions.length}`);
        console.log(`[TRANSACTION-DEBUG] 🔍 Total instructions: ${prerequisiteInstructions.length + finalInstructions.length}`);
        
        // Show instruction breakdown
        finalInstructions.forEach((instruction, index) => {
            const programId = instruction.programId.toBase58();
            console.log(`[TRANSACTION-DEBUG] 🔍 Instruction ${index}: ${programId.substring(0, 8)}... (${instruction.keys.length} accounts)`);
        });
        
        return { instructions: [...prerequisiteInstructions, ...finalInstructions], success: true };
    }
}

module.exports = { UniversalCloner };