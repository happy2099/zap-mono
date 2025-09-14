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
    }

    /**
     * Helper function to detect if a mint uses Token-2022 program
     * @param {PublicKey} mintPubkey - The mint public key to check
     * @returns {Promise<boolean>} - True if Token-2022, false if standard SPL Token
     */
    async _isToken2022(mintPubkey) {
        try {
            const mintInfo = await this.connection.getAccountInfo(mintPubkey);
            if (!mintInfo) {
                console.warn(`[UNIVERSAL-CLONER] ⚠️ Mint ${shortenAddress(mintPubkey.toString())} not found, assuming standard SPL Token`);
                return false;
            }
            
            const isToken2022 = mintInfo.owner.equals(config.TOKEN_2022_PROGRAM_ID);
            console.log(`[UNIVERSAL-CLONER] 🔍 Mint ${shortenAddress(mintPubkey.toString())} uses ${isToken2022 ? 'Token-2022' : 'Standard SPL Token'} program`);
            return isToken2022;
        } catch (error) {
            console.error(`[UNIVERSAL-CLONER] ❌ Error checking token program for mint ${shortenAddress(mintPubkey.toString())}:`, error.message);
            // Default to standard SPL Token on error
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
        config.PUMP_FUN_BUY_DISCRIMINATOR.copy(freshInstructionData, 0);

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
        console.log(`[FORGER]   - Discriminator: ${config.PUMP_FUN_BUY_DISCRIMINATOR.toString('hex')}`);
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
        config.PUMP_FUN_SELL_DISCRIMINATOR.copy(freshInstructionData, 0);

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
        console.log(`[FORGER]   - Discriminator: ${config.PUMP_FUN_SELL_DISCRIMINATOR.toString('hex')}`);
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
        const freshInstructionData = Buffer.alloc(24); // Pump.fun instruction is 24 bytes
        
        // 1. Copy master's discriminator exactly (bytes 0-7)
        masterDiscriminator.copy(freshInstructionData, 0);
        
        // 2. Set minimal token output for maximum slippage tolerance (bytes 8-15)
        const minTokenOut = BigInt(1);
        freshInstructionData.writeBigUInt64LE(minTokenOut, 8);
        
        // 3. Set user's max SOL cost (bytes 16-23)
        freshInstructionData.writeBigUInt64LE(BigInt(ourMaxSolCost.toString()), 16);

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
     * 🔄 PHOTON ROUTER CPI EXTRACTION: Extract inner Pump.fun instruction from Photon Router
     * This converts complex router calls into direct Pump.fun calls for successful cloning
     */
    async _extractAndClonePumpFunFromPhoton(photonInstruction, builderOptions) {
        try {
            console.log(`[FORGER-PHOTON] 🔄 Starting CPI extraction from Photon Router...`);
            
            // Create a direct Pump.fun instruction using our platformBuilders
            const { userPublicKey, outputMint, inputMint, tradeType, userSolAmount, slippageBps } = builderOptions;
            
            console.log(`[FORGER-PHOTON] 🎯 Reconstructing as direct Pump.fun ${tradeType.toUpperCase()} instruction`);
            console.log(`[FORGER-PHOTON] 💰 Amount: ${userSolAmount} lamports`);
            console.log(`[FORGER-PHOTON] 📊 Slippage: ${slippageBps} BPS`);
            console.log(`[FORGER-PHOTON] 🪙 Token: ${outputMint || inputMint}`);
            
            // Import platformBuilders dynamically to avoid circular dependency
            const { buildPumpFunInstruction } = require('./platformBuilders');
            const { PumpSdk } = require('@pump-fun/pump-sdk');
            
            // Build the direct Pump.fun instruction using proper builderOptions format
            const pumpBuilderOptions = {
                connection: this.connection,
                keypair: { publicKey: userPublicKey }, // Mock keypair structure
                swapDetails: {
                    tradeType: tradeType,
                    inputMint: tradeType === 'sell' ? (outputMint || inputMint) : 'So11111111111111111111111111111111111111112',
                    outputMint: tradeType === 'buy' ? (outputMint || inputMint) : 'So11111111111111111111111111111111111111112'
                },
                amountBN: new (require('bn.js'))(userSolAmount),
                slippageBps: slippageBps,
                sdk: new PumpSdk(this.connection), // Add SDK instance
                apiManager: this.apiManager // Pass apiManager for Jupiter quotes
            };
            
            const directPumpFunInstruction = await buildPumpFunInstruction(pumpBuilderOptions);
            
            console.log(`[FORGER-PHOTON] ✅ Successfully extracted and rebuilt as direct Pump.fun instruction`);
            console.log(`[FORGER-PHOTON] 📊 Direct instruction: Program ${shortenAddress(directPumpFunInstruction.programId.toBase58())}, Accounts: ${directPumpFunInstruction.keys.length}`);
            
            // Return the full instruction object (programId, keys, data)
            return directPumpFunInstruction;
            
        } catch (error) {
            console.error(`[FORGER-PHOTON] ❌ CPI extraction failed:`, error.message);
            console.log(`[FORGER-PHOTON] 🔄 Falling back to conservative cloning...`);
            
            // Fall back to original instruction (this will likely fail, but it's a safety net)
            throw error; // Re-throw to let the calling function handle the fallback
        }
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

        // 🔄 CASE 0: Photon Router -> EXTRACT INNER PUMP.FUN INSTRUCTION (CPI Extraction Override)
        if (programIdStr === 'BSfD6SHZigAfDWSjzD5Q41jw8LmKwtmjskPH9XW1mrRW') {
            console.log(`[FORGER] 🔄 PHOTON ROUTER DETECTED: Extracting inner Pump.fun instruction for direct cloning`);
            console.log(`[FORGER] 🎯 CPI EXTRACTION OVERRIDE: Converting router call to direct Pump.fun call`);
            
            // Extract the inner Pump.fun instruction and reconstruct as direct call
            const directInstruction = await this._extractAndClonePumpFunFromPhoton(clonedInstruction, builderOptions);
            
            // Update the cloned instruction to use direct Pump.fun program and accounts
            clonedInstruction.programId = directInstruction.programId;
            clonedInstruction.keys = directInstruction.keys;
            
            console.log(`[FORGER] ✅ Photon Router converted to direct Pump.fun instruction`);
            console.log(`[FORGER] 📊 New program: ${shortenAddress(directInstruction.programId.toBase58())}`);
            console.log(`[FORGER] 📊 New accounts: ${directInstruction.keys.length}`);
            
            return directInstruction.data;
        }

        // 🎯 CASE 1: Pump.fun Buy -> TRANSACTION-DRIVEN RECONSTRUCTION (Maximum Accuracy)
        if ((programIdStr === config.PUMP_FUN_PROGRAM_ID.toBase58() || 
             programIdStr === config.PUMP_FUN_PROGRAM_ID_VARIANT.toBase58()) && 
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

        // 🔒 CASE 3: All Other Platforms -> PRESERVE ORIGINAL (Maximum Universality)
        else {
            console.log(`[FORGER] 🔒 CONSERVATIVE OVERRIDE: Unknown platform - preserving original data for safety`);
        }

        // Update the instruction with the potentially modified data
        clonedInstruction.data = finalInstructionData;

        // --- STRUCTURAL FIXES (Applied to all platforms) ---
        // These are account-level fixes, not data-level fixes

        // --- OVERRIDE RULE #1: Pump.fun User Volume Accumulator PDA Fix ---
        if (programIdStr === config.PUMP_FUN_PROGRAM_ID.toBase58() || programIdStr === config.PUMP_FUN_PROGRAM_ID_VARIANT.toBase58()) {
            console.log(`[FORGER] 🎯 Detected Pump.fun. Fixing user_volume_accumulator PDA...`);
            
            try {
                const { userPublicKey } = builderOptions;
                
                // The user_volume_accumulator is typically at index 13 based on the error logs
                const USER_VOLUME_ACCUMULATOR_INDEX = 13;
                
                if (clonedInstruction.keys.length > USER_VOLUME_ACCUMULATOR_INDEX) {
                    // Derive the correct PDA for our user
                    const [userVolumeAccumulator] = PublicKey.findProgramAddressSync(
                        [
                            Buffer.from("user_volume_accumulator"),
                            userPublicKey.toBuffer()
                        ],
                        new PublicKey(programIdStr)
                    );
                    
                    const oldPDA = clonedInstruction.keys[USER_VOLUME_ACCUMULATOR_INDEX].pubkey.toBase58();
                    clonedInstruction.keys[USER_VOLUME_ACCUMULATOR_INDEX].pubkey = userVolumeAccumulator;
                    
                    console.log(`[FORGER] ✅ OVERRIDE APPLIED: Updated user_volume_accumulator PDA:`);
                    console.log(`[FORGER]   Old: ${shortenAddress(oldPDA)}`);
                    console.log(`[FORGER]   New: ${shortenAddress(userVolumeAccumulator.toBase58())}`);
                } else {
                    console.warn(`[FORGER] ⚠️ Cannot find user_volume_accumulator at expected index ${USER_VOLUME_ACCUMULATOR_INDEX}`);
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

            // Step 2: Handle all prerequisites (ATA creation, wSOL wrapping, etc.)
            const prerequisiteInstructions = await this._handlePrerequisites(
                userPublicKey,
                outputMint,
                tradeType,
                inputMint, // Pass inputMint for comprehensive prerequisite handling
                builderOptions // 🚀 CRITICAL: Pass builderOptions for userSolAmount
            );

            // Step 3: Handle instruction data - CRITICAL FIX for data corruption
            // The issue: We're converting base64 → Buffer → base64, which adds padding
            // Solution: Keep original data format and only convert when creating TransactionInstruction
            
            // Convert to Buffer for instruction creation - minimal logging for speed
            let finalInstructionData;
            
            try {
                finalInstructionData = Buffer.from(bs58.decode(cloningTarget.data)); // CRITICAL FIX: Decode from Base58, not Base64
                
                // Platform-specific, SURGICAL data modifications for timestamp expiration fixes
                const PHOTON_ROUTER_ID = 'BSfD6SHZigAfDWSjzD5Q41jw8LmKwtmjskPH9XW1mrRW';
                
                if (cloningTarget.programId === PHOTON_ROUTER_ID) {
                    console.log(`[UNIVERSAL-CLONER] 🔧 Photon Router detected. Attempting to update timestamp...`);
                    try {
                        // Based on the 40-byte instruction data, attempt to locate and update timestamp
                        // Let's try multiple common timestamp locations
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
                console.error(`[UNIVERSAL-CLONER] ❌ Failed to decode base58 data: ${error.message}`);
                console.error(`[UNIVERSAL-CLONER] 🔍 Problematic data: ${JSON.stringify(cloningTarget.data)}`);
                // Fallback: treat as hex or raw
                try {
                    finalInstructionData = Buffer.from(cloningTarget.data, 'hex');
                    console.log(`[UNIVERSAL-CLONER] 🔄 Fallback hex decode successful: ${finalInstructionData.length} bytes`);
                } catch (hexError) {
                    console.error(`[UNIVERSAL-CLONER] ❌ Hex fallback also failed: ${hexError.message}`);
                    finalInstructionData = Buffer.alloc(0); // Empty buffer as last resort
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

            // Step 6: Prepare all instructions (prerequisites + cloned instruction)
            let allInstructions = [...prerequisiteInstructions, clonedInstruction];
            
            // Step 7: Add durable nonce instruction if provided (must be FIRST)
            if (nonceInfo) {
                console.log(`[UNIVERSAL-CLONER] 🔐 Adding durable nonce instruction for account: ${shortenAddress(nonceInfo.noncePubkey.toString())}`);
                const nonceInstruction = SystemProgram.nonceAdvance({
                    noncePubkey: nonceInfo.noncePubkey,
                    authorizedPubkey: nonceInfo.authorizedPubkey,
                });
                allInstructions.unshift(nonceInstruction); // Add as FIRST instruction
                console.log(`[UNIVERSAL-CLONER] ✅ Durable nonce instruction added - transaction will never expire`);
            }

            return {
                instructions: allInstructions,
                success: true,
                platform: 'Universal',
                method: 'swap_rules_cloning',
                prerequisiteInstructions: prerequisiteInstructions.length,
                clonedInstruction: true,
                nonceUsed: !!nonceInfo
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
     * Handle all prerequisites for the trade: ATA creation, wSOL wrapping, etc.
     * This is the "Prerequisite Handler" - the final architectural component
     */
    async _handlePrerequisites(userPublicKey, outputMint, tradeType, inputMint = null, builderOptions = {}) {
        const ataInstructions = [];

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
                
                // Check if user already has an ATA for this token
                const userATA = await this._getAssociatedTokenAddress(userPublicKey, outputMint);
                const ataAccountInfo = await this.connection.getAccountInfo(userATA);
                
                if (!ataAccountInfo) {
                    console.log(`[UNIVERSAL-CLONER] 🔧 Creating ATA for user: ${shortenAddress(userPublicKey.toString())}`);
                    
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
                    
                    ataInstructions.push(createATAInstruction);
                    console.log(`[UNIVERSAL-CLONER] ✅ ATA creation instruction added with ${isToken2022 ? 'Token-2022' : 'Standard SPL Token'} program`);
                } else {
                    console.log(`[UNIVERSAL-CLONER] ✅ User already has ATA for this token`);
                }
            } catch (error) {
                console.error(`[UNIVERSAL-CLONER] ❌ OUTPUT ATA creation check failed:`, error.message);
            }
        }

        // Create ATA for INPUT tokens (SELL trades - when user needs to sell tokens)
        if (tradeType === 'sell' && inputMint && inputMint !== 'So11111111111111111111111111111111111111112') {
            try {
                console.log(`[UNIVERSAL-CLONER] 🔍 Checking INPUT ATA creation for mint: ${shortenAddress(inputMint)}`);
                
                // Check if user already has an ATA for this input token
                const userInputATA = await this._getAssociatedTokenAddress(userPublicKey, inputMint);
                const inputATAAccountInfo = await this.connection.getAccountInfo(userInputATA);
                
                if (!inputATAAccountInfo) {
                    console.log(`[UNIVERSAL-CLONER] 🔧 Creating INPUT ATA for user: ${shortenAddress(userPublicKey.toString())}`);
                    
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
                    
                    ataInstructions.push(createInputATAInstruction);
                    console.log(`[UNIVERSAL-CLONER] ✅ INPUT ATA creation instruction added with ${isToken2022 ? 'Token-2022' : 'Standard SPL Token'} program`);
                } else {
                    console.log(`[UNIVERSAL-CLONER] ✅ User already has INPUT ATA for this token`);
                }
            } catch (error) {
                console.error(`[UNIVERSAL-CLONER] ❌ INPUT ATA creation check failed:`, error.message);
            }
        }

        // 🚀 PLATFORM-SPECIFIC wSOL prerequisite handling
        // Only AMM platforms (Raydium, Meteora) need wSOL, not Pump.fun
        const needsWSOL = builderOptions.platform && 
                         (builderOptions.platform.includes('Raydium') || 
                          builderOptions.platform.includes('Meteora') ||
                          builderOptions.platform.includes('AMM'));
        
        if (tradeType === 'buy' && inputMint === 'So11111111111111111111111111111111111111112' && needsWSOL) {
            try {
                console.log(`[FORGER-PREQ] 🔍 AMM BUY trade detected with SOL as input - checking wSOL prerequisite for ${builderOptions.platform}...`);
                
                const { getAssociatedTokenAddressSync } = require('@solana/spl-token');
                const { SystemProgram } = require('@solana/web3.js');
                const { createSyncNativeInstruction } = require('@solana/spl-token');
                
                // Check if user has a wSOL ATA
                const userWSOLATA = getAssociatedTokenAddressSync(
                    new PublicKey('So11111111111111111111111111111111111111112'), 
                    userPublicKey
                );
                
                const wsolATAInfo = await this.connection.getAccountInfo(userWSOLATA);
                
                // CRITICAL FIX: Always ensure wSOL ATA is funded for AMM trades!
                // AMMs require wSOL accounts to have sufficient balance, even if they exist
                
                if (!wsolATAInfo) {
                    console.log(`[FORGER-PREQ] ⚠️ User is missing a Wrapped SOL account. Creating and funding it...`);
                    
                    // 1. Create the wSOL ATA
                    const createWSOLATAInstruction = createAssociatedTokenAccountInstruction(
                        userPublicKey, // payer
                        userWSOLATA, // ata
                        userPublicKey, // owner
                        new PublicKey('So11111111111111111111111111111111111111112'), // mint (wSOL)
                        config.TOKEN_PROGRAM_ID // token program
                    );
                    
                    ataInstructions.push(createWSOLATAInstruction);
                    console.log(`[FORGER-PREQ] ✅ wSOL ATA creation instruction added`);
                } else {
                    console.log(`[FORGER-PREQ] ✅ User has wSOL ATA - will fund it for AMM trade`);
                }
                
                // ALWAYS fund the wSOL ATA for AMM trades (regardless of existence)
                console.log(`[FORGER-PREQ] 💰 Funding wSOL ATA for AMM trade with user's configured amount...`);
                
                // 2. Transfer SOL to the wSOL ATA to fund it
                const { userSolAmount } = builderOptions;
                
                if (!userSolAmount || userSolAmount.toString() === '0') {
                    throw new Error("[FORGER-PREQ] userSolAmount is missing or zero, cannot fund wSOL account.");
                }
                
                // Convert BN to number for the transfer instruction
                const solAmountToWrap = typeof userSolAmount === 'object' ? parseInt(userSolAmount.toString()) : userSolAmount;
                
                const transferSOLInstruction = SystemProgram.transfer({
                    fromPubkey: userPublicKey,
                    toPubkey: userWSOLATA,
                    lamports: solAmountToWrap // 🎯 USE THE CORRECT USER AMOUNT
                });
                
                ataInstructions.push(transferSOLInstruction);
                console.log(`[FORGER-PREQ] ✅ SOL transfer instruction added (${solAmountToWrap} lamports) - USER'S CONFIGURED AMOUNT`);
                
                // 3. Sync native to convert SOL to wSOL
                const syncNativeInstruction = createSyncNativeInstruction(userWSOLATA);
                ataInstructions.push(syncNativeInstruction);
                console.log(`[FORGER-PREQ] ✅ Sync native instruction added to convert SOL to wSOL`);
                console.log(`[FORGER-PREQ] 🎯 AMM wSOL prerequisite completed - account funded and ready`);
                
                
            } catch (error) {
                console.error(`[FORGER-PREQ] ❌ wSOL prerequisite check failed:`, error.message);
            }
        } else if (tradeType === 'buy' && inputMint === 'So11111111111111111111111111111111111111112' && !needsWSOL) {
            console.log(`[FORGER-PREQ] ✅ Pump.fun BUY trade - no wSOL needed, using direct SOL`);
        }

        return ataInstructions;
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
}

module.exports = { UniversalCloner };
