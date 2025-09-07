#!/usr/bin/env node

/**
 * Script to create nonce accounts for existing wallets that don't have them
 */

const { DatabaseManager } = require('../database/databaseManager');
const WalletManager = require('../walletManager');
const { SolanaManager } = require('../solanaManager');
const { encrypt } = require('../encryption');
const bs58 = require('bs58');
const { shortenAddress } = require('../utils.js');

class NonceAccountCreator {
    constructor() {
        this.databaseManager = new DatabaseManager();
        this.solanaManager = new SolanaManager();
        this.walletManager = new WalletManager(this.databaseManager);
        this.walletManager.setConnection(this.solanaManager.connection);
    }

    async initialize() {
        await this.databaseManager.initialize();
        console.log('🔧 NonceAccountCreator initialized');
    }

    async createNonceAccountsForExistingWallets() {
        console.log('🔍 Finding wallets without nonce accounts...');
        
        // Get all wallets that don't have nonce accounts
        const walletsWithoutNonce = await this.databaseManager.all(
            'SELECT * FROM user_wallets WHERE nonce_account_pubkey IS NULL'
        );

        console.log(`📊 Found ${walletsWithoutNonce.length} wallets without nonce accounts`);

        if (walletsWithoutNonce.length === 0) {
            console.log('✅ All wallets already have nonce accounts!');
            return;
        }

        for (const walletRow of walletsWithoutNonce) {
            try {
                console.log(`\n🔧 Creating nonce account for wallet: ${walletRow.label} (${shortenAddress(walletRow.public_key)})`);
                
                // Get the wallet's keypair
                const wallet = await this.walletManager.getWalletById(walletRow.id);
                if (!wallet) {
                    console.error(`❌ Could not retrieve wallet ${walletRow.id}`);
                    continue;
                }

                const keypair = await this.walletManager.getKeypairById(walletRow.id);
                if (!keypair) {
                    console.error(`❌ Could not retrieve keypair for wallet ${walletRow.id}`);
                    continue;
                }

                // Check wallet balance
                const balance = await this.solanaManager.connection.getBalance(keypair.publicKey);
                const balanceSOL = balance / 1e9;
                console.log(`💰 Wallet balance: ${balanceSOL.toFixed(4)} SOL`);

                if (balanceSOL < 0.002) {
                    console.warn(`⚠️ Wallet has insufficient balance (${balanceSOL.toFixed(4)} SOL) to create nonce account. Skipping.`);
                    continue;
                }

                // Create nonce account
                const { nonceAccountKeypair, nonceAccountPubkey } = await this.solanaManager.createAndInitializeNonceAccount(keypair);
                
                // Encrypt the nonce account private key
                const encryptedNoncePrivateKey = await encrypt(bs58.encode(nonceAccountKeypair.secretKey), this.walletManager.encryptionKey);

                // Update the database
                await this.databaseManager.run(
                    'UPDATE user_wallets SET nonce_account_pubkey = ?, encrypted_nonce_private_key = ? WHERE id = ?',
                    [nonceAccountPubkey.toBase58(), encryptedNoncePrivateKey, walletRow.id]
                );

                console.log(`✅ Nonce account ${shortenAddress(nonceAccountPubkey.toBase58())} created and linked to wallet ${walletRow.label}`);

            } catch (error) {
                console.error(`❌ Failed to create nonce account for wallet ${walletRow.label}: ${error.message}`);
                // Continue with next wallet
            }
        }

        console.log('\n🎉 Nonce account creation process completed!');
    }

    async close() {
        await this.databaseManager.close();
    }
}

// Run the script
async function main() {
    const creator = new NonceAccountCreator();
    
    try {
        await creator.initialize();
        await creator.createNonceAccountsForExistingWallets();
    } catch (error) {
        console.error('❌ Script failed:', error.message);
        process.exit(1);
    } finally {
        await creator.close();
    }
}

if (require.main === module) {
    main();
}

module.exports = { NonceAccountCreator };
