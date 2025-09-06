// ==========================================
// Universal Instruction Cloner - Platform Agnostic
// ==========================================
// File: universalCloner.js
// Description: Universal cloner that works with any platform using swap rules

const { Connection, PublicKey, Transaction, TransactionInstruction, SystemProgram } = require('@solana/web3.js');
const { createAssociatedTokenAccountInstruction } = require('@solana/spl-token');
const { shortenAddress } = require('./utils.js');

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
            slippageBps 
        } = builderOptions;

        console.log(`[UNIVERSAL-CLONER] 🔧 Building cloned instruction for user ${shortenAddress(userPublicKey.toString())}`);
        console.log(`[UNIVERSAL-CLONER] 🎯 Target program: ${shortenAddress(cloningTarget.programId)}`);
        console.log(`[UNIVERSAL-CLONER] 💰 Trade type: ${tradeType}`);
        console.log(`[UNIVERSAL-CLONER] 📊 Account count: ${cloningTarget.accounts.length}`);

        try {
            // Step 1: Apply the three swap rules
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

            // Step 3: Create the cloned instruction
            const clonedInstruction = new TransactionInstruction({
                programId: new PublicKey(cloningTarget.programId),
                keys: clonedAccounts,
                data: Buffer.from(cloningTarget.data, 'base64')
            });

            console.log(`[UNIVERSAL-CLONER] ✅ Created cloned instruction:`, {
                programId: shortenAddress(clonedInstruction.programId.toString()),
                accountCount: clonedInstruction.keys.length,
                dataLength: clonedInstruction.data.length
            });

            // Step 4: Return all instructions (ATA creation + cloned instruction)
            const allInstructions = [...ataInstructions, clonedInstruction];

            return {
                instructions: allInstructions,
                success: true,
                platform: 'Universal',
                method: 'swap_rules_cloning',
                ataInstructions: ataInstructions.length,
                clonedInstruction: true
            };

        } catch (error) {
            console.error(`[UNIVERSAL-CLONER] ❌ Cloning failed:`, error.message);
            throw error;
        }
    }

    /**
     * Apply the three swap rules to clone accounts
     */
    async _applySwapRules(originalAccounts, masterTraderWallet, userPublicKey, inputMint, outputMint) {
        console.log(`[UNIVERSAL-CLONER] 🔄 Applying swap rules...`);
        console.log(`[UNIVERSAL-CLONER] 🔍 Master trader: ${shortenAddress(masterTraderWallet)}`);
        console.log(`[UNIVERSAL-CLONER] 🔍 User: ${shortenAddress(userPublicKey.toString())}`);

        const clonedAccounts = [];

        for (let i = 0; i < originalAccounts.length; i++) {
            const originalAccount = originalAccounts[i];
            const originalPubkey = originalAccount.pubkey.toString();

            console.log(`[UNIVERSAL-CLONER] 🔍 Processing account ${i}: ${shortenAddress(originalPubkey)}`);

            let clonedAccount = { ...originalAccount };

            // Rule 1: User Swap - Replace master trader wallet with user wallet
            if (originalPubkey === masterTraderWallet) {
                clonedAccount.pubkey = userPublicKey;
                console.log(`[UNIVERSAL-CLONER] 🔄 Rule 1 (User Swap): ${shortenAddress(originalPubkey)} → ${shortenAddress(userPublicKey.toString())}`);
            }
            // Rule 2: Token Account Swap - Replace master trader's ATA with user's ATA
            else if (this._isTokenAccount(originalPubkey, inputMint, outputMint)) {
                const userATA = await this._getUserATA(userPublicKey, originalPubkey, inputMint, outputMint);
                if (userATA) {
                    clonedAccount.pubkey = userATA;
                    console.log(`[UNIVERSAL-CLONER] 🔄 Rule 2 (Token Account Swap): ${shortenAddress(originalPubkey)} → ${shortenAddress(userATA.toString())}`);
                }
            }
            // Rule 3: Default Copy - Copy everything else verbatim
            else {
                console.log(`[UNIVERSAL-CLONER] 📋 Rule 3 (Default Copy): ${shortenAddress(originalPubkey)} (unchanged)`);
            }

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
    async _getUserATA(userPublicKey, originalAccount, inputMint, outputMint) {
        try {
            // This is a simplified implementation
            // In reality, you'd need to determine which mint the original account belongs to
            // and then derive the user's ATA for that mint
            
            // For now, we'll return null and let the ATA creation logic handle it
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
}

module.exports = { UniversalCloner };
