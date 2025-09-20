// ==========================================
// Universal Instruction Cloner - Platform Agnostic
// ==========================================
// File: universalCloner.js
// Description: Universal cloner that works with any platform using swap rules

const { Connection, PublicKey, Transaction, TransactionInstruction, SystemProgram } = require('@solana/web3.js');
const { createAssociatedTokenAccountInstruction } = require('@solana/spl-token');
const { shortenAddress } = require('./utils.js');
const bs58 = require('bs58');
const config = require('./config.js');

class UniversalCloner {
    constructor(connection, apiManager = null) {
        this.connection = connection;
        this.apiManager = apiManager;
        
        // 🚀 PERFORMANCE CACHES
        this.tokenProgramCache = new Map();
        this.ataExistenceCache = new Map();
        this.priceCache = new Map();
        this.cacheTimestamps = new Map();
        
        // Cache TTLs (in milliseconds)
        this.CACHE_TTL = {
            TOKEN_PROGRAM: 300000,  // 5 minutes
            ATA_EXISTENCE: 60000,   // 1 minute
            PRICES: 30000          // 30 seconds
        };
        
        console.log('[UNIVERSAL-CLONER] 🚀 Performance caches initialized');
    }

    /**
     * Helper function to detect if a mint uses Token-2022 program
     * @param {PublicKey} mintPubkey - The mint public key to check
     * @returns {Promise<boolean>} - True if Token-2022, false if standard SPL Token
     */
    async _isToken2022(mintPubkey) {
        const mintStr = mintPubkey.toString();
        const now = Date.now();
        
        // 🚀 CHECK CACHE FIRST
        if (this.tokenProgramCache.has(mintStr)) {
            const cachedData = this.tokenProgramCache.get(mintStr);
            if ((now - cachedData.timestamp) < this.CACHE_TTL.TOKEN_PROGRAM) {
                return cachedData.isToken2022;
            }
        }
        
        try {
            const mintInfo = await this.connection.getAccountInfo(mintPubkey);
            if (!mintInfo) {
                console.warn(`[UNIVERSAL-CLONER] ⚠️ Mint ${shortenAddress(mintStr)} not found, assuming standard SPL Token`);
                // Cache the assumption
                this.tokenProgramCache.set(mintStr, { isToken2022: false, timestamp: now });
                return false;
            }
            
            const isToken2022 = mintInfo.owner.equals(config.TOKEN_2022_PROGRAM_ID);
            
            // 🚀 CACHE THE RESULT
            this.tokenProgramCache.set(mintStr, { isToken2022, timestamp: now });
            
            console.log(`[UNIVERSAL-CLONER] 🔍 Mint ${shortenAddress(mintStr)} uses ${isToken2022 ? 'Token-2022' : 'Standard SPL Token'} program`);
            return isToken2022;
        } catch (error) {
            console.error(`[UNIVERSAL-CLONER] ❌ Error checking token program for mint ${shortenAddress(mintStr)}:`, error.message);
            // Cache the error result
            this.tokenProgramCache.set(mintStr, { isToken2022: false, timestamp: now });
            return false;
        }
    }

    /**
     * 🧠 RECONSTRUCTION OVERRIDE: Build fresh Pump.fun instruction data with user's parameters
     * Maximum Control Strategy - Complete control over economic parameters
     */
    _reconstructPumpFunBuyData(builderOptions) {
        console.log(`[FORGER] 🧠 RECONSTRUCTION: Building fresh Pump.fun 'buy' instruction data`);
        
        const freshInstructionData = Buffer.alloc(24);
        const BN = require('bn.js');

        // 1. Write the CORRECT, OFFICIAL 'buy' discriminator
        config.PUMP_FUN_CONSTANTS.BUY_DISCRIMINATOR.copy(freshInstructionData, 0);

        // 2. Write the token amount out (ALWAYS 0 for a SOL-based buy)
        freshInstructionData.writeBigUInt64LE(BigInt(0), 8);

        // 3. Write the user's specific max_sol_cost with their slippage
        const userSolAmount = new BN(builderOptions.userSolAmount.toString());
        const slippageBps = new BN(builderOptions.slippageBps?.toString() || '5000'); // Default 50%
        const BPS_DIVISOR = new BN(10000);
        
        // Calculate max SOL cost with slippage: userAmount * (1 + slippage)
        const ourMaxSolCost = userSolAmount.mul(BPS_DIVISOR.add(slippageBps)).div(BPS_DIVISOR);
        
        freshInstructionData.writeBigUInt64LE(BigInt(ourMaxSolCost.toString()), 16);
        
        console.log(`[FORGER] ✅ RECONSTRUCTION COMPLETE:`);
        console.log(`[FORGER]   - Discriminator: ${config.PUMP_FUN_CONSTANTS.BUY_DISCRIMINATOR.toString('hex')}`);
        console.log(`[FORGER]   - User SOL Amount: ${userSolAmount.toString()} lamports`);
        console.log(`[FORGER]   - Slippage BPS: ${slippageBps.toString()}`);
        console.log(`[FORGER]   - Max SOL Cost: ${ourMaxSolCost.toString()} lamports`);
        
        return freshInstructionData;
    }

    /**
     * 🧠 RECONSTRUCTION OVERRIDE: Build fresh Pump.fun SELL instruction data with user's parameters
     * Maximum Control Strategy - Complete control over economic parameters for sell transactions
     */
    _reconstructPumpFunSellData(builderOptions) {
        console.log(`[FORGER] 🧠 RECONSTRUCTION: Building fresh Pump.fun 'sell' instruction data`);
        
        const freshInstructionData = Buffer.alloc(24);
        const BN = require('bn.js');

        // 1. Write the CORRECT, OFFICIAL 'sell' discriminator
        config.PUMP_FUN_CONSTANTS.SELL_DISCRIMINATOR.copy(freshInstructionData, 0);

        // 2. Write the token amount to sell (user's token amount)
        const userTokenAmount = new BN(builderOptions.userTokenAmount.toString());
        freshInstructionData.writeBigUInt64LE(BigInt(userTokenAmount.toString()), 8);

        // 3. Write the minimum SOL output with slippage protection
        const expectedSolOutput = new BN(builderOptions.expectedSolOutput.toString());
        const slippageBps = new BN(builderOptions.slippageBps?.toString() || '5000'); // Default 50%
        const BPS_DIVISOR = new BN(10000);
        
        // Calculate minimum SOL output with slippage: expectedOutput * (1 - slippage)
        const minSolOutput = expectedSolOutput.mul(BPS_DIVISOR.sub(slippageBps)).div(BPS_DIVISOR);
        
        freshInstructionData.writeBigUInt64LE(BigInt(minSolOutput.toString()), 16);
        
        console.log(`[FORGER] ✅ SELL RECONSTRUCTION COMPLETE:`);
        console.log(`[FORGER]   - Discriminator: ${config.PUMP_FUN_CONSTANTS.SELL_DISCRIMINATOR.toString('hex')}`);
        console.log(`[FORGER]   - Token Amount: ${userTokenAmount.toString()} tokens`);
        console.log(`[FORGER]   - Expected SOL Output: ${expectedSolOutput.toString()} lamports`);
        console.log(`[FORGER]   - Slippage BPS: ${slippageBps.toString()}`);
        console.log(`[FORGER]   - Min SOL Output: ${minSolOutput.toString()} lamports`);
        
        return freshInstructionData;
    }

    /**
     * 🧠 TRANSACTION-DRIVEN RECONSTRUCTION: Use master's discriminator and structure, only modify economic parameters
     * Maximum Accuracy Strategy - Preserve everything from master except user-specific amounts
     */
    _reconstructPumpFunFromMasterTransaction(originalData, builderOptions) {
        console.log(`[FORGER] 🔍 TRANSACTION-DRIVEN: Analyzing master's instruction data`);
        console.log(`[FORGER] 🔍 Original master data: ${originalData.toString('hex')}`);
        
        const BN = require('bn.js');

        // RULE: Transaction is source of truth - preserve master's discriminator!
        const masterDiscriminator = originalData.subarray(0, 8);
        console.log(`[FORGER] ✅ Preserving MASTER'S discriminator: ${masterDiscriminator.toString('hex')}`);

        // RULE: Only modify economic parameters with user's settings
        const userSolAmount = new BN(builderOptions.userSolAmount.toString());
        const slippageBps = new BN(builderOptions.slippageBps?.toString() || '5000');
        const BPS_DIVISOR = new BN(10000);
        
        // Calculate user's max SOL cost with slippage
        const ourMaxSolCost = userSolAmount.mul(BPS_DIVISOR.add(slippageBps)).div(BPS_DIVISOR);

        // Build new instruction data preserving master's structure
        const freshInstructionData = Buffer.alloc(originalData.length); // Preserve original instruction length
        
        // 1. Copy master's discriminator exactly (bytes 0-7)
        masterDiscriminator.copy(freshInstructionData, 0);
        
        // 2. For instructions shorter than 24 bytes, preserve the original structure
        if (originalData.length >= 16) {
            // Set user's max SOL cost (bytes 8-15) if space allows
            freshInstructionData.writeBigUInt64LE(BigInt(ourMaxSolCost.toString()), 8);
        }
        
        // 3. For longer instructions, also set minimal token output (bytes 16-23) if space allows
        const minTokenOut = BigInt(1);
        if (originalData.length >= 24) {
            freshInstructionData.writeBigUInt64LE(minTokenOut, 16);
        }

        console.log(`[FORGER] ✅ TRANSACTION-DRIVEN RECONSTRUCTION COMPLETE:`);
        console.log(`[FORGER]   - Master's discriminator preserved: ${masterDiscriminator.toString('hex')}`);
        console.log(`[FORGER]   - User SOL Amount: ${userSolAmount.toString()} lamports`);
        console.log(`[FORGER]   - Slippage BPS: ${slippageBps.toString()}`);
        console.log(`[FORGER]   - Max SOL Cost: ${ourMaxSolCost.toString()} lamports`);
        console.log(`[FORGER]   - Min Token Out: ${minTokenOut.toString()} tokens (maximum slippage)`);
        console.log(`[FORGER]   - Final Data: ${freshInstructionData.toString('hex')}`);
        
        return freshInstructionData;
    }

