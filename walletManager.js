// ==========================================
// File: WalletManager.js
// Description: Manages generation, encryption, storage, and retrieval of user wallets.
// ==========================================

import { Keypair, PublicKey, Connection, LAMPORTS_PER_SOL } from '@solana/web3.js';
import bs58 from 'bs58';
import { promises as fs } from 'fs'; // Use fs.promises for async file operations
import crypto from 'crypto';
import { EventEmitter } from 'events';
import path from 'path';
import { encrypt, decrypt } from './encryption.js'; // Assuming encryption.js for CJS
import { getAssociatedTokenAddressSync } from '@solana/spl-token';
import BN from 'bn.js'; // CommonJS import for BN.js
import config from './patches/config.js'; // Import our config for file paths etc.
import { shortenAddress } from './utils.js'; // Import common utility

// File paths from config (recommended way to get paths from config.js)
const WALLETS_FILE = config.WALLET_FILE; // Use path from config.js
const DATA_DIR = config.DATA_DIR; // Use path from config.js

// Encryption key from environment variables
const WALLET_ENCRYPTION_KEY = process.env.WALLET_ENCRYPTION_KEY;


const DEFAULT_WALLETS_STRUCTURE = {
  trading: [],
  withdrawal: []
};

class WalletManager extends EventEmitter {
  // Constructor no longer takes 'connection' directly as it's set later via `setConnection`
  constructor(dataManager) { // Update the constructor signature
    super();
    this.dataManager = dataManager; // Store the dataManager
    this.connection = null; // Connection will be set via setConnection(conn) method
    this.solanaManager = null; 
    this.walletsFile = WALLETS_FILE;
    this.wallets = {
      user_wallets: {} // A map of { [chatId]: { trading: [], withdrawal: [] } }
    };// Deep copy default structure
    this.dataDir = DATA_DIR;
    this.initialized = false;
    this.encryptionKey = WALLET_ENCRYPTION_KEY;

    if (!this.encryptionKey) {
      console.error("FATAL: WALLET_ENCRYPTION_KEY is not set in environment variables. Wallet operations will fail.");
      // Depending on strictness, you might throw here or try to operate with warning
    }
  }

  // Called by ZapBot.js to provide the live Solana Connection
  setConnection(connection) {
    if (!(connection instanceof Connection)) {
      throw new Error("WalletManager.setConnection: Provided connection is not a valid Solana Connection object.");
    }
    this.connection = connection;
    // console.log("[WM Init] Solana connection set.");
  }

  // NEW: Called by ZapBot.js to provide the SolanaManager instance
  setSolanaManager(solanaManagerInstance) {
    if (!solanaManagerInstance || typeof solanaManagerInstance.createAndInitializeNonceAccount !== 'function') {
      throw new Error("WalletManager.setSolanaManager: Provided solanaManagerInstance is not valid.");
    }
    this.solanaManager = solanaManagerInstance;
    console.log("[WM Init] SolanaManager instance set.");
  }

  // Initialization method (called by ZapBot.js)
 async initialize() {
    if (this.initialized) return;
    console.log("[WM Init] Initializing WalletManager...");
    try {
      await fs.mkdir(this.dataDir, { recursive: true });

      try {
        await fs.access(this.walletsFile);
      } catch (error) {
        if (error.code === 'ENOENT') {
          console.log(`[WM Init] Wallets file not found. Creating default: ${this.walletsFile}`);
          // Create the file with the correct empty multi-user structure
          await this._saveWalletsInternal({ user_wallets: {} });
        } else {
          throw error;
        }
      }
      await this.loadWallets(); // Load wallets from the file
      this.initialized = true;
      console.log(`[WM Init] Successfully initialized for ${Object.keys(this.wallets.user_wallets).length} users.`);
   } catch (error) {
    console.error('❌ [WM Init] Error initializing WalletManager:', error.message);
    // On a fatal init error, reset to the correct, empty multi-user structure.
    this.wallets = { user_wallets: {} };
    this.initialized = false;
    throw new Error(`WalletManager initialization failed: ${error.message}`);
  }
}

