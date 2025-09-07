// ==========================================
// Universal Instruction Cloner - Platform Agnostic
// ==========================================
// File: universalCloner.js
// Description: Universal cloner that works with any platform using swap rules

const { Connection, PublicKey, Transaction, TransactionInstruction, SystemProgram } = require('@solana/web3.js');
const { createAssociatedTokenAccountInstruction } = require('@solana/spl-token');
const { shortenAddress } = require('./utils.js');
const bs58 = require('bs58');

class UniversalCloner {
    constructor(connection) {
        this.connection = connection;
    }

    /**
     * Main cloning function - applies the three swap rules
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

        console.log(`[UNIVERSAL-CLONER] 🔧 Building cloned instruction for user ${shortenAddress(userPublicKey.toString())}`);
        console.log(`[UNIVERSAL-CLONER] 🎯 Target program: ${shortenAddress(cloningTarget.programId)}`);
        console.log(`[UNIVERSAL-CLONER] 💰 Trade type: ${tradeType}`);
        console.log(`[UNIVERSAL-CLONER] 📊 Account count: ${cloningTarget.accounts.length}`);

        try {
            // Step 1: Apply the three swap rules
            // Ready to apply swap rules
            
            const clonedAccounts = await this._applySwapRules(
                cloningTarget.accounts,
                masterTraderWallet,
                userPublicKey,
                inputMint,
                outputMint
            );

            console.log(`[UNIVERSAL-CLONER] ✅ Applied swap rules to ${clonedAccounts.length} accounts`);

            // Step 2: Check if user needs ATA creation
            const ataInstructions = await this._checkATACreation(
                userPublicKey,
                outputMint,
                tradeType
            );

            // Step 3: Handle instruction data - CRITICAL FIX for data corruption
            // The issue: We're converting base64 → Buffer → base64, which adds padding
            // Solution: Keep original data format and only convert when creating TransactionInstruction
            
            console.log(`[UNIVERSAL-CLONER] 🔍 Input data: ${cloningTarget.data}`);
            console.log(`[UNIVERSAL-CLONER] 🔍 Input data type: ${typeof cloningTarget.data}`);
            
            // Store original data format for comparison
            const originalDataString = cloningTarget.data;
            
            // Convert to Buffer for instruction creation (but don't re-encode to base64)
            let finalInstructionData;
            console.log(`[UNIVERSAL-CLONER] 🔍 Input data: ${cloningTarget.data}`);
            console.log(`[UNIVERSAL-CLONER] 🔍 Input data type: ${typeof cloningTarget.data}`);
            console.log(`[UNIVERSAL-CLONER] 🔍 Input data length: ${cloningTarget.data ? cloningTarget.data.length : 'null'}`);
            
            try {
                finalInstructionData = Buffer.from(bs58.decode(cloningTarget.data)); // CRITICAL FIX: Decode from Base58, not Base64
                console.log(`[UNIVERSAL-CLONER] 🔍 Decoded buffer length: ${finalInstructionData.length} bytes`);
                console.log(`[UNIVERSAL-CLONER] 🔍 Decoded buffer (hex): ${finalInstructionData.toString('hex')}`);
                
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
            if (tradeType === 'buy' && userSolAmount) {
                // For BUY trades: Use user's configured SOL amount per trade
                userAmountToUse = userSolAmount;
                console.log(`[UNIVERSAL-CLONER] 💰 Using user's SOL amount for BUY: ${this._extractAmountValue(userSolAmount)} lamports`);
            } else if (tradeType === 'sell' && userTokenBalance) {
                // For SELL trades: Use user's actual token balance
                userAmountToUse = userTokenBalance;
                console.log(`[UNIVERSAL-CLONER] 💰 Using user's token balance for SELL: ${this._extractAmountValue(userTokenBalance)} tokens`);
            } else if (amountBN && this._isValidAmount(amountBN)) {
                // Fallback: Use the provided amountBN (master's amount)
                userAmountToUse = amountBN;
                console.warn(`[UNIVERSAL-CLONER] ⚠️ Using master trader's amount as fallback: ${this._extractAmountValue(amountBN)}`);
            }
            
            // CRITICAL FIX: For production safety, preserve original data unless we're 100% sure
            // The data corruption issue shows we need to be more conservative
            console.log(`[UNIVERSAL-CLONER] 🔒 PRODUCTION SAFETY: Using original instruction data to prevent corruption`);
            console.log(`[UNIVERSAL-CLONER] 💡 User amount will be handled by account balance, not data modification`);
            
            // Future enhancement: Add platform-specific data modification only for known, tested platforms
            if (userAmountToUse && this._isValidAmount(userAmountToUse)) {
                console.log(`[UNIVERSAL-CLONER] 📊 User amount available: ${this._extractAmountValue(userAmountToUse)} lamports`);
                console.log(`[UNIVERSAL-CLONER] 🔄 For safety, keeping original data format and relying on account states`);
                
                // Only modify for explicitly supported platforms where we've tested the data format
                if (cloningTarget.programId === '6EF8rrecthR5DkVaGFKLkma4YkdrkvPPHoqUPLQkwQjR') { // Pump.fun - tested
                    console.log(`[UNIVERSAL-CLONER] 🔧 Pump.fun detected - applying tested data modification`);
                    if (finalInstructionData.length >= 24) {
                        const amountValue = this._extractAmountValue(userAmountToUse);
                        finalInstructionData.writeBigUInt64LE(BigInt(amountValue), 16);
                        console.log(`[UNIVERSAL-CLONER] ✅ Modified Pump.fun instruction data with user amount: ${amountValue}`);
                    }
                } else {
                    console.log(`[UNIVERSAL-CLONER] 🔒 Unknown/untested platform - preserving original data for safety`);
                }
            }

            // Step 4: Create the cloned instruction
            const clonedInstruction = new TransactionInstruction({
                programId: new PublicKey(cloningTarget.programId),
                keys: clonedAccounts,
                data: finalInstructionData
            });

            console.log(`[UNIVERSAL-CLONER] ✅ Created cloned instruction:`, {
                programId: shortenAddress(clonedInstruction.programId.toString()),
                accountCount: clonedInstruction.keys.length,
                dataLength: clonedInstruction.data.length
            });

            // Step 5: Prepare all instructions (ATA creation + cloned instruction)
            let allInstructions = [...ataInstructions, clonedInstruction];
            
            // Step 6: Add durable nonce instruction if provided (must be FIRST)
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
                ataInstructions: ataInstructions.length,
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
            'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', // Token Program
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
     * Check if user needs ATA creation for the output token
     */
    async _checkATACreation(userPublicKey, outputMint, tradeType) {
        const ataInstructions = [];

        // Only create ATA for BUY trades (when user receives tokens)
        if (tradeType === 'buy' && outputMint !== 'So11111111111111111111111111111111111111112') {
            try {
                console.log(`[UNIVERSAL-CLONER] 🔍 Checking ATA creation for mint: ${shortenAddress(outputMint)}`);
                
                // Check if user already has an ATA for this token
                const userATA = await this._getAssociatedTokenAddress(userPublicKey, outputMint);
                const ataAccountInfo = await this.connection.getAccountInfo(userATA);
                
                if (!ataAccountInfo) {
                    console.log(`[UNIVERSAL-CLONER] 🔧 Creating ATA for user: ${shortenAddress(userPublicKey.toString())}`);
                    
                    const createATAInstruction = createAssociatedTokenAccountInstruction(
                        userPublicKey, // payer
                        userATA, // ata
                        userPublicKey, // owner
                        new PublicKey(outputMint) // mint
                    );
                    
                    ataInstructions.push(createATAInstruction);
                    console.log(`[UNIVERSAL-CLONER] ✅ ATA creation instruction added`);
                } else {
                    console.log(`[UNIVERSAL-CLONER] ✅ User already has ATA for this token`);
                }
            } catch (error) {
                console.error(`[UNIVERSAL-CLONER] ❌ ATA creation check failed:`, error.message);
            }
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
}

module.exports = { UniversalCloner };
