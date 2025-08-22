// ==========================================
// ============= ZapBot ApiManager ===========
// ==========================================
// File: apiManager.js
// Description: Central manager for all external API interactions (Shyft, Raydium, etc.).

const axios = require('axios');
const config = require('./patches/config.js'); // CommonJS import for internal module
const { shortenAddress, logPerformance } = require('./utils.js'); // Added logPerformance
const { createJupiterApiClient } = require('@jup-ag/api');
// const jupiterConnection = new Connection("OUR_DEDICATED_JUPITER_RPC_URL");
const { Client, Datastream } = require('@solana-tracker/data-api'); // Optional dependency


class ApiManager {
  constructor(solanaManager) {
    this.subscribedTraders = new Set();
    this.solanaManager = solanaManager; 


    // Raydium API Client (unchanged)
    this.raydiumClient = axios.create({
      baseURL: 'https://api.raydium.io/v2',
      timeout: 10000,
    });

    // Solana Tracker API Client (The NEW SYSTEM) - Optional
    this.solanaTrackerApi = null;
    if (config.SOLANA_TRACKER_API_KEY && !config.SOLANA_TRACKER_API_KEY.startsWith('YOUR_KEY_HERE')) {
      console.log('[APIMANAGER] Solana Tracker API key found, but Client not available');
    }

    // We will initialize the DataStream (WebSocket) later, when we need it.
    this.solanaTrackerStream = null;

  }



 startUniversalDataStream(tradingEngine) {
    // Mission-critical check: Do we have the credentials for this weapon?
    if (!config.SOLANA_TRACKER_API_KEY || config.SOLANA_TRACKER_API_KEY.startsWith('YOUR_KEY_HERE')) {
      console.warn('[DATASTREAM] ⚠️ SKIPPING: WebSocket Sniper is a premium feature. No valid Solana Tracker API key found in .env');
      return;
    }

    console.log('[DATASTREAM] Initializing Universal New Pool Sniper...');

    // 1. Initialize the Datastream client if it doesn't exist
     if (!this.solanaTrackerStream) {
      // The intel confirms we must get the AUTHENTICATED URL from the dashboard. 
      // This is a placeholder for the real URL you will get with a paid plan.
      // For now, it likely won't connect, but the code is now CORRECT and ready.
      const PREMIUM_WEBSOCKET_URL = `wss://datastream.solanatracker.io/sdk?apiKey=${config.SOLANA_TRACKER_API_KEY}`;
      
      this.solanaTrackerStream = new Datastream({
        wsUrl: PREMIUM_WEBSOCKET_URL,
        autoReconnect: true
      });

      // 2. Set up event listeners for the connection itself
      this.solanaTrackerStream.on('connected', () => console.log('[DATASTREAM] ✅ Sniper is online. Connected to Solana Tracker.'));
      this.solanaTrackerStream.on('disconnected', () => console.warn('[DATASTREAM] ⚠️ Sniper is offline. Disconnected.'));
      this.solanaTrackerStream.on('error', (error) => console.error('[DATASTREAM] ❌ CRITICAL ERROR:', error));

      // 3. Connect to the WebSocket
      this.solanaTrackerStream.connect();
    }

    // 4. THIS IS THE FIREHOSE. Subscribe to ALL new tokens and pools.
    const subscription = this.solanaTrackerStream.subscribe.latest();
    subscription.on((data) => {
        // ... ALL of the switch-case logic we wrote before stays here ...
        if (!data || !data.pools || data.pools.length === 0) return;
        const primaryPool = data.pools[0];
        const token = data.token;
        console.log(`[DATASTREAM] 🔥 NEW POOL DETECTED! Symbol: ${token.symbol}, Market: ${primaryPool.market}`);

      // 6. This is the dispatcher. We look at the 'market' and route to the correct tradingEngine function.
      switch (primaryPool.market) {

        case 'pumpfun':
          // We need to transform their data into the format our tradingEngine expects
          const pumpData = {
            Transaction: { Signature: primaryPool.bundleId || `pump_${token.mint}` },
            Instruction: {
              Accounts: [{ Address: token.mint }]
              // Note: We're simulating the structure. All we need is the mint address.
            }
          };
          tradingEngine.processPumpFunCreation(pumpData);
          break;

        case 'raydium-launchpad':
          // Their Launchpad data is rich. We can pass it all.
          const launchpadData = {
            Transaction: { Signature: `launchpad_${primaryPool.poolId}` }, // Create a synthetic signature
            parsedPoolData: { // Our tradingEngine looks for this specific object
              poolId: primaryPool.poolId,
              baseMint: primaryPool.tokenAddress,
              configId: primaryPool.launchpad?.configId // We'll need to confirm this field exists, but it's a safe bet
            },
            // Pass metadata directly
            Instruction: { Program: { Arguments: [{ Name: "base_mint_param", Value: { json: primaryPool.tokenAddress } }, { Name: "metadata", Value: { json: { symbol: token.symbol, name: token.name } } }] } }
          };
          tradingEngine.processLivePoolCreation(launchpadData);
          break;

        case 'meteora-dlmm':
          const dlmmData = {
            Transaction: { Signature: `dlmm_${primaryPool.poolId}` },
            Instruction: { Accounts: [{ Address: primaryPool.poolId }, { Address: token.mint }, { Address: config.NATIVE_SOL_MINT }] }
          };
          tradingEngine.processMeteoraDlmmPoolCreation(dlmmData);
          break;

        case 'meteora-dbc':
          const dbcData = {
            Transaction: { Signature: `dbc_${primaryPool.poolId}` },
            Instruction: { Accounts: [{ Address: primaryPool.poolId }, {}, { Address: config.NATIVE_SOL_MINT }, { Address: token.mint }] } // Simulating the account structure
          };
          tradingEngine.processMeteoraDbcPoolCreation(dbcData);
          break;

        // You can add more cases here for 'bonk','moonshot' etc. as you implement those strategies
        default:
          console.log(`[DATASTREAM] Received pool on unhandled market: ${primaryPool.market}`);
          break;
      }
    });
  }

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
                this.solanaTrackerStream.subscribe.tx.wallet(addressStr).transactions().on((txData) => {
                    if (txData && txData.signature) {
                        console.log(`[TRADER_MONITOR] 🔥 Activity from Master Trader: ${shortenAddress(addressStr)}, Sig: ${shortenAddress(txData.signature, 6)}`);
                        // Pass the full txData and trader address to the express lane
                        tradingEngine.handleWalletStreamEvent({ ...txData, traderAddress: addressStr });
                    }
                });