 async loadWallets() {
    if (!this.encryptionKey) {
      console.error("[WM Load] Cannot load wallets: WALLET_ENCRYPTION_KEY not set.");
      this.wallets = { user_wallets: {} };
      return;
    }
    try {
      const data = await fs.readFile(this.walletsFile, 'utf8');
      if (!data || data.trim().length < 2) {
        // File is empty or just contains "{}", so we start fresh.
        this.wallets = { user_wallets: {} };
        return;
      }

      const parsedData = JSON.parse(data);
      // We explicitly check for the top-level 'user_wallets' key.
      if (!parsedData || typeof parsedData.user_wallets !== 'object') {
        console.warn("[WM Load] Wallet file is malformed or in old format. Resetting to new structure.");
        this.wallets = { user_wallets: {} };
        return;
      }
      
      this.wallets = parsedData;

      // Convert all string public keys back into PublicKey objects for each user.
      for (const userId in this.wallets.user_wallets) {
        const userWalletSet = this.wallets.user_wallets[userId];
        if (userWalletSet.trading) {
          userWalletSet.trading.forEach(w => {
            if (typeof w.publicKey === 'string') w.publicKey = new PublicKey(w.publicKey);
          });
        }
        if (userWalletSet.withdrawal) {
          userWalletSet.withdrawal.forEach(w => {
             if (typeof w.publicKey === 'string') w.publicKey = new PublicKey(w.publicKey);
          });
        }
      }

    } catch (error) {
      console.error(`❌ [WM Load] Error loading wallets file:`, error.message);
      this.wallets = { user_wallets: {} }; // Reset on any catastrophic failure
      if (error.code === 'ENOENT') {
        await this._saveWalletsInternal(this.wallets); // Create a fresh empty file
      }
    }
}

  // Fetches the token balance for a given owner and mint address
  async getTokenBalance(ownerPublicKey, mintAddress) {
    if (!this.connection) throw new Error("WalletManager connection not set. Call setConnection().");

    try {
      const owner = new PublicKey(ownerPublicKey);
      const mint = new PublicKey(mintAddress);
      const ataAddress = getAssociatedTokenAddressSync(mint, owner, true); // true allows owner to be off-curve

      const accountInfo = await this.connection.getParsedAccountInfo(ataAddress);

      if (!accountInfo || !accountInfo.value || !accountInfo.value.data) {
        return new BN(0); // ATA does not exist or has no data, so balance is 0.
      }

      const tokenAmount = accountInfo.value.data.parsed?.info?.tokenAmount;

      if (tokenAmount && typeof tokenAmount.amount === 'string') {
        return new BN(tokenAmount.amount);
      } else {
        return new BN(0); // Account exists but has no valid token amount data.
      }
    } catch (error) {
      console.error(`[WM Balance] Error fetching token balance for mint ${mintAddress}:`, error.message);
      return new BN(0); // Return 0 on any error for safety.
    }
  }

  // Internal helper for saving, converts PublicKey back to string for JSON
  async _saveWalletsInternal(walletData) {
    try {
      const dataToSave = { user_wallets: {} };

      for (const userId in walletData.user_wallets) {
        const userWallets = walletData.user_wallets[userId];
        dataToSave.user_wallets[userId] = {
          trading: userWallets.trading.map(w => ({
            ...w,
            publicKey: w.publicKey?.toBase58(),
            // NEW: Convert nonceAccountPubkey to string for saving
            nonceAccountPubkey: w.nonceAccountPubkey ? w.nonceAccountPubkey.toBase58() : undefined,
            // Exclude nonceAccountKeypair from direct save if it's there
            nonceAccountKeypair: undefined
          })),
          withdrawal: userWallets.withdrawal.map(w => ({
            ...w,
            publicKey: w.publicKey?.toBase58()
          }))
        };
      }

      await fs.writeFile(this.walletsFile, JSON.stringify(dataToSave, null, 2), 'utf8');
    } catch (error) {
      console.error(`❌ [WM Save] Error saving wallets:`, error.message);
      throw error;
    }
  }

  // Public save method
  async saveWallets() {
    await this._saveWalletsInternal(this.wallets);
  }

