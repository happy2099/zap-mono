// ==========================================
// File: WalletManager.js
// Description: Manages generation, encryption, storage, and retrieval of user wallets.
// ==========================================

const { Keypair, PublicKey, Connection, LAMPORTS_PER_SOL } = require('@solana/web3.js');
const bs58 = require('bs58');
const crypto = require('crypto');
const { EventEmitter } = require('events');
const { encrypt, decrypt } = require('./encryption.js'); // Assuming encryption.js for CJS
const { getAssociatedTokenAddressSync } = require('@solana/spl-token');
const BN = require('bn.js'); // CommonJS import for BN.js
const { shortenAddress } = require('./utils.js'); // Import common utility

// Encryption key from environment variables
const WALLET_ENCRYPTION_KEY = process.env.WALLET_ENCRYPTION_KEY;


const DEFAULT_WALLETS_STRUCTURE = {
  trading: [],
  withdrawal: []
};

class WalletManager extends EventEmitter {
  // Constructor no longer takes 'connection' directly as it's set later via `setConnection`
  constructor(databaseManager) { // Update the constructor signature
    super();
    this.databaseManager = databaseManager; // Store the databaseManager
    this.connection = null; // Connection will be set via setConnection(conn) method
    this.solanaManager = null; 
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
     console.log("[WM Init] Initializing WalletManager in DATABASE-ONLY mode...");
     
     // In DB mode, there are no files to load. We just confirm dependencies are set.
     if (!this.databaseManager) throw new Error("WalletManager cannot initialize: DatabaseManager is missing.");
     if (!this.connection) throw new Error("WalletManager cannot initialize: Solana connection is missing.");

     this.initialized = true;
     console.log(`[WM Init] ✅ Successfully initialized in DATABASE-ONLY mode.`);
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

      // DATABASE-ONLY MODE: Do not store in memory
      console.log(`[WM Generate] DATABASE-ONLY MODE: Skipping memory storage for wallet "${label}".`);
       if (category === 'trading' && this.solanaManager) {
        console.log(`[PROVISION-NONCE] Automatically creating durable nonce account for new wallet: ${label}...`);
        try {
          // This will build, sign with the wallet's OWN keypair, and send the transaction
          const { nonceAccountKeypair, nonceAccountPubkey } = await this.solanaManager.createAndInitializeNonceAccount(keypair);
          
          // Securely store the new nonce account info WITH the wallet
          wallet.nonceAccountPubkey = nonceAccountPubkey;
          wallet.encryptedNonceAccountPrivateKey = await encrypt(bs58.encode(nonceAccountKeypair.secretKey), this.encryptionKey);
          
          // DATABASE-ONLY MODE: Nonce info will be stored in database
          console.log(`[PROVISION-NONCE] DATABASE-ONLY MODE: Nonce info will be stored in database.`);
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

        // DO NOT STORE IN MEMORY - DATABASE ONLY MODE
        console.log(`[WM Import] DATABASE-ONLY MODE: Wallet "${label}" will be stored in database only.`);
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

      // DATABASE-ONLY MODE: Do not store in memory
      console.log(`[WM Import] DATABASE-ONLY MODE: Skipping memory storage for wallet "${label}".`);
       if (category === 'trading' && this.solanaManager) {
        console.log(`[PROVISION-NONCE] Automatically creating durable nonce account for new wallet: ${label}...`);
        try {
          // This will build, sign with the wallet's OWN keypair, and send the transaction
          const { nonceAccountKeypair, nonceAccountPubkey } = await this.solanaManager.createAndInitializeNonceAccount(keypair);
          
          // Securely store the new nonce account info WITH the wallet
          wallet.nonceAccountPubkey = nonceAccountPubkey;
          wallet.encryptedNonceAccountPrivateKey = await encrypt(bs58.encode(nonceAccountKeypair.secretKey), this.encryptionKey);
          
          // DATABASE-ONLY MODE: Nonce info will be stored in database
          console.log(`[PROVISION-NONCE] DATABASE-ONLY MODE: Nonce info will be stored in database.`);
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
  // NOW READS FROM DATABASE ONLY - NO MEMORY STORAGE
  async getAllWallets(chatId) {
    try {
      // Get user from database
      const user = await this.databaseManager.getUser(String(chatId));
      if (!user) {
        return { tradingWallets: [], withdrawalWallets: [] };
      }

      // Get all wallets from database
      const dbWallets = await this.databaseManager.all(
        'SELECT * FROM user_wallets WHERE user_id = ?', 
        [user.id]
      );



      // Convert database wallets to the expected format
      const tradingWallets = dbWallets.map(w => ({
        id: w.id,
        label: w.label,
        publicKey: w.public_key,
        encryptedPrivateKey: 'REDACTED', // Hide sensitive data
        category: 'trading',
        ownerChatId: String(chatId),
        balance: w.balance || 0,
        createdAt: w.created_at,

      }));

      return {
        tradingWallets: tradingWallets,
        withdrawalWallets: [] // No withdrawal wallets for now
      };
    } catch (error) {
      console.error(`[WM] Error getting wallets from database for user ${chatId}:`, error);
      return { tradingWallets: [], withdrawalWallets: [] };
    }
  }

  async getTradingWalletCount(chatId) {
    try {
      const user = await this.databaseManager.getUser(String(chatId));
      if (!user) return 0;
      
      const count = await this.databaseManager.get(
        'SELECT COUNT(*) as count FROM user_wallets WHERE user_id = ?', 
        [user.id]
      );
      return count?.count || 0;
    } catch (error) {
      console.error(`[WM] Error getting wallet count for user ${chatId}:`, error);
      return 0;
    }
  }

   async getTradingWallets(chatId) {
    try {
      const user = await this.databaseManager.getUser(String(chatId));
      if (!user) return [];

      const wallets = await this.databaseManager.all(
        'SELECT * FROM user_wallets WHERE user_id = ?',
        [user.id]
      );

      return wallets.map(w => ({
        id: w.id,
        label: w.label,
        publicKey: w.public_key,
        encryptedPrivateKey: 'REDACTED',
        category: 'trading',
        ownerChatId: String(chatId),
        balance: w.balance || 0,
        createdAt: w.created_at,
        nonceAccountPubkey: w.nonce_account_pubkey,
        encryptedNonceAccountPrivateKey: 'REDACTED'
      }));
    } catch (error) {
      console.error(`[WM] Error getting trading wallets for user ${chatId}:`, error);
      return [];
    }
  }






  async getFirstTradingKeypair(chatId) {
    if (!chatId) {
      console.warn("[WM] getFirstTradingKeypair requires chatId parameter");
      return null;
    }
    
    try {
      const user = await this.databaseManager.getUser(String(chatId));
      if (!user) return null;

      // Get the first trading wallet for this user
      const walletRow = await this.databaseManager.get(
        'SELECT * FROM user_wallets WHERE user_id = ? ORDER BY id ASC LIMIT 1',
        [user.id]
      );

      if (walletRow) {
        const wallet = await this.getWalletById(walletRow.id);
        if (wallet) {
          const keypair = await this.getKeypairById(wallet.id);
          return { keypair, wallet };
        }
      }
      return null;
    } catch (error) {
      console.error(`[WM] Error getting first trading keypair for user ${chatId}:`, error);
      return null;
    }
  }

  async getAdminFallbackWallet(chatId) {
    if (!chatId) {
      console.warn("[WM] getAdminFallbackWallet requires chatId parameter");
      return null;
    }
    
    try {
      const user = await this.databaseManager.getUser(String(chatId));
      if (!user) return null;

      // Get the first trading wallet for this user
      const walletRow = await this.databaseManager.get(
        'SELECT * FROM user_wallets WHERE user_id = ? ORDER BY id ASC LIMIT 1',
        [user.id]
      );

      if (walletRow) {
        return await this.getWalletById(walletRow.id);
      }
      return null;
    } catch (error) {
      console.error(`[WM] Error getting admin fallback wallet for user ${chatId}:`, error);
      return null;
    }
  }

  async getKeypairByLabel(chatId, label) {
    if (!chatId || !label) {
      console.warn("[WM] getKeypairByLabel requires both chatId and label parameters");
      return null;
    }
    
    const wallet = await this.getWalletByLabel(chatId, label);
    if (!wallet) return null;
    return this.getKeypairById(wallet.id);
  }


  // Finds wallet by ID across categories, returns INTERNAL object reference
  async getWalletById(id) {
    if (!id) return null;

    try {
        const walletRow = await this.databaseManager.get(
            'SELECT uw.*, u.chat_id FROM user_wallets uw JOIN users u ON uw.user_id = u.id WHERE uw.id = ?',
            [id]
        );

        if (!walletRow) {
            return null;
        }

        return {
            id: walletRow.id,
            label: walletRow.label,
            publicKey: new PublicKey(walletRow.public_key),
            encryptedPrivateKey: walletRow.private_key_encrypted,
            category: 'trading',
            ownerChatId: String(walletRow.chat_id),
            balance: walletRow.balance,
            createdAt: walletRow.created_at,
            nonceAccountPubkey: walletRow.nonce_account_pubkey ? new PublicKey(walletRow.nonce_account_pubkey) : null,
            encryptedNonceAccountPrivateKey: walletRow.encrypted_nonce_private_key
        };
    } catch (error) {
        console.error(`[WM DB] Error in getWalletById for id ${id}:`, error);
        return null;
    }
  }
  
  // Checks label existence (case-insensitive)
  async labelExists(chatId, label) {
    // This now just becomes a simple check using our corrected getWalletByLabel
    return await this.getWalletByLabel(chatId, label) !== null;
}

  // Delete by ID - operates on database
  async deleteWalletById(id) {
    if (!id) { console.error("[WM Delete] Invalid ID."); return false; }
    if (!this.initialized) await this.initialize();

    try {
      // Get wallet info to find the user
      const wallet = await this.getWalletById(id);
      if (!wallet) return false; // Wallet doesn't exist

      const user = await this.databaseManager.getUser(wallet.ownerChatId);
      if (!user) throw new Error("User not found.");

      await this.databaseManager.deleteWallet(user.id, id);
      console.log(`[WM Delete] Wallet ID ${id} deleted from database.`);
      return true;
    } catch (error) {
      console.error(`[WM Delete] Error deleting wallet ID ${id}:`, error.message);
      throw error;
    }
  }

 async deleteWalletByLabel(chatId, label) {
     try {
         const user = await this.databaseManager.getUser(chatId);
         if (!user) throw new Error("User not found.");

         // Use the new direct method from database manager
         await this.databaseManager.deleteWalletByLabel(user.id, label);
         console.log(`[WM Delete] Wallet "${label}" for user ${chatId} deleted from database.`);
         return true;
     } catch (error) {
         console.error(`[WM Delete] Error deleting wallet "${label}" for user ${chatId}:`, error.message);
         throw error;
     }
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
              const newBalanceSol = balanceLamports / config.LAMPORTS_PER_SOL_CONST;
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
      console.error(`[DIAGNOSTIC] ‼️ FATAL: Wallet with ID "${id}" could not be found in the database.`);
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
    const wallet = await this.getWalletByLabel(chatId, label);
    if (!wallet) {
      console.error(`[WM Keypair] Wallet "${label}" not found for user ${chatId}.`);
      return null;
    }
    return this.getKeypairById(wallet.id); // This already works globally
  }

  async getPrimaryTradingKeypair(chatId) {
    if (!chatId) {
        throw new Error("[KeypairProvider] CRITICAL: A chatId is required to find a keypair.");
    }
    
    try {
        const user = await this.databaseManager.getUser(String(chatId));
        if (!user) {
            console.warn(`[KeypairProvider] ❌ No user found for chatId ${chatId}.`);
            return null;
        }

        // Get the user's first available wallet for trading
        const walletRow = await this.databaseManager.get(
            'SELECT * FROM user_wallets WHERE user_id = ? ORDER BY id ASC LIMIT 1',
            [user.id]
        );

        if (walletRow) {
            const walletObject = await this.getWalletById(walletRow.id);
            if (!walletObject) throw new Error(`Failed to reconstruct wallet object for ID ${walletRow.id}`);
            
            const keypair = await this.getKeypairById(walletRow.id);
            if (keypair) {
                console.log(`[KeypairProvider] ✅ Resolved wallet "${walletObject.label}" for user ${user.id}.`);
                return { keypair: keypair, wallet: walletObject };
            }
        }
        
        console.warn(`[KeypairProvider] ❌ No trading wallets found for user ${user.id}. Trade cannot proceed.`);
        return null;

    } catch (error) {
        console.error(`[KeypairProvider] FATAL: Could not resolve a keypair for user ${chatId}: ${error.message}`);
        return null;
    }
}

  async getWalletByLabel(chatId, label) {
    if (!chatId || !label) {
      return null;
    }
    const lowerCaseLabel = label.toLowerCase();
    
    try {
        const user = await this.databaseManager.getUser(String(chatId));
        if (!user) {
            console.warn(`[WM DB] getWalletByLabel: User not found for chatId ${chatId}`);
            return null;
        }

        const walletRow = await this.databaseManager.get(
            'SELECT * FROM user_wallets WHERE user_id = ? AND label = ?',
            [user.id, label]
        );

        if (!walletRow) {
            return null; // Not found
        }
        
        // Convert the database row to the wallet object format our code expects
        return {
            id: walletRow.id,
            label: walletRow.label,
            publicKey: new PublicKey(walletRow.public_key),
            encryptedPrivateKey: walletRow.encrypted_private_key,
            category: 'trading', // Assuming 'trading' for now
            ownerChatId: String(chatId),
            balance: walletRow.balance,
            createdAt: walletRow.created_at,
            nonceAccountPubkey: walletRow.nonce_account_pubkey ? new PublicKey(walletRow.nonce_account_pubkey) : null,
            encryptedNonceAccountPrivateKey: walletRow.encrypted_nonce_private_key
        };
    } catch (error) {
        console.error(`[WM DB] Error in getWalletByLabel for user ${chatId}, label ${label}:`, error);
        return null;
    }
  }

  // Signs a transaction with a given wallet label
  async signTransaction(chatId, walletLabel, transaction) {
    if (!chatId || !walletLabel) {
      throw new Error("signTransaction requires both chatId and walletLabel parameters");
    }
    
    const wallet = await this.getWalletByLabel(chatId, walletLabel);
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

  // Force-update all balances for all users
  async updateAllBalances(force = false) {
    if (!this.initialized) throw new Error("WalletManager not initialized. Call initialize().");
    if (!this.connection) { console.warn("[WM Balances] Cannot update balances, connection not set."); return; }

    try {
      // Get all users from database
      const users = await this.databaseManager.all('SELECT id, chat_id FROM users');
      const updatePromises = [];
      
      for (const user of users) {
        // Get all wallets for this user
        const wallets = await this.databaseManager.all(
          'SELECT * FROM user_wallets WHERE user_id = ?',
          [user.id]
        );
        
        for (const walletRow of wallets) {
          const wallet = await this.getWalletById(walletRow.id);
          if (wallet) {
            updatePromises.push(this.updateWalletBalance(wallet).catch(e => {
              console.error(`[WM Balances] Failed balance update for user ${user.chat_id}, wallet ${wallet.label || 'Unknown'}: ${e.message}`);
            }));
          }
        }
      }

      await Promise.all(updatePromises);
      console.log(`[WM Balances] Finished balance updates for ${updatePromises.length} wallet entries across all users.`);
    } catch (error) {
      console.error("❌ [WM Balances] Error during bulk balance update:", error.message);
      throw error; // Re-throw critical errors
    }
  }


}

module.exports = WalletManager;