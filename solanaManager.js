// ==========================================
// ====== ZapBot SolanaManager (Final) ======
// ==========================================
// File: solanaManager.js
// Description: Manages all Solana network interactions, including advanced Jito bundle handling and polling.

const { Connection, Keypair, VersionedTransaction, TransactionMessage, PublicKey, SystemProgram,
    Transaction, ComputeBudgetProgram, AddressLookupTableAccount, NonceAccount } = require('@solana/web3.js');
const bs58 = require('bs58');
// const { Bundle: JitoBundle } = require('jito-ts/dist/sdk/block-engine/types');
// const { searcherClient: createJitoSearcherClient } = require('jito-ts/dist/sdk/block-engine/searcher');
const { shortenAddress, sleep } = require('./utils');
const config = require('./config.js');
const sellInstructionCache = new Map();
const axios = require('axios'); // Add this line at the top


class RPCLoadBalancer {
   constructor(endpoints, defaultEndpoint) {
       this.endpoints = Array.from(new Set([defaultEndpoint, ...(endpoints || [])].filter(Boolean)));
       this.currentIndex = 0;
       this.status = new Map(this.endpoints.map(ep => [ep, { errors: 0, status: 'healthy', lastErrorTime: 0 }]));
       this.altTableCache = new Map();
       console.log(`RPCLoadBalancer initialized with ${this.endpoints.length} endpoints.`);
   }

   getNextEndpoint() {
       if (this.endpoints.length === 1) return this.endpoints[0];
       for (let i = 0; i < this.endpoints.length; i++) {
           const endpoint = this.endpoints[this.currentIndex];
           const info = this.status.get(endpoint);
           this.currentIndex = (this.currentIndex + 1) % this.endpoints.length;
           if (info.status === 'healthy' || (Date.now() - info.lastErrorTime > 180000)) {
               if (info.status === 'cooling_down') this.recordSuccess(endpoint);
               return endpoint;
           }
       }
       return this.endpoints[0];
   }

   recordError(endpoint) {
       const info = this.status.get(endpoint);
       if (info) {
           info.errors += 1;
           info.lastErrorTime = Date.now();
           if (info.errors >= 5) {
               info.status = 'cooling_down';
               console.warn(`RPC [${shortenAddress(endpoint, 15)}] marked for cooldown.`);
           }
       }
   }

   recordSuccess(endpoint) {
       const info = this.status.get(endpoint);
       if (info && info.errors > 0) {
           info.errors = 0;
           info.status = 'healthy';
       }
   }
}

class SolanaManager {
   constructor() {
       // Use dedicated premium endpoint with fallback to mainnet
       // Primary: Your dedicated endpoint, Fallback: Main Helius RPC
       const dedicatedRpc = config.HELIUS_ENDPOINTS.rpc;
       
       // THE FIX: No fallbacks to public RPCs. We pay for premium, we use premium.
       this.rpcLoadBalancer = new RPCLoadBalancer(null, dedicatedRpc);
       this.connection = new Connection(this.rpcLoadBalancer.getNextEndpoint(), {
           commitment: 'processed',
           wsEndpoint: config.HELIUS_ENDPOINTS.websocket || config.WS_URL,
           disableRetryOnRateLimit: true
       });
       this.priorityFees = config.MEV_PROTECTION?.priorityFees || { microLamports: 1000000 };
       this.lastBlockhash = null;
       this.lastBlockhashTime = 0;
       this.altTableCache = new Map();

       console.log(`SolanaManager created. RPC: ${this.connection.rpcEndpoint}`);
   }

   async initialize() {
       // This is the clean initialize method.
       try {
           await this.connection.getVersion();
           console.log("✅ Connection established with RPC:", this.connection.rpcEndpoint);
           await this.getBlockhashWithRetry(); // Prime the blockhash cache on startup
       } catch (error) {
           console.error('❌ Failed to establish connection with Solana RPC:', error.message);
           throw new Error(`Solana RPC connection failed: ${error.message}`);
       }
   }