  async generateAndAddWallet(label, category = 'trading', ownerChatId) { // <-- ADD ownerChatId
    if (!this.initialized) throw new Error("WalletManager not initialized. Call initialize().");
    if (!this.encryptionKey) throw new Error("Cannot generate wallet: WALLET_ENCRYPTION_KEY is not set.");
    if (!['trading', 'withdrawal'].includes(category)) throw new Error(`Invalid wallet category: ${category}`);
    if (await this.labelExists(label)) throw new Error(`Wallet label "${label}" already exists.`);
    if (!ownerChatId) throw new Error("ownerChatId is required to generate a wallet."); // <-- ADD a check

    try {
      const keypair = Keypair.generate();
      const privateKeyBs58 = bs58.encode(keypair.secretKey);
      const encryptedPrivateKey = await encrypt(privateKeyBs58, this.encryptionKey);

      const wallet = {
        id: crypto.randomUUID(),
        label,
        publicKey: keypair.publicKey, // Store OBJECT INSTANCE
        encryptedPrivateKey,
        category,
        ownerChatId: ownerChatId, // <-- THIS IS THE CRITICAL NEW LINE
        balance: null,
        createdAt: Date.now(),
        lastBalanceUpdate: 0
      };

       // NEW: If it's a trading wallet, generate and associate a durable nonce account
      if (category === 'trading' && this.solanaManager) {
        try {
          const { nonceAccountKeypair, nonceAccountPubkey } = await this.solanaManager.createAndInitializeNonceAccount(keypair);
          wallet.nonceAccountPubkey = nonceAccountPubkey;
          wallet.encryptedNonceAccountPrivateKey = await encrypt(bs58.encode(nonceAccountKeypair.secretKey), this.encryptionKey);
          console.log(`[WM Gen] Associated durable nonce account ${shortenAddress(nonceAccountPubkey.toBase58())} with trading wallet ${label}.`);
        } catch (nonceError) {
          console.error(`[WM Gen] Warning: Failed to create/associate nonce account for ${label}: ${nonceError.message}. Wallet created without nonce.`);
          // Continue creating the wallet even if nonce creation fails
        }
      } else if (category === 'trading' && !this.solanaManager) {
          console.warn(`[WM Gen] SolanaManager not set. Cannot create durable nonce account for trading wallet ${label}.`);
      }

      const userChatIdStr = String(ownerChatId);

      // Ensure the user has a wallet "set" initialized
      if (!this.wallets.user_wallets[userChatIdStr]) {
        this.wallets.user_wallets[userChatIdStr] = { trading: [], withdrawal: [] };
      }

      // Add the new wallet to the correct category for that specific user.
      this.wallets.user_wallets[userChatIdStr][category].push(wallet);
      await this.saveWallets();
       if (category === 'trading' && this.solanaManager) {
        console.log(`[PROVISION-NONCE] Automatically creating durable nonce account for new wallet: ${label}...`);
        try {
          // This will build, sign with the wallet's OWN keypair, and send the transaction
          const { nonceAccountKeypair, nonceAccountPubkey } = await this.solanaManager.createAndInitializeNonceAccount(keypair);
          
          // Securely store the new nonce account info WITH the wallet
          wallet.nonceAccountPubkey = nonceAccountPubkey;
          wallet.encryptedNonceAccountPrivateKey = await encrypt(bs58.encode(nonceAccountKeypair.secretKey), this.encryptionKey);
          
          // Re-save the wallet file with the new nonce information
          await this.saveWallets();
          console.log(`[PROVISION-NONCE] ✅ Nonce account ${shortenAddress(nonceAccountPubkey.toBase58())} successfully created and linked to ${label}.`);
        } catch (nonceError) {
            console.error(`[PROVISION-NONCE] ❌ CRITICAL: Failed to auto-create nonce account for ${label}. Trades for this wallet will be slower. Error: ${nonceError.message}`);
            // We do not throw an error here. The wallet is still usable, just slower.
        }
      }

      console.log(`[WM Gen] Created ${category} wallet: ${label} for user ${ownerChatId}`);
      return { walletInfo: wallet, privateKey: privateKeyBs58 };
    } catch (error) {
      console.error('❌ [WM Gen] Error creating wallet:', error.message);
      throw error;
    }
  }

