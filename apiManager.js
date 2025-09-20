// ==========================================
// ============= ZapBot ApiManager ===========
// ==========================================
// File: apiManager.js
// Description: Central manager for all external API interactions (Shyft, Raydium, etc.).

const axios = require('axios');
const config = require('./config.js'); // CommonJS import for internal module
const { shortenAddress, logPerformance } = require('./utils.js'); // Added logPerformance
// Jupiter API removed - using universalCloner instead
const { PublicKey } = require('@solana/web3.js');
const { getMint } = require('@solana/spl-token');


class ApiManager {
  constructor(solanaManager) {
    this.solanaManager = solanaManager;
    this.solanaTrackerApi = null;
    this.solanaTrackerStream = null;
    this.subscribedTraders = new Set();
    this.isInitialized = false;

    // Raydium API Client (unchanged, used for rare fallbacks)
    this.raydiumClient = axios.create({
      baseURL: 'https://api.raydium.io/v2',
      timeout: 10000,
    });
    
    console.log("[ApiManager] Initialized with Helius-native logic.");
  }


//  startUniversalDataStream(tradingEngine) {
//     // Mission-critical check: Do we have the credentials for this weapon?
//     if (!config.HELIUS_API_KEY || config.HELIUS_API_KEY.startsWith('b9a69ad0-d823-429e-8c18-7cbea0e31769')) {
//       console.warn('[DATASTREAM] ⚠️ SKIPPING: WebSocket Sniper is a premium feature. No valid Solana Tracker API key found in .env');
//       return;
//     }

//     console.log('[DATASTREAM] Initializing Universal New Pool Sniper...');

//     // 1. Initialize the Datastream client if it doesn't exist
//      if (!this.solanaTrackerStream) {
//       // The intel confirms we must get the AUTHENTICATED URL from the dashboard. 
//       // This is a placeholder for the real URL you will get with a paid plan.
//       // For now, it likely won't connect, but the code is now CORRECT and ready.
//       const PREMIUM_WEBSOCKET_URL = `wss://datastream.solanatracker.io/sdk?apiKey=${config.HELIUS_API_KEY}`;
      
//       this.solanaTrackerStream = new Datastream({
//         wsUrl: PREMIUM_WEBSOCKET_URL,
//         autoReconnect: true
//       });

//       // 2. Set up event listeners for the connection itself
//       this.solanaTrackerStream.on('connected', () => console.log('[DATASTREAM] ✅ Sniper is online. Connected to Solana Tracker.'));
//       this.solanaTrackerStream.on('disconnected', () => console.warn('[DATASTREAM] ⚠️ Sniper is offline. Disconnected.'));
//       this.solanaTrackerStream.on('error', (error) => console.error('[DATASTREAM] ❌ CRITICAL ERROR:', error));

//       // 3. Connect to the WebSocket
//       this.solanaTrackerStream.connect();
//     }

//     // 4. THIS IS THE FIREHOSE. Subscribe to ALL new tokens and pools.
//     const subscription = this.solanaTrackerStream.subscribe.latest();
//     subscription.on((data) => {
//         // ... ALL of the switch-case logic we wrote before stays here ...
//         if (!data || !data.pools || data.pools.length === 0) return;
//         const primaryPool = data.pools[0];
//         const token = data.token;
//         console.log(`[DATASTREAM] 🔥 NEW POOL DETECTED! Symbol: ${token.symbol}, Market: ${primaryPool.market}`);

//       // 6. This is the dispatcher. We look at the 'market' and route to the correct tradingEngine function.
//       switch (primaryPool.market) {

//         case 'pumpfun':
//           // We need to transform their data into the format our tradingEngine expects
//           // const pumpData = {
//           //   Transaction: { Signature: primaryPool.bundleId || `pump_${token.mint}` },
//           //   Instruction: {
//           //     Accounts: [{ Address: token.mint }]
//           //     // Note: We're simulating the structure. All we need is the mint address.
//           //   }
//           // };
//           // tradingEngine.processPumpFunCreation(pumpData);
//           break;

//         case 'raydium-launchpad':
//           // Their Launchpad data is rich. We can pass it all.
//           // const launchpadData = {
//           //   Transaction: { Signature: `launchpad_${primaryPool.poolId}` }, // Create a synthetic signature
//           //   parsedPoolData: { // Our tradingEngine looks for this specific object
//           //     poolId: primaryPool.poolId,
//           //     baseMint: primaryPool.tokenAddress,
//           //     configId: primaryPool.launchpad?.configId // We'll need to confirm this field exists, but it's a safe bet
//           //   },
//           //   // Pass metadata directly
//           //   Instruction: { Program: { Arguments: [{ Name: "base_mint_param", Value: { json: primaryPool.tokenAddress } }, { Name: "metadata", Value: { json: { symbol: token.symbol, name: token.name } } }] } }
//           // };
//           // tradingEngine.processLivePoolCreation(launchpadData);
//           break;

//         case 'meteora-dlmm':
//           // const dlmmData = {
//           //   Transaction: { Signature: `dlmm_${primaryPool.poolId}` },
//           //   Instruction: { Accounts: [{ Address: primaryPool.poolId }, { Address: token.mint }, { Address: config.NATIVE_SOL_MINT }] }
//           // };
//           // tradingEngine.processMeteoraDlmmPoolCreation(dlmmData);
//           break;

//         case 'meteora-dbc':
//           // const dbcData = {
//           //   Transaction: { Signature: `dbc_${primaryPool.poolId}` },
//           //   Instruction: { Accounts: [{ Address: primaryPool.poolId }, {}, { Address: config.NATIVE_SOL_MINT }, { Address: token.mint }] } // Simulating the account structure
//           // };
//           // tradingEngine.processMeteoraDbcPoolCreation(dbcData);
//           break;

//         // You can add more cases here for 'bonk','moonshot' etc. as you implement those strategies
//         default:
//           console.log(`[DATASTREAM] Received pool on unhandled market: ${primaryPool.market}`);
//           break;
//       }
//     });
//   }

async startTraderMonitoringStream(tradingEngine) {
    if (!this.solanaTrackerStream) {
        console.warn('[TRADER_MONITOR] SKIPPING: Datastream object does not exist.');
        return;
    }

    console.log('[TRADER_MONITOR] Syncing trader subscriptions...');

    try {
        const masterTraderWallets = await tradingEngine.getMasterTraderWallets();
        if (!masterTraderWallets?.length) {
            console.log('[TRADER_MONITOR] No active master traders to subscribe to.');
            return;
        }

        for (const traderAddress of masterTraderWallets) {
            const addressStr = typeof traderAddress === 'object' ? traderAddress.toBase58() : traderAddress;

            if (this.subscribedTraders.has(addressStr)) {
                continue;
            }

            try {
                this.solanaTrackerStream.subscribe.tx.wallet(addressStr).transactions().on(async (txData) => {
                    if (txData && txData.signature) {
                        // Get trader name from the trading engine
                        const traderName = await tradingEngine.getTraderName(addressStr);
                        console.log(`[TRADER_MONITOR] 🔥 Activity from Master Trader: ${traderName} (${shortenAddress(addressStr)}), Sig: ${shortenAddress(txData.signature, 6)}`);
                        // Pass the full txData and trader address to the express lane
                        tradingEngine.handleWalletStreamEvent({ ...txData, traderAddress: addressStr });
                    }
                });

                this.subscribedTraders.add(addressStr);
                // Get trader name for subscription logging
                const traderName = await tradingEngine.getTraderName(addressStr);
                console.log(`[TRADER_MONITOR] -> ✅ SUCCESSFULLY SUBSCRIBED to new trader: ${traderName} (${shortenAddress(addressStr)})`);
            } catch (subError) {
                console.error(`[TRADER_MONITOR] ❌ Error subscribing to trader ${shortenAddress(addressStr)}: ${subError.message}`);
            }
        }
        console.log(`[TRADER_MONITOR] Subscription sync complete. Total monitored traders: ${this.subscribedTraders.size}`);
    } catch (error) {
        console.error(`[TRADER_MONITOR] ❌ Failed to get master trader list: ${error.message}`);
    }
}