   /**
    * Fetch Address Lookup Table (ALT) from on-chain data
    */
   async fetchALT(tableAddress) {
       const pubkeyStr = typeof tableAddress === 'string' ? tableAddress : tableAddress.toBase58();

       // Return from cache if we already have it
       if (this.altTableCache.has(pubkeyStr)) {
           return this.altTableCache.get(pubkeyStr);
       }

       try {
           const lookupAccountInfo = await this.connection.getAddressLookupTable(new PublicKey(pubkeyStr));
           const altAccount = lookupAccountInfo?.value;
           if (!altAccount) throw new Error('ALT not found on-chain or is invalid.');

           this.altTableCache.set(pubkeyStr, altAccount);
           console.log(`[ALT_INDEXER] ✅ Cached ALT: ${pubkeyStr.substring(0, 4)}... with ${altAccount.state.addresses.length} addresses`);
           return altAccount;

       } catch (err) {
           console.warn(`[ALT_INDEXER] ❌ Failed to fetch ALT ${pubkeyStr}. Reason:`, err.message);
           return null; // Return null on failure so the transaction can proceed without it if necessary
       }
   }

   /**
    * Fetch Address Lookup Table (ALT) from on-chain data
    */
   async fetchALTTable(tableAddress) {
       try {
           // ================================================================
           // ====================== THE FINAL, SINGLE-LINE FIX ======================
           // ================================================================
           // We now "open the box" here. The PublicKey constructor is smart enough
           // to handle the raw object/Buffer that Helius sends us.
           const tableKey = new PublicKey(tableAddress);
           // ================================================================

           const pubkeyStr = tableKey.toBase58();

           // The rest of the function now works perfectly
           if (this.altTableCache.has(pubkeyStr)) {
               return this.altTableCache.get(pubkeyStr);
           }

           // We use the 'tableKey' PublicKey object we created for the RPC call
           const lookupAccountInfo = await this.connection.getAddressLookupTable(tableKey);
           const altAccount = lookupAccountInfo?.value;
           if (!altAccount) throw new Error('ALT not found on-chain or is invalid.');

           this.altTableCache.set(pubkeyStr, altAccount);
           console.log(`[ALT_FETCHER] Cached ALT: ${pubkeyStr.substring(0, 4)}... with ${altAccount.state.addresses.length} addresses`);
           return altAccount;

       } catch (err) {
           console.warn(`[ALT_FETCHER] Failed to fetch ALT. Reason:`, err.message);
           return null;
       }
   }

   async getDecodedAmmPool(poolAddress) {
    try {
        const borsh = require('borsh');
        const BN = require('bn.js');
        const { PublicKey } = require('@solana/web3.js');

        const PoolLayout = new Map([[Object, { 
            kind: 'struct', 
            fields: [
                ['pool_bump', 'u8'],
                ['index', 'u16'],
                ['creator', 'publicKey'],
                ['base_mint', 'publicKey'],
                ['quote_mint', 'publicKey'],
                ['lp_mint', 'publicKey'],
                ['pool_base_token_account', 'publicKey'],
                ['pool_quote_token_account', 'publicKey'],
                ['lp_supply', 'u64'],
                ['coin_creator', 'publicKey'],
                ['pool_base_token_reserves', 'u64'],
                ['pool_quote_token_reserves', 'u64'],
            ] 
        }]]);

        const accountInfo = await this.connection.getAccountInfo(new PublicKey(poolAddress));
        if (!accountInfo) return null;
        
        // The discriminator is the first 8 bytes of the account data
        const decodedData = borsh.deserialize(PoolLayout, Object, accountInfo.data.slice(8));
        
        // Convert buffers to PublicKeys and BN to numbers/BigInts for easier use
        const formatDecodedData = (data) => {
            const formatted = {};
            for (const [key, value] of Object.entries(data)) {
                if (value && typeof value.toBuffer === 'function') {
                    formatted[key] = new PublicKey(value);
                } else if (value instanceof BN) {
                    formatted[key] = BigInt(value.toString());
                } else {
                    formatted[key] = value;
                }
            }
            return formatted;
        };

        return formatDecodedData(decodedData);
        
    } catch (error) {
        console.error(`[SolanaManager] Failed to decode AMM pool account ${poolAddress}:`, error);
        return null;
    }
}