   async importWalletFromPrivateKey(privateKeyBs58, label, category = 'trading', ownerChatId) {
    if (!ownerChatId) throw new Error("ownerChatId is required to import a wallet.");

    const userChatIdStr = String(ownerChatId);

    if (await this.labelExists(userChatIdStr, label)) {
        throw new Error(`Wallet label "${label}" already exists for you.`);
    }

    try {
        const secretKeyBytes = bs58.decode(privateKeyBs58);
        if (secretKeyBytes.length !== 64) throw new Error('Invalid private key format or length.');
        
        const keypair = Keypair.fromSecretKey(secretKeyBytes);
        const encryptedPrivateKey = await encrypt(privateKeyBs58, this.encryptionKey);

        const wallet = {
            id: crypto.randomUUID(),
            label,
            publicKey: keypair.publicKey,
            encryptedPrivateKey,
            category,
            ownerChatId: userChatIdStr,
            balance: 0,
            createdAt: Date.now(),
        };
   // NEW: If it's a trading wallet, generate and associate a durable nonce account
      if (category === 'trading' && this.solanaManager) {
        try {
          // The nonce account is authorized by the main wallet's public key
          const { nonceAccountKeypair, nonceAccountPubkey } = await this.solanaManager.createAndInitializeNonceAccount(keypair);
          wallet.nonceAccountPubkey = nonceAccountPubkey;
          wallet.encryptedNonceAccountPrivateKey = await encrypt(bs58.encode(nonceAccountKeypair.secretKey), this.encryptionKey);
          console.log(`[WM Import] Associated durable nonce account ${shortenAddress(nonceAccountPubkey.toBase58())} with imported trading wallet ${label}.`);
        } catch (nonceError) {
          console.error(`[WM Import] Warning: Failed to create/associate nonce account for ${label}: ${nonceError.message}. Wallet imported without nonce.`);
          // Continue importing the wallet even if nonce creation fails
        }
      } else if (category === 'trading' && !this.solanaManager) {
          console.warn(`[WM Import] SolanaManager not set. Cannot create durable nonce account for trading wallet ${label}.`);
      }

      if (!this.wallets.user_wallets[userChatIdStr]) {
        this.wallets.user_wallets[userChatIdStr] = { trading: [], withdrawal: [] };
      }

      this.wallets.user_wallets[userChatIdStr][category].push(wallet);
      await this.saveWallets();
       if (category === 'trading' && this.solanaManager) {
        console.log(`[PROVISION-NONCE] Automatically creating durable nonce account for new wallet: ${label}...`);
        try {
          // This will build, sign with the wallet's OWN keypair, and send the transaction
          const { nonceAccountKeypair, nonceAccountPubkey } = await this.solanaManager.createAndInitializeNonceAccount(keypair);
          
          // Securely store the new nonce account info WITH the wallet
          wallet.nonceAccountPubkey = nonceAccountPubkey;
          wallet.encryptedNonceAccountPrivateKey = await encrypt(bs58.encode(nonceAccountKeypair.secretKey), this.encryptionKey);
          
          // Re-save the wallet file with the new nonce information
          await this.saveWallets();
          console.log(`[PROVISION-NONCE] ✅ Nonce account ${shortenAddress(nonceAccountPubkey.toBase58())} successfully created and linked to ${label}.`);
        } catch (nonceError) {
            console.error(`[PROVISION-NONCE] ❌ CRITICAL: Failed to auto-create nonce account for ${label}. Trades for this wallet will be slower. Error: ${nonceError.message}`);
            // We do not throw an error here. The wallet is still usable, just slower.
        }
      }

        if (this.connection) {
            await this.updateWalletBalance(wallet);
        }
        
        console.log(`[WM Import] Imported ${category} wallet: "${label}" for user ${userChatIdStr}`);
        return wallet;

    } catch (error) {
        console.error(`❌ [WM Import] Error importing wallet "${label}":`, error.message);
        throw error;
    }
  }