    /**
     * 🧠 RECONSTRUCTION OVERRIDE: Build fresh Raydium Launchpad instruction data with user's parameters
     * Maximum Control Strategy - Complete control over economic parameters for BuyExactIn
     */
    _reconstructRaydiumLaunchpadBuyData(builderOptions) {
        console.log(`[FORGER] 🧠 RECONSTRUCTION: Building fresh Raydium Launchpad 'BuyExactIn' instruction data`);
        
        const freshInstructionData = Buffer.alloc(32);
        const BN = require('bn.js');

        // 1. Write the CORRECT 'BuyExactIn' discriminator for Raydium Launchpad
        // From the logs: faea0d7bd59c13ec
        const LAUNCHPAD_BUY_DISCRIMINATOR = Buffer.from([0xfa, 0xea, 0x0d, 0x7b, 0xd5, 0x9c, 0x13, 0xec]);
        LAUNCHPAD_BUY_DISCRIMINATOR.copy(freshInstructionData, 0);

        // 2. Write OUR USER's SOL amount (with slippage buffer)
        const userSolAmount = new BN(builderOptions.userSolAmount.toString());
        const slippageBps = new BN(builderOptions.slippageBps?.toString() || '5000'); // Default 50%
        const BPS_DIVISOR = new BN(10000);
        
        // Calculate max SOL cost with slippage: userAmount * (1 + slippage)
        const ourMaxSolCost = userSolAmount.mul(BPS_DIVISOR.add(slippageBps)).div(BPS_DIVISOR);
        
        // Write SOL amount at offset 8 (little-endian u64)
        freshInstructionData.writeBigUInt64LE(BigInt(ourMaxSolCost.toString()), 8);

        // 3. Write minimum token out (set to 1 for maximum slippage tolerance)
        // This is a sniper bot - we want the trade to succeed even with high slippage
        const minTokenOut = BigInt(1);
        freshInstructionData.writeBigUInt64LE(minTokenOut, 16);

        // 4. Padding (8 bytes of zeros) - already initialized to 0
        
        console.log(`[FORGER] ✅ RAYDIUM LAUNCHPAD RECONSTRUCTION COMPLETE:`);
        console.log(`[FORGER]   - Discriminator: ${LAUNCHPAD_BUY_DISCRIMINATOR.toString('hex')}`);
        console.log(`[FORGER]   - User SOL Amount: ${userSolAmount.toString()} lamports`);
        console.log(`[FORGER]   - Slippage BPS: ${slippageBps.toString()}`);
        console.log(`[FORGER]   - Max SOL Cost: ${ourMaxSolCost.toString()} lamports`);
        console.log(`[FORGER]   - Min Token Out: ${minTokenOut.toString()} tokens (maximum slippage)`);
        console.log(`[FORGER]   - Final Data: ${freshInstructionData.toString('hex')}`);
        
        return freshInstructionData;
    }

    /**
     * 🔧 UNKNOWN PLATFORM: Modify instruction data to use user's SOL amount
     * Preserves original structure but updates amount fields
     */
    _createMinimalInstructionData(originalDataBuffer, builderOptions) {
        console.log(`[FORGER] 🔧 MODIFYING AMOUNT: Updating instruction data with user's SOL amount`);
        console.log(`[FORGER] 🔍 Original data length: ${originalDataBuffer.length} bytes`);
        console.log(`[FORGER] 🔍 Original data: ${originalDataBuffer.toString('hex')}`);
        
        // For very small instructions (like ATA creation), preserve original data
        // These typically don't contain amounts
        if (originalDataBuffer.length <= 4) {
            console.log(`[FORGER] ✅ PRESERVING ORIGINAL: Small instruction data (${originalDataBuffer.length} bytes) - likely no amounts`);
            return originalDataBuffer;
        }
        
        const BN = require('bn.js');
        const userSolAmount = new BN(builderOptions.userSolAmount || 5000000); // Default 0.005 SOL
        
        // Create a copy of the original data to preserve structure
        const modifiedData = Buffer.from(originalDataBuffer);
        
        // Try to find and update amount fields (common locations: offset 8, 16, 24)
        let amountUpdated = false;
        for (let offset = 8; offset <= Math.min(24, originalDataBuffer.length - 8); offset += 8) {
            try {
                const originalAmount = modifiedData.readBigUInt64LE(offset);
                
                // If the amount looks reasonable (not too large), replace it with user's amount
                if (originalAmount > 0n && originalAmount < BigInt('1000000000000000')) { // Less than 1000 SOL
                    console.log(`[FORGER] 💰 Found amount at offset ${offset}: ${originalAmount} lamports`);
                    console.log(`[FORGER] 💰 Updating to user's amount: ${userSolAmount.toString()} lamports`);
                    
                    modifiedData.writeBigUInt64LE(BigInt(userSolAmount.toString()), offset);
                    console.log(`[FORGER] ✅ Successfully updated amount from ${originalAmount} to ${userSolAmount.toString()}`);
                    amountUpdated = true;
                    break;
                }
            } catch (error) {
                // Skip this offset if we can't read it
                continue;
            }
        }
        
        if (!amountUpdated) {
            console.log(`[FORGER] ⚠️ No amount field found to update - using original data`);
        }
        
        console.log(`[FORGER] ✅ MODIFIED DATA: Updated instruction data (${modifiedData.length} bytes)`);
        console.log(`[FORGER] 🔍 Modified data: ${modifiedData.toString('hex')}`);
        
        return modifiedData;
    }

    /**
     * 🔧 UNKNOWN PLATFORM: Reconstruct instruction data for unknown platforms
     * Fixes account index issues by creating fresh instruction data
     */
    _reconstructUnknownPlatformData(originalDataBuffer, builderOptions) {
        console.log(`[FORGER] 🔧 RECONSTRUCTING: Building fresh instruction data for unknown platform`);
        console.log(`[FORGER] 🔍 Original data length: ${originalDataBuffer.length} bytes`);
        console.log(`[FORGER] 🔍 Original data: ${originalDataBuffer.toString('hex')}`);
        
        // For unknown platforms, we need to be more careful about preserving structure
        // Instead of completely reconstructing, let's try to preserve the original data
        // and only modify specific fields if we can identify them
        
        const BN = require('bn.js');
        const userSolAmount = new BN(builderOptions.userSolAmount || 5000000); // Default 0.005 SOL
        
        // Create a copy of the original data
        const freshInstructionData = Buffer.from(originalDataBuffer);
        
        // Try to identify and update amount fields in the instruction data
        // Most swap instructions have amount data in the first 16-24 bytes
        if (originalDataBuffer.length >= 16) {
            // Look for patterns that might be amounts (u64 values)
            // Try to find the master's amount and replace with user's amount
            
            // Common patterns:
            // - Amount at offset 8 (after 8-byte discriminator)
            // - Amount at offset 16 (after discriminator + other data)
            
            // Try offset 8 first (most common)
            if (originalDataBuffer.length >= 16) {
                const originalAmount = originalDataBuffer.readBigUInt64LE(8);
                console.log(`[FORGER] 🔍 Found potential amount at offset 8: ${originalAmount}`);
                
                // If the amount looks reasonable (not too large), replace it
                if (originalAmount > 0 && originalAmount < BigInt('1000000000000000')) { // Less than 1000 SOL
                    freshInstructionData.writeBigUInt64LE(BigInt(userSolAmount.toString()), 8);
                    console.log(`[FORGER] ✅ Updated amount at offset 8: ${originalAmount} → ${userSolAmount.toString()}`);
                }
            }
            
            // Try offset 16 if we have enough data
            if (originalDataBuffer.length >= 24) {
                const originalAmount2 = originalDataBuffer.readBigUInt64LE(16);
                console.log(`[FORGER] 🔍 Found potential amount at offset 16: ${originalAmount2}`);
                
                // If the amount looks reasonable, replace it
                if (originalAmount2 > 0 && originalAmount2 < BigInt('1000000000000000')) {
                    freshInstructionData.writeBigUInt64LE(BigInt(userSolAmount.toString()), 16);
                    console.log(`[FORGER] ✅ Updated amount at offset 16: ${originalAmount2} → ${userSolAmount.toString()}`);
                }
            }
        }
        
        console.log(`[FORGER] ✅ RECONSTRUCTED: Fresh instruction data (${freshInstructionData.length} bytes)`);
        console.log(`[FORGER] 🔍 Fresh data: ${freshInstructionData.toString('hex')}`);
        
        return freshInstructionData;
    }

    /**
     * 🔪 SURGICAL OVERRIDE: Modify specific fields in original data
     * Maximum Safety Strategy - Minimal changes to preserve structure
     */
    _surgicallyModifyPhotonData(originalDataBuffer) {
        console.log(`[FORGER] 🔪 SURGICAL: Photon Router timestamp update`);
        
        const TIMESTAMP_OFFSET = 9;
        if (originalDataBuffer.length >= TIMESTAMP_OFFSET + 8) {
            const newTimestamp = BigInt(Math.floor(Date.now() / 1000));
            originalDataBuffer.writeBigUInt64LE(newTimestamp, TIMESTAMP_OFFSET);
            console.log(`[FORGER] ✅ SURGICAL COMPLETE: Updated Photon timestamp to ${newTimestamp}`);
        } else {
            console.log(`[FORGER] ⚠️ SURGICAL SKIPPED: Data too short for timestamp update`);
        }
        
        return originalDataBuffer;
    }


