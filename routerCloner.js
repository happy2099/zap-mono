// ==========================================
// Router Instruction Cloner - Clean Implementation
// ==========================================
// File: routerCloner.js
// Description: Clones only the Router instruction, ignores tip instructions

const { Connection, PublicKey, TransactionInstruction } = require('@solana/web3.js');
const { createAssociatedTokenAccountInstruction } = require('@solana/spl-token');
const { shortenAddress } = require('./utils.js');

class RouterCloner {
    constructor(connection) {
        this.connection = connection;
    }

    /**
     * Build cloned Router instruction - clean implementation
     * Only clones the Router instruction, ignores tip instructions
     */
    async buildClonedRouterInstruction(builderOptions) {
        const { 
            userPublicKey, 
            cloningTarget, 
            masterTraderWallet, 
            tradeType, 
            inputMint, 
            outputMint,
            amountBN,
            slippageBps 
        } = builderOptions;

        console.log(`[ROUTER-CLONER] 🔧 Building Router instruction: ${tradeType.toUpperCase()} | User: ${shortenAddress(userPublicKey.toString())} | Amount: ${(amountBN.toNumber() / 1e9).toFixed(4)} SOL`);
        console.log(`[ROUTER-CLONER] 🎯 KEY FIX: Using Router instruction data (not inner Pump.fun data)`);
        console.log(`[ROUTER-CLONER] 📊 Original accounts count: ${cloningTarget.accounts.length}`);
        
        // Debug: Log first few accounts to see their structure
        if (cloningTarget.accounts.length > 0) {
            console.log(`[ROUTER-CLONER] 🔍 Sample account structures:`);
            for (let i = 0; i < Math.min(3, cloningTarget.accounts.length); i++) {
                const acc = cloningTarget.accounts[i];
                console.log(`[ROUTER-CLONER] 🔍 Account ${i}:`, {
                    hasPubkey: !!acc.pubkey,
                    hasIsSigner: 'isSigner' in acc,
                    hasIsWritable: 'isWritable' in acc,
                    type: typeof acc,
                    keys: Object.keys(acc)
                });
            }
        }

        try {
            // Step 1: Apply the three swap rules to clone accounts
            const clonedAccounts = await this._applySwapRules(
                cloningTarget.accounts,
                masterTraderWallet,
                userPublicKey,
                inputMint,
                outputMint
            );

            // console.log(`[ROUTER-CLONER] ✅ Applied swap rules to ${clonedAccounts.length} accounts`);

            // Step 2: Check if user needs ATA creation
            const ataInstructions = await this._checkATACreation(
                userPublicKey,
                outputMint,
                tradeType
            );

            // Step 3: Use original Router instruction data (don't modify it)
            // Router instructions have their own format and we should preserve the original data
            // This is the key fix: we use the Router's instruction data, not the inner Pump.fun data
            const modifiedData = Buffer.from(cloningTarget.data, 'base64');
            
            console.log(`[ROUTER-CLONER] ✅ Using original Router instruction data (${modifiedData.length} bytes)`);
            console.log(`[ROUTER-CLONER] 🔍 Router data preview: ${modifiedData.toString('hex').substring(0, 16)}...`);
            console.log(`[ROUTER-CLONER] 📊 Cloned accounts count: ${clonedAccounts.length}`);

            // Step 4: Validate and create the cloned Router instruction
            // Ensure all accounts have proper structure
            const validatedAccounts = clonedAccounts.map(account => {
                if (!account || !account.pubkey) {
                    throw new Error(`Invalid account structure: ${JSON.stringify(account)}`);
                }
                return {
                    pubkey: account.pubkey,
                    isSigner: account.isSigner || false,
                    isWritable: account.isWritable || false
                };
            });

            const clonedRouterInstruction = new TransactionInstruction({
                programId: new PublicKey(cloningTarget.programId),
                keys: validatedAccounts,
                data: modifiedData
            });

            // console.log(`[ROUTER-CLONER] ✅ Created cloned Router instruction:`, {
            //     programId: shortenAddress(clonedRouterInstruction.programId.toString()),
            //     accountCount: clonedRouterInstruction.keys.length,
            //     dataLength: clonedRouterInstruction.data.length
            // });

            // Step 4: Return clean instruction list (ATA creation + Router instruction only)
            const allInstructions = [...ataInstructions, clonedRouterInstruction];

            // console.log(`[ROUTER-CLONER] 📋 Final instruction list:`, {
            //     ataInstructions: ataInstructions.length,
            //     routerInstruction: 1,
            //     totalInstructions: allInstructions.length
            // });

            return {
                instructions: allInstructions,
                success: true,
                platform: 'Router',
                method: 'router_cloning',
                ataInstructions: ataInstructions.length,
                routerInstruction: true
            };

        } catch (error) {
            console.error(`[ROUTER-CLONER] ❌ Router cloning failed:`, error.message);
            throw error;
        }
    }