  // Returns DEEP COPIES containing PublicKey strings (safe for external use/display)
   getAllWallets(chatId) {
    const userWalletSet = this.wallets.user_wallets?.[String(chatId)];
    if (!userWalletSet) {
      return { tradingWallets: [], withdrawalWallets: [] };
    }
    const mapWallet = (w) => ({
      ...w,
      publicKey: w.publicKey?.toBase58(),
      encryptedPrivateKey: 'REDACTED', // Hide sensitive data
      nonceAccountPubkey: w.nonceAccountPubkey?.toBase58(), // Hide sensitive data
      encryptedNonceAccountPrivateKey: 'REDACTED' // Hide sensitive data
    });

    return {
      tradingWallets: (userWalletSet.trading || []).map(mapWallet),
      withdrawalWallets: (userWalletSet.withdrawal || []).map(mapWallet)
    };
  }

   getTradingWalletCount(chatId) {
    const userWalletSet = this.wallets.user_wallets?.[String(chatId)];
    return userWalletSet?.trading?.length || 0;
  }

   getTradingWallets(chatId) {
    const userWalletSet = this.wallets.user_wallets?.[String(chatId)];
    if (!userWalletSet) return [];
    return (userWalletSet.trading || []).map(w => ({
      ...w,
      publicKey: w.publicKey?.toBase58(),
      encryptedPrivateKey: 'REDACTED',
      nonceAccountPubkey: w.nonceAccountPubkey?.toBase58(),
      encryptedNonceAccountPrivateKey: 'REDACTED'
    }));
  }

  // Finds wallet by label (case-sensitive), returns the INTERNAL object reference
  getWalletByLabel(chatId, label) {
    if (!chatId || !label) {
      return null;
    }
    const userChatIdStr = String(chatId);
    const userWalletSet = this.wallets.user_wallets?.[userChatIdStr];
    if (!userWalletSet) {
      return null; // User has no wallet set at all
    }
    const lowerCaseLabel = label.toLowerCase();
    const allUserWallets = [
      ...(userWalletSet.trading || []),
      ...(userWalletSet.withdrawal || [])
    ];
    return allUserWallets.find(w => w.label.toLowerCase() === lowerCaseLabel) || null;
  }


  getPrimaryTradingWallet() {
    // Find the label from settings
    const primaryLabel = this.primaryWalletLabel; // Assuming primaryWalletLabel is set during config/settings load or in bot init
    if (primaryLabel) {
      const wallet = this.getWalletByLabel(primaryLabel);
      if (wallet) {
        return wallet;
      } else {
        this.primaryWalletLabel = null; // Reset if wallet not found (e.g., deleted)
      }
    }
    // If no primary is set, or it's missing, try to get the first trading wallet
    return this.wallets.trading?.[0] || null;
  }

  getAdminFallbackWallet() {
    // This method should return a FULL wallet object, not just a label.
    // We use getAllWallets() which returns structured, safe-to-use wallet data.
    const allWallets = this.getAllWallets();
    const firstTradingWallet = allWallets?.tradingWallets?.[0];

    if (firstTradingWallet) {
      // Return the actual wallet object from our internal list by its label
      return this.getWalletByLabel(firstTradingWallet.label);
    }
    return null; // Return null if no trading wallets exist
  }

  async getKeypairByLabel(label) {
    const wallet = this.getWalletByLabel(label);
    if (!wallet) return null;
    return this.getKeypairById(wallet.id);
  }


  // Finds wallet by ID across categories, returns INTERNAL object reference
  async getWalletById(id) {
    if (!id) return null;
    if (!this.initialized) await this.initialize();
    
    // Search through EVERY user's wallets to find the one with the matching ID
    for (const userId in this.wallets.user_wallets) {
        const userWalletSet = this.wallets.user_wallets[userId];
        const allUserWallets = [...(userWalletSet.trading || []), ...(userWalletSet.withdrawal || [])];
        const foundWallet = allUserWallets.find(w => w.id === id);
        if (foundWallet) {
            return foundWallet;
        }
    }
    
    return null; // Not found anywhere
  }
  
  // Checks label existence (case-insensitive)
  async labelExists(chatId, label) {
    // This now just becomes a simple check using our corrected getWalletByLabel
    return this.getWalletByLabel(chatId, label) !== null;
}