   async createAndInitializeNonceAccount(payerKeypair) {
       try {
           const nonceAccountKeypair = Keypair.generate();
           const nonceAccountPubkey = nonceAccountKeypair.publicKey;

           console.log(`[NONCE] Creating and initializing new nonce account: ${shortenAddress(nonceAccountPubkey.toBase58())}`);

           // Calculate minimum balance for rent exemption
           // Nonce accounts are 80 bytes in size
           const NONCE_ACCOUNT_SIZE = 80;
           const lamports = await this.connection.getMinimumBalanceForRentExemption(NONCE_ACCOUNT_SIZE);

           const createAccountInstruction = SystemProgram.createAccount({
               fromPubkey: payerKeypair.publicKey,
               newAccountPubkey: nonceAccountPubkey,
               lamports,
               space: NONCE_ACCOUNT_SIZE,
               programId: SystemProgram.programId,
           });

          const initializeNonceInstruction = SystemProgram.nonceInitialize({
   noncePubkey: nonceAccountPubkey,
   authorizedPubkey: payerKeypair.publicKey,
});
           const { blockhash, lastValidBlockHeight } = await this.connection.getLatestBlockhash('confirmed');

           const transaction = new Transaction({
               recentBlockhash: blockhash,
               feePayer: payerKeypair.publicKey,
           }).add(createAccountInstruction, initializeNonceInstruction);

           transaction.sign(payerKeypair, nonceAccountKeypair); // Sign with both payer and new nonce account

           const signature = await this.connection.sendRawTransaction(transaction.serialize(), {
               skipPreflight: false,
               preflightCommitment: 'confirmed'
           });

           // Use polling instead of WebSocket subscription for confirmation
           let confirmed = false;
           let attempts = 0;
           const maxAttempts = 30;
           
           while (!confirmed && attempts < maxAttempts) {
               try {
                   const status = await this.connection.getSignatureStatus(signature);
                   if (status.value && status.value.confirmationStatus === 'confirmed') {
                       confirmed = true;
                       break;
                   }
                   if (status.value && status.value.err) {
                       throw new Error(`Transaction failed: ${JSON.stringify(status.value.err)}`);
                   }
               } catch (error) {
                   console.log(`[NONCE] Confirmation attempt ${attempts + 1}/${maxAttempts}...`);
               }
               
               attempts++;
               await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds
           }
           
           if (!confirmed) {
               throw new Error('Transaction confirmation timeout');
           }

           console.log(`[NONCE] ✅ Nonce account ${shortenAddress(nonceAccountPubkey.toBase58())} created and initialized. TXID: ${signature}`);
           return { nonceAccountKeypair, nonceAccountPubkey };

       } catch (error) {
           console.error(`[NONCE] ❌ Failed to create and initialize nonce account: ${error.message}`);
           throw error;
       }
   }

   async getLatestNonce(nonceAccountPubkey) {
       try {
           const accountInfo = await this.connection.getAccountInfo(nonceAccountPubkey);
           if (!accountInfo) {
               throw new Error(`Nonce account ${shortenAddress(nonceAccountPubkey.toBase58())} not found.`);
           }

           const nonceAccount = NonceAccount.fromAccountData(accountInfo.data);
           // Fix: Check if nonce account is properly initialized (state should be an object with initialized flag)
           if (!nonceAccount || !nonceAccount.nonce) {
               throw new Error(`Nonce account ${shortenAddress(nonceAccountPubkey.toBase58())} is not initialized.`);
           }

           const nonce = new PublicKey(nonceAccount.nonce).toBase58(); // Nonce is a blockhash
           const nonceAuthority = new PublicKey(nonceAccount.authorizedPubkey);

           console.log(`[NONCE] Fetched latest nonce for ${shortenAddress(nonceAccountPubkey.toBase58())}: ${shortenAddress(nonce)}`);
           return { nonce, nonceAuthority };

       } catch (error) {
           console.error(`[NONCE] ❌ Failed to get latest nonce for ${shortenAddress(nonceAccountPubkey.toBase58())}: ${error.message}`);
           throw error;
       }
   }



