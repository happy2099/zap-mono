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
       this.rpcLoadBalancer = new RPCLoadBalancer(config.RPC_FALLBACK_URLS, config.RPC_URL);
       this.connection = new Connection(this.rpcLoadBalancer.getNextEndpoint(), {
           commitment: 'confirmed',
           wsEndpoint: config.WS_URL,
           disableRetryOnRateLimit: true
       });
       this.priorityFees = config.MEV_PROTECTION.priorityFees;
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



   async sendVersionedTransaction({ instructions = [], prebuiltTx = null, signer, lookupTableAddresses = [] }) {
    let lastError;
    const maxRetries = 3;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const { blockhash, lastValidBlockHeight } = await this.getBlockhashWithRetry();
            let transaction;

            if (prebuiltTx) {
                transaction = prebuiltTx;
                transaction.message.recentBlockhash = blockhash;
            } else {
                if (instructions.length === 0) {
                    throw new Error("Transaction failed: No instructions provided.");
                }

                // The Helius Sender API requires a Jito tip instruction.
                const tipAccount = new PublicKey(
                    config.TIP_ACCOUNTS[Math.floor(Math.random() * config.TIP_ACCOUNTS.length)]
                );
                const finalInstructions = [
                    ...instructions, // Place user instructions first
                    SystemProgram.transfer({ // Add Jito tip at the end
                        fromPubkey: signer.publicKey,
                        toPubkey: tipAccount,
                        lamports: config.DEFAULT_JITO_TIP_LAMPORTS,
                    })
                ];

                const lookupTables = (await Promise.all(
                    lookupTableAddresses.map(addr => this.fetchALTTable(addr))
                )).filter(Boolean);

                const messageV0 = new TransactionMessage({
                    payerKey: signer.publicKey,
                    recentBlockhash: blockhash,
                    instructions: finalInstructions,
                }).compileToV0Message(lookupTables);

                transaction = new VersionedTransaction(messageV0);
            }

            transaction.sign([signer]);
            const serializedTx = transaction.serialize();
            
            console.log(`[Sender API] Sending transaction... Attempt ${attempt}`);

            // Use the new Helius Sender API endpoint
            const { data } = await axios.post(config.SENDER_ENDPOINT, {
                jsonrpc: '2.0',
                id: 'zapbot-sender-1',
                method: 'sendTransaction',
                params: [
                    Buffer.from(serializedTx).toString('base64'),
                    {
                        skipPreflight: true,
                        maxRetries: 0
                    }
                ]
            });

            if (data.error) {
                throw new Error(`Sender API Error: ${data.error.message}`);
            }
            const signature = data.result;

            const confirmation = await this.connection.confirmTransaction({
                signature,
                blockhash,
                lastValidBlockHeight
            }, 'confirmed');
            
            if (confirmation.value?.err) {
                throw new Error(`On-chain transaction confirmation failed: ${JSON.stringify(confirmation.value.err)}`);
            }

            console.log(`[Sender API] ✅ Tx Confirmed: ${signature}`);
            return { signature, error: null };

        } catch (error) {
            console.error(`[Sender API] Attempt ${attempt} failed:`, error.message);
            lastError = error;
            if(attempt < maxRetries) await require('./utils.js').sleep(700 * attempt);
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



   /**
   * ====================
   * Prebuild Trade Method
   * ====================
   */
   // async prebuildTrade(poolId, amountLamports, owner, connection, slippageBps = 50) {
   //     const raydium = await initRaydium(connection, owner);
   //     const poolInfo = await raydium.api.fetchPoolById({ ids: poolId });
   //     if (!poolInfo) throw new Error(`Pool not found: ${poolId}`);

   //     const [configInfo, token2022Infos] = await Promise.all([
   //         poolInfo.market?.startsWith("launchpad") ? raydium.api.fetchConfigById({ ids: poolInfo.configId }) : null,
   //         raydium.api.getToken2022Infos({ connection, mints: [poolInfo.mintA, poolInfo.mintB] }),
   //     ]);

   //     const isForward = !poolInfo.mintA.equals(NATIVE_MINT);
   //     const inputToken = isForward ? poolInfo.mintA : poolInfo.mintB;
   //     const outputToken = isForward ? poolInfo.mintB : poolInfo.mintA;

   //     const [inputAtaCheck, outputAtaCheck, tokenInfoA, tokenInfoB] = await Promise.all([
   //         checkATAs(connection, owner, inputToken),
   //         checkATAs(connection, owner, outputToken),
   //         raydium.token.getTokenInfo(poolInfo.mintA).catch(() => ({ programId: TOKEN_PROGRAM_ID })),
   //         poolInfo.mintB.equals(NATIVE_MINT)
   //             ? Promise.resolve({ programId: TOKEN_PROGRAM_ID })
   //             : raydium.token.getTokenInfo(poolInfo.mintB).catch(() => ({ programId: TOKEN_PROGRAM_ID })),
   //     ]);

   //     const tokenProgramA = new PublicKey(tokenInfoA.programId);
   //     const tokenProgramB = new PublicKey(tokenInfoB.programId);

   //     const instructions = [];
   //     if (!inputAtaCheck.ataExists) instructions.push(inputAtaCheck.createInstruction);
   //     if (!outputAtaCheck.ataExists) instructions.push(outputAtaCheck.createInstruction);

   //     // Handle WSOL wrapping
   //     if (inputToken.equals(NATIVE_MINT)) {
   //         const wsolAccount = getAssociatedTokenAddressSync(NATIVE_MINT, owner, true);
   //         instructions.push(
   //             createAssociatedTokenAccountIdempotentInstruction(owner, wsolAccount, owner, NATIVE_MINT),
   //             SystemProgram.transfer({ fromPubkey: owner, toPubkey: wsolAccount, lamports: amountLamports }),
   //             createSyncNativeInstruction(wsolAccount)
   //         );
   //     }

   //     const amountIn = new TokenAmount(inputToken, new BN(amountLamports));
   //     let minOut = new BN(0), feeAmount = new BN(0);

   //     if (poolInfo.market === "raydium-amm") {
   //         const poolKeys = await raydium.liquidity.getPoolKeys(poolInfo.id);
   //         ({ minAmountOut: minOut, feeAmount } = await raydium.liquidity.computeAmountOut({
   //             poolKeys, amountIn, tokenOut: outputToken,
   //             slippage: new Percent(slippageBps, 10000), token2022Infos,
   //         }));

   //         const { innerTransactions } = await raydium.liquidity.makeSwapInstructionSimple({
   //             connection, poolKeys,
   //             userKeys: {
   //                 owner, tokenAccounts: [
   //                     { pubkey: inputAtaCheck.ata, programId: tokenProgramA },
   //                     { pubkey: outputAtaCheck.ata, programId: tokenProgramB },
   //                 ]
   //             },
   //             amountIn, amountOut: new TokenAmount(outputToken, minOut),
   //             fixedSide: "in", slippage: new Percent(slippageBps, 10000), makeTxVersion: 0,
   //         });
   //         const innerInstructions = innerTransactions || []; // Check for null or undefined
   //         instructions.push(...innerInstructions.flatMap(tx => tx.instructions));
   //     }
   //     else if (poolInfo.market === "raydium-clmm") {
   //         const epochInfo = await connection.getEpochInfo();
   //         ({ minAmountOut: minOut, feeAmount } = raydium.clmm.computeAmountOutFormat({
   //             poolInfo, amountIn, tokenIn: inputToken, tokenOut: outputToken,
   //             slippage: new Percent(slippageBps, 10000), epochInfo, token2022Infos,
   //         }));

   //         const { setup, swap, cleanup } = await raydium.clmm.swap({
   //             poolInfo, owner, inputToken, outputToken,
   //             inputTokenAmount: amountIn, outputTokenAmount: new TokenAmount(outputToken, minOut),
   //             tokenProgramA, tokenProgramB,
   //         });
   //         if (setup) instructions.push(...setup.instructions);
   //         instructions.push(...swap.instructions);
   //         if (cleanup) instructions.push(...cleanup.instructions);
   //     }
   //     else if (poolInfo.market === "raydium-v4") {
   //         const poolKeys = await raydium.tradeV2.getPoolKeys(poolInfo.id);
   //         ({ minAmountOut: minOut, feeAmount } = await raydium.tradeV2.computeAmountOut({
   //             poolKeys, amountIn, tokenOut: outputToken,
   //             slippage: new Percent(slippageBps, 10000), token2022Infos,
   //         }));

   //         const { innerTransactions } = await raydium.tradeV2.makeSwapInstructionSimple({
   //             connection, poolKeys,
   //             userKeys: {
   //                 owner, tokenAccounts: [
   //                     { pubkey: inputAtaCheck.ata, programId: tokenProgramA },
   //                     { pubkey: outputAtaCheck.ata, programId: tokenProgramB },
   //                 ]
   //             },
   //             amountIn, amountOut: new TokenAmount(outputToken, minOut),
   //             fixedSide: "in", slippage: new Percent(slippageBps, 10000), makeTxVersion: 0,
   //         });
   //         const innerInstructions = innerTransactions || []; // Check for null or undefined
   //         instructions.push(...innerInstructions.flatMap(tx => tx.instructions));
   //     }
   //     else if (poolInfo.market?.startsWith("launchpad")) {
   //         if (!configInfo) throw new Error(`Launchpad config missing`);
   //         const { amountA, amountB, splitFee } = raydium.LAUNCHPAD.Curve.buyExactIn({
   //             poolInfo, amountB: new BN(amountLamports),
   //             protocolFeeRate: configInfo.tradeFeeRate,
   //             platformFeeRate: poolInfo.platformFee,
   //             curveType: configInfo.curveType,
   //             shareFeeRate: new BN(0),
   //         });

   //         minOut = amountA.mul(new BN(10000 - slippageBps)).div(new BN(10000));
   //         feeAmount = splitFee;

   //         const authPda = raydium.LAUNCHPAD.pda.getPdaLaunchpadAuth(LAUNCHPAD_PROGRAM);
   //         instructions.push(
   //             raydium.LAUNCHPAD.instrument.buyExactInInstruction(
   //                 LAUNCHPAD_PROGRAM, owner, authPda,
   //                 poolInfo.configId, poolInfo.platformId, poolInfo.id,
   //                 inputAtaCheck.ata, getAssociatedTokenAddressSync(NATIVE_MINT, owner, true),
   //                 raydium.LAUNCHPAD.pda.getPdaLaunchpadVaultId(LAUNCHPAD_PROGRAM, poolInfo.id, poolInfo.mintA),
   //                 raydium.LAUNCHPAD.pda.getPdaLaunchpadVaultId(LAUNCHPAD_PROGRAM, poolInfo.id, NATIVE_MINT),
   //                 poolInfo.mintA, NATIVE_MINT, tokenProgramA, TOKEN_PROGRAM_ID,
   //                 amountB, minOut, new BN(0)
   //             )
   //         );
   //     }

   //     return {
   //         instructions,
   //         metadata: {
   //             poolId: poolInfo.id,
   //             baseMint: poolInfo.mintA,
   //             quoteMint: poolInfo.mintB,
   //             minOut,
   //             fees: feeAmount,
   //         },
   //     };
   // }



   // async getPrecisionPriorityFee(targetProgramId, level = 'high') {
   //     // Helius `getPriorityFeeEstimate` RPC is the equivalent of QuickNode's.
   //     // It's the most accurate way to get fees for a specific dApp.
   //     const rpcEndpoint = this.connection.rpcEndpoint;

   //     try {
   //         console.log(`[FeeSniper] Fetching precision fee for program: ${shortenAddress(targetProgramId)}`);

   //         const response = await fetch(rpcEndpoint, {
   //             method: 'POST',
   //             headers: { 'Content-Type': 'application/json' },
   //             body: JSON.stringify({
   //                 jsonrpc: '2.0',
   //                 id: 1,
   //                 method: 'getPriorityFeeEstimate',
   //                 params: [{
   //                     "accountKeys": [targetProgramId], // Get fees specifically for interactions with this program
   //                     "options": { "includeAllMicroLamportLevels": true }
   //                 }]
   //             }),
   //         });

   //         const data = await response.json();

   //         // The response gives us fee levels from "min" to "veryHigh".
   //         // We'll map our bot's levels to theirs.
   //         const feeLevels = data?.result?.priorityFeeLevels;
   //         if (!feeLevels) {
   //             throw new Error("Invalid or empty response from getPriorityFeeEstimate.");
   //         }

   //         const levelMap = {
   //             low: feeLevels.low,
   //             normal: feeLevels.medium,
   //             medium: feeLevels.high,
   //             high: feeLevels.veryHigh,
   //             ultra: feeLevels.extremelyHigh || feeLevels.veryHigh, // Fallback if extremelyHigh isn't provided
   //         };

   //         const precisionFee = levelMap[level] || feeLevels.high; // Default to 'high'
   //         console.log(`[FeeSniper] ✅ Success! Precision fee for Raydium V4 (${level}): ${precisionFee} micro-lamports.`);
   //         return precisionFee;

   //     } catch (error) {
   //         console.warn(`[FeeSniper] ⚠️ Precision fee estimate failed: ${error.message}. Falling back to old dynamic fee.`);
   //         // Fallback to our old method if the advanced one fails. This makes the bot resilient.
   //         return this.getDynamicPriorityFee(level);
   //     }
   // }


   // async initializeConnection(attempt = 1) {
   //     let endpoint = this.rpcLoadBalancer.getNextEndpoint();
   //     try {
   //         console.log(`Connecting SOL [${attempt}/5] via: ${endpoint}...`);

   //         const tempConnection = new Connection(endpoint, {
   //             commitment: 'confirmed',
   //             confirmTransactionInitialTimeout: config.TRANSACTION_TIMEOUT
   //         });

   //         console.log(`Attempting getVersion() on ${endpoint}...`);
   //         const version = await tempConnection.getVersion();

   //         console.log(`RPC [${shortenAddress(endpoint, 15)}] Version: ${JSON.stringify(version)}`);

   //         if (!version['solana-core']) {
   //             throw new Error('Invalid RPC version response.');
   //         }

   //         this.connection = tempConnection;
   //         this.rpcLoadBalancer.recordSuccess(endpoint);
   //         console.log(`✅ Connection established with RPC: ${shortenAddress(endpoint, 40)}`);
   //         return true;
   //     } catch (e) {
   //         console.error(`❌ Connection attempt ${attempt}/5 to ${shortenAddress(endpoint, 40)} FAILED: ${e.message}`);
   //         this.rpcLoadBalancer.recordError(endpoint);
   //         if (attempt < 5) {
   //             await sleep(config.RETRY_DELAY * attempt);
   //             return this.initializeConnection(attempt + 1);
   //         }
   //         console.error(`Final connection attempt failed after 5 retries.`);
   //         return false;
   //     }
   // }

   // initializeJito() {
   //     if (!config.MEV_PROTECTION.enabled) {
   //         this.jitoSdkAvailable = false;
   //         return console.warn('Jito MEV Protection disabled in config.');
   //     }

   //     try {
   //         const jitoAuthKeypair = Keypair.fromSecretKey(bs58.decode(config.USER_WALLET_PRIVATE_KEY));
   //         this.jitoSearcherClient = createJitoSearcherClient(config.JITO_BLOCK_ENGINE_URL, jitoAuthKeypair, { 'grpc.keepalive_time_ms': 5000 });
   //         this.BundleClass = JitoBundle;
   //         this.jitoSearcherClient.onBundleResult((res) => this.handleJitoBundleResult(res), (err) => console.error('[Jito Bundle Error]', err));
   //         this.jitoSdkAvailable = true;
   //         this.refreshJitoTipAccounts();
   //         console.log('✅ Real Jito MEV Protection initialized.');
   //     } catch (error) {
   //         console.error('❌ FAILED to initialize Jito SDK:', error);
   //         this.jitoSdkAvailable = false;
   //     }
   // }

   // handleJitoBundleResult(bundleResult) {
   //     if (bundleResult.dropped) console.error(`[Jito] Bundle ${bundleResult.bundleId} DROPPED. Reason: ${bundleResult.rejectionReason}`);
   // }

   // async refreshJitoTipAccounts() {
   //     if (!this.jitoSdkAvailable) return;
   //     try {
   //         const accounts = await this.jitoSearcherClient.getTipAccounts();
   //         if (accounts?.length > 0) this.jitoTipAccounts = accounts.map(a => new PublicKey(a));
   //     } catch (e) { console.warn("Could not refresh Jito tip accounts."); }
   // }

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

   // async sendAndConfirmTransaction(instructionsOrTx, signers) {
   //     // ============== INPUT VALIDATION ==============
   //     if (!instructionsOrTx) {
   //         throw new Error("No transaction or instructions provided");
   //     }
   //     if (!Array.isArray(signers)) {
   //         throw new Error("Signers must be an array");
   //     }
   //     if (signers.length === 0) {
   //         throw new Error("At least one signer required");
   //     }

   //     // ============== DEBUG LOGGING ==============
   //     if (config.DEBUG_MODE) {
   //         console.log("[DEBUG] Transaction details:", {
   //             inputType: Array.isArray(instructionsOrTx) ? "instructions" : "prebuilt-transaction",
   //             signers: signers.map(s => s.publicKey.toString()),
   //             inputData: instructionsOrTx
   //         });
   //     }

   //     const payer = signers[0];
   //     let lastError;

   //     for (let attempt = 1; attempt <= 3; attempt++) {
   //         const rpc = this.rpcLoadBalancer.getNextEndpoint();
   //         const connection = new Connection(rpc, { commitment: 'confirmed' });

   //         try {
   //             const { blockhash, lastValidBlockHeight } = await this.getBlockhashWithRetry();
   //             let tx;

   //             // Handle both instruction arrays and pre-built transactions
   //             if (Array.isArray(instructionsOrTx)) {
   //                 if (config.DEBUG_MODE) {
   //                     console.log("[DEBUG] Building new transaction from", instructionsOrTx.length, "instructions");
   //                 }

   //                 tx = new VersionedTransaction(
   //                     new TransactionMessage({
   //                         payerKey: payer.publicKey,
   //                         recentBlockhash: blockhash,
   //                         instructions: instructionsOrTx
   //                     }).compileToV0Message()
   //                 );
   //             } else {
   //                 if (config.DEBUG_MODE) {
   //                     console.log("[DEBUG] Using pre-built transaction");
   //                 }

   //                 tx = instructionsOrTx;
   //                 // Update blockhash to prevent staleness
   //                 tx.message.recentBlockhash = blockhash;
   //             }

   //             tx.sign(signers);

   //             if (config.DEBUG_MODE) {
   //                 console.log("[DEBUG] Signed transaction:", {
   //                     signatures: tx.signatures.map(sig => bs58.encode(sig)),
   //                     message: tx.message
   //                 });
   //             }

   //             const sig = await connection.sendRawTransaction(tx.serialize(), {
   //                 skipPreflight: true
   //             });

   //             const conf = await connection.confirmTransaction(
   //                 { signature: sig, blockhash, lastValidBlockHeight },
   //                 'confirmed'
   //             );

   //             if (conf.value.err) {
   //                 throw new Error(`On-chain confirmation error: ${JSON.stringify(conf.value.err)}`);
   //             }

   //             this.rpcLoadBalancer.recordSuccess(rpc);
   //             console.log(`[Sender] ✅ Tx Confirmed: ${sig}`);
   //             return sig;
   //         } catch (error) {
   //             lastError = error;
   //             this.rpcLoadBalancer.recordError(rpc);
   //             if (attempt < 3) {
   //                 console.warn(`[Attempt ${attempt}/3] Failed, retrying...`);
   //                 await sleep(1500);
   //             }
   //         }
   //     }

   //     console.error("Transaction failed after all retries:", lastError);
   //     throw lastError || new Error("Transaction failed for unknown reasons");
   // }

   // async sendProtectedTransaction(transaction, payerKeypair) {
   //     // ============== INPUT VALIDATION ==============
   //     if (!transaction) {
   //         throw new Error("No transaction provided");
   //     }
   //     if (!payerKeypair || !payerKeypair.publicKey) {
   //         throw new Error("Invalid payer keypair");
   //     }

   //     // ============== DEBUG LOGGING ==============
   //     if (config.DEBUG_MODE) {
   //         console.log("[DEBUG] Protected transaction details:", {
   //             instructions: transaction.message?.instructions?.length || 0,
   //             signer: payerKeypair.publicKey.toString(),
   //             recentBlockhash: transaction.message?.recentBlockhash
   //         });
   //     }

   //     // Fallback to standard send if Jito is disabled or unavailable
   //     if (!config.MEV_PROTECTION.enabled || !this.jitoSearcherClient) {
   //         console.warn("[Send] Jito disabled/unavailable. Sending standard transaction.");
   //         try {
   //             const signature = await this.sendAndConfirmTransaction(
   //                 transaction,
   //                 [payerKeypair]
   //             );
   //             return { signature, error: null };
   //         } catch (error) {
   //             if (config.DEBUG_MODE) {
   //                 console.error("[DEBUG] Standard send failed:", error);
   //             }
   //             return { signature: null, error: `Standard send failed: ${error.message}` };
   //         }
   //     }

   //     try {
   //         const bundle = new this.BundleClass([transaction], 5);
   //         const tip = this.calculateJitoTip('high');

   //         if (tip > 0 && this.jitoTipAccounts.length > 0) {
   //             const tipAccount = this.jitoTipAccounts[Math.floor(Math.random() * this.jitoTipAccounts.length)];
   //             bundle.addTipTx(
   //                 payerKeypair,
   //                 tip,
   //                 tipAccount,
   //                 transaction.message.recentBlockhash
   //             );

   //             if (config.DEBUG_MODE) {
   //                 console.log("[DEBUG] Added tip transaction:", {
   //                     tipAmount: tip,
   //                     tipAccount: tipAccount.toString()
   //                 });
   //             }
   //         }

   //         const bundleId = await this.jitoSearcherClient.sendBundle(bundle);
   //         console.log(`[Jito] Bundle sent: ${bundleId}. Polling for confirmation...`);

   //         const signature = await this.pollJitoBundle(bundleId);
   //         if (!signature) {
   //             throw new Error(`Jito bundle ${bundleId} did not confirm within timeout.`);
   //         }

   //         return { signature, error: null };
   //     } catch (e) {
   //         console.error(`[Jito] Error sending bundle, falling back to standard tx:`, e.message);

   //         try {
   //             const signature = await this.sendAndConfirmTransaction(
   //                 transaction,
   //                 [payerKeypair]
   //             );
   //             return { signature, error: `(Jito send failed, but fallback succeeded)` };
   //         } catch (fallbackError) {
   //             if (config.DEBUG_MODE) {
   //                 console.error("[DEBUG] Fallback send failed:", fallbackError);
   //             }
   //             return {
   //                 signature: null,
   //                 error: `Jito failed AND standard send also failed: ${fallbackError.message}`
   //             };
   //         }
   //     }
   // }

   // async pollJitoBundle(bundleId, timeoutMs = 30000) {
   //     const startTime = Date.now();
   //     while (Date.now() - startTime < timeoutMs) {
   //         try {
   //             const statuses = await this.jitoSearcherClient.getBundleStatuses([bundleId]);
   //             const status = statuses?.value?.[0];
   //             if (status) {
   //                 const sig = status.transactions?.[0];
   //                 if (status.confirmation_status === "CONFIRMED" && sig) return sig;
   //                 if (status.confirmation_status === "DROPPED") return null;
   //             }
   //         } catch { }
   //         await sleep(1500);
   //     }
   //     return null;
   // }

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

   // async confirmTransaction(signature) {
   //     const result = await this.connection.confirmTransaction(signature, 'confirmed');
   //     if (result.value.err) {
   //         throw new Error("Transaction failed confirmation");
   //     }
   //     return result;
   // }

   stop() {
       if (this.blockhashRefreshInterval) clearInterval(this.blockhashRefreshInterval);
       if (this.networkCongestionInterval) clearInterval(this.networkCongestionInterval);
       console.log("SolanaManager stopped.");
   }
}

module.exports = { SolanaManager, RPCLoadBalancer };