  // async fetchLatestUniversalPools(page = 1) { // THE FIX: Parameter is 'page', not 'limit'.
  //   console.log(`[API_UNIVERSAL_SCAN] Fetching latest tokens from all markets (page ${page}) via SDK...`);

  //   try {
  //     // Step 1: Call the single, powerful function that gets EVERYTHING.
  //     const tokens = await this.solanaTrackerApi.getLatestTokens(page);

  //  if (!tokens || tokens.length === 0) return [];
  //     const processedPools = [];
  //     for (const tokenData of tokens) {
  //       if (!tokenData.pools || tokenData.pools.length === 0) continue;
  //       const mainPool = tokenData.pools[0];

  //       // This is our new dispatcher, right inside the fetcher.
  //       // It standardizes the data regardless of the source DEX.
  //       switch (mainPool.market) {

  //         case 'pumpfun':
  //           processedPools.push({
  //             platform: 'Pump.fun',
  //             market: 'pumpfun_bc', // A unique key for our switch case later
  //             mint: tokenData.mint,
  //             name: tokenData.name,
  //             symbol: tokenData.symbol,
  //             creator: tokenData.creator,
  //             timestamp: new Date(tokenData.created_timestamp).getTime(),
  //           });
  //           break;

  //         // NOTE: Pump.fun AMM pools are likely not in the "latest tokens" feed
  //         // as they are a secondary market. Our real-time sniper is the best tool for this migration.