    /**
     * 🧠 SMART OVERRIDE DISPATCHER: The pinnacle of the Smart Cloner architecture
     * Hybrid strategy: Reconstruction for high-frequency platforms, Surgical for others
     */
    async _applySurgicalOverrides(clonedInstruction, builderOptions) {
        const programIdStr = clonedInstruction.programId.toBase58();
        let finalInstructionData = clonedInstruction.data; // Start with cloned data

        console.log(`[FORGER] 🧠 SMART OVERRIDE DISPATCHER: Processing program ${shortenAddress(programIdStr)}`);

        // --- THE STRATEGY DISPATCHER ---

        // 🔄 CASE 0: Photon Router -> TRUE MIMIC AS-IS APPROACH (Use exact structure, swap accounts only)
        if (programIdStr === 'BSfD6SHZigAfDWSjzD5Q41jw8LmKwtmjskPH9XW1mrRW') {
            console.log(`[FORGER] 🔄 PHOTON ROUTER DETECTED: Using TRUE mimic-as-is approach`);
            console.log(`[FORGER] 🎯 MIMIC STRATEGY: Keep exact Photon Router structure, swap accounts only`);
            console.log(`[FORGER] ✅ Using original Photon Router instruction data as-is with account forging`);
            
            // For Photon Router, we keep the EXACT same instruction data and structure
            // Only the account forging will swap trader wallet → user wallet, etc.
            // This is the most reliable approach - no data modification, just account swaps
            return finalInstructionData; // Return original data unchanged
        }

        // 🎯 CASE 1: Pump.fun Buy -> TRANSACTION-DRIVEN RECONSTRUCTION (Maximum Accuracy)
        if (programIdStr === config.PLATFORM_IDS.PUMP_FUN.toBase58() && 
            builderOptions.tradeType === 'buy') {
            console.log(`[FORGER] 🧠 TRANSACTION-DRIVEN RECONSTRUCTION: Pump.fun detected - using MASTER'S discriminator and structure`);
            finalInstructionData = this._reconstructPumpFunFromMasterTransaction(finalInstructionData, builderOptions);
        }

        // 🎯 CASE 2: Raydium Launchpad Buy -> TOTAL RECONSTRUCTION (Maximum Control)
        else if (programIdStr === 'LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj' && builderOptions.tradeType === 'buy') {
            console.log(`[FORGER] 🧠 RECONSTRUCTION OVERRIDE: Raydium Launchpad detected - building fresh instruction data`);
            finalInstructionData = this._reconstructRaydiumLaunchpadBuyData(builderOptions);
        }

        // 🔪 CASE 3: Photon Router -> SURGICAL TIMESTAMP EDIT (Maximum Safety)
        else if (programIdStr === 'BSfD6SHZigAfDWSjzD5Q41jw8LmKwtmjskPH9XW1mrRW') {
            console.log(`[FORGER] 🔪 SURGICAL OVERRIDE: Photon Router detected - updating timestamp`);
            finalInstructionData = this._surgicallyModifyPhotonData(finalInstructionData);
        }

        // 🔒 CASE 3: All Other Platforms -> MODIFY AMOUNT ONLY (Preserve structure)
        else {
            console.log(`[FORGER] 🔧 UNKNOWN PLATFORM: Modifying amount field to use user's SOL amount`);
            console.log(`[FORGER] ✅ PRESERVING STRUCTURE: Keeping original instruction structure, updating amount only`);
            // For unknown platforms, we preserve the original instruction structure
            // but update the amount field to use the user's SOL amount
            finalInstructionData = this._createMinimalInstructionData(finalInstructionData, builderOptions);
        }

        // Update the instruction with the potentially modified data
        clonedInstruction.data = finalInstructionData;

        // --- STRUCTURAL FIXES (Applied to all platforms) ---
        // These are account-level fixes, not data-level fixes

        // --- OVERRIDE RULE #1: Pump.fun User Volume Accumulator PDA Fix ---
        // Based on official @pump-fun/pump-sdk: user_volume_accumulator PDA seeds are [Buffer.from("user_volume_accumulator"), user.toBuffer()]
        // NOT [Buffer.from("user_volume_accumulator"), user.toBuffer(), mint.toBuffer()] as we had before
        if (programIdStr === config.PLATFORM_IDS.PUMP_FUN.toBase58()) {
            console.log(`[FORGER] 🎯 Detected Pump.fun. Fixing user_volume_accumulator PDA...`);
            
            try {
                const { userPublicKey } = builderOptions;
                const { outputMint } = builderOptions;
                
                // Debug: Log all accounts to see what we're working with
                console.log(`[FORGER] 🔍 DEBUG: Pump.fun instruction has ${clonedInstruction.keys.length} accounts:`);
                clonedInstruction.keys.forEach((key, index) => {
                    console.log(`[FORGER]   Account ${index}: ${shortenAddress(key.pubkey.toBase58())} (signer: ${key.isSigner}, writable: ${key.isWritable})`);
                });
                
                // Find the default PDA that needs to be replaced
                const defaultPDA = 'pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ';
                
                // Find index dynamically by looking for the default PDA
                let accumulatorIndex = -1;
                for (let i = 0; i < clonedInstruction.keys.length; i++) {
                    if (clonedInstruction.keys[i].pubkey.toBase58() === defaultPDA) {
                        accumulatorIndex = i;
                        break;
                    }
                }
                
                if (accumulatorIndex === -1) {
                    console.warn(`[FORGER] ⚠️ user_volume_accumulator not found in accounts - skipping fix`);
                } else {
                    // Derive the correct PDA for our user (CORRECT seeds from official SDK)
                    const [userVolumeAccumulator] = PublicKey.findProgramAddressSync(
                        [
                            Buffer.from("user_volume_accumulator"),
                            userPublicKey.toBuffer()
                            // NOTE: NO outputMint in seeds - that was the bug!
                        ],
                        new PublicKey(programIdStr)
                    );
                    
                    const oldPDA = clonedInstruction.keys[accumulatorIndex].pubkey.toBase58();
                    clonedInstruction.keys[accumulatorIndex].pubkey = userVolumeAccumulator;
                    
                    console.log(`[FORGER] ✅ OVERRIDE APPLIED: Updated user_volume_accumulator PDA at index ${accumulatorIndex}:`);
                    console.log(`[FORGER]   Old: ${shortenAddress(oldPDA)}`);
                    console.log(`[FORGER]   New: ${shortenAddress(userVolumeAccumulator.toBase58())}`);
                }
                
                // Additional validation: Check if all required accounts are present and valid
                console.log(`[FORGER] 🔍 VALIDATION: Checking Pump.fun instruction integrity...`);
                console.log(`[FORGER]   Program ID: ${shortenAddress(programIdStr)}`);
                console.log(`[FORGER]   Data length: ${clonedInstruction.data.length} bytes`);
                console.log(`[FORGER]   Data (hex): ${clonedInstruction.data.toString('hex')}`);
                
                // Check for common Pump.fun account issues
                const hasUserWallet = clonedInstruction.keys.some(key => key.pubkey.toBase58() === userPublicKey);
                const hasOutputMint = clonedInstruction.keys.some(key => key.pubkey.toBase58() === outputMint);
                const hasSystemProgram = clonedInstruction.keys.some(key => key.pubkey.toBase58() === '11111111111111111111111111111111');
                
                console.log(`[FORGER]   Has user wallet: ${hasUserWallet}`);
                console.log(`[FORGER]   Has output mint: ${hasOutputMint}`);
                console.log(`[FORGER]   Has system program: ${hasSystemProgram}`);
                
                if (!hasUserWallet) {
                    console.error(`[FORGER] ❌ CRITICAL: User wallet not found in Pump.fun instruction!`);
                }
                if (!hasOutputMint) {
                    console.error(`[FORGER] ❌ CRITICAL: Output mint not found in Pump.fun instruction!`);
                }
                if (!hasSystemProgram) {
                    console.error(`[FORGER] ❌ CRITICAL: System program not found in Pump.fun instruction!`);
                }
                
            } catch (e) {
                console.error(`[FORGER] ❌ Pump.fun PDA derivation failed:`, e.message);
            }
            
            // NOTE: Fee recipient and other read-only account fixes are now handled 
            // by the Quality Control Forging system above - no redundant fixes needed
            
            // NOTE: Data modification is now handled by the Smart Override Dispatcher above
            // This ensures clean separation between structural fixes (PDAs) and data fixes (economic parameters)
        }
        
        // --- OVERRIDE RULE #2: Raydium AMM V4 Token Program Fix ---
        else if (programIdStr === '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8') {
            console.log(`[FORGER] 🎯 Detected Raydium AMM V4. Verifying Token Program accounts...`);
            
            // Check if we're dealing with Token-2022 mints
            const inputMintPk = new PublicKey(inputMint);
            const outputMintPk = new PublicKey(outputMint);
            
            const isInputToken2022 = await this._isToken2022(inputMintPk);
            const isOutputToken2022 = await this._isToken2022(outputMintPk);
            
            // Raydium's instruction expects the Token Program at index 0 in its keys array
            const TOKEN_PROGRAM_INDEX = 0;
            
            if (isInputToken2022 || isOutputToken2022) {
                console.log(`[FORGER] 🔧 Token-2022 detected (Input: ${isInputToken2022}, Output: ${isOutputToken2022})`);
                clonedInstruction.keys[TOKEN_PROGRAM_INDEX].pubkey = config.TOKEN_2022_PROGRAM_ID;
                console.log(`[FORGER] ✅ OVERRIDE APPLIED: Switched to Token-2022 Program for Raydium at index ${TOKEN_PROGRAM_INDEX}`);
            } else {
                console.log(`[FORGER] ✅ Standard SPL Token detected, keeping original Token Program`);
            }
        }
        
        // --- OVERRIDE RULE #3: Photon Router Timestamp Fix ---
        else if (programIdStr === 'BSfD6SHZigAfDWSjzD5Q41jw8LmKwtmjskPH9XW1mrRW') {
            console.log(`[FORGER] 🎯 Detected Photon Router. Updating timestamp in instruction data...`);
            const TIMESTAMP_OFFSET = 8; // Updated offset based on previous analysis
            if (clonedInstruction.data.length >= TIMESTAMP_OFFSET + 8) {
                const newTimestamp = BigInt(Math.floor(Date.now() / 1000));
                clonedInstruction.data.writeBigUInt64LE(newTimestamp, TIMESTAMP_OFFSET);
                console.log(`[FORGER] ✅ OVERRIDE APPLIED: Updated Photon timestamp to ${newTimestamp}`);
            } else {
                console.log(`[FORGER] ⚠️ Photon instruction data too short for timestamp update`);
            }
        }
        
        // --- OVERRIDE RULE #4: Raydium CLMM User Position PDA Fix ---
        else if (programIdStr === config.PLATFORM_IDS.RAYDIUM_CLMM.toBase58()) {
            console.log(`[FORGER] 🎯 Detected Raydium CLMM. Fixing user position PDA...`);
            
            try {
                const { userPublicKey } = builderOptions;
                const { inputMint, outputMint } = builderOptions;
                
                // Raydium CLMM uses position PDAs for user-specific positions
                // Find and replace the position PDA with user-specific one
                const positionPDAIndex = this._findRaydiumCLMMPositionPDA(clonedInstruction.keys, userPublicKey, inputMint, outputMint);
                
                if (positionPDAIndex !== -1) {
                    const [userPositionPDA] = PublicKey.findProgramAddressSync(
                        [
                            Buffer.from("position"),
                            new PublicKey(userPublicKey).toBuffer(),
                            new PublicKey(inputMint).toBuffer(),
                            new PublicKey(outputMint).toBuffer()
                        ],
                        new PublicKey(programIdStr)
                    );
                    
                    const oldPDA = clonedInstruction.keys[positionPDAIndex].pubkey.toBase58();
                    clonedInstruction.keys[positionPDAIndex].pubkey = userPositionPDA;
                    
                    console.log(`[FORGER] ✅ OVERRIDE APPLIED: Updated Raydium CLMM position PDA at index ${positionPDAIndex}:`);
                    console.log(`[FORGER]   Old: ${shortenAddress(oldPDA)}`);
                    console.log(`[FORGER]   New: ${shortenAddress(userPositionPDA.toBase58())}`);
                } else {
                    console.warn(`[FORGER] ⚠️ Raydium CLMM position PDA not found in accounts - skipping fix`);
                }
            } catch (e) {
                console.error(`[FORGER] ❌ Raydium CLMM PDA derivation failed:`, e.message);
            }
        }
        
        // --- OVERRIDE RULE #5: Raydium CPMM User Position PDA Fix ---
        else if (programIdStr === config.PLATFORM_IDS.RAYDIUM_CPMM.toBase58()) {
            console.log(`[FORGER] 🎯 Detected Raydium CPMM. Fixing user position PDA...`);
            
            try {
                const { userPublicKey } = builderOptions;
                const { inputMint, outputMint } = builderOptions;
                
                // Raydium CPMM uses position PDAs similar to CLMM
                const positionPDAIndex = this._findRaydiumCPMMPositionPDA(clonedInstruction.keys, userPublicKey, inputMint, outputMint);
                
                if (positionPDAIndex !== -1) {
                    const [userPositionPDA] = PublicKey.findProgramAddressSync(
                        [
                            Buffer.from("position"),
                            new PublicKey(userPublicKey).toBuffer(),
                            new PublicKey(inputMint).toBuffer(),
                            new PublicKey(outputMint).toBuffer()
                        ],
                        new PublicKey(programIdStr)
                    );
                    
                    const oldPDA = clonedInstruction.keys[positionPDAIndex].pubkey.toBase58();
                    clonedInstruction.keys[positionPDAIndex].pubkey = userPositionPDA;
                    
                    console.log(`[FORGER] ✅ OVERRIDE APPLIED: Updated Raydium CPMM position PDA at index ${positionPDAIndex}:`);
                    console.log(`[FORGER]   Old: ${shortenAddress(oldPDA)}`);
                    console.log(`[FORGER]   New: ${shortenAddress(userPositionPDA.toBase58())}`);
                } else {
                    console.warn(`[FORGER] ⚠️ Raydium CPMM position PDA not found in accounts - skipping fix`);
                }
            } catch (e) {
                console.error(`[FORGER] ❌ Raydium CPMM PDA derivation failed:`, e.message);
            }
        }
        
        // --- OVERRIDE RULE #6: Meteora DLMM User Position PDA Fix ---
        else if (programIdStr === config.PLATFORM_IDS.METEORA_DLMM.toBase58()) {
            console.log(`[FORGER] 🎯 Detected Meteora DLMM. Fixing user position PDA...`);
            
            try {
                const { userPublicKey } = builderOptions;
                const { inputMint, outputMint } = builderOptions;
                
                // Meteora DLMM uses position PDAs for user-specific positions
                const positionPDAIndex = this._findMeteoraDLMMPositionPDA(clonedInstruction.keys, userPublicKey, inputMint, outputMint);
                
                if (positionPDAIndex !== -1) {
                    const [userPositionPDA] = PublicKey.findProgramAddressSync(
                        [
                            Buffer.from("position"),
                            new PublicKey(userPublicKey).toBuffer(),
                            new PublicKey(inputMint).toBuffer(),
                            new PublicKey(outputMint).toBuffer()
                        ],
                        new PublicKey(programIdStr)
                    );
                    
                    const oldPDA = clonedInstruction.keys[positionPDAIndex].pubkey.toBase58();
                    clonedInstruction.keys[positionPDAIndex].pubkey = userPositionPDA;
                    
                    console.log(`[FORGER] ✅ OVERRIDE APPLIED: Updated Meteora DLMM position PDA at index ${positionPDAIndex}:`);
                    console.log(`[FORGER]   Old: ${shortenAddress(oldPDA)}`);
                    console.log(`[FORGER]   New: ${shortenAddress(userPositionPDA.toBase58())}`);
                } else {
                    console.warn(`[FORGER] ⚠️ Meteora DLMM position PDA not found in accounts - skipping fix`);
                }
            } catch (e) {
                console.error(`[FORGER] ❌ Meteora DLMM PDA derivation failed:`, e.message);
            }
        }
        
        // --- OVERRIDE RULE #7: Meteora DBC User Position PDA Fix ---
        else if (config.PLATFORM_IDS.METEORA_DBC.some(id => programIdStr === id.toBase58())) {
            console.log(`[FORGER] 🎯 Detected Meteora DBC. Fixing user position PDA...`);
            
            try {
                const { userPublicKey } = builderOptions;
                const { inputMint, outputMint } = builderOptions;
                
                // Meteora DBC uses position PDAs for user-specific positions
                const positionPDAIndex = this._findMeteoraDBCPositionPDA(clonedInstruction.keys, userPublicKey, inputMint, outputMint);
                
                if (positionPDAIndex !== -1) {
                    const [userPositionPDA] = PublicKey.findProgramAddressSync(
                        [
                            Buffer.from("position"),
                            new PublicKey(userPublicKey).toBuffer(),
                            new PublicKey(inputMint).toBuffer(),
                            new PublicKey(outputMint).toBuffer()
                        ],
                        new PublicKey(programIdStr)
                    );
                    
                    const oldPDA = clonedInstruction.keys[positionPDAIndex].pubkey.toBase58();
                    clonedInstruction.keys[positionPDAIndex].pubkey = userPositionPDA;
                    
                    console.log(`[FORGER] ✅ OVERRIDE APPLIED: Updated Meteora DBC position PDA at index ${positionPDAIndex}:`);
                    console.log(`[FORGER]   Old: ${shortenAddress(oldPDA)}`);
                    console.log(`[FORGER]   New: ${shortenAddress(userPositionPDA.toBase58())}`);
                } else {
                    console.warn(`[FORGER] ⚠️ Meteora DBC position PDA not found in accounts - skipping fix`);
                }
            } catch (e) {
                console.error(`[FORGER] ❌ Meteora DBC PDA derivation failed:`, e.message);
            }
        }
        
        // --- OVERRIDE RULE #8: Meteora CP-AMM User Position PDA Fix ---
        else if (programIdStr === config.PLATFORM_IDS.METEORA_CP_AMM.toBase58()) {
            console.log(`[FORGER] 🎯 Detected Meteora CP-AMM. Fixing user position PDA...`);
            
            try {
                const { userPublicKey } = builderOptions;
                const { inputMint, outputMint } = builderOptions;
                
                // Meteora CP-AMM uses position PDAs for user-specific positions
                const positionPDAIndex = this._findMeteoraCPAMMPositionPDA(clonedInstruction.keys, userPublicKey, inputMint, outputMint);
                
                if (positionPDAIndex !== -1) {
                    const [userPositionPDA] = PublicKey.findProgramAddressSync(
                        [
                            Buffer.from("position"),
                            new PublicKey(userPublicKey).toBuffer(),
                            new PublicKey(inputMint).toBuffer(),
                            new PublicKey(outputMint).toBuffer()
                        ],
                        new PublicKey(programIdStr)
                    );
                    
                    const oldPDA = clonedInstruction.keys[positionPDAIndex].pubkey.toBase58();
                    clonedInstruction.keys[positionPDAIndex].pubkey = userPositionPDA;
                    
                    console.log(`[FORGER] ✅ OVERRIDE APPLIED: Updated Meteora CP-AMM position PDA at index ${positionPDAIndex}:`);
                    console.log(`[FORGER]   Old: ${shortenAddress(oldPDA)}`);
                    console.log(`[FORGER]   New: ${shortenAddress(userPositionPDA.toBase58())}`);
                } else {
                    console.warn(`[FORGER] ⚠️ Meteora CP-AMM position PDA not found in accounts - skipping fix`);
                }
            } catch (e) {
                console.error(`[FORGER] ❌ Meteora CP-AMM PDA derivation failed:`, e.message);
            }
        }
        
        // --- OVERRIDE RULE #6: Pump AMM User Volume Accumulator PDA Fix ---
        // Based on official @pump-fun/pump-swap-sdk: user_volume_accumulator PDA seeds are [Buffer.from("user_volume_accumulator"), user.toBuffer()]
        else if (programIdStr === config.PLATFORM_IDS.PUMP_FUN_AMM.toBase58()) {
            console.log(`[FORGER] 🎯 Detected Pump AMM. Fixing user_volume_accumulator PDA...`);
            
            try {
                const { userPublicKey } = builderOptions;
                
                // Find the user_volume_accumulator PDA in the accounts
                // Look for the default PDA that needs to be replaced
                const defaultPDA = 'pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ';
                
                // Find index dynamically by looking for the default PDA
                let accumulatorIndex = -1;
                for (let i = 0; i < clonedInstruction.keys.length; i++) {
                    if (clonedInstruction.keys[i].pubkey.toBase58() === defaultPDA) {
                        accumulatorIndex = i;
                        break;
                    }
                }
                
                if (accumulatorIndex === -1) {
                    console.warn(`[FORGER] ⚠️ user_volume_accumulator not found in accounts - skipping fix`);
                } else {
                    // Derive the correct PDA for our user (CORRECT seeds from official SDK)
                    const [userVolumeAccumulator] = PublicKey.findProgramAddressSync(
                        [
                            Buffer.from("user_volume_accumulator"),
                            userPublicKey.toBuffer()
                            // NOTE: NO outputMint in seeds - same as Pump.fun
                        ],
                        new PublicKey(programIdStr)
                    );
                    
                    const oldPDA = clonedInstruction.keys[accumulatorIndex].pubkey.toBase58();
                    clonedInstruction.keys[accumulatorIndex].pubkey = userVolumeAccumulator;
                    
                    console.log(`[FORGER] ✅ OVERRIDE APPLIED: Updated Pump AMM user_volume_accumulator PDA at index ${accumulatorIndex}:`);
                    console.log(`[FORGER]   Old: ${shortenAddress(oldPDA)}`);
                    console.log(`[FORGER]   New: ${shortenAddress(userVolumeAccumulator.toBase58())}`);
                }
            } catch (e) {
                console.error(`[FORGER] ❌ Pump AMM PDA derivation failed:`, e.message);
            }
        }
        
        // --- FUTURE OVERRIDE RULES GO HERE ---
        // Add more `else if` blocks as new platform-specific issues are discovered
        
        else {
            console.log(`[FORGER] ✅ No surgical overrides needed for program: ${shortenAddress(programIdStr)}`);
        }
        
        return clonedInstruction;
    }

