#!/usr/bin/env node

/**
 * Script to create nonce accounts for existing wallets that don't have them
 */

const { DataManager } = require('../dataManager');
const WalletManager = require('../walletManager');
const { SolanaManager } = require('../solanaManager');
const { encrypt } = require('../encryption');
const { Keypair } = require('@solana/web3.js');
const bs58 = require('bs58');
const { shortenAddress } = require('../utils.js');

class NonceAccountCreator {
    constructor() {
        this.dataManager = new DataManager();
        this.solanaManager = new SolanaManager();
        this.walletManager = new WalletManager(this.dataManager);
        this.walletManager.setConnection(this.solanaManager.connection);
    }

    async initialize() {
        await this.dataManager.initialize();
        console.log('🔧 NonceAccountCreator initialized');
    }

    async createNonceAccountsForExistingWallets() {
        console.log('🔍 Finding wallets without nonce accounts...');
        
        // Get all wallets from the JSON data
        const walletsData = await this.dataManager.readJsonFile('wallets.json');
        const walletsWithoutNonce = [];

        // Find wallets without nonce accounts
        if (walletsData.user_wallets) {
            for (const [chatId, userWallets] of Object.entries(walletsData.user_wallets)) {
                for (const [label, walletData] of Object.entries(userWallets)) {
                    if (!walletData.nonce_account_pubkey) {
                        walletsWithoutNonce.push({
                            chatId,
                            label,
                            public_key: walletData.publicKey,
                            private_key: walletData.privateKey
                        });
                    }
                }
            }
        }

        console.log(`📊 Found ${walletsWithoutNonce.length} wallets without nonce accounts`);

        if (walletsWithoutNonce.length === 0) {
            console.log('✅ All wallets already have nonce accounts!');
            return;
        }

        for (const walletRow of walletsWithoutNonce) {
            try {
                console.log(`\n🔧 Creating nonce account for wallet: ${walletRow.label} (${shortenAddress(walletRow.public_key)})`);
                
                // Create keypair from private key
                const keypair = Keypair.fromSecretKey(bs58.decode(walletRow.private_key));

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

                // Update the wallet data in JSON
                const walletsData = await this.dataManager.readJsonFile('wallets.json');
                if (walletsData.user_wallets && walletsData.user_wallets[walletRow.chatId] && walletsData.user_wallets[walletRow.chatId][walletRow.label]) {
                    walletsData.user_wallets[walletRow.chatId][walletRow.label].nonce_account_pubkey = nonceAccountPubkey.toBase58();
                    walletsData.user_wallets[walletRow.chatId][walletRow.label].encrypted_nonce_private_key = encryptedNoncePrivateKey;
                    await this.dataManager.writeJsonFile('wallets.json', walletsData);
                }

                console.log(`✅ Nonce account ${shortenAddress(nonceAccountPubkey.toBase58())} created and linked to wallet ${walletRow.label}`);

            } catch (error) {
                console.error(`❌ Failed to create nonce account for wallet ${walletRow.label}: ${error.message}`);
                // Continue with next wallet
            }
        }

        console.log('\n🎉 Nonce account creation process completed!');
    }

    async close() {
        // DataManager doesn't need explicit closing for JSON files
        console.log('✅ NonceAccountCreator cleanup completed');
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