  // Delete by ID - operates on internal state
  async deleteWalletById(id) {
    if (!id) { console.error("[WM Delete] Invalid ID."); return false; }
    if (!this.initialized) await this.initialize();

    let initialTradingLength = this.wallets.trading?.length || 0;
    this.wallets.trading = this.wallets.trading?.filter(w => w.id !== id);
    let removed = initialTradingLength > (this.wallets.trading?.length || 0);

    if (!removed) {
      let initialWithdrawalLength = this.wallets.withdrawal?.length || 0;
      this.wallets.withdrawal = this.wallets.withdrawal?.filter(w => w.id !== id);
      removed = initialWithdrawalLength > (this.wallets.withdrawal?.length || 0);
    }

    if (removed) {
      try {
        await this.saveWallets();
        // console.log(`[WM Delete] Wallet ID ${id} removed and saved.`);
        return true;
      } catch (error) {
        console.error(`[WM Delete] SAVE FAILED after removing wallet ID ${id}:`, error.message);
        throw new Error(`Failed to save after deleting wallet.`); // Indicate failure if save fails
      }
    } else {
      return false; // Not found
    }
  }

 async deleteWalletByLabel(chatId, label) {
    const walletToDelete = this.getWalletByLabel(chatId, label);
    if (!walletToDelete) return false;

    const userWalletSet = this.wallets.user_wallets?.[String(chatId)];
    if (!userWalletSet) return false; // Should be impossible if wallet was found, but safe

    // Remove from either list if it exists.
    if (userWalletSet.trading) {
        userWalletSet.trading = userWalletSet.trading.filter(w => w.id !== walletToDelete.id);
    }
    if (userWalletSet.withdrawal) {
        userWalletSet.withdrawal = userWalletSet.withdrawal.filter(w => w.id !== walletToDelete.id);
    }

    await this.saveWallets(); // Persist the change
    return true;
  }

  // Updates the internal wallet object reference with fetched balance
  async updateWalletBalance(wallet) {
    if (!this.connection) { console.warn("[WM Balance] Cannot update balance, connection not set."); return wallet?.balance ?? null; }
    if (!wallet || !wallet.publicKey || !(wallet.publicKey instanceof PublicKey)) {
      console.warn("[WM Balance] Invalid wallet object or publicKey provided for update.", wallet);
      return wallet?.balance ?? null;
    }

    try {
      const balanceLamports = await this.connection.getBalance(wallet.publicKey, 'confirmed');
      const newBalanceSol = balanceLamports / LAMPORTS_PER_SOL;
      wallet.balance = newBalanceSol;
      wallet.lastBalanceUpdate = Date.now();
      return newBalanceSol;
    } catch (error) {
      if (!error.message?.includes('timed out') && !error.message?.includes('Network request failed')) {
        console.error(`[WM Balance] Error updating ${wallet.label} (${shortenAddress(wallet.publicKey.toBase58())}):`, error.message);
      }
      return wallet.balance ?? null;
    }
  }

  // Decrypts using ID - searches internal state
  async getDecryptedPrivateKeyBs58(id) {
    if (!id) {
      throw new Error("[DIAGNOSTIC] Wallet ID required for decryption.");
    }
    if (!this.encryptionKey) {
      throw new Error("[DIAGNOSTIC] WALLET_ENCRYPTION_KEY is not set. Cannot decrypt.");
    }

    const wallet = await this.getWalletById(id);

    if (!wallet) {
      console.error(`[DIAGNOSTIC] ‼️ FATAL: Wallet with ID "${id}" could not be found in the WalletManager's list.`);
      console.error(`[DIAGNOSTIC] Current loaded trading wallet IDs:`, this.wallets.trading.map(w => w.id));
      throw new Error(`[DIAGNOSTIC] Wallet not found by ID: ${id}`);
    }

    if (!wallet.encryptedPrivateKey) {
      console.error(`[DIAGNOSTIC] ‼️ ERROR POINT: The 'encryptedPrivateKey' property is MISSING or empty on the wallet object for "${wallet.label}".`);
      throw new Error(`Encrypted private key missing for wallet: ${wallet.label}`);
    }

    try {

      const decryptedBs58 = await decrypt(wallet.encryptedPrivateKey, this.encryptionKey);

      if (typeof decryptedBs58 !== 'string' || decryptedBs58.length === 0) {
        throw new Error("[DIAGNOSTIC] Decryption resulted in empty or invalid data. Check encryption key.");
      }

      console.log(`[DIAGNOSTIC] ✅ Decryption successful for "${wallet.label}".`);
      return decryptedBs58;

    } catch (error) {
      console.error(`❌ [DIAGNOSTIC] Error during decryption process for wallet ${wallet.label}:`, error.message);
      throw new Error(`Failed to decrypt private key. Please check your WALLET_ENCRYPTION_KEY and wallet file integrity.`);
    }
  }