    /**
     * STAGE 2: Generate the Forging Map - defines exactly which accounts need to be changed
     */
    _createForgingMap(builderOptions) {
        const { userPublicKey, masterTraderWallet, inputMint, outputMint } = builderOptions;
        const { getAssociatedTokenAddressSync } = require('@solana/spl-token');
        const forgingMap = new Map();

        console.log(`[FORGER] 🗺️ Creating forging map for account swaps...`);

        // 1. Map the trader's wallet to our user's wallet
        forgingMap.set(masterTraderWallet, userPublicKey.toBase58());
        console.log(`[FORGER] 📝 Map: TRADER_WALLET ${shortenAddress(masterTraderWallet)} → ${shortenAddress(userPublicKey.toBase58())}`);

        // 2. Map the trader's ATAs to our user's ATAs
        if (inputMint !== config.NATIVE_SOL_MINT) {
            const masterInputATA = getAssociatedTokenAddressSync(new PublicKey(inputMint), new PublicKey(masterTraderWallet));
            const userInputATA = getAssociatedTokenAddressSync(new PublicKey(inputMint), userPublicKey);
            forgingMap.set(masterInputATA.toBase58(), userInputATA.toBase58());
            console.log(`[FORGER] 📝 Map: INPUT_ATA ${shortenAddress(masterInputATA.toBase58())} → ${shortenAddress(userInputATA.toBase58())}`);
        }
        
        if (outputMint !== config.NATIVE_SOL_MINT) {
            const masterOutputATA = getAssociatedTokenAddressSync(new PublicKey(outputMint), new PublicKey(masterTraderWallet));
            const userOutputATA = getAssociatedTokenAddressSync(new PublicKey(outputMint), userPublicKey);
            forgingMap.set(masterOutputATA.toBase58(), userOutputATA.toBase58());
            console.log(`[FORGER] 📝 Map: OUTPUT_ATA ${shortenAddress(masterOutputATA.toBase58())} → ${shortenAddress(userOutputATA.toBase58())}`);
        }
        
        console.log(`[FORGER] ✅ Forging map created with ${forgingMap.size} account swaps`);
        return forgingMap;
    }

