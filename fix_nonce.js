#!/usr/bin/env node

const { dataManager } = require('./database/dataManager');
const { SolanaManager } = require('./solanaManager');
const { decrypt, encrypt } = require('./encryption');
const bs58 = require('bs58');
const { Keypair } = require('@solana/web3.js');

async function fixNonceAccount() {
  const db = new dataManager();
  await db.initialize();
  const solana = new SolanaManager();
  
  console.log('🔧 Creating new nonce account for zap wallet...');
  
  try {
    // Get the wallet
    const wallet = await db.get('SELECT * FROM user_wallets WHERE label = ?', ['zap']);
    if (!wallet) {
      console.log('❌ Wallet not found');
      return;
    }
    
    // Decrypt the wallet private key
    const privateKeyBs58 = await decrypt(wallet.encrypted_private_key, process.env.WALLET_ENCRYPTION_KEY);
    const keypair = Keypair.fromSecretKey(bs58.decode(privateKeyBs58));
    
    console.log('🔑 Wallet loaded:', wallet.public_key);
    
    // Create new nonce account
    const { nonceAccountKeypair, nonceAccountPubkey } = await solana.createAndInitializeNonceAccount(keypair);
    
    // Encrypt the nonce private key
    const encryptedNoncePrivateKey = await encrypt(bs58.encode(nonceAccountKeypair.secretKey), process.env.WALLET_ENCRYPTION_KEY);
    
    // Update the database
    await db.run(
      'UPDATE user_wallets SET nonce_account_pubkey = ?, encrypted_nonce_private_key = ? WHERE id = ?',
      [nonceAccountPubkey.toBase58(), encryptedNoncePrivateKey, wallet.id]
    );
    
    console.log('✅ New nonce account created:', nonceAccountPubkey.toBase58());
    
  } catch (error) {
    console.error('❌ Error creating nonce account:', error.message);
  } finally {
    await db.close();
  }
}

fixNonceAccount();