   async getBlockhashWithRetry(retries = 3) {
       const now = Date.now();
       if (this.lastBlockhash && (now - this.lastBlockhashTime) < config.BLOCKHASH_CACHE_EXPIRATION) {
           return this.lastBlockhash;
       }

       for (let i = 0; i < retries; i++) {
           try {
               const blockhashData = await this.connection.getLatestBlockhash('confirmed');
               this.lastBlockhash = blockhashData.blockhash;
               this.lastBlockhashTime = Date.now();
               return { blockhash: this.lastBlockhash, lastValidBlockHeight: blockhashData.lastValidBlockHeight };
           } catch (error) {
               console.warn(`[Blockhash] Attempt ${i + 1} failed. Retrying...`);
               if (i === retries - 1) throw new Error("Failed to get latest blockhash.");
               await new Promise(resolve => setTimeout(resolve, 500));
           }
       }
   }


   startBlockhashCacheRefresh() {
       if (this.blockhashRefreshInterval) clearInterval(this.blockhashRefreshInterval);
       this.blockhashRefreshInterval = setInterval(() => this.getBlockhashWithRetry().catch(() => { }), config.BLOCKHASH_REFRESH_INTERVAL_MS);
       this.blockhashRefreshInterval.unref();
   }

   startCongestionMonitor() {
       const update = async () => {
           if (!this.connection) return;
           const state = config.MEV_PROTECTION.networkState;
           try {
               const fees = await this.connection.getRecentPrioritizationFees({ lockedAccounts: [] });
               if (!fees?.length) { state.congestionLevel = 'normal'; return; }
               const p75 = fees.sort((a, b) => a.prioritizationFee - b.prioritizationFee)[Math.floor(fees.length * 0.75)]?.prioritizationFee;
               if (p75 > config.MEV_PROTECTION.priorityFees.high) state.congestionLevel = 'high';
               else if (p75 < config.MEV_PROTECTION.priorityFees.low / 2) state.congestionLevel = 'low';
               else state.congestionLevel = 'normal';
           } catch (e) { /* Ignore RPC errors */ }
       };
       this.networkCongestionInterval = setInterval(update, config.MEV_PROTECTION.networkState.updateInterval);
       this.networkCongestionInterval.unref();
   }

   async warmupConnection() {
       try { await this.connection.getEpochInfo(); }
       catch { await this.initializeConnection(); }
   }

   async getSOLBalance(address) {
       try {
           return await this.connection.getBalance(new PublicKey(address), 'confirmed') / config.LAMPORTS_PER_SOL_CONST;
       } catch { return null; }
   }

   // REMOVED: getDynamicPriorityFee - Use singaporeSenderManager.js for all fee calculations

   calculateJitoTip(level = 'high') {
       const factor = { low: 0.5, normal: 1.0, medium: 1.5, high: 2.5, ultra: 5.0 }[level] || 1.0;
       return Math.floor(config.MEV_PROTECTION.defaultTipLamports * factor);
   }



   async getBalance(publicKeyString) {
       try {
           const balance = await this.connection.getBalance(new PublicKey(publicKeyString));
           return balance / config.LAMPORTS_PER_SOL_CONST;
       } catch (error) {
           console.error(`Failed to get balance for ${publicKeyString}:`, error);
           return 0;
       }
   }

   stop() {
       console.log("SolanaManager stopped.");
   }

   // REMOVED: sendSol - Use singaporeSenderManager.js for all transaction sending



   stop() {
       if (this.blockhashRefreshInterval) clearInterval(this.blockhashRefreshInterval);
       if (this.networkCongestionInterval) clearInterval(this.networkCongestionInterval);
       console.log("SolanaManager stopped.");
   }
}

module.exports = { SolanaManager, RPCLoadBalancer };