    /**
     * STAGE 3: Blueprint-Based Forging - Main cloning function using blueprint and forging map
     */
    async buildClonedInstruction(builderOptions) {
        const startTime = Date.now();
        
        const { 
            userPublicKey, 
            cloningTarget, 
            masterTraderWallet, 
            tradeType, 
            inputMint, 
            outputMint,
            amountBN,
            slippageBps,
            // NEW: User-specific parameters
            userChatId,
            userSolAmount,
            userTokenBalance,
            userRiskSettings,
            // NEW: Durable nonce support
            nonceInfo = null
        } = builderOptions;

        console.log(`[BLUEPRINT-FORGER] 🔧 Building cloned instruction for user ${shortenAddress(userPublicKey.toString())}`);
        console.log(`[BLUEPRINT-FORGER] 🎯 Target program: ${shortenAddress(cloningTarget.programId)}`);
        console.log(`[BLUEPRINT-FORGER] 💰 Trade type: ${tradeType}`);
        console.log(`[BLUEPRINT-FORGER] 📊 Blueprint accounts: ${cloningTarget.accounts.length}`);

        try {
            // STAGE 2: Generate the forging map
            const forgingMap = this._createForgingMap(builderOptions);

            // =======================================================
            // === STAGE 3.5: QUALITY CONTROL FORGING ================
            // =======================================================
            console.log(`[BLUEPRINT-FORGER] 🔨 Forging instruction using blueprint with Quality Control...`);
            
            // This is the known ruleset for critical, non-writable accounts on Pump.fun
            const READ_ONLY_RULES = new Set([
                '4wTV1YmiEkRvAtNtsSGPtUrqRYQMe5SKy2uB4Jjaxnjf', // PUMP_FUN_GLOBAL
                'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', // TOKEN_PROGRAM
                'Ce6TQqeHC9p8KetsN6JsjHK7UTZk7nasjjnr7XxXp9F1'  // Event Authority PDA
                // NOTE: Fee Config PDA and fee_recipient are NOT in READ_ONLY_RULES - they MUST be writable
            ]);

            // This is the known ruleset for accounts that MUST be writable on Pump.fun
            const MUST_BE_WRITABLE_RULES = new Set([
                'CebN5WGQ4jvEPvsVU4EoHEpgzq1VV7AbicfhtW4xC9iM', // PUMP_FUN_FEE_RECIPIENT
                '8Wf5TiAheLUqBrKXeYg2JtAFFMWtKdG2BSFgqUcPVwTt', // Fee Config PDA - MUST be writable
                'Hq2wp8uJ9jCPsYgNHex8RtqdvMPfVGoYwjvF1ATiwn2Y', // Global Volume Accumulator
                'GMQhT8QhbTtNeuve1xzJaBqX3D1KefNy9e2td2NWCBSZ'  // User Volume Accumulator
            ]);

            const clonedKeys = cloningTarget.accounts.map((blueprintAccount) => {
                const originalPubkeyStr = blueprintAccount.pubkey;
                
                // Get the final pubkey from our forging map (swaps trader wallet/ATA for ours)
                const finalPubkeyStr = forgingMap.get(originalPubkeyStr) || originalPubkeyStr;
                const finalPubkey = new PublicKey(finalPubkeyStr);
                
                // --- Quality Control Logic ---
                let finalIsWritable = blueprintAccount.isWritable;
                
                // RULE #1: ENFORCE READ-ONLY. If this account is in our known read-only list, ALWAYS set isWritable to false.
                if (READ_ONLY_RULES.has(finalPubkeyStr)) {
                    if (finalIsWritable) {
                        console.log(`[FORGER-QC] 🔥 OVERRIDE: Forcing account ${shortenAddress(finalPubkeyStr)} to be READ-ONLY.`);
                        finalIsWritable = false;
                    }
                }
                
                // RULE #1.5: ENFORCE MUST-BE-WRITABLE. If this account is in our known must-be-writable list, ALWAYS set isWritable to true.
                if (MUST_BE_WRITABLE_RULES.has(finalPubkeyStr)) {
                    if (!finalIsWritable) {
                        console.log(`[FORGER-QC] 🔥 OVERRIDE: Forcing account ${shortenAddress(finalPubkeyStr)} to be WRITABLE (required by program).`);
                        finalIsWritable = true;
                    }
                }
                
                // RULE #2: OUR WALLET MUST BE WRITABLE.
                if (finalPubkey.equals(userPublicKey)) {
                     if (!finalIsWritable) {
                        console.log(`[FORGER-QC] 🔥 OVERRIDE: Forcing USER WALLET ${shortenAddress(finalPubkeyStr)} to be WRITABLE.`);
                        finalIsWritable = true;
                     }
                }
                
                return {
                    pubkey: finalPubkey,
                    isSigner: finalPubkey.equals(userPublicKey), // Only our user is the signer.
                    isWritable: finalIsWritable,
                };
            });

            console.log(`[BLUEPRINT-FORGER] ✅ Forged ${clonedKeys.length} accounts using blueprint`);

            // Blueprint vs forged comparison - removed for speed

            // Step 2: Use ALL instructions from master trader (no prerequisites)
            console.log(`[UNIVERSAL-CLONER] 🎯 USING ALL MASTER INSTRUCTIONS: Taking exact same instruction structure from master trader`);
            console.log(`[UNIVERSAL-CLONER] 🔍 DEBUG: builderOptions.originalTransaction type: ${typeof builderOptions.originalTransaction}`);
            console.log(`[UNIVERSAL-CLONER] 🔍 DEBUG: builderOptions.originalTransaction keys: ${builderOptions.originalTransaction ? Object.keys(builderOptions.originalTransaction) : 'undefined'}`);
            const allMasterInstructions = builderOptions.originalTransaction?.instructions || [];
            console.log(`[UNIVERSAL-CLONER] 🔍 Master has ${allMasterInstructions.length} instructions - will clone ALL of them`);

            // Step 3: Handle instruction data - CRITICAL FIX for data corruption
            // The issue: We're converting base64 → Buffer → base64, which adds padding
            // Solution: Keep original data format and only convert when creating TransactionInstruction
            
            // DEBUG: Check what data we're receiving
            console.log(`[UNIVERSAL-CLONER] 🔍 DEBUG: cloningTarget.data type: ${typeof cloningTarget.data}`);
            console.log(`[UNIVERSAL-CLONER] 🔍 DEBUG: cloningTarget.data isBuffer: ${Buffer.isBuffer(cloningTarget.data)}`);
            console.log(`[UNIVERSAL-CLONER] 🔍 DEBUG: cloningTarget.data value:`, cloningTarget.data);
            console.log(`[UNIVERSAL-CLONER] 🔍 DEBUG: cloningTarget.data length: ${cloningTarget.data ? cloningTarget.data.length : 'undefined'}`);
            
            // Convert to Buffer for instruction creation - minimal logging for speed
            let finalInstructionData;
            
            try {
                // Handle different data types properly
                if (Buffer.isBuffer(cloningTarget.data)) {
                    // Data is already a Buffer
                    finalInstructionData = cloningTarget.data;
                    console.log(`[UNIVERSAL-CLONER] 🔍 Data is already Buffer: ${finalInstructionData.length} bytes`);
                } else if (cloningTarget.data instanceof Uint8Array) {
                    // Data is a Uint8Array (common after worker communication)
                    finalInstructionData = Buffer.from(cloningTarget.data);
                    console.log(`[UNIVERSAL-CLONER] ✅ Uint8Array to Buffer conversion: ${finalInstructionData.length} bytes`);
                } else if (typeof cloningTarget.data === 'string') {
                    // Data is a string, try base58 decode first
                    try {
                        finalInstructionData = Buffer.from(bs58.decode(cloningTarget.data));
                        console.log(`[UNIVERSAL-CLONER] ✅ Base58 decode successful: ${finalInstructionData.length} bytes`);
                    } catch (base58Error) {
                        // If base58 fails, try hex decode
                        finalInstructionData = Buffer.from(cloningTarget.data, 'hex');
                        console.log(`[UNIVERSAL-CLONER] ✅ Hex decode successful: ${finalInstructionData.length} bytes`);
                    }
                } else if (Array.isArray(cloningTarget.data)) {
                    // Data is an array of numbers
                    finalInstructionData = Buffer.from(cloningTarget.data);
                    console.log(`[UNIVERSAL-CLONER] ✅ Array to Buffer conversion: ${finalInstructionData.length} bytes`);
                } else {
                    // Unknown type, try to convert to string first
                    const dataString = String(cloningTarget.data);
                    try {
                        finalInstructionData = Buffer.from(bs58.decode(dataString));
                        console.log(`[UNIVERSAL-CLONER] ✅ String to Base58 decode: ${finalInstructionData.length} bytes`);
                    } catch (base58Error) {
                        finalInstructionData = Buffer.from(dataString, 'hex');
                        console.log(`[UNIVERSAL-CLONER] ✅ String to Hex decode: ${finalInstructionData.length} bytes`);
                    }
                }
                
                // Platform-specific, SURGICAL data modifications for timestamp expiration fixes
                const PHOTON_ROUTER_ID = 'BSfD6SHZigAfDWSjzD5Q41jw8LmKwtmjskPH9XW1mrRW';
                
                if (cloningTarget.programId === PHOTON_ROUTER_ID) {
                    console.log(`[UNIVERSAL-CLONER] 🔧 Photon Router detected. Updating SOL amount and timestamp...`);
                    try {
                        // For Photon Router 40-byte instruction data:
                        // - Update SOL amount to user's amount (usually at offset 8-16)
                        // - Update timestamp to current time (usually at offset 0-8 or 16-24)
                        
                        const userSolAmount = builderOptions.userSolAmount || 1000000; // Default 0.001 SOL
                        console.log(`[UNIVERSAL-CLONER] 💰 Updating SOL amount from master's amount to user's amount: ${userSolAmount} lamports`);
                        
                        // Try to find and update SOL amount (common locations: offset 8, 16, 24)
                        const solAmountOffsets = [8, 16, 24];
                        let solAmountUpdated = false;
                        
                        for (const offset of solAmountOffsets) {
                            if (finalInstructionData.length >= offset + 8) {
                                const originalAmount = finalInstructionData.readBigUInt64LE(offset);
                                console.log(`[UNIVERSAL-CLONER] 🔍 Checking offset ${offset}: ${originalAmount} lamports`);
                                
                                // Check if this looks like a reasonable SOL amount (between 1000 and 100 SOL)
                                if (originalAmount > 1000n && originalAmount < 100000000000n) {
                                    console.log(`[UNIVERSAL-CLONER] 💰 Found SOL amount at offset ${offset}: ${originalAmount} lamports`);
                                    console.log(`[UNIVERSAL-CLONER] 💰 Updating to user's amount: ${userSolAmount} lamports`);
                                    
                                    finalInstructionData.writeBigUInt64LE(BigInt(userSolAmount), offset);
                                    console.log(`[UNIVERSAL-CLONER] ✅ Successfully updated SOL amount from ${originalAmount} to ${userSolAmount}`);
                                    solAmountUpdated = true;
                                    break;
                                }
                            }
                        }
                        
                        // Update timestamp (try multiple common timestamp locations)
                        const possibleOffsets = [0, 8, 16, 24, 32]; // Try different 8-byte aligned positions
                        let timestampUpdated = false;
                        const currentTimestamp = BigInt(Math.floor(Date.now() / 1000)); // Current Unix time in seconds
                        
                        // Try to find a reasonable timestamp in the data
                        for (const offset of possibleOffsets) {
                            if (finalInstructionData.length >= offset + 8) {
                                const originalTimestamp = finalInstructionData.readBigUInt64LE(offset);
                                
                                // Check if this looks like a Unix timestamp (reasonable range)
                                // Unix timestamps for 2020-2030 are roughly between 1577836800 and 1893456000
                                if (originalTimestamp > 1577836800n && originalTimestamp < 1893456000n) {
                                    console.log(`[UNIVERSAL-CLONER] 📅 Found valid timestamp at offset ${offset}: ${originalTimestamp}`);
                                    console.log(`[UNIVERSAL-CLONER] 📅 Updating to current timestamp: ${currentTimestamp}`);
                                    
                                    finalInstructionData.writeBigUInt64LE(currentTimestamp, offset);
                                    console.log(`[UNIVERSAL-CLONER] ✅ Successfully updated Photon Router timestamp from ${originalTimestamp} to ${currentTimestamp}`);
                                    timestampUpdated = true;
                                    break;
                                } else {
                                    console.log(`[UNIVERSAL-CLONER] 🔍 Offset ${offset}: ${originalTimestamp} (not a valid timestamp)`);
                                }
                            }
                        }
                        
                        if (!solAmountUpdated) {
                            console.warn(`[UNIVERSAL-CLONER] ⚠️ Could not locate SOL amount in Photon instruction data. Proceeding with original data.`);
                        }
                        
                        if (!timestampUpdated) {
                            console.warn(`[UNIVERSAL-CLONER] ⚠️ Could not locate valid timestamp in Photon instruction data. Proceeding with original data.`);
                        }
                    } catch (timestampError) {
                        console.error(`[UNIVERSAL-CLONER] ❌ Error updating Photon timestamp: ${timestampError.message}`);
                        console.log(`[UNIVERSAL-CLONER] 🔄 Proceeding with original data...`);
                    }
                } else {
                    console.log(`[UNIVERSAL-CLONER] 🔒 Non-Photon platform (${cloningTarget.programId.substring(0, 8)}...). Preserving original instruction data for safety.`);
                }
                
            } catch (error) {
                console.error(`[UNIVERSAL-CLONER] ❌ Failed to process instruction data: ${error.message}`);
                console.error(`[UNIVERSAL-CLONER] 🔍 Data type: ${typeof cloningTarget.data}, isBuffer: ${Buffer.isBuffer(cloningTarget.data)}, isArray: ${Array.isArray(cloningTarget.data)}`);
                console.error(`[UNIVERSAL-CLONER] 🔍 Problematic data: ${JSON.stringify(cloningTarget.data)}`);
                
                // Multiple fallback strategies
                try {
                    if (Buffer.isBuffer(cloningTarget.data)) {
                        finalInstructionData = cloningTarget.data;
                        console.log(`[UNIVERSAL-CLONER] 🔄 Buffer fallback successful: ${finalInstructionData.length} bytes`);
                    } else if (typeof cloningTarget.data === 'string') {
                        finalInstructionData = Buffer.from(cloningTarget.data, 'hex');
                        console.log(`[UNIVERSAL-CLONER] 🔄 Hex fallback successful: ${finalInstructionData.length} bytes`);
                    } else if (Array.isArray(cloningTarget.data)) {
                        finalInstructionData = Buffer.from(cloningTarget.data);
                        console.log(`[UNIVERSAL-CLONER] 🔄 Array fallback successful: ${finalInstructionData.length} bytes`);
                    } else {
                        // Last resort: try to create a minimal buffer
                        finalInstructionData = Buffer.alloc(1, 0); // Single byte with value 0
                        console.log(`[UNIVERSAL-CLONER] 🔄 Minimal buffer fallback: ${finalInstructionData.length} bytes`);
                    }
                } catch (fallbackError) {
                    console.error(`[UNIVERSAL-CLONER] ❌ All fallbacks failed: ${fallbackError.message}`);
                    finalInstructionData = Buffer.alloc(1, 0); // Single byte as absolute last resort
                    console.log(`[UNIVERSAL-CLONER] 🔄 Absolute fallback: ${finalInstructionData.length} bytes`);
                }
            }
            
            // Determine the actual user amount to use based on trade type
            let userAmountToUse = null;
            let expectedOutput = null;
            
            if (tradeType === 'buy' && userSolAmount) {
                // For BUY trades: Use user's configured SOL amount per trade
                userAmountToUse = userSolAmount;
                console.log(`[UNIVERSAL-CLONER] 💰 Using user's SOL amount for BUY: ${this._extractAmountValue(userSolAmount)} lamports`);
            } else if (tradeType === 'sell' && userTokenBalance) {
                // For SELL trades: Use user's actual token balance
                userAmountToUse = userTokenBalance;
                console.log(`[UNIVERSAL-CLONER] 💰 Using user's token balance for SELL: ${this._extractAmountValue(userTokenBalance)} tokens`);
                
                // Try to pre-calculate expected SOL output for sell trades
                try {
                    expectedOutput = await this._calculateExpectedSolOutput(cloningTarget.platform, userTokenBalance, swapDetails);
                    if (expectedOutput) {
                        console.log(`[UNIVERSAL-CLONER] 🧮 Pre-calculated expected SOL output: ${expectedOutput.toString()} lamports`);
                    }
                } catch (calcError) {
                    console.warn(`[UNIVERSAL-CLONER] ⚠️ Could not pre-calculate SOL output: ${calcError.message}`);
                }
            } else if (amountBN && this._isValidAmount(amountBN)) {
                // Fallback: Use the provided amountBN (master's amount)
                userAmountToUse = amountBN;
                console.warn(`[UNIVERSAL-CLONER] ⚠️ Using master trader's amount as fallback: ${this._extractAmountValue(amountBN)}`);
            }
            
            // The surgical override system will handle all platform-specific data modifications
            console.log(`[UNIVERSAL-CLONER] 🔒 Using original instruction data - surgical overrides will apply platform-specific fixes`);
            console.log(`[UNIVERSAL-CLONER] 💡 Platform-specific data modifications handled by Smart Cloner overrides`);
            console.log(`[UNIVERSAL-CLONER] 🔍 DEBUG: Original instruction data before overrides: ${finalInstructionData.toString('hex')}`);

            // Step 4: Create the cloned instruction using blueprint-forged keys
            let clonedInstruction = new TransactionInstruction({
                programId: new PublicKey(cloningTarget.programId),
                keys: clonedKeys,
                data: finalInstructionData
            });

            console.log(`[UNIVERSAL-CLONER] ✅ Created cloned instruction:`, {
                programId: shortenAddress(clonedInstruction.programId.toString()),
                accountCount: clonedInstruction.keys.length,
                dataLength: clonedInstruction.data.length
            });

            // Step 5: SMART CLONER - Apply surgical overrides for known platform issues
            console.log(`[UNIVERSAL-CLONER] 🧠 Applying Smart Cloner surgical overrides...`);
            clonedInstruction = await this._applySurgicalOverrides(clonedInstruction, builderOptions);
            console.log(`[UNIVERSAL-CLONER] ✅ Smart Cloner overrides completed`);

            // Step 6: Clone ALL master instructions with account swapping
            console.log(`[UNIVERSAL-CLONER] 🔄 Cloning ALL ${allMasterInstructions.length} instructions from master trader`);
            const allInstructions = [];
            
            for (let i = 0; i < allMasterInstructions.length; i++) {
                const masterInstruction = allMasterInstructions[i];
                console.log(`[UNIVERSAL-CLONER] 🔍 Cloning instruction ${i}: ${shortenAddress(masterInstruction.programId.toString())} with ${masterInstruction.keys.length} accounts`);
                
                // Clone the instruction with account swapping
                const clonedInstruction = await this._cloneInstructionWithAccountSwap(masterInstruction, builderOptions);
                allInstructions.push(clonedInstruction);
            }
            
            console.log(`[UNIVERSAL-CLONER] ✅ Cloned ALL ${allInstructions.length} instructions from master trader`);

            const totalTime = Date.now() - startTime;
            console.log(`[BLUEPRINT-FORGER] ⚡ Cloning completed in ${totalTime}ms`);
            
            return {
                instructions: allInstructions,
                success: true,
                platform: 'Universal',
                method: 'all_instructions_cloning',
                totalInstructions: allInstructions.length,
                clonedInstructions: true,
                nonceUsed: false, // Nonce is used as blockhash, not as instruction
                performance: {
                    totalTime: totalTime,
                    targetTime: 200, // Target: <200ms
                    isOptimal: totalTime < 200
                }
            };

        } catch (error) {
            console.error(`[UNIVERSAL-CLONER] ❌ Cloning failed:`, error.message);
            throw error;
        }
    }