  // Returns Keypair object using ID - searches internal state
  async getKeypairById(id) {
    console.log(`[DIAGNOSTIC] Attempting to get Keypair for wallet ID: ${id}`);
    const privateKeyBs58 = await this.getDecryptedPrivateKeyBs58(id);
    try {
      const secretKeyBytes = bs58.decode(privateKeyBs58);
      if (secretKeyBytes.length !== 64) {
        throw new Error(`[DIAGNOSTIC] Invalid secret key length after decode: ${secretKeyBytes.length} bytes. Expected 64.`);
      }
      console.log(`[DIAGNOSTIC] ✅ Keypair successfully derived for wallet ID: ${id}`);
      return Keypair.fromSecretKey(secretKeyBytes);
    } catch (error) {
      console.error(`❌ [DIAGNOSTIC] Failed to derive Keypair for ID ${id}:`, error.message);
      throw new Error(`Could not reconstruct Keypair for wallet ID ${id}. The private key may be corrupt.`);
    }
  }

async getNonceKeypairByWalletId(walletId) {
    if (!this.encryptionKey) throw new Error("Cannot decrypt nonce keypair: WALLET_ENCRYPTION_KEY not set.");
    const wallet = await this.getWalletById(walletId); // Get the main wallet object
    if (!wallet || wallet.category !== 'trading' || !wallet.encryptedNonceAccountPrivateKey) {
      console.warn(`[WM Nonce] Wallet ${walletId} is not a trading wallet or has no associated nonce keypair.`);
      return null;
    }

    try {
      const privateKeyBs58 = await decrypt(wallet.encryptedNonceAccountPrivateKey, this.encryptionKey);
      // Fix: Changed privateKeyBs558 to privateKeyBs58
      return Keypair.fromSecretKey(bs58.decode(privateKeyBs58));
    } catch (error) {
      console.error(`❌ [WM Nonce] Error decrypting nonce keypair for wallet ID ${walletId}: ${error.message}`);
      return null;
    }
  }

  // Used by tradingEngine/zapbot.js - Gets keypair by label - finds internal object ref
  async getKeypairForWallet(chatId, label) {
    const wallet = this.getWalletByLabel(chatId, label);
    if (!wallet) {
      console.error(`[WM Keypair] Wallet "${label}" not found for user ${chatId}.`);
      return null;
    }
    return this.getKeypairById(wallet.id); // This already works globally
  }

  async getPrimaryTradingKeypair(chatId) {
    if (!chatId) {
        throw new Error("[KeypairProvider] CRITICAL: A chatId is required to find the correct user's keypair.");
    }
    const userChatIdStr = String(chatId);

    // --- ISOLATED DATA RETRIEVAL ---
    // 1. Get ONLY the wallet set for this specific user.
    const userWalletSet = this.wallets.user_wallets?.[userChatIdStr];
    if (!userWalletSet || !userWalletSet.trading || userWalletSet.trading.length === 0) {
        console.warn(`[KeypairProvider] ❌ No trading wallets found for user ${userChatIdStr}. Trade cannot proceed.`);
        return null;
    }

    // 2. Load all settings to find THIS user's primary choice.
    const settings = await this.dataManager.loadSettings();
    const primaryLabel = settings.userSettings?.[userChatIdStr]?.primaryCopyWalletLabel;

    let walletToUse = null;

    // --- ISOLATED LOGIC ---
    // 3. Strategy A: Find the primary wallet BY LABEL, only within THIS USER'S LIST.
    if (primaryLabel) {
        walletToUse = userWalletSet.trading.find(w => w.label === primaryLabel);
        if (!walletToUse) {
            console.warn(`[KeypairProvider] User ${userChatIdStr}'s chosen primary wallet "${primaryLabel}" was not found. Falling back...`);
        }
    }

    // 4. Strategy B (Fallback): If no primary is set or found, use the first wallet in THIS USER'S LIST.
    if (!walletToUse) {
        walletToUse = userWalletSet.trading[0];
        console.warn(`[KeypairProvider] No primary wallet set for user ${userChatIdStr}. Using fallback: "${walletToUse.label}".`);
    }

    // 5. If we have a wallet, get its keypair. `getKeypairById` is globally safe.
    if (walletToUse) {
        const keypair = await this.getKeypairById(walletToUse.id);
        if (keypair) {
            // Return the "packet" with both the keypair and the wallet info.
            return {
                keypair: keypair,
                wallet: walletToUse
            };
        }
    }

    console.error(`[KeypairProvider] FATAL: Could not resolve a keypair for user ${userChatIdStr} despite them having wallets.`);
    return null;
  }