                this.subscribedTraders.add(addressStr);
                console.log(`[TRADER_MONITOR] -> ✅ SUCCESSFULLY SUBSCRIBED to new trader: ${shortenAddress(addressStr)}`);
            } catch (subError) {
                console.error(`[TRADER_MONITOR] ❌ Error subscribing to trader ${shortenAddress(addressStr)}: ${subError.message}`);
            }
        }
        console.log(`[TRADER_MONITOR] Subscription sync complete. Total monitored traders: ${this.subscribedTraders.size}`);
    } catch (error) {
        console.error(`[TRADER_MONITOR] ❌ Failed to get master trader list: ${error.message}`);
    }
}


  async fetchLatestUniversalPools(page = 1) { // THE FIX: Parameter is 'page', not 'limit'.
    console.log(`[API_UNIVERSAL_SCAN] Fetching latest tokens from all markets (page ${page}) via SDK...`);

    try {
      // Step 1: Call the single, powerful function that gets EVERYTHING.
      const tokens = await this.solanaTrackerApi.getLatestTokens(page);

   if (!tokens || tokens.length === 0) return [];
      const processedPools = [];
      for (const tokenData of tokens) {
        if (!tokenData.pools || tokenData.pools.length === 0) continue;
        const mainPool = tokenData.pools[0];

        // This is our new dispatcher, right inside the fetcher.
        // It standardizes the data regardless of the source DEX.
        switch (mainPool.market) {

          case 'pumpfun':
            processedPools.push({
              platform: 'Pump.fun',
              market: 'pumpfun_bc', // A unique key for our switch case later
              mint: tokenData.mint,
              name: tokenData.name,
              symbol: tokenData.symbol,
              creator: tokenData.creator,
              timestamp: new Date(tokenData.created_timestamp).getTime(),
            });
            break;

          // NOTE: Pump.fun AMM pools are likely not in the "latest tokens" feed
          // as they are a secondary market. Our real-time sniper is the best tool for this migration.

          case 'raydium-launchpad':
            processedPools.push({
              platform: 'Raydium Launchpad',
              market: 'raydium_launchpad',
              poolId: mainPool.poolId,
              base_mint: mainPool.tokenAddress,
            });
            break;

          case 'raydium-amm':
            processedPools.push({
              platform: 'Raydium AMM',
              market: 'raydium_amm',
              poolId: mainPool.poolId,
              baseMint: mainPool.tokenAddress,
              quoteMint: mainPool.quoteToken,
            });
            break;

          case 'raydium-clmm':
            processedPools.push({
              platform: 'Raydium CLMM',
              market: 'raydium_clmm',
              poolId: mainPool.poolId,
              baseMint: mainPool.tokenAddress,
              quoteMint: mainPool.quoteToken,
            });
            break;

          case 'meteora-dlmm':
            processedPools.push({
              platform: 'Meteora DLMM',
              market: 'meteora_dlmm',
              poolId: mainPool.poolId,
              baseMint: mainPool.tokenAddress,
              quoteMint: mainPool.quoteToken,
            });
            break;

          case 'meteora-dbc':
            processedPools.push({
              platform: 'Meteora DBC',
              market: 'meteora_dbc',
              poolId: mainPool.poolId,
              baseMint: mainPool.tokenAddress,
              quoteMint: mainPool.quoteToken,
            });
            break;

          default:
            // This is useful for discovering new markets they support.
            // console.log(`[API_UNIVERSAL_SCAN] Info: Found token on unhandled market: '${mainPool.market}'`);
            break;
        }
      }

      console.log(`[API_UNIVERSAL_SCAN] ✅ Processed ${processedPools.length} new pools from the universal feed.`);
      return processedPools;

    } catch (error) {
      console.error(`[API_UNIVERSAL_SCAN] ❌ Error fetching from Solana Tracker SDK:`, error.message);
      return [];
    }
  }

   async getSwapTransactionFromJupiter({ inputMint, outputMint, amount, userWallet, slippageBps }) {
    console.log(`[Jupiter] Getting swap quote: ${amount} of ${shortenAddress(inputMint)} -> ${shortenAddress(outputMint)}`);
    const jupiterApi = createJupiterApiClient({ apiEndpoint: "https://dark-evocative-owl.solana-mainnet.quiknode.pro/497fc975da6984a5a05cb7ab9da031ca4ecea653/jup/v6" });

    try {
      // 1. Get the quote for the swap
      const quote = await jupiterApi.quoteGet({
        inputMint: inputMint,
        outputMint: outputMint,
        amount: Number(amount), // Jupiter SDK expects a number for amount
        slippageBps: slippageBps,
        onlyDirectRoutes: false, // Set to true for simpler routes if needed
        asLegacyTransaction: false, // We want modern VersionedTransactions
      });

      if (!quote) {
        throw new Error("Jupiter failed to find a route.");
      }

      // 2. Get the serialized transaction from the quote
      const swapResult = await jupiterApi.swapPost({
        swapRequest: {
          quoteResponse: quote,
          userPublicKey: userWallet,
          wrapAndUnwrapSol: true, // Automatically handle wrapping/unwrapping SOL
          // Optional: Set a fee account to support Jupiter
          // feeAccount: "YOUR_FEE_ACCOUNT_PUBKEY_HERE" 
        },
      });

      // The result contains the transaction we need to sign and send
      const swapTransaction = swapResult.swapTransaction;

      if (!swapTransaction) {
        throw new Error("Jupiter failed to create the swap transaction.");
      }

      console.log(`[Jupiter] ✅ Successfully created swap transaction.`);
      // Jupiter now returns a single transaction string. We wrap it in an array to match the old format.
      return [swapTransaction];

    } catch (err) {
      console.error(`[Jupiter] ❌ Error during Jupiter API call:`, err.message);
      if (err.response?.data) {
        console.error('Jupiter API Error Details:', err.response.data);
      }
      throw new Error(`Jupiter API swap failed: ${err.message}`);
    }
  }

  async getTokenPrices(tokenMints) {
    if (!tokenMints || tokenMints.length === 0) {
      return new Map();
    }

    // The Jupiter price API takes a comma-separated list of mint addresses
    const ids = tokenMints.join(',');
    const url = `https://price.jup.ag/v4/price?ids=${ids}`;

    try {
      const response = await axios.get(url, {
        headers: { 'Accept': 'application/json' },
        timeout: 5000
      });

      const prices = response.data.data;
      const priceMap = new Map();

      for (const mint of tokenMints) {
        if (prices[mint]) {
          priceMap.set(mint, prices[mint].price);
        }
      }
      return priceMap;

    } catch (error) {
      console.warn(`[PriceAPI] Failed to fetch token prices from Jupiter: ${error.message}`);
      // Return an empty map on failure so the bot doesn't crash
      return new Map();
    }
  }