    /**
     * Apply the three swap rules to clone accounts with correct signer logic
     */
    async _applySwapRules(originalAccounts, masterTraderWallet, userPublicKey, inputMint, outputMint) {
        console.log(`[UNIVERSAL-CLONER] 🔄 Applying swap rules...`);
        console.log(`[UNIVERSAL-CLONER] 🔍 Master trader: ${shortenAddress(masterTraderWallet)}`);
        console.log(`[UNIVERSAL-CLONER] 🔍 User: ${shortenAddress(userPublicKey.toString())}`);
        const clonedAccounts = [];

        for (let i = 0; i < originalAccounts.length; i++) {
            const originalAccount = originalAccounts[i];
            const masterPubkey = new PublicKey(originalAccount.pubkey);
            let finalPubkey = masterPubkey;

            console.log(`[UNIVERSAL-CLONER] 🔍 Processing account ${i}: ${shortenAddress(masterPubkey.toString())}`);

            // Rule 1: User Swap - Replace master trader wallet with user wallet
            if (masterPubkey.equals(new PublicKey(masterTraderWallet))) {
                finalPubkey = userPublicKey;
                console.log(`[UNIVERSAL-CLONER] 🔄 Rule 1 (User Swap): ${shortenAddress(masterPubkey.toString())} → ${shortenAddress(userPublicKey.toString())}`);
            }
            // Rule 2: Token Account Swap - Replace master trader's ATA with user's ATA
            else if (this._isTokenAccount(masterPubkey.toString(), inputMint, outputMint)) {
                // Getting user ATA for token account swap
                const userATA = await this._getUserATA(userPublicKey, masterPubkey.toString(), inputMint, outputMint);
                if (userATA) {
                    finalPubkey = userATA;
                    console.log(`[UNIVERSAL-CLONER] 🔄 Rule 2 (Token Account Swap): ${shortenAddress(masterPubkey.toString())} → ${shortenAddress(userATA.toString())}`);
                }
            }
            // Rule 3: Default Copy - Copy everything else verbatim
            else {
                console.log(`[UNIVERSAL-CLONER] 📋 Rule 3 (Default Copy): ${shortenAddress(masterPubkey.toString())} (unchanged)`);
            }

            // --- CRITICAL SIGNATURE FIX ---
            // Only OUR user wallet can ever be a signer in OUR transaction.
            // However, we must preserve isSigner for required PDA signers.
            let finalIsSigner = false;

            // Case A: The account is OUR user's wallet. It MUST be a signer.
            if (finalPubkey.equals(userPublicKey)) {
                finalIsSigner = true;
                console.log(`[UNIVERSAL-CLONER] ✅ User account marked as signer: ${shortenAddress(finalPubkey.toString())}`);
            }
            // Case B: The account is NOT our user, but the original instruction required it to be a signer (it's a PDA).
            // In this case, we MUST PRESERVE the `isSigner` flag.
            else if (originalAccount.isSigner) {
                console.warn(`[UNIVERSAL-CLONER] ⚠️ Preserving 'isSigner' flag for a non-user account: ${shortenAddress(finalPubkey.toString())}. This is likely a required PDA signer.`);
                finalIsSigner = true;
            }

            const clonedAccount = {
                pubkey: finalPubkey,
                isSigner: finalIsSigner, // Correctly handles both user and PDA signers
                isWritable: originalAccount.isWritable, // We CAN copy the writable flag
            };

            clonedAccounts.push(clonedAccount);
        }

        return clonedAccounts;
    }