  //         case 'raydium-launchpad':
  //           processedPools.push({
  //             platform: 'Raydium Launchpad',
  //             market: 'raydium_launchpad',
  //             poolId: mainPool.poolId,
  //             base_mint: mainPool.tokenAddress,
  //           });
  //           break;

  //         case 'raydium-amm':
  //           processedPools.push({
  //             platform: 'Raydium AMM',
  //             market: 'raydium_amm',
  //             poolId: mainPool.poolId,
  //             baseMint: mainPool.tokenAddress,
  //             quoteMint: mainPool.quoteToken,
  //           });
  //           break;

  //         case 'raydium-clmm':
  //           processedPools.push({
  //             platform: 'Raydium CLMM',
  //             market: 'raydium_clmm',
  //             poolId: mainPool.poolId,
  //             baseMint: mainPool.tokenAddress,
  //             quoteMint: mainPool.quoteToken,
  //           });
  //           break;

  //         case 'meteora-dlmm':
  //           processedPools.push({
  //             platform: 'Meteora DLMM',
  //             market: 'meteora_dlmm',
  //             poolId: mainPool.poolId,
  //             baseMint: mainPool.tokenAddress,
  //             quoteMint: mainPool.quoteToken,
  //           });
  //           break;

  //         case 'meteora-dbc':
  //           processedPools.push({
  //             platform: 'Meteora DBC',
  //             market: 'meteora_dbc',
  //             poolId: mainPool.poolId,
  //             baseMint: mainPool.tokenAddress,
  //             quoteMint: mainPool.quoteToken,
  //           });
  //           break;

  //         default:
  //           // This is useful for discovering new markets they support.
  //           // console.log(`[API_UNIVERSAL_SCAN] Info: Found token on unhandled market: '${mainPool.market}'`);
  //           break;
  //       }
  //     }

  //     console.log(`[API_UNIVERSAL_SCAN] ✅ Processed ${processedPools.length} new pools from the universal feed.`);
  //     return processedPools;

  //   } catch (error) {
  //     console.error(`[API_UNIVERSAL_SCAN] ❌ Error fetching from Solana Tracker SDK:`, error.message);
  //     return [];
  //   }
  // }