    /**
     * Apply the three swap rules to clone accounts
     */
    async _applySwapRules(originalAccounts, masterTraderWallet, userPublicKey, inputMint, outputMint) {
        // console.log(`[ROUTER-CLONER] 🔄 Applying swap rules...`);

        const clonedAccounts = [];

        for (let i = 0; i < originalAccounts.length; i++) {
            const originalAccount = originalAccounts[i];
            
            // More lenient account validation - Router programs can have various account structures
            if (!originalAccount) {
                continue;
            }
            
            // Handle different account structures and ensure proper account format
            let originalPubkey;
            let clonedAccount;
            
            if (originalAccount.pubkey) {
                // Standard account structure
                originalPubkey = originalAccount.pubkey.toString();
                clonedAccount = {
                    pubkey: originalAccount.pubkey,
                    isSigner: originalAccount.isSigner || false,
                    isWritable: originalAccount.isWritable || false
                };
            } else if (originalAccount.toString) {
                // Account is just a PublicKey
                originalPubkey = originalAccount.toString();
                clonedAccount = {
                    pubkey: originalAccount,
                    isSigner: false,
                    isWritable: true
                };
            } else {
                // Skip invalid accounts
                continue;
            }

            // Rule 1: User Swap - Replace master trader wallet with user wallet
            if (originalPubkey === masterTraderWallet) {
                clonedAccount.pubkey = userPublicKey;
                clonedAccount.isSigner = true; // User is always a signer
                // console.log(`[ROUTER-CLONER] 🔄 Rule 1 (User Swap): ${shortenAddress(originalPubkey)} → ${shortenAddress(userPublicKey.toString())}`);
            }
            // Rule 2: Token Account Swap - Replace master trader's ATA with user's ATA
            else if (this._isTokenAccount(originalPubkey, inputMint, outputMint)) {
                const userATA = await this._getUserATA(userPublicKey, originalPubkey, inputMint, outputMint);
                if (userATA) {
                    clonedAccount.pubkey = userATA;
                    console.log(`[ROUTER-CLONER] 🔄 Rule 2 (Token Account Swap): ${shortenAddress(originalPubkey)} → ${shortenAddress(userATA.toString())}`);
                }
            }
            // Rule 3: Default Copy - Copy everything else verbatim
            else {
                console.log(`[ROUTER-CLONER] 📋 Rule 3 (Default Copy): ${shortenAddress(originalPubkey)} (unchanged)`);
            }

            // Ensure pubkey is a PublicKey object
            if (typeof clonedAccount.pubkey === 'string') {
                clonedAccount.pubkey = new PublicKey(clonedAccount.pubkey);
            }

            clonedAccounts.push(clonedAccount);
        }

        return clonedAccounts;
    }