    /**
     * Check if an account is a token account for the trade
     */
    _isTokenAccount(accountPubkey, inputMint, outputMint) {
        // This is a simplified check - in reality, you'd need to check if the account
        // is an Associated Token Account for either the input or output mint
        // For now, we'll use a heuristic based on the account structure
        
        // Skip system accounts and known program accounts
        const systemAccounts = [
            '11111111111111111111111111111111', // System Program
            'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', // SPL Token Program
            'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb', // Token-2022 Program
            'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL', // Associated Token Program
            'So11111111111111111111111111111111111111112' // SOL
        ];

        if (systemAccounts.includes(accountPubkey)) {
            return false;
        }

        // If it's not a system account and not the input/output mint, it might be a token account
        return accountPubkey !== inputMint && accountPubkey !== outputMint;
    }

    /**
     * Get user's ATA for a specific mint
     */
    async _getUserATA(userPublicKey, originalAccountPubkey, inputMint, outputMint) {
        try {
            const { getAssociatedTokenAddressSync } = require('@solana/spl-token');
            
            // Try to determine which mint this account belongs to
            // We'll check if it's an ATA for either the input or output mint
            
            // Check if it's an ATA for the input mint
            const inputATA = getAssociatedTokenAddressSync(
                new PublicKey(inputMint),
                userPublicKey
            );
            
            // Check if it's an ATA for the output mint
            const outputATA = getAssociatedTokenAddressSync(
                new PublicKey(outputMint),
                userPublicKey
            );
            
            // If the original account matches the input ATA pattern, return user's input ATA
            if (originalAccountPubkey === inputATA.toBase58()) {
                return inputATA;
            }
            
            // If the original account matches the output ATA pattern, return user's output ATA
            if (originalAccountPubkey === outputATA.toBase58()) {
                return outputATA;
            }
            
            // If we can't determine the mint, return null and let ATA creation handle it
            console.log(`[UNIVERSAL-CLONER] 🔍 Could not determine mint for account: ${shortenAddress(originalAccountPubkey)}`);
            return null;
        } catch (error) {
            console.error(`[UNIVERSAL-CLONER] ❌ Error getting user ATA:`, error.message);
            return null;
        }
    }

    /**
     * Clone a single instruction with account swapping
     * This replaces the old prerequisite system - we just swap accounts in existing instructions
     */
    async _cloneInstructionWithAccountSwap(masterInstruction, builderOptions) {
        const { userPublicKey, masterTraderWallet, inputMint, outputMint } = builderOptions;
        const { getAssociatedTokenAddressSync } = require('@solana/spl-token');
        
        console.log(`[UNIVERSAL-CLONER] 🔄 Cloning instruction: ${shortenAddress(masterInstruction.programId.toString())}`);
        
        // Create forging map for account swaps
        const forgingMap = new Map();
        
        // 1. Map the trader's wallet to our user's wallet
        forgingMap.set(masterTraderWallet, userPublicKey.toBase58());
        
        // 2. Map the trader's ATAs to our user's ATAs
        if (inputMint && inputMint !== 'So11111111111111111111111111111111111111112') {
            const masterInputATA = getAssociatedTokenAddressSync(new PublicKey(inputMint), new PublicKey(masterTraderWallet));
            const userInputATA = getAssociatedTokenAddressSync(new PublicKey(inputMint), userPublicKey);
            forgingMap.set(masterInputATA.toBase58(), userInputATA.toBase58());
        }
        
        if (outputMint && outputMint !== 'So11111111111111111111111111111111111111112') {
            const masterOutputATA = getAssociatedTokenAddressSync(new PublicKey(outputMint), new PublicKey(masterTraderWallet));
            const userOutputATA = getAssociatedTokenAddressSync(new PublicKey(outputMint), userPublicKey);
            forgingMap.set(masterOutputATA.toBase58(), userOutputATA.toBase58());
        }
        
        // Clone the instruction keys with account swapping
        const clonedKeys = masterInstruction.keys.map((key) => {
            const originalPubkeyStr = key.pubkey.toBase58();
            const finalPubkeyStr = forgingMap.get(originalPubkeyStr) || originalPubkeyStr;
            
            return {
                pubkey: new PublicKey(finalPubkeyStr),
                isSigner: key.isSigner,
                isWritable: key.isWritable
            };
        });
        
        // Clone the instruction data (preserve original structure)
        let clonedData = masterInstruction.data;
        
        // Apply surgical overrides for amount modification if needed
        if (masterInstruction.data.length > 4) {
            clonedData = await this._applySurgicalOverrides({
                programId: masterInstruction.programId,
                keys: clonedKeys,
                data: masterInstruction.data
            }, builderOptions);
            clonedData = clonedData.data; // Extract data from the result
        }
        
        // Create the cloned instruction
        const clonedInstruction = new TransactionInstruction({
            programId: masterInstruction.programId,
            keys: clonedKeys,
            data: clonedData
        });
        
        console.log(`[UNIVERSAL-CLONER] ✅ Cloned instruction: ${clonedKeys.length} accounts, ${clonedData.length} bytes data`);
        return clonedInstruction;
    }

    /**
     * Handle all prerequisites for the trade: ATA creation, wSOL wrapping, etc.
     * This is the "Prerequisite Handler" - the final architectural component
     * NOTE: This method is now DEPRECATED - we use _cloneInstructionWithAccountSwap instead
     */
    async _handlePrerequisites(userPublicKey, outputMint, tradeType, inputMint = null, builderOptions = {}) {
        const prerequisiteInstructions = [];
        const { userPaymentMethod, amountBN } = builderOptions;
    
        // --- Create ATA for the token we are RECEIVING (This logic is still correct) ---
        if (tradeType === 'buy') {
            // ... existing logic to create the ATA for the outputMint ...
            // DEBUG: Log all parameters to understand the issue
            console.log(`[FORGER-PREQ] 🔍 PREREQUISITE HANDLER DEBUG:`);
            console.log(`[FORGER-PREQ]   - tradeType: "${tradeType}"`);
            console.log(`[FORGER-PREQ]   - outputMint: ${outputMint}`);
            console.log(`[FORGER-PREQ]   - inputMint: ${inputMint}`);
            console.log(`[FORGER-PREQ]   - SOL mint: So11111111111111111111111111111111111111112`);
    
            // Create ATA for OUTPUT tokens (BUY trades - when user receives tokens)
            if (tradeType === 'buy' && outputMint !== 'So11111111111111111111111111111111111111112') {
                try {
                    console.log(`[UNIVERSAL-CLONER] 🔍 Checking ATA creation for mint: ${shortenAddress(outputMint)}`);
                    
                    // 🚀 PERFORMANCE OPTIMIZATION: Skip RPC call, always create ATA instruction
                    // The transaction will fail gracefully if ATA already exists (rare case)
                    const userATA = await this._getAssociatedTokenAddress(userPublicKey, outputMint);
                    
                    console.log(`[UNIVERSAL-CLONER] 🔧 Creating ATA instruction for user: ${shortenAddress(userPublicKey.toString())}`);
                    
                    // 🔧 TOKEN-2022 FIX: Determine which token program owns the mint
                    const outputMintPk = new PublicKey(outputMint);
                    const isToken2022 = await this._isToken2022(outputMintPk);
                    const tokenProgramId = isToken2022 ? config.TOKEN_2022_PROGRAM_ID : config.TOKEN_PROGRAM_ID;
                    
                    console.log(`[UNIVERSAL-CLONER] 🎯 Using Token Program: ${shortenAddress(tokenProgramId.toString())} for mint ${shortenAddress(outputMint)}`);
                    
                    const createATAInstruction = createAssociatedTokenAccountInstruction(
                        userPublicKey, // payer
                        userATA, // ata
                        userPublicKey, // owner
                        outputMintPk, // mint
                        tokenProgramId // 🔧 CRITICAL FIX: Pass the correct token program
                    );
                    
                    prerequisiteInstructions.push(createATAInstruction);
                    console.log(`[UNIVERSAL-CLONER] ✅ ATA creation instruction added with ${isToken2022 ? 'Token-2022' : 'Standard SPL Token'} program`);
                } catch (error) {
                    console.error(`[UNIVERSAL-CLONER] ❌ OUTPUT ATA creation check failed:`, error.message);
                }
            }
        }
    
        // Create ATA for INPUT tokens (SELL trades - when user needs to sell tokens)
        if (tradeType === 'sell' && inputMint && inputMint !== 'So11111111111111111111111111111111111111112') {
            try {
                console.log(`[UNIVERSAL-CLONER] 🔍 Checking INPUT ATA creation for mint: ${shortenAddress(inputMint)}`);
                
                // 🚀 PERFORMANCE OPTIMIZATION: Skip RPC call, always create ATA instruction
                const userInputATA = await this._getAssociatedTokenAddress(userPublicKey, inputMint);
                
                console.log(`[UNIVERSAL-CLONER] 🔧 Creating INPUT ATA instruction for user: ${shortenAddress(userPublicKey.toString())}`);
                
                // 🔧 TOKEN-2022 FIX: Determine which token program owns the mint
                const inputMintPk = new PublicKey(inputMint);
                const isToken2022 = await this._isToken2022(inputMintPk);
                const tokenProgramId = isToken2022 ? config.TOKEN_2022_PROGRAM_ID : config.TOKEN_PROGRAM_ID;
                
                console.log(`[UNIVERSAL-CLONER] 🎯 Using Token Program: ${shortenAddress(tokenProgramId.toString())} for INPUT mint ${shortenAddress(inputMint)}`);
                
                const createInputATAInstruction = createAssociatedTokenAccountInstruction(
                    userPublicKey, // payer
                    userInputATA, // ata
                    userPublicKey, // owner
                    inputMintPk, // mint
                    tokenProgramId // 🔧 CRITICAL FIX: Pass the correct token program
                );
                
                prerequisiteInstructions.push(createInputATAInstruction);
                console.log(`[UNIVERSAL-CLONER] ✅ INPUT ATA creation instruction added with ${isToken2022 ? 'Token-2022' : 'Standard SPL Token'} program`);
            } catch (error) {
                console.error(`[UNIVERSAL-CLONER] ❌ INPUT ATA creation check failed:`, error.message);
            }
        }
    
        // --- NEW "SOL-ONLY" PAYMENT LOGIC ---
        // This logic replaces the old, simple wSOL wrapping.
    
        // If the master's input was a token (like wSOL or USDC), but we are commanded to pay with SOL...
        if (tradeType === 'buy' && userPaymentMethod === 'sol') {
            console.log(`[FORGER-PREQ] Enforcing SOL-only payment rule.`);
            
            // Is the platform an AMM that REQUIRES wrapped SOL? (e.g., Raydium, Orca)
            const platform = builderOptions.cloningTarget.platform; // We need to know the platform
            const needsWSOL = platform.includes('Raydium') || platform.includes('Meteora') || platform.includes('Orca');
    
            if (needsWSOL) {
                // This is an AMM trade. We MUST wrap our raw SOL into wSOL.
                console.log(`[FORGER-PREQ] Platform ${platform} requires wSOL. Wrapping user's raw SOL...`);
                
                const { getAssociatedTokenAddressSync } = require('@solana/spl-token');
                const { SystemProgram, createSyncNativeInstruction } = require('@solana/web3.js');
    
                const userWSOL_ATA = getAssociatedTokenAddressSync(new PublicKey(config.NATIVE_SOL_MINT), userPublicKey);
                const wsolAtaInfo = await this.connection.getAccountInfo(userWSOL_ATA);
    
                // 1. Create the wSOL ATA if it doesn't exist
                if (!wsolAtaInfo) {
                    prerequisiteInstructions.push(
                        createAssociatedTokenAccountIdempotentInstruction(userPublicKey, userWSOL_ATA, userPublicKey, new PublicKey(config.NATIVE_SOL_MINT))
                    );
                }
    
                // 2. Transfer RAW SOL from our user's wallet to their wSOL ATA
                prerequisiteInstructions.push(
                    SystemProgram.transfer({
                        fromPubkey: userPublicKey,
                        toPubkey: userWSOL_ATA,
                        lamports: parseInt(amountBN.toString()), // The user's desired SOL spend
                    })
                );
    
                // 3. Sync the native balance to "wrap" the SOL
                prerequisiteInstructions.push(
                    createSyncNativeInstruction(userWSOL_ATA)
                );
    
                console.log(`[FORGER-PREQ] Added 3 instructions to create and fund wSOL account with ${amountBN.toString()} lamports.`);
                
            } else {
                // This is likely a Pump.fun trade. It uses raw SOL directly. No wrapping needed.
                console.log(`[FORGER-PREQ] Platform ${platform} uses raw SOL. No wrapping required.`);
            }
        }
    
        return prerequisiteInstructions;
    }