   async getTokenAmountFromHeliusData({ inputMint, outputMint, amount, tradeType }) {
    console.log(`[Helius] Getting token amount estimate: ${amount} of ${shortenAddress(inputMint)} -> ${shortenAddress(outputMint)}`);
    
    try {
      // Use Helius Enhanced Parse Transaction API to get recent similar transactions
      const response = await axios.get(`https://api.helius.xyz/v0/addresses/${inputMint}/transactions?api-key=${config.HELIUS_API_KEY}&limit=5&type=SWAP&source=PUMP_FUN`, {
        headers: {
          'Content-Type': 'application/json'
        },
        timeout: 3000 // Fast timeout for copy trading
      });

      if (response.data && response.data.length > 0) {
        // Analyze recent transactions to estimate conversion rate
        let totalInputAmount = 0;
        let totalOutputAmount = 0;
        let validTransactions = 0;

        for (const tx of response.data.slice(0, 3)) { // Use last 3 transactions
          if (tx.tokenTransfers && tx.tokenTransfers.length >= 2) {
            const solTransfer = tx.tokenTransfers.find(t => t.mint === 'So11111111111111111111111111111111111111112');
            const tokenTransfer = tx.tokenTransfers.find(t => t.mint === outputMint);
            
            if (solTransfer && tokenTransfer) {
              totalInputAmount += Math.abs(solTransfer.tokenAmount);
              totalOutputAmount += Math.abs(tokenTransfer.tokenAmount);
              validTransactions++;
            }
          }
        }

        if (validTransactions > 0) {
          const averageRate = totalOutputAmount / totalInputAmount;
          const estimatedOutput = Math.floor(amount * averageRate);
          
          console.log(`[Helius] ✅ Estimated from ${validTransactions} recent transactions: ${amount} -> ${estimatedOutput}`);
          return {
            inputAmount: amount,
            outputAmount: estimatedOutput,
            source: 'helius_historical',
            validTransactions: validTransactions
          };
        }
      }
      
      // Fallback to conservative estimate based on typical Pump.fun rates
      console.log(`[Helius] ⚠️ No recent transaction data, using conservative estimate`);
      const conservativeOutput = tradeType === 'buy' 
        ? Math.floor(amount * 50000) // More realistic: 1 SOL = 50K tokens (0.02 SOL per token)
        : Math.floor(amount / 50000); // More realistic: 50K tokens = 1 SOL
        
      return {
        inputAmount: amount,
        outputAmount: conservativeOutput,
        source: 'conservative_estimate'
      };

    } catch (err) {
      console.error(`[Helius] ❌ Error getting token amount:`, err.message);
      // Fallback to conservative estimate
      const conservativeOutput = tradeType === 'buy' 
        ? Math.floor(amount * 50000) // More realistic rate
        : Math.floor(amount / 50000); // More realistic rate
        
      return {
        inputAmount: amount,
        outputAmount: conservativeOutput,
        source: 'error_fallback'
      };
    }
  }

  // Jupiter API methods removed - using universalCloner instead

  // Jupiter swap method removed - using universalCloner instead

