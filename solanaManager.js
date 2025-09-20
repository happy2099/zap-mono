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


   async fetchALTTable(tableAddress) {
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

   async sendRawSerializedTransaction(txString) {
       try {
           const txBuffer = Buffer.from(txString, 'base64');
           const signature = await this.connection.sendRawTransaction(txBuffer, { skipPreflight: true });
           // Don't wait for confirmation here for max speed, let it confirm in the background.
           return { signature, error: null };
       } catch (error) {
           return { signature: null, error: error.message };
       }
   }



   async sendVersionedTransaction({ instructions, signer, lookupTableAddresses = [] }) {
    let lastError;
    const maxRetries = config.MAX_RETRIES || 3;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const { blockhash } = await this.getBlockhashWithRetry();
            
            const lookupTables = (await Promise.all(
                lookupTableAddresses.map(addr => this.fetchALTTable(addr))
            )).filter(Boolean);

            const messageV0 = new TransactionMessage({
                payerKey: signer.publicKey,
                recentBlockhash: blockhash,
                instructions: instructions,
            }).compileToV0Message(lookupTables);

            const transaction = new VersionedTransaction(messageV0);
            transaction.sign([signer]);
            const serializedTx = transaction.serialize();
            
            // Direct-to-sender execution
            const response = await fetch(config.HELIUS_ENDPOINTS.sender, {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({
                    "jsonrpc": "2.0",
                    "id": "zapbot-sender-1",
                    "method": "sendTransaction",
                    "params": [bs58.encode(serializedTx)]
                }),
            });

            const data = await response.json();

            if (data.error) {
                throw new Error(`Helius Sender API Error: ${data.error.message}`);
            }
            
            // We don't wait for confirmation here for max speed. We just need the signature.
            // The confirmation logic will be handled higher up, if needed.
            return { signature: data.result, error: null };

        } catch (error) {
            console.error(`[SolanaManager] Send Attempt ${attempt} failed:`, error.message);
            lastError = error;
            if(attempt < maxRetries) await sleep(500 * attempt); // Wait longer between retries
        }
    }
    
    return { signature: null, error: `Tx failed after all retries: ${lastError?.message || 'Unknown Sender Error'}` };
}

// ADD this new function inside the SolanaManager class in solanaManager.js

   async getPriorityFeeEstimate(instructions, signerPublicKey, lookupTables = []) {
       try {
           const messageV0 = new TransactionMessage({
               payerKey: signerPublicKey,
               recentBlockhash: '11111111111111111111111111111111', // Dummy blockhash
               instructions: instructions,
           }).compileToV0Message(lookupTables);

           const transaction = new VersionedTransaction(messageV0);
           const serializedTx = bs58.encode(transaction.serialize());

           const response = await fetch(this.connection.rpcEndpoint, {
               method: "POST",
               headers: { "Content-Type": "application/json" },
               body: JSON.stringify({
                 jsonrpc: "2.0",
                 id: "zapbot-fee-estimate",
                 method: "getPriorityFeeEstimate",
                 params: [{ transaction: serializedTx, options: { includeAllFees: true } }],   
               }),
             });
             
           const data = await response.json();
           
           // Helius provides different levels, we will take the high estimate for sniping
           if (data.result?.priorityFeeLevels?.high) {
               console.log(`[Fee Estimator] Dynamic priority fee: ${data.result.priorityFeeLevels.high} microLamports`);
               return data.result.priorityFeeLevels.high;
           }

       } catch (error) {
           console.warn(`[Fee Estimator] Failed to get dynamic priority fee, falling back. Error: ${error.message}`);
       }
       
       // Fallback to our existing method if the API call fails
       return this.getDynamicPriorityFee('ultra');
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

   getDynamicPriorityFee(level = 'high') {
       let fee = config.MEV_PROTECTION.priorityFees[level] || config.MEV_PROTECTION.priorityFees.normal;
       const mult = { low: 0.8, normal: 1.0, high: 1.8 }[config.MEV_PROTECTION.networkState.congestionLevel] || 1.0;
       return Math.ceil(fee * mult);
   }

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

   async sendSol(fromWalletLabel, toAddress, amountSol) {
       try {
           const fromKeypair = await this.walletManager.getKeypairByLabel(fromWalletLabel);
           if (!fromKeypair) throw new Error(`Wallet '${fromWalletLabel}' not found.`);

           const toPublicKey = new PublicKey(toAddress);
           const amountLamports = amountSol * config.LAMPORTS_PER_SOL_CONST;

           const { blockhash, lastValidBlockHeight } = await this.connection.getLatestBlockhash('confirmed');

           const instructions = [
               SystemProgram.transfer({
                   fromPubkey: fromKeypair.publicKey,
                   toPubkey: toPublicKey,
                   lamports: amountLamports,
               }),
           ];

           const messageV0 = new TransactionMessage({
               payerKey: fromKeypair.publicKey,
               recentBlockhash: blockhash,
               instructions,
           }).compileToLegacyMessage(); // Compile to legacy message for simple transfers

           const transaction = new Transaction().add(instructions[0]); // Add the transfer instruction
           transaction.recentBlockhash = blockhash;
           transaction.feePayer = fromKeypair.publicKey;
           transaction.sign(fromKeypair);

           const signature = await this.connection.sendRawTransaction(transaction.serialize(), {
               skipPreflight: false,
               preflightCommitment: 'confirmed'
           });

           await this.connection.confirmTransaction({
               signature,
               blockhash,
               lastValidBlockHeight
           }, 'confirmed');

           console.log(`✅ Sent ${amountSol} SOL from ${shortenAddress(fromKeypair.publicKey.toBase58())} to ${shortenAddress(toAddress)}. TXID: ${signature}`);
           return signature;
       } catch (error) {
           console.error(`❌ Failed to send SOL: ${error.message}`);
           throw error;
       }
   }



   stop() {
       if (this.blockhashRefreshInterval) clearInterval(this.blockhashRefreshInterval);
       if (this.networkCongestionInterval) clearInterval(this.networkCongestionInterval);
       console.log("SolanaManager stopped.");
   }
}

module.exports = { SolanaManager, RPCLoadBalancer };