async findAmmPoolForToken(tokenMint) {
    if (!tokenMint) return null;
    if (!this.solanaTrackerApi) {
        console.error('[API-PIVOT] Solana Tracker API client is not initialized.');
        return null;
    }

    try {
        console.log(`[API-PIVOT] Checking migration status for ${shortenAddress(tokenMint)} via SolanaTracker SDK...`);
        // This is the real API call.
        const tokenInfo = await this.solanaTrackerApi.getTokenInfo(tokenMint);
        
        // Find the first pool that is NOT a pump.fun pool, which indicates a migration has happened.
        const migratedPool = tokenInfo?.pools?.find(p => p.market && p.market.toLowerCase() !== 'pumpfun' && p.market.toLowerCase() !== 'unknown');

        if (migratedPool) {
            console.log(`[API-PIVOT] ✅ MIGRATION CONFIRMED. Found pool on market: ${migratedPool.market}`);
            return migratedPool; // Return the full pool object provided by the SDK.
        }
        
        console.log(`[API-PIVOT] ❌ No migrated pool found. Token likely still on bonding curve.`);
        return null;

    } catch (error) {
        // If the API call fails (e.g., token not found, or API error), it hasn't migrated.
        console.warn(`[API-PIVOT] Error or non-migration for ${shortenAddress(tokenMint)}:`, error.message);
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

  
}
// CommonJS export
module.exports = {
  ApiManager, // Export the class
};