  async getTokenPrices(tokenMints) {
    if (!tokenMints || tokenMints.length === 0) {
      return new Map();
    }

    // Check Redis cache first for instant metadata
    const cachedPrices = new Map();
    const missingMints = [];
    
    try {
      // Get Redis manager from solanaManager if available
      const redisManager = this.solanaManager?.redisManager;
      
      if (redisManager) {
        for (const mint of tokenMints) {
          const cached = await redisManager.get(`price:${mint}`);
          if (cached) {
            cachedPrices.set(mint, parseFloat(cached));
          } else {
            missingMints.push(mint);
          }
        }
        
        if (missingMints.length === 0) {
          console.log(`[PriceAPI-HELIUS] ✅ All prices from Redis cache:`, Array.from(cachedPrices.entries()).map(([k,v]) => `${k.slice(-4)}: $${v}`));
          return cachedPrices;
        }
        
        console.log(`[PriceAPI-HELIUS] 📡 Fetching ${missingMints.length} missing prices from DAS...`);
      } else {
        missingMints.push(...tokenMints);
        console.log(`[PriceAPI-HELIUS] 📡 No Redis cache available, fetching all ${tokenMints.length} prices from DAS...`);
      }
      
      // Use Helius DAS getAssetBatch for reliable token metadata
      const response = await fetch(config.HELIUS_ENDPOINTS.rpc, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'grok-price-fetch',
          method: 'getAssetBatch',
          params: { 
            ids: missingMints, 
            options: { showFungible: true, showSystemMetadata: true } 
          }
        })
      });

      if (!response.ok) {
        throw new Error(`Helius DAS failed: ${response.status}`);
      }

      const data = await response.json();
      console.log(`[PriceAPI-HELIUS] 🔍 Raw DAS response:`, JSON.stringify(data, null, 2));
      
      // Handle DAS API errors
      if (data.error) {
        console.warn(`[PriceAPI-HELIUS] ⚠️ DAS API error: ${data.error.message}`);
        // For new tokens, DAS might return errors - use fallback prices
        const fallbackPrices = new Map();
        for (const mint of missingMints) {
          const price = mint === config.NATIVE_SOL_MINT ? 150 : 0;
          fallbackPrices.set(mint, price);
          console.log(`[PriceAPI-HELIUS] 🔄 Using fallback price for ${mint}: $${price}`);
        }
        return fallbackPrices;
      }
      
      // Validate response structure
      if (!data.result || !Array.isArray(data.result)) {
        throw new Error(`Helius DAS returned invalid result: ${JSON.stringify(data)}`);
      }
      
      // Process results and cache them
      for (const asset of data.result) {
        if (asset && asset.id) {
          const price = asset.price_info?.price_per_token || 0;
          const decimals = asset.token_info?.decimals || 6;
          const symbol = asset.token_info?.symbol || 'UNKNOWN';
          
          cachedPrices.set(asset.id, price);
          
          // Cache for 30 seconds if Redis is available
          if (redisManager) {
            await redisManager.set(`price:${asset.id}`, price.toString(), 'EX', 30);
          }
          
          console.log(`[PriceAPI-HELIUS] ✅ ${asset.id}: $${price} (${decimals} decimals, ${symbol})`);
        }
      }

      // Handle SOL separately if still missing
      if (missingMints.includes(config.NATIVE_SOL_MINT) && !cachedPrices.has(config.NATIVE_SOL_MINT)) {
        const solResponse = await fetch(config.HELIUS_ENDPOINTS.rpc, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 'grok-sol-price',
            method: 'getAsset',
            params: { id: config.NATIVE_SOL_MINT }
          })
        });
        
        if (solResponse.ok) {
          const solData = await solResponse.json();
          if (solData.result) {
            const solPrice = solData.result.price_info?.price_per_token || 150;
            cachedPrices.set(config.NATIVE_SOL_MINT, solPrice);
            if (redisManager) {
              await redisManager.set(`price:${config.NATIVE_SOL_MINT}`, solPrice.toString(), 'EX', 30);
            }
            console.log(`[PriceAPI-HELIUS] ✅ SOL: $${solPrice}`);
          }
        }
      }

      console.log(`[PriceAPI-HELIUS] ✅ Fetched ${missingMints.length} prices from DAS:`, Array.from(cachedPrices.entries()).map(([k,v]) => `${k.slice(-4)}: $${v}`));
      return cachedPrices;

    } catch (error) {
      console.error('[PriceAPI-HELIUS] ❌ Failed to fetch prices from DAS:', error.message);
      // Return fallback prices
      const fallbackMap = new Map();
      for (const mint of tokenMints) {
        fallbackMap.set(mint, mint === config.NATIVE_SOL_MINT ? 150 : 0);
      }
      return fallbackMap;
    }
  }

  // 🚀 NEW: Fast price fetcher for copy trading (no DAS dependency)
  async getTokenPricesFast(tokenMints) {
    if (!tokenMints || tokenMints.length === 0) {
      return new Map();
    }

    console.log(`[PriceAPI-FAST] ⚡ Fast price fetch for ${tokenMints.length} tokens (no DAS)`);

    const fastPrices = new Map();
    
    // Simple fallback prices for copy trading
    for (const mint of tokenMints) {
      const price = mint === config.NATIVE_SOL_MINT ? 150 : 0;
      fastPrices.set(mint, price);
    }
    
    console.log(`[PriceAPI-FAST] ✅ Fast prices set (saved ~100-300ms by skipping DAS)`);
    return fastPrices;
  }