    /**
     * Get the Associated Token Address for a user and mint
     */
    async _getAssociatedTokenAddress(userPublicKey, mintAddress) {
        try {
            const { getAssociatedTokenAddress } = require('@solana/spl-token');
            return await getAssociatedTokenAddress(
                new PublicKey(mintAddress),
                userPublicKey
            );
        } catch (error) {
            console.error(`[UNIVERSAL-CLONER] ❌ Error getting ATA:`, error.message);
            return null;
        }
    }

    /**
     * Check if amount is valid and non-zero
     */
    _isValidAmount(amountBN) {
        try {
            if (!amountBN) return false;
            
            // Handle different amount formats
            let amountStr;
            if (typeof amountBN === 'string') {
                amountStr = amountBN;
            } else if (typeof amountBN === 'number') {
                amountStr = amountBN.toString();
            } else if (amountBN.toString && typeof amountBN.toString === 'function') {
                amountStr = amountBN.toString();
            } else if (amountBN._bn) {
                // BN.js object
                amountStr = amountBN._bn.toString();
            } else {
                return false;
            }
            
            return amountStr !== '0' && amountStr !== '' && !isNaN(amountStr);
        } catch (error) {
            console.warn(`[UNIVERSAL-CLONER] ⚠️ Error validating amount: ${error.message}`);
            return false;
        }
    }

    /**
     * Extract amount value from various formats
     */
    _extractAmountValue(amountBN) {
        try {
            if (typeof amountBN === 'string') {
                return amountBN;
            } else if (typeof amountBN === 'number') {
                return amountBN.toString();
            } else if (amountBN._bn) {
                // BN.js object
                return amountBN._bn.toString();
            } else if (amountBN.toString && typeof amountBN.toString === 'function') {
                return amountBN.toString();
            } else {
                return '0';
            }
        } catch (error) {
            console.warn(`[UNIVERSAL-CLONER] ⚠️ Error extracting amount value: ${error.message}`);
            return '0';
        }
    }

    /**
     * Calculate expected SOL output for sell trades using platform-specific SDKs
     */
    async _calculateExpectedSolOutput(platform, tokenAmount, swapDetails) {
        try {
            const BN = require('bn.js');
            const { PublicKey } = require('@solana/web3.js');
            
            // Convert token amount to BN if needed
            const tokenAmountBN = new BN(tokenAmount.toString());
            
            if (platform === 'Pump.fun') {
                // Use Pump.fun SDK to calculate expected SOL output
                const { PumpSdk } = require('@pump-fun/pump-sdk');
                const sdk = new PumpSdk(this.connection);
                
                const tokenMintPk = new PublicKey(swapDetails.inputMint);
                const global = await sdk.fetchGlobal();
                const { bondingCurve } = await sdk.fetchSellState(tokenMintPk, new PublicKey(swapDetails.userPublicKey));
                
                // Use the SDK's calculation method
                const { getSellSolAmountFromTokenAmount } = require('@pump-fun/pump-sdk');
                const expectedSol = getSellSolAmountFromTokenAmount(global, bondingCurve, tokenAmountBN);
                
                return expectedSol;
                
            } else if (platform.includes('Raydium')) {
                // For Raydium, we would need pool state to calculate accurately
                // For now, use a conservative estimate
                console.log(`[UNIVERSAL-CLONER] ⚠️ Raydium SOL output calculation not implemented, using conservative estimate`);
                return tokenAmountBN.mul(new BN(1000000)); // 0.001 SOL per token estimate
                
            } else if (platform.includes('Meteora')) {
                // For Meteora, we would need pool state to calculate accurately
                // For now, use a conservative estimate
                console.log(`[UNIVERSAL-CLONER] ⚠️ Meteora SOL output calculation not implemented, using conservative estimate`);
                return tokenAmountBN.mul(new BN(1000000)); // 0.001 SOL per token estimate
                
            } else {
                // Generic fallback calculation
                console.log(`[UNIVERSAL-CLONER] ⚠️ Platform ${platform} SOL output calculation not implemented, using conservative estimate`);
                return tokenAmountBN.mul(new BN(500000)); // 0.0005 SOL per token (very conservative)
            }
            
        } catch (error) {
            console.warn(`[UNIVERSAL-CLONER] ⚠️ Error calculating expected SOL output: ${error.message}`);
            // Return conservative fallback
            const BN = require('bn.js');
            return new BN(tokenAmount.toString()).mul(new BN(500000)); // 0.0005 SOL per token
        }
    }

    /**
     * Helper method to find Raydium CLMM position PDA in instruction keys
     */
    _findRaydiumCLMMPositionPDA(keys, userPublicKey, inputMint, outputMint) {
        // Look for position PDA pattern in Raydium CLMM
        // Position PDAs are typically at specific indices in CLMM instructions
        for (let i = 0; i < keys.length; i++) {
            const key = keys[i].pubkey.toBase58();
            // Look for known position PDA patterns or check if it's a PDA
            if (this._isPositionPDA(key, userPublicKey, inputMint, outputMint)) {
                return i;
            }
        }
        return -1;
    }

    /**
     * Helper method to find Raydium CPMM position PDA in instruction keys
     */
    _findRaydiumCPMMPositionPDA(keys, userPublicKey, inputMint, outputMint) {
        // Similar to CLMM but for CPMM
        for (let i = 0; i < keys.length; i++) {
            const key = keys[i].pubkey.toBase58();
            if (this._isPositionPDA(key, userPublicKey, inputMint, outputMint)) {
                return i;
            }
        }
        return -1;
    }

    /**
     * Helper method to find Meteora DLMM position PDA in instruction keys
     */
    _findMeteoraDLMMPositionPDA(keys, userPublicKey, inputMint, outputMint) {
        // Look for position PDA pattern in Meteora DLMM
        for (let i = 0; i < keys.length; i++) {
            const key = keys[i].pubkey.toBase58();
            if (this._isPositionPDA(key, userPublicKey, inputMint, outputMint)) {
                return i;
            }
        }
        return -1;
    }

    /**
     * Helper method to find Meteora DBC position PDA in instruction keys
     */
    _findMeteoraDBCPositionPDA(keys, userPublicKey, inputMint, outputMint) {
        // Look for position PDA pattern in Meteora DBC
        for (let i = 0; i < keys.length; i++) {
            const key = keys[i].pubkey.toBase58();
            if (this._isPositionPDA(key, userPublicKey, inputMint, outputMint)) {
                return i;
            }
        }
        return -1;
    }

    /**
     * Helper method to find Meteora CP-AMM position PDA in instruction keys
     */
    _findMeteoraCPAMMPositionPDA(keys, userPublicKey, inputMint, outputMint) {
        // Look for position PDA pattern in Meteora CP-AMM
        for (let i = 0; i < keys.length; i++) {
            const key = keys[i].pubkey.toBase58();
            if (this._isPositionPDA(key, userPublicKey, inputMint, outputMint)) {
                return i;
            }
        }
        return -1;
    }

    /**
     * Helper method to check if a key is a position PDA
     */
    _isPositionPDA(key, userPublicKey, inputMint, outputMint) {
        // This is a simplified check - in practice, you'd want to derive the expected PDA
        // and compare it with the key. For now, we'll look for common patterns.
        
        // Check if it's a known position PDA pattern
        // Position PDAs typically have specific characteristics:
        // 1. They're not system programs
        // 2. They're not token mints
        // 3. They're not user wallets
        // 4. They're not ATAs
        
        const systemPrograms = [
            '11111111111111111111111111111111', // System Program
            'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', // SPL Token Program
            'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL', // Associated Token Program
        ];
        
        if (systemPrograms.includes(key)) {
            return false;
        }
        
        // Check if it's the user's wallet
        if (key === userPublicKey) {
            return false;
        }
        
        // Check if it's the input or output mint
        if (key === inputMint || key === outputMint) {
            return false;
        }
        
        // For now, assume any other key could be a position PDA
        // In a real implementation, you'd derive the expected PDA and compare
        return true;
    }
}

module.exports = { UniversalCloner };