    /**
     * Check if an account is a token account for the trade
     */
    _isTokenAccount(accountPubkey, inputMint, outputMint) {
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
    async _getUserATA(userPublicKey, originalAccount, inputMint, outputMint) {
        try {
            // This is a simplified implementation
            // In reality, you'd need to determine which mint the original account belongs to
            // and then derive the user's ATA for that mint
            
            // For now, we'll return null and let the ATA creation logic handle it
            return null;
        } catch (error) {
            console.error(`[ROUTER-CLONER] ❌ Error getting user ATA:`, error.message);
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
                console.log(`[ROUTER-CLONER] 🔍 Checking ATA creation for mint: ${shortenAddress(outputMint)}`);
                
                // Check if user already has an ATA for this token
                const userATA = await this._getAssociatedTokenAddress(userPublicKey, outputMint);
                const ataAccountInfo = await this.connection.getAccountInfo(userATA);
                
                if (!ataAccountInfo) {
                    console.log(`[ROUTER-CLONER] 🔧 Creating ATA for user: ${shortenAddress(userPublicKey.toString())}`);
                    
                    const createATAInstruction = createAssociatedTokenAccountInstruction(
                        userPublicKey, // payer
                        userATA, // ata
                        userPublicKey, // owner
                        new PublicKey(outputMint) // mint
                    );
                    
                    ataInstructions.push(createATAInstruction);
                    // console.log(`[ROUTER-CLONER] ✅ ATA creation instruction added`);
                } else {
                    // console.log(`[ROUTER-CLONER] ✅ User already has ATA for this token`);
                }
            } catch (error) {
                console.error(`[ROUTER-CLONER] ❌ ATA creation check failed:`, error.message);
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
            console.error(`[ROUTER-CLONER] ❌ Error getting ATA:`, error.message);
            return null;
        }
    }

    /**
     * Note: We no longer modify Router instruction data
     * Router instructions have their own specific format and we preserve the original data
     * The Router program handles the amount internally based on the user's wallet and token balances
     */
    async _modifyInstructionDataWithUserAmount_DEPRECATED(originalData, userAmountBN, tradeType) {
        try {
            // console.log(`[ROUTER-CLONER] 🔧 Modifying instruction data with user's SOL amount...`);
            // console.log(`[ROUTER-CLONER] 💰 User amount: ${userAmountBN.toString()} lamports (${userAmountBN.toNumber() / 1e9} SOL)`);
            
            // For Router instructions, we need to modify the SOL amount in the instruction data
            // The Router instruction data typically contains the amount as a u64 at a specific offset
            
            const dataBuffer = Buffer.from(originalData, 'base64');
            // console.log(`[ROUTER-CLONER] 📊 Original data length: ${dataBuffer.length} bytes`);
            
            // For now, we'll use a simple approach: try to find and replace the amount
            // This is a simplified implementation - in production, you'd need to know the exact Router instruction format
            
            if (tradeType === 'buy') {
                // For BUY trades, we need to modify the SOL input amount
                // The Router instruction data typically has the amount at offset 8 (after discriminator)
                
                if (dataBuffer.length >= 16) { // Ensure we have enough data
                    const modifiedBuffer = Buffer.from(dataBuffer);
                    
                    // Write the user's SOL amount as a u64 little-endian
                    const userAmountBytes = Buffer.alloc(8);
                    userAmountBytes.writeBigUInt64LE(BigInt(userAmountBN.toString()), 0);
                    
                    // Replace the amount in the instruction data (typically at offset 8)
                    modifiedBuffer.set(userAmountBytes, 8);
                    
                    // console.log(`[ROUTER-CLONER] ✅ Modified instruction data with user's SOL amount`);
                    // console.log(`[ROUTER-CLONER] 📊 Modified data length: ${modifiedBuffer.length} bytes`);
                    
                    return modifiedBuffer;
                } else {
                    // console.log(`[ROUTER-CLONER] ⚠️ Instruction data too short, using original data`);
                    return dataBuffer;
                }
            } else {
                // For SELL trades, we might need to modify the token amount
                // For now, we'll use the original data
                console.log(`[ROUTER-CLONER] 📋 SELL trade - using original instruction data`);
                return dataBuffer;
            }
            
        } catch (error) {
            console.error(`[ROUTER-CLONER] ❌ Error modifying instruction data:`, error.message);
            console.log(`[ROUTER-CLONER] ⚠️ Using original instruction data as fallback`);
            return Buffer.from(originalData, 'base64');
        }
    }
}

module.exports = { RouterCloner };