async findAmmPoolForToken(tokenMint) {
    if (!tokenMint || !config.HELIUS_API_KEY) {
      console.warn('[API-PIVOT] Skipping migration check: Missing tokenMint or Helius API key.');
      return null;
    }

    // This is the Helius "Parsed Transaction History" API endpoint. It's incredibly powerful.
    const url = `${config.RPC_URL.replace('?api-key=', '')}/v0/addresses/${tokenMint}/transactions?api-key=${config.HELIUS_API_KEY}`;
    
    try {
      console.log(`[API-PIVOT] Checking migration status for ${shortenAddress(tokenMint)} via Helius...`);

      const response = await axios.get(url, { params: { 'type': 'TOKEN_SWAP' } });
      const transactions = response.data;

      if (!transactions || transactions.length === 0) {
        console.log(`[API-PIVOT] ❌ No swap history found on Helius. Token likely still on bonding curve.`);
        return null;
      }
      
      // Find the *first* swap transaction that is NOT on Pump.fun. This confirms migration.
      for (const tx of transactions) {
        if (tx.source && tx.source !== 'PUMP_FUN') {
            const platform = tx.source.replace(/_/g, ' '); // e.g., RAYDIUM_V4 -> Raydium V4
            
            // Extract the liquidity pool address from the transaction accounts.
            // This is a common pattern for Raydium pools.
            const ammAccount = tx.events?.swap?.amm;

            if (ammAccount) {
                 console.log(`[API-PIVOT] ✅ MIGRATION CONFIRMED. Found swap on platform: ${platform}. Pool: ${shortenAddress(ammAccount)}`);
                 return {
                    market: platform, // 'RAYDIUM V4', 'RAYDIUM CLMM', etc.
                    poolId: ammAccount
                 };
            }
        }
      }

      console.log(`[API-PIVOT] ❌ Only Pump.fun swaps found. Token likely not migrated yet.`);
      return null;

    } catch (error) {
      console.warn(`[API-PIVOT] Error checking Helius for migration of ${shortenAddress(tokenMint)}:`, error.message);
      return null;
    }
}

  async findMeteoraPoolForMint(tokenMintAddress) {
    // This is a placeholder for future enhancement. 
    // For now, it prevents crashes by simply returning null.
    // console.warn('[Heuristic Pivot] Meteora pool lookup not yet implemented. Skipping.');
    return null;
  }

  async getRaydiumApiTransaction({ inputMint, outputMint, amount, userWallet, slippageBps }) {
    const amountString = amount.toString(); // API needs the amount as a string
    const maxRetries = 2; // Keep retries low for the fallback
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`[Raydium-API-FB] Attempting to get quote...`);
        // STEP 1: Get the quote
        const quoteResponse = await this.raydiumClient.get('/swap', {
          params: { inputMint, outputMint, amount: amountString, slippageBps },
          timeout: 8000,
        });

        const swapData = quoteResponse?.data;
        if (!swapData?.route?.length) {
          throw new Error("Raydium API quote returned no valid trade route.");
        }
        console.log(`[Raydium-API-FB] Quote received. Building transaction...`);

        // STEP 2: Use the quote to build the transaction
        const txResponse = await this.raydiumClient.post('/transactions/swap', {
          route: swapData.route,
          userPublicKey: userWallet,
        }, { timeout: 10000 });

        const txData = txResponse?.data;
        if (!txData?.transactions?.length) {
          throw new Error("Raydium API did not return any transactions to execute.");
        }

        // The API gives us the base64 encoded strings directly.
        console.log(`[Raydium-API-FB] ✅ Transaction successfully built.`);
        return txData.transactions.map(tx => tx.transaction);

      } catch (err) {
        console.warn(`[Raydium-API-FB] Fallback failed (Attempt ${attempt}/${maxRetries}): ${err.message}`);
        if (attempt === maxRetries) {
          throw new Error(`Raydium API fallback failed after all retries: ${err.message}`);
        }
        await new Promise(resolve => setTimeout(resolve, 1500));
      }
    }
  }


  async getTokenMetadatas(tokenMints) {
    if (!tokenMints || tokenMints.length === 0) {
        return new Map();
    }

    const connection = this.solanaManager.connection; // Assuming solanaManager is passed or accessible
    const metadataMap = new Map();

    try {
        await Promise.all(tokenMints.map(async (mint) => {
            const mintPubkey = new PublicKey(mint);
            const mintInfo = await getMint(connection, mintPubkey);
            metadataMap.set(mint, {
                totalSupply: mintInfo.supply.toString(),
                decimals: mintInfo.decimals
            });
        }));
        return metadataMap;
    } catch (error) {
        console.warn(`[MetadataAPI] Failed to fetch token metadata from Solana RPC: ${error.message}`);
        return new Map(); // Fallback to empty map
    }
}

  // ===============================================
  // ============ PUMP.FUN HELIUS INTEGRATION ===========
  // ===============================================
  async getPumpFunCoinData(mint) {
      console.log(`[PUMP_API] ⏳ Fetching coin data for ${shortenAddress(mint)} via Helius...`);

      try {
          // Use Helius to get the creator from the bonding curve account
          // The creator is stored in the bonding curve account data
          const bondingCurvePda = PublicKey.findProgramAddressSync(
              [Buffer.from('bonding-curve'), new PublicKey(mint).toBuffer()],
              new PublicKey('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P') // Pump.fun BC program ID
          );

          // Get the bonding curve account info
          const bondingCurveAccount = await this.solanaManager.connection.getAccountInfo(bondingCurvePda[0]);
          
          if (!bondingCurveAccount) {
              throw new Error(`Bonding curve account not found for mint ${mint}`);
          }

                     // Search for the creator field by looking for the actual data structure
           // Instead of hardcoded offsets, we'll search for patterns
           const data = bondingCurveAccount.data;
           
           // Look for creator field - search for valid PublicKey patterns
           let creator = null;
           for (let i = 0; i <= data.length - 32; i++) {
               const potentialKey = data.slice(i, i + 32);
               
               // Check if this looks like a valid PublicKey (not all zeros, not all ones)
               const isAllZeros = potentialKey.every(byte => byte === 0);
               const isAllOnes = potentialKey.every(byte => byte === 255);
               
               if (!isAllZeros && !isAllOnes) {
                   try {
                       const testKey = new PublicKey(potentialKey);
                       // Additional validation: check if it's a valid address format
                       if (testKey.toBase58().length === 44) { // Solana addresses are 44 chars
                           creator = testKey;
                           console.log(`[PUMP_API] 🔍 Found potential creator at offset ${i}: ${shortenAddress(testKey.toBase58())}`);
                           break;
                       }
                   } catch (e) {
                       // Invalid PublicKey, continue searching
                       continue;
                   }
               }
           }
           
           if (!creator) {
               throw new Error(`Could not find valid creator PublicKey in bonding curve account data`);
           }

          console.log(`[PUMP_API] ✅ Successfully fetched creator ${shortenAddress(creator.toBase58())} for ${shortenAddress(mint)} via Helius.`);
          
          return {
              creator: creator.toBase58(),
              mint: mint,
              source: 'helius_onchain'
          };

      } catch (error) {
          console.error(`[PUMP_API] ❌ Failed to fetch coin data via Helius: ${error.message}`);
          
          // Fallback: Try to get creator from the mint metadata account
          try {
              console.log(`[PUMP_API] 🔄 Attempting fallback via mint metadata...`);
              
              const mintMetadataPda = PublicKey.findProgramAddressSync(
                  [
                      Buffer.from('metadata'),
                      new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s').toBuffer(),
                      new PublicKey(mint).toBuffer()
                  ],
                  new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s')
              );

              const metadataAccount = await this.solanaManager.connection.getAccountInfo(mintMetadataPda[0]);
              
                             if (metadataAccount) {
                   // Parse metadata to find creator using key-based search
                   const data = metadataAccount.data;
                   
                   // Look for creator field in metadata - search for valid PublicKey patterns
                   let creator = null;
                   for (let i = 0; i <= data.length - 32; i++) {
                       const potentialKey = data.slice(i, i + 32);
                       
                       // Check if this looks like a valid PublicKey (not all zeros, not all ones)
                       const isAllZeros = potentialKey.every(byte => byte === 0);
                       const isAllOnes = potentialKey.every(byte => byte === 255);
                       
                       if (!isAllZeros && !isAllOnes) {
                           try {
                               const testKey = new PublicKey(potentialKey);
                               // Additional validation: check if it's a valid address format
                               if (testKey.toBase58().length === 44) { // Solana addresses are 44 chars
                                   creator = testKey;
                                   console.log(`[PUMP_API] 🔍 Fallback: Found potential creator at offset ${i}: ${shortenAddress(testKey.toBase58())}`);
                                   break;
                               }
                           } catch (e) {
                               // Invalid PublicKey, continue searching
                               continue;
                           }
                       }
                   }
                   
                   if (creator) {
                       console.log(`[PUMP_API] ✅ Fallback successful: Found creator ${shortenAddress(creator.toBase58())} via metadata.`);
                       
                       return {
                           creator: creator.toBase58(),
                           mint: mint,
                           source: 'helius_metadata_fallback'
                       };
                   }
               }
          } catch (fallbackError) {
              console.warn(`[PUMP_API] ⚠️ Fallback also failed: ${fallbackError.message}`);
          }

          throw new Error(`Failed to fetch creator for mint ${mint} via Helius on-chain data.`);
      }
  }

  
}
// CommonJS export
module.exports = {
  ApiManager, // Export the class
};