  // Signs a transaction with a given wallet label
  async signTransaction(walletLabel, transaction) {
    const wallet = this.getWalletByLabel(walletLabel);
    if (!wallet) throw new Error("Wallet not found to sign transaction.");

    try {
      const keypair = await this.getKeypairById(wallet.id); // Get full Keypair
      transaction.sign([keypair]); // Sign the transaction with the keypair
      return transaction; // Return the signed transaction
    } catch (error) {
      console.error(`❌ [WM Sign] Error signing transaction for wallet "${walletLabel}":`, error.message);
      throw new Error(`Failed to sign transaction: ${error.message}`);
    }
  }

  // Force-update all balances and save
 async updateAllBalances(force = false) {
    if (!this.initialized) throw new Error("WalletManager not initialized. Call initialize().");
    if (!this.connection) { console.warn("[WM Balances] Cannot update balances, connection not set."); return; }

    const updatePromises = [];
    
    // Iterate through EVERY user's wallets
    for (const userId in this.wallets.user_wallets) {
        const userWalletSet = this.wallets.user_wallets[userId];
        
        // Collect update promises for trading wallets
        if (userWalletSet.trading && Array.isArray(userWalletSet.trading)) {
            for (const walletRef of userWalletSet.trading) {
                updatePromises.push(this.updateWalletBalance(walletRef).catch(e => {
                    console.error(`[WM Balances] Failed balance update for user ${userId}, wallet ${walletRef.label || 'Unknown'} (${shortenAddress(walletRef.publicKey?.toBase58() || 'N/A')}): ${e.message}`);
                }));
            }
        }

        // Collect update promises for withdrawal wallets
        if (userWalletSet.withdrawal && Array.isArray(userWalletSet.withdrawal)) {
            for (const walletRef of userWalletSet.withdrawal) {
                updatePromises.push(this.updateWalletBalance(walletRef).catch(e => {
                    console.error(`[WM Balances] Failed balance update for user ${userId}, withdrawal wallet ${walletRef.label || 'Unknown'} (${shortenAddress(walletRef.publicKey?.toBase58() || 'N/A')}): ${e.message}`);
                }));
            }
        }
    }

    try {
      await Promise.all(updatePromises);
      await this.saveWallets(); // Save all updates to disk
      console.log(`[WM Balances] Finished balance updates for ${updatePromises.length} wallet entries across all users.`);
    } catch (error) {
      console.error("❌ [WM Balances] Error during final save after bulk balance update:", error.message);
      throw error; // Re-throw critical errors
    }
  }

  // Reset state and delete file
async reset() {
    console.warn("--- RESETTING ALL WALLETS in WalletManager ---");
    this.wallets = { user_wallets: {} }; // <-- THE FIX
    this.initialized = false; // Mark as not initialized
    // ... rest of the function remains the same ...
    try {
      await fs.unlink(this.walletsFile); // Delete the wallets file
      console.log(`[WM Reset] Deleted wallets file: ${this.walletsFile}`);
    } catch (error) {
      if (error.code === 'ENOENT') {
        console.log("[WM Reset] Wallet file already deleted or never existed.");
      } else {
        console.error("CRITICAL ERROR: Failed to delete wallet file during reset:", error.message);
        throw error; // Indicate failure
      }
    }
}
}

export default WalletManager;