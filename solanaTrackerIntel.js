// // ===========================================
// // ======== Solana Tracker Intel Drop ========
// // ===========================================

// // -------------------------------------------
// // --------- INTEL FROM: README.md -----------
// // -------------------------------------------

// // [ COPY AND PASTE THE ENTIRE 'DataStream' / 'WebSocket' SECTION FROM THE README.md FILE HERE ]
// // (Make sure to include all the text and code examples for the WebSocket part)

// README
// Solana Tracker - Data API SDK
// Official JavaScript/TypeScript client for the Solana Tracker Data API.

// npm version

// Features
// Full TypeScript support with detailed interfaces for all API responses
// Comprehensive coverage of all Solana Tracker Data API endpoints
// Real-time data streaming via WebSocket (Datastream)
// Built-in error handling with specific error types
// Compatible with both Node.js and browser environments
// NEW: Snipers and insiders tracking via WebSocket
// NEW: Enhanced error details for better debugging
// NEW: Subscribe to Wallet Balance updates
// Support for all pool types including launchpad and meteora curve pools (Shows which platform token is released on, Moonshot, Bonk, Jupiter Studio etc)
// Installation
// Install the package using npm:

// npm install @solana-tracker/data-api
// Or with yarn:

// yarn add @solana-tracker/data-api
// Quick Start
// import { Client } from '@solana-tracker/data-api';

// // Initialize the client with your API key
// const client = new Client({
//   apiKey: 'YOUR_API_KEY',
// });

// // Fetch token information
// const fetchTokenInfo = async () => {
//   try {
//     const tokenInfo = await client.getTokenInfo('4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R');
//     console.log('Token info:', tokenInfo);
//   } catch (error) {
//     console.error('Error:', error);
//   }
// };

// fetchTokenInfo();
// Real-Time Data Streaming (Premium plan or higher only)
// The library includes a Datastream class for real-time data updates with an improved, intuitive API:

// import { Datastream } from '@solanatracker/data-api';

// // Initialize the Datastream with your API key
// const dataStream = new Datastream({
//   wsUrl: 'YOUR_WS_URL'
// });

// // Connect to the WebSocket server
// dataStream.connect();

// // Handle connection events
// dataStream.on('connected', () => console.log('Connected to datastream'));
// dataStream.on('disconnected', () => console.log('Disconnected from datastream'));
// dataStream.on('error', (error) => console.error('Datastream error:', error));

// // Example 1: Subscribe to latest tokens with chained listener
// dataStream.subscribe.latest().on((tokenData) => {
//   console.log('New token created:', tokenData.token.name);
// });

// // Example 2: Track a specific token's price with type-safe data
// const tokenAddress = '6p6xgHyF7AeE6TZkSmFsko444wqoP15icUSqi2jfGiPN'; // TRUMP token
// dataStream.subscribe.price.token(tokenAddress).on((priceData) => {
//   console.log(`New price: $${priceData.price}`);
//   console.log(`Time: ${new Date(priceData.time).toLocaleTimeString()}`);
// });

// // Example 3: Subscribe to token transactions with stored subscription reference
// const txSubscription = dataStream.subscribe.tx.token(tokenAddress).on((transaction) => {
//   console.log(`Transaction type: ${transaction.type}`);
//   console.log(`Amount: ${transaction.amount}`);
//   console.log(`Price: $${transaction.priceUsd}`);
// });

// // Later, unsubscribe from transactions
// txSubscription.unsubscribe();

// // Example 4: Monitor holder count for a token
// dataStream.subscribe.holders(tokenAddress).on((holderData) => {
//   console.log(`Total holders: ${holderData.total}`);
// });

// // Example 5: Watch for wallet transactions
// const walletAddress = 'YourWalletAddressHere';
// dataStream.subscribe.tx.wallet(walletAddress).on((walletTx) => {
//   console.log(`${walletTx.type === 'buy' ? 'Bought' : 'Sold'} token`);
//   console.log(`Volume: ${walletTx.volume} USD`);
// });

// // Example 6: Subscribe to curve percentage updates
// dataStream.subscribe.curvePercentage('pumpfun', 30).on((data) => {
//   console.log(`Token ${data.token.symbol} reached 30% on Pump.fun`);
//   console.log(`Market cap: ${data.pools[0].marketCap.usd}`);
// });

// // Different markets and percentages
// dataStream.subscribe.curvePercentage('meteora-curve', 75).on((data) => {
//   console.log(`Meteora token at 75%: ${data.token.name}`);
// });

// // Example 7: NEW - Monitor snipers for a token
// dataStream.subscribe.snipers(tokenAddress).on((sniperUpdate) => {
//   console.log(`Sniper wallet: ${sniperUpdate.wallet}`);
//   console.log(`Token amount: ${sniperUpdate.tokenAmount.toLocaleString()}`);
//   console.log(`Percentage: ${sniperUpdate.percentage.toFixed(2)}%`);
//   console.log(`Total snipers hold: ${sniperUpdate.totalSniperPercentage.toFixed(2)}%`);
// });

// // Example 8: NEW - Monitor insiders for a token
// dataStream.subscribe.insiders(tokenAddress).on((insiderUpdate) => {
//   console.log(`Insider wallet: ${insiderUpdate.wallet}`);
//   console.log(`Token amount: ${insiderUpdate.tokenAmount.toLocaleString()}`);
//   console.log(`Percentage: ${insiderUpdate.percentage.toFixed(2)}%`);
//   console.log(`Total insiders hold: ${insiderUpdate.totalInsiderPercentage.toFixed(2)}%`);
// });

// // Example 9: NEW - Monitor wallet balance changes
// const walletAddress = 'YourWalletAddressHere';

// // Watch all token balance changes for a wallet
// dataStream.subscribe.tx.wallet(walletAddress).balance().on((balanceUpdate) => {
//   console.log(`Balance update for wallet ${balanceUpdate.wallet}`);
//   console.log(`Token: ${balanceUpdate.token}`);
//   console.log(`New balance: ${balanceUpdate.amount}`);
// });

// // Watch specific token balance for a wallet
// dataStream.subscribe.tx.wallet(walletAddress).tokenBalance('tokenMint').on((balanceUpdate) => {
//   console.log(`Token balance changed to: ${balanceUpdate.amount}`);
// });
// Available subscription methods:

// // Token and pool updates
// dataStream.subscribe.latest();                  // Latest tokens and pools
// dataStream.subscribe.token(tokenAddress);       // Token changes (any pool)
// dataStream.subscribe.pool(poolId);              // Pool changes

// // Price updates
// dataStream.subscribe.price.token(tokenAddress); // Token price (main pool)
// dataStream.subscribe.price.allPoolsForToken(tokenAddress); // All price updates for a token
// dataStream.subscribe.price.pool(poolId);        // Pool price

// // Transactions
// dataStream.subscribe.tx.token(tokenAddress);    // Token transactions
// dataStream.subscribe.tx.pool(tokenAddress, poolId); // Pool transactions
// dataStream.subscribe.tx.wallet(walletAddress);  // Wallet transactions (deprecated: use .transactions())
// dataStream.subscribe.tx.wallet(walletAddress).transactions(); // Wallet transactions (new)
// dataStream.subscribe.tx.wallet(walletAddress).balance();      // All token balance changes
// dataStream.subscribe.tx.wallet(walletAddress).tokenBalance(tokenAddress); // Specific token balance

// // Pump.fun stages
// dataStream.subscribe.graduating();              // Graduating tokens
// dataStream.subscribe.graduated();               // Graduated tokens

// // Metadata and holders
// dataStream.subscribe.metadata(tokenAddress);    // Token metadata
// dataStream.subscribe.holders(tokenAddress);     // Holder updates

// // Curve percentage updates
// dataStream.subscribe.curvePercentage(market, percentage); // Market options: 'launchpad', 'pumpfun', 'boop', 'meteora-curve'

// // NEW: Snipers and Insiders tracking
// dataStream.subscribe.snipers(tokenAddress);     // Track sniper wallets
// dataStream.subscribe.insiders(tokenAddress);    // Track insider wallets
// Each subscription method returns a response object with:

// room: The subscription channel name
// on(): Method to attach a listener with proper TypeScript types
// Returns an object with unsubscribe() method for easy cleanup
// WebSocket Data Stream
// The Datastream class provides real-time access to Solana Tracker data:

// Events
// The Datastream extends the standard EventEmitter interface, allowing you to listen for various events:

// // Connection events
// dataStream.on('connected', () => console.log('Connected to WebSocket server'));
// dataStream.on('disconnected', (socketType) => console.log(`Disconnected: ${socketType}`));
// dataStream.on('reconnecting', (attempt) => console.log(`Reconnecting: attempt ${attempt}`));
// dataStream.on('error', (error) => console.error('Error:', error));

// // Data events - Standard approach
// dataStream.on('latest', (data) => console.log('New token:', data));
// dataStream.on(`price-by-token:${tokenAddress}`, (data) => console.log('Price update:', data));
// dataStream.on(`transaction:${tokenAddress}`, (data) => console.log('New transaction:', data));
// dataStream.on(`sniper:${tokenAddress}`, (data) => console.log('Sniper update:', data)); // NEW
// dataStream.on(`insider:${tokenAddress}`, (data) => console.log('Insider update:', data)); // NEW

// // New approach - Chain .on() directly to subscription
// dataStream.subscribe.latest().on((data) => console.log('New token:', data));
// dataStream.subscribe.price.token(tokenAddress).on((data) => console.log('Price update:', data));
// dataStream.subscribe.tx.token(tokenAddress).on((data) => console.log('Transaction:', data));
// dataStream.subscribe.snipers(tokenAddress).on((data) => console.log('Sniper:', data)); // NEW
// dataStream.subscribe.insiders(tokenAddress).on((data) => console.log('Insider:', data)); // NEW
// API Documentation
// The library provides methods for all endpoints in the Solana Tracker Data API.

// Token Endpoints
// // Get token information
// const tokenInfo = await client.getTokenInfo('tokenAddress');

// // Get token by pool address
// const tokenByPool = await client.getTokenByPool('poolAddress');

// // Get token holders
// const tokenHolders = await client.getTokenHolders('tokenAddress');

// // Get top token holders
// const topHolders = await client.getTopHolders('tokenAddress');

// // Get all-time high price for a token
// const athPrice = await client.getAthPrice('tokenAddress');

// // Get tokens by deployer wallet
// const deployerTokens = await client.getTokensByDeployer('walletAddress');

// // Search for tokens
// const searchResults = await client.searchTokens({
//   query: 'SOL',
//   minLiquidity: 100000,
//   sortBy: 'marketCapUsd',
//   sortOrder: 'desc',
// });

// // Get latest tokens
// const latestTokens = await client.getLatestTokens(100);

// // Get information about multiple tokens (UPDATED: Now returns MultiTokensResponse)
// const multipleTokens = await client.getMultipleTokens([
//   'So11111111111111111111111111111111111111112',
//   '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R',
// ]);
// // Access tokens like: multipleTokens.tokens['tokenAddress']

// // Get trending tokens
// const trendingTokens = await client.getTrendingTokens('1h');

// // Get tokens by volume
// const volumeTokens = await client.getTokensByVolume('24h');

// // Get token overview (latest, graduating, graduated)
// const tokenOverview = await client.getTokenOverview();

// // Get graduated tokens
// const graduatedTokens = await client.getGraduatedTokens();
// Price Endpoints
// // Get token price
// const tokenPrice = await client.getPrice('tokenAddress', true); // Include price changes

// // Get historic price information
// const priceHistory = await client.getPriceHistory('tokenAddress');

// // Get price at a specific timestamp
// const timestampPrice = await client.getPriceAtTimestamp('tokenAddress', 1690000000);

// // Get price range (lowest/highest in time range)
// const priceRange = await client.getPriceRange('tokenAddress', 1690000000, 1695000000);

// // Get price using POST method
// const postedPrice = await client.postPrice('tokenAddress');

// // Get multiple token prices
// const multiplePrices = await client.getMultiplePrices([
//   'So11111111111111111111111111111111111111112',
//   '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R',
// ]);

// // Get multiple token prices using POST
// const postedMultiplePrices = await client.postMultiplePrices([
//   'So11111111111111111111111111111111111111112',
//   '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R',
// ]);
// Wallet Endpoints
// // Get basic wallet information
// const walletBasic = await client.getWalletBasic('walletAddress');

// // Get all tokens in a wallet
// const wallet = await client.getWallet('walletAddress');

// // Get wallet tokens with pagination
// const walletPage = await client.getWalletPage('walletAddress', 2);

// // Get wallet portfolio chart data with historical values and PnL
// const walletChart = await client.getWalletChart('walletAddress');
// console.log('24h PnL:', walletChart.pnl['24h']);
// console.log('30d PnL:', walletChart.pnl['30d']);
// console.log('Chart data points:', walletChart.chartData.length);

// // Get wallet trades
// const walletTrades = await client.getWalletTrades('walletAddress', undefined, true, true, false);
// Trade Endpoints
// // Get trades for a token
// const tokenTrades = await client.getTokenTrades('tokenAddress');

// // Get trades for a specific token and pool
// const poolTrades = await client.getPoolTrades('tokenAddress', 'poolAddress');

// // Get trades for a specific token, pool, and wallet
// const userPoolTrades = await client.getUserPoolTrades('tokenAddress', 'poolAddress', 'walletAddress');

// // Get trades for a specific token and wallet
// const userTokenTrades = await client.getUserTokenTrades('tokenAddress', 'walletAddress');
// Chart Endpoints
// // Get OHLCV data for a token
// const chartData = await client.getChartData('tokenAddress', '1h', 1690000000, 1695000000);

// // Get OHLCV data for a specific token and pool
// const poolChartData = await client.getPoolChartData('tokenAddress', 'poolAddress', '15m');

// // Get holder count chart data
// const holdersChart = await client.getHoldersChart('tokenAddress', '1d');
// PnL Endpoints
// // Get PnL data for all positions of a wallet
// const walletPnL = await client.getWalletPnL('walletAddress', true, true, false);

// // Get the first 100 buyers of a token with PnL data
// const firstBuyers = await client.getFirstBuyers('tokenAddress');

// // Get PnL data for a specific token in a wallet
// const tokenPnL = await client.getTokenPnL('walletAddress', 'tokenAddress');
// Top Traders Endpoints
// // Get the most profitable traders across all tokens
// const topTraders = await client.getTopTraders(1, true, 'total');

// // Get top 100 traders by PnL for a token
// const tokenTopTraders = await client.getTokenTopTraders('tokenAddress');
// Events Endpoints (Live Data)
// // Get raw event data for live processing
// // NOTE: For non-live statistics, use getTokenStats() instead which is more efficient
// const events = await client.getEvents('tokenAddress');
// console.log('Total events:', events.length);

// // Get events for a specific pool
// const poolEvents = await client.getPoolEvents('tokenAddress', 'poolAddress');

// // Process events into statistics using the processEvents utility
// import { processEventsAsync } from '@solana-tracker/data-api';

// const stats = await processEvents(events);
// console.log('1h stats:', stats['1h']);
// console.log('24h volume:', stats['24h']?.volume.total);
// Additional Endpoints
// // Get detailed stats for a token
// const tokenStats = await client.getTokenStats('tokenAddress');

// // Get detailed stats for a specific token and pool
// const poolStats = await client.getPoolStats('tokenAddress', 'poolAddress');

// // Get remaining API credits
// const credits = await client.getCredits();
// console.log('Remaining credits:', credits.credits);

// // NEW: Get subscription information
// const subscription = await client.getSubscription();
// console.log('Plan:', subscription.plan);
// console.log('Credits:', subscription.credits);
// console.log('Status:', subscription.status);
// console.log('Next billing date:', subscription.next_billing_date);
// Error Handling
// The library includes specific error types for robust error handling with enhanced error details:

// import { Client, DataApiError, RateLimitError, ValidationError } from '@solana-tracker/data-api';

// try {
//   const tokenInfo = await client.getTokenInfo('invalid-address');
// } catch (error) {
//   if (error instanceof RateLimitError) {
//     console.error('Rate limit exceeded. Retry after:', error.retryAfter, 'seconds');
//   } else if (error instanceof ValidationError) {
//     console.error('Validation error:', error.message);
//   } else if (error instanceof DataApiError) {
//     console.error('API error:', error.message, 'Status:', error.status);
    
//     // NEW: Access detailed error information
//     if (error.details) {
//       console.error('Error details:', error.details);
//     }
//   } else {
//     console.error('Unexpected error:', error);
//   }
// }
// What's New
// Version Updates
// New Features:
// Snipers and Insiders Tracking: Monitor wallets that are identified as snipers or insiders for any token via WebSocket subscriptions
// Wallet Balance Tracking: Real-time monitoring of token balance changes for any wallet via WebSocket
// Enhanced Error Handling: Error responses now include detailed error information from the API when available
// Subscription Endpoint: New endpoint to get subscription details including plan, credits, and billing information
// Updated Type Definitions:
// Added volume24h field to transaction statistics
// Enhanced TokenRisk interface with detailed snipers/insiders data
// Added MultiTokensResponse for the /tokens/multi endpoint
// Updated Launchpad and MeteoraCurve interfaces for pool-specific data (Shows which platform token is released on, Moonshot, Bonk, Jupiter Studio etc)
// Added SubscriptionResponse for subscription information
// Type Updates:
// // NEW: Subscription information
// interface SubscriptionResponse {
//   credits: number;
//   plan: string;
//   next_billing_date: string;
//   status: string;
// }

// // NEW: Sniper/Insider update structure
// interface SniperInsiderUpdate {
//   wallet: string;
//   amount: string;
//   tokenAmount: number;
//   percentage: number;
//   previousAmount: number;
//   previousPercentage: number;
//   totalSniperPercentage: number;
//   totalInsiderPercentage: number;
// }

// // NEW: Wallet balance update structure
// interface WalletBalanceUpdate {
//   wallet: string;
//   token: string;
//   amount: number;
// }

// // UPDATED: Risk structure now includes detailed snipers/insiders
// interface TokenRisk {
//   snipers: {
//     count: number;
//     totalBalance: number;
//     totalPercentage: number;
//     wallets: Array<{
//       address: string;
//       balance: number;
//       percentage: number;
//     }>;
//   };
//   insiders: {
//     count: number;
//     totalBalance: number;
//     totalPercentage: number;
//     wallets: Array<{
//       address: string;
//       balance: number;
//       percentage: number;
//     }>;
//   };
//   top10: number;
//   rugged: boolean;
//   risks: TokenRiskFactor[];
//   score: number;
//   jupiterVerified?: boolean;
// }

// // NEW: Pool structures for different markets
// interface PoolInfo {
//   // ... existing fields ...
//   launchpad?: Launchpad;      // For raydium-launchpad market
//   meteoraCurve?: MeteoraCurve; // For meteora-curve market
//   txns?: {
//     // ... existing fields ...
//     volume24h: number;         // NEW field
//   };
// }
// WebSocket Data Stream
// The Datastream class provides real-time access to Solana Tracker data:

// Events
// The Datastream extends the standard EventEmitter interface, allowing you to listen for various events:

// // Connection events
// dataStream.on('connected', () => console.log('Connected to WebSocket server'));
// dataStream.on('disconnected', (socketType) => console.log(`Disconnected: ${socketType}`));
// dataStream.on('reconnecting', (attempt) => console.log(`Reconnecting: attempt ${attempt}`));
// dataStream.on('error', (error) => console.error('Error:', error));

// // Data events
// dataStream.on('latest', (data) => console.log('New token:', data));
// dataStream.on(`price-by-token:${tokenAddress}`, (data) => console.log('Price update:', data));
// dataStream.on(`price:${tokenAddress}`, (data) => console.log('Price update:', data));
// dataStream.on(`price:${poolAddress}`, (data) => console.log('Price update:', data));
// dataStream.on(`transaction:${tokenAddress}`, (data) => console.log('New transaction:', data));
// dataStream.on(`wallet:${walletAddress}`, (data) => console.log('Wallet transaction:', data));
// dataStream.on(`wallet:${walletAddress}:balance`, (data) => console.log('Wallet balance update:', data)); // NEW
// dataStream.on(`wallet:${walletAddress}:${tokenAddress}:balance`, (data) => console.log('Token balance update:', data)); // NEW
// dataStream.on('graduating', (data) => console.log('Graduating token:', data));
// dataStream.on('graduated', (data) => console.log('Graduated token:', data));
// dataStream.on(`metadata:${tokenAddress}`, (data) => console.log('Metadata update:', data));
// dataStream.on(`holders:${tokenAddress}`, (data) => console.log('Holders update:', data));
// dataStream.on(`token:${tokenAddress}`, (data) => console.log('Token update:', data));
// dataStream.on(`pool:${poolId}`, (data) => console.log('Pool update:', data));
// dataStream.on(`sniper:${tokenAddress}`, (data) => console.log('Sniper update:', data)); // NEW
// dataStream.on(`insider:${tokenAddress}`, (data) => console.log('Insider update:', data)); // NEW
// Connection Management
// // Connect to the WebSocket server
// await dataStream.connect();

// // Check connection status
// const isConnected = dataStream.isConnected();

// // Disconnect
// dataStream.disconnect();
// Subscription Plans
// Solana Tracker offers a range of subscription plans with varying rate limits:

// Plan	Price	Requests/Month	Rate Limit
// Free	Free	10,000	1/second
// Starter	€14.99/month	50,000	None
// Advanced	€50/month	200,000	None
// Pro	€200/month	1,000,000	None
// Premium	€397/month	10,000,000	None
// Business	€599/month	25,000,000	None
// Enterprise	€1499/month	100,000,000	None
// Enterprise Plus	Custom	Unlimited	None
// Visit Solana Tracker to sign up and get your API key.

// WebSocket Access
// WebSocket access (via the Datastream) is available for Premium, Business, and Enterprise plans.






// // -------------------------------------------
// // ---- INTEL FROM: examples/datastream.ts ---
// // -------------------------------------------

// // [ COPY AND PASTE THE ENTIRE CONTENTS OF THE 'examples/datastream.ts' FILE HERE ]
// // (Just the raw code from that file)

// // examples/datastream.ts
// import { Datastream } from '@solanatracker/data-api';

// // Initialize the Datastream with configuration
// const dataStream = new Datastream({
//   wsUrl: 'YOUR_WS_URL', // Get this from your Solana Tracker Dashboard
//   autoReconnect: true, // Auto reconnect on disconnect (default: true)
//   reconnectDelay: 2500, // Initial reconnect delay in ms (default: 2500)
//   reconnectDelayMax: 4500, // Maximum reconnect delay in ms (default: 4500)
//   randomizationFactor: 0.5, // Randomization factor for reconnect delay (default: 0.5)
//   useWorker: true, // Use Web Worker for background processing (default: false)
// });


// // ************************************
// // Basic connection management examples
// // ************************************

// // Connect to the WebSocket server
// const connect = async () => {
//   try {
//     await dataStream.connect();
//     console.log('Successfully connected to Datastream');
//   } catch (error) {
//     console.error('Failed to connect:', error);
//   }
// };

// // Check connection status
// const checkConnection = () => {
//   const isConnected = dataStream.isConnected();
//   console.log(`Datastream connection status: ${isConnected ? 'Connected' : 'Disconnected'}`);
//   return isConnected;
// };

// // Disconnect from the WebSocket server
// const disconnect = () => {
//   dataStream.disconnect();
//   console.log('Disconnected from Datastream');
// };

// // Register connection event handlers
// dataStream.on('connected', () => console.log('Event: Connected to Datastream'));
// dataStream.on('disconnected', (type) => console.log(`Event: Disconnected from Datastream (${type})`));
// dataStream.on('reconnecting', (attempts) => console.log(`Event: Reconnecting to Datastream (attempt ${attempts})`));
// dataStream.on('error', (error) => console.error('Event: Datastream error:', error));

// // Connect to start receiving data
// connect();

// // Example token and pool addresses for demonstration
// const TOKEN_ADDRESS = '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R'; // Example token
// const POOL_ADDRESS = 'FJtaAZd6tXNCFGNqXj83JUZqZ5jKQrLpjPTUmAgBGsX4'; // Example pool
// const WALLET_ADDRESS = 'YourWalletAddressHere'; // Replace with actual wallet address

// // ************************************
// // Top-level subscription examples
// // ************************************

// // Subscribe to latest tokens and pools
// const subscribeToLatest = () => {
//   const subscription = dataStream.subscribe.latest().on((data) => {
//     console.log('Latest token/pool update:', data);
//     console.log(`Token: ${data.pools[0].tokenAddress}`);
//     console.log(`Market Cap: $${data.pools[0].marketCap?.usd.toLocaleString()}`);
//   });

//   return subscription; // Contains unsubscribe() method
// };

// // Subscribe to graduating tokens
// const subscribeToGraduating = (marketCapThresholdSOL?: number) => {
//   const subscription = dataStream.subscribe.graduating(marketCapThresholdSOL).on((data) => {
//     console.log('Graduating token:', data);
//     console.log(`Token: ${data.pools[0].tokenAddress}`);
//     console.log(`Market Cap: $${data.pools[0].marketCap?.usd.toLocaleString()}`);
//   });

//   return subscription;
// };

// // Subscribe to graduated tokens
// const subscribeToGraduated = () => {
//   const subscription = dataStream.subscribe.graduated().on((data) => {
//     console.log('Graduated token:', data);
//     console.log(`Token: ${data.pools[0].tokenAddress}`);
//     console.log(`Market Cap: $${data.pools[0].marketCap?.usd.toLocaleString()}`);
//   });

//   return subscription;
// };

// // Subscribe to token metadata updates
// const subscribeToMetadata = (tokenAddress: string = TOKEN_ADDRESS) => {
//   const subscription = dataStream.subscribe.metadata(tokenAddress).on((data) => {
//     console.log('Token metadata update:', data);
//     console.log(`Name: ${data.name}`);
//     console.log(`Symbol: ${data.symbol}`);
//     console.log(`Description: ${data.description || 'N/A'}`);
//   });

//   return subscription;
// };

// // Subscribe to holder count updates
// const subscribeToHolders = (tokenAddress: string = TOKEN_ADDRESS) => {
//   const subscription = dataStream.subscribe.holders(tokenAddress).on((data) => {
//     console.log('Holder count update:', data);
//     console.log(`Total holders: ${data.total}`);
//   });

//   return subscription;
// };

// // Subscribe to token changes (any pool)
// const subscribeToTokenChanges = (tokenAddress: string = TOKEN_ADDRESS) => {
//   const subscription = dataStream.subscribe.token(tokenAddress).on((data) => {
//     console.log('Token update:', data);
//     console.log(`Price: $${data.price?.usd}`);
//     console.log(`Liquidity: $${data.liquidity?.usd}`);
//     console.log(`Market Cap: $${data.marketCap?.usd}`);
//   });

//   return subscription;
// };

// // Subscribe to pool changes
// const subscribeToPoolChanges = (poolId: string = POOL_ADDRESS) => {
//   const subscription = dataStream.subscribe.pool(poolId).on((data) => {
//     console.log('Pool update:', data);
//     console.log(`Pool ID: ${data.poolId}`);
//     console.log(`Token: ${data.tokenAddress}`);
//     console.log(`Price: $${data.price?.usd}`);
//     console.log(`Liquidity: $${data.liquidity?.usd}`);
//   });

//   return subscription;
// };

// // ************************************
// // Price subscription examples
// // ************************************

// // Subscribe to token price updates (main/largest pool)
// const subscribeToTokenPrice = (tokenAddress: string = TOKEN_ADDRESS) => {
//   const subscription = dataStream.subscribe.price.token(tokenAddress).on((data) => {
//     console.log('Token price update:', data);
//     console.log(`Price: $${data.price}`);
//     console.log(`Token: ${data.token}`);
//     console.log(`Pool: ${data.pool}`);
//     console.log(`Time: ${new Date(data.time).toLocaleTimeString()}`);
//   });

//   return subscription;
// };

// // Subscribe to all price updates for a token (across all pools)
// const subscribeToAllTokenPrices = (tokenAddress: string = TOKEN_ADDRESS) => {
//   const subscription = dataStream.subscribe.price.allPoolsForToken(tokenAddress).on((data) => {
//     console.log('Token price update (all pools):', data);
//     console.log(`Price: $${data.price}`);
//     console.log(`Quote price: ${data.price_quote}`);
//     console.log(`Pool: ${data.pool}`);
//     console.log(`Time: ${new Date(data.time).toLocaleTimeString()}`);
//   });

//   return subscription;
// };

// // Subscribe to price updates for a specific pool
// const subscribeToPoolPrice = (poolId: string = POOL_ADDRESS) => {
//   const subscription = dataStream.subscribe.price.pool(poolId).on((data) => {
//     console.log('Pool price update:', data);
//     console.log(`Price: $${data.price}`);
//     console.log(`Token: ${data.token}`);
//     console.log(`Pool: ${data.pool}`);
//     console.log(`Time: ${new Date(data.time).toLocaleTimeString()}`);
//   });

//   return subscription;
// };

// // ************************************
// // Transaction subscription examples
// // ************************************

// // Subscribe to transactions for a token (across all pools)
// const subscribeToTokenTransactions = (tokenAddress: string = TOKEN_ADDRESS) => {
//   const subscription = dataStream.subscribe.tx.token(tokenAddress).on((data) => {
//     // The Datastream will automatically handle arrays of transactions
//     console.log(`${data.type.toUpperCase()} transaction`);
//     console.log(`Transaction ID: ${data.tx}`);
//     console.log(`Amount: ${data.amount}`);
//     console.log(`Price: $${data.priceUsd}`);
//     console.log(`Volume: $${data.volume}`);
//     console.log(`Wallet: ${data.wallet}`);
//     console.log(`Time: ${new Date(data.time).toLocaleTimeString()}`);
//     console.log('---');
//   });

//   return subscription;
// };

// // Subscribe to transactions for a specific token and pool
// const subscribeToPoolTransactions = (
//   tokenAddress: string = TOKEN_ADDRESS,
//   poolId: string = POOL_ADDRESS
// ) => {
//   const subscription = dataStream.subscribe.tx.pool(tokenAddress, poolId).on((data) => {
//     console.log(`Pool ${data.type.toUpperCase()} transaction`);
//     console.log(`Transaction ID: ${data.tx}`);
//     console.log(`Amount: ${data.amount}`);
//     console.log(`Price: $${data.priceUsd}`);
//     console.log(`Volume: $${data.volume}`);
//     console.log(`Wallet: ${data.wallet}`);
//     console.log(`Time: ${new Date(data.time).toLocaleTimeString()}`);
//     console.log('---');
//   });

//   return subscription;
// };

// // Subscribe to transactions for a specific wallet
// const subscribeToWalletTransactions = (walletAddress: string = WALLET_ADDRESS) => {
//   const subscription = dataStream.subscribe.tx.wallet(walletAddress).transactions().on((data) => {
//     console.log(`Wallet ${data.type.toUpperCase()} transaction`);
//     console.log(`Transaction ID: ${data.tx}`);
//     console.log(`Amount: ${data.amount}`);
//     console.log(`Price: $${data.priceUsd}`);
//     console.log(`Volume: $${data.volume}`);
//     console.log(`SOL Volume: ${data.solVolume}`);

//     if (data.token) {
//       console.log('Token Details:');
//       console.log(`From: ${data.token.from.name} (${data.token.from.symbol})`);
//       console.log(`To: ${data.token.to.name} (${data.token.to.symbol})`);
//     }

//     console.log(`Time: ${new Date(data.time).toLocaleTimeString()}`);
//     console.log('---');
//   });

//   return subscription;
// };


// const subscribeToPumpFunCurvePercentage = () => {
//   const subscription = dataStream.subscribe.curvePercentage('pumpfun', 30);
//   subscription.on((data) => {
//     console.log(`Token ${data.token.symbol} reached 30% on Pump.fun`);
//     console.log(`Market cap: ${data.pools[0].marketCap.usd}`);
//   });
// }


// const subscribeToSnipers = (tokenAddress: string = TOKEN_ADDRESS) => {
//   dataStream.subscribe.latest().on((data) => {
//     const subscription = dataStream.subscribe.snipers(data.pools[0].tokenAddress).on((data) => {
//       console.log('Sniper update:');
//       console.log(`Wallet: ${data.wallet}`);
//       console.log(`Token Amount: ${data.tokenAmount.toLocaleString()}`);
//       console.log(`Percentage: ${data.percentage.toFixed(2)}%`);
//       console.log(`Previous Amount: ${data.previousAmount.toLocaleString()}`);
//       console.log(`Previous Percentage: ${data.previousPercentage.toFixed(2)}%`);
//       console.log(`Total Sniper Percentage: ${data.totalSniperPercentage.toFixed(2)}%`);
//       console.log(`Total Insider Percentage: ${data.totalInsiderPercentage.toFixed(2)}%`);
//       console.log('---');
//     });
//   });

// };


// // Subscribe to insider updates for a token
// const subscribeToInsiders = (tokenAddress: string = TOKEN_ADDRESS) => {
//   dataStream.subscribe.latest().on((data) => {
//     const subscription = dataStream.subscribe.insiders(data.pools[0].tokenAddress).on((data) => {
//       console.log('Insider update:');
//       console.log(`Wallet: ${data.wallet}`);
//       console.log(`Token Amount: ${data.tokenAmount.toLocaleString()}`);
//       console.log(`Percentage: ${data.percentage.toFixed(2)}%`);
//       console.log(`Previous Amount: ${data.previousAmount.toLocaleString()}`);
//       console.log(`Previous Percentage: ${data.previousPercentage.toFixed(2)}%`);
//       console.log(`Total Sniper Percentage: ${data.totalSniperPercentage.toFixed(2)}%`);
//       console.log(`Total Insider Percentage: ${data.totalInsiderPercentage.toFixed(2)}%`);
//       console.log('---');
//     });
//   });

// };


// // ************************************
// // Example execution
// // ************************************

// // To run any of the examples, uncomment the relevant line below
// // or call the functions in your application

// // subscribeToLatest();
// // subscribeToSnipers();
// // subscribeToInsiders();
// // subscribeToGraduating();
// // subscribeToGraduated();
// // subscribeToMetadata(TOKEN_ADDRESS);
// // subscribeToHolders(TOKEN_ADDRESS);
// // subscribeToTokenChanges(TOKEN_ADDRESS);
// // subscribeToPoolChanges(POOL_ADDRESS);
// // subscribeToTokenPrice(TOKEN_ADDRESS);
// // subscribeToAllTokenPrices(TOKEN_ADDRESS);
// // subscribeToPoolPrice(POOL_ADDRESS);
// // subscribeToTokenTransactions(TOKEN_ADDRESS);
// // subscribeToPoolTransactions(TOKEN_ADDRESS, POOL_ADDRESS);
// // subscribeToWalletTransactions(WALLET_ADDRESS);

// // OR run the combined example:
// // runCombinedExample();


// /**
//  * Trade-related examples for the Solana Tracker API
//  */
// import { Client } from '@solanatracker/data-api';
// import { handleError } from './utils';

// // Initialize the API client with your API key
// const client = new Client({
//   apiKey: 'YOUR_API_KEY_HERE'
// });

// /**
//  * Example 1: Get trades for a token
//  */
// export async function getTokenTrades(tokenAddress: string) {
//   try {
//     // Get trades with metadata and Jupiter parsing
//     const trades = await client.getTokenTrades(tokenAddress, undefined, true, true);
    
//     console.log(`\n=== Recent Trades for ${tokenAddress} ===`);
//     console.log(`Trades Found: ${trades.trades.length}`);
    
//     console.log('\nMost Recent Trades:');
//     trades.trades.slice(0, 5).forEach((trade, index) => {
//       console.log(`\n${index+1}. Transaction: ${trade.tx.slice(0, 8)}...`);
//       console.log(`   Time: ${new Date(trade.time).toLocaleString()}`);
//       console.log(`   Type: ${trade.type?.toUpperCase() || 'N/A'}`);
//       console.log(`   Amount: ${trade.amount?.toLocaleString() || 'N/A'}`);
//       console.log(`   Price: $${trade.priceUsd?.toFixed(6) || 'N/A'}`);
      
//       if (trade.volume) {
//         console.log(`   Volume: $${trade.volume.toFixed(2)}`);
//       }
      
//       console.log(`   Wallet: ${trade.wallet.slice(0, 6)}...${trade.wallet.slice(-4)}`);
//       console.log(`   Program: ${trade.program}`);
//     });
    
//     // Calculate some statistics if there are trades
//     if (trades.trades.length > 0) {
//       let buyCount = 0;
//       let sellCount = 0;
//       let totalVolume = 0;
      
//       trades.trades.forEach(trade => {
//         if (trade.type === 'buy') buyCount++;
//         if (trade.type === 'sell') sellCount++;
//         if (trade.volume) totalVolume += trade.volume;
//       });
      
//       console.log('\nTrade Statistics:');
//       console.log(`Buy Transactions: ${buyCount}`);
//       console.log(`Sell Transactions: ${sellCount}`);
//       console.log(`Buy/Sell Ratio: ${(buyCount / (sellCount || 1)).toFixed(2)}`);
//       console.log(`Total Volume: $${totalVolume.toFixed(2)}`);
//       console.log(`Average Transaction Size: $${(totalVolume / trades.trades.length).toFixed(2)}`);
//     }
    
//     if (trades.hasNextPage) {
//       console.log(`\nMore trades available. Next cursor: ${trades.nextCursor}`);
//     }
    
//     return trades;
//   } catch (error) {
//     handleError(error);
//     return null;
//   }
// }

// /**
//  * Example 2: Get trades for a specific token and pool
//  */
// export async function getPoolTrades(tokenAddress: string, poolAddress: string) {
//   try {
//     const trades = await client.getPoolTrades(tokenAddress, poolAddress, undefined, true);
    
//     console.log(`\n=== Recent Trades for ${tokenAddress} in Pool ${poolAddress} ===`);
//     console.log(`Trades Found: ${trades.trades.length}`);
    
//     trades.trades.slice(0, 5).forEach((trade, index) => {
//       console.log(`\n${index+1}. Transaction: ${trade.tx.slice(0, 8)}...`);
//       console.log(`   Time: ${new Date(trade.time).toLocaleString()}`);
//       console.log(`   Type: ${trade.type?.toUpperCase() || 'N/A'}`);
//       console.log(`   Amount: ${trade.amount?.toLocaleString() || 'N/A'}`);
//       console.log(`   Price: $${trade.priceUsd?.toFixed(6) || 'N/A'}`);
//     });
    
//     return trades;
//   } catch (error) {
//     handleError(error);
//     return null;
//   }
// }

// /**
//  * Example 3: Get user-specific token trades
//  */
// export async function getUserTokenTrades(tokenAddress: string, walletAddress: string) {
//   try {
//     const trades = await client.getUserTokenTrades(tokenAddress, walletAddress, undefined, true);
    
//     console.log(`\n=== Trades for ${tokenAddress} by Wallet ${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)} ===`);
//     console.log(`Trades Found: ${trades.trades.length}`);
    
//     if (trades.trades.length > 0) {
//       trades.trades.forEach((trade, index) => {
//         console.log(`\n${index+1}. Transaction: ${trade.tx.slice(0, 8)}...`);
//         console.log(`   Time: ${new Date(trade.time).toLocaleString()}`);
//         console.log(`   Type: ${trade.type?.toUpperCase() || 'N/A'}`);
//         console.log(`   Amount: ${trade.amount?.toLocaleString() || 'N/A'}`);
//         console.log(`   Price: $${trade.priceUsd?.toFixed(6) || 'N/A'}`);
//         if (trade.volume) {
//           console.log(`   Volume: $${trade.volume.toFixed(2)}`);
//         }
//       });
      
//       // Calculate trade statistics
//       let buyCount = 0;
//       let sellCount = 0;
//       let totalVolume = 0;
//       let firstTradeTime = trades.trades[trades.trades.length - 1].time;
//       let lastTradeTime = trades.trades[0].time;
      
//       trades.trades.forEach(trade => {
//         if (trade.type === 'buy') buyCount++;
//         if (trade.type === 'sell') sellCount++;
//         if (trade.volume) totalVolume += trade.volume;
//       });
      
//       const tradingPeriodDays = (lastTradeTime - firstTradeTime) / (1000 * 60 * 60 * 24);
      
//       console.log('\nTrading Statistics:');
//       console.log(`First Trade: ${new Date(firstTradeTime).toLocaleString()}`);
//       console.log(`Last Trade: ${new Date(lastTradeTime).toLocaleString()}`);
//       console.log(`Trading Period: ${tradingPeriodDays.toFixed(1)} days`);
//       console.log(`Buy Transactions: ${buyCount}`);
//       console.log(`Sell Transactions: ${sellCount}`);
//       console.log(`Total Volume: $${totalVolume.toFixed(2)}`);
//       console.log(`Average Transaction Size: $${(totalVolume / trades.trades.length).toFixed(2)}`);
//     } else {
//       console.log('\nNo trades found for this wallet and token combination.');
//     }
    
//     return trades;
//   } catch (error) {
//     handleError(error);
//     return null;
//   }
// }

// /**
//  * Example 4: Analyze token trading activity over time
//  */
// export async function analyzeTokenTradingActivity(tokenAddress: string) {
//   try {
//     // Get a large number of trades
//     let allTrades: any[] = [];
//     let cursor: number | undefined = undefined;
//     let hasMore = true;
    
//     // Fetch up to 3 pages of trades (adjust as needed)
//     for (let i = 0; i < 3 && hasMore; i++) {
//       const trades = await client.getTokenTrades(tokenAddress, cursor);
//       allTrades = allTrades.concat(trades.trades);
      
//       hasMore = trades.hasNextPage || false;
//       cursor = trades.nextCursor;
      
//       // Avoid rate limits
//       if (hasMore) await new Promise(resolve => setTimeout(resolve, 500));
//     }
    
//     console.log(`\n=== Trading Activity Analysis for ${tokenAddress} ===`);
//     console.log(`Total Trades Analyzed: ${allTrades.length}`);
    
//     if (allTrades.length === 0) {
//       console.log('No trades found to analyze.');
//       return null;
//     }
    
//     // Group trades by hour
//     const tradesByHour: { [hour: string]: any[] } = {};
//     allTrades.forEach(trade => {
//       const date = new Date(trade.time);
//       const hourKey = `${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, '0')}-${date.getDate().toString().padStart(2, '0')} ${date.getHours().toString().padStart(2, '0')}:00`;
      
//       if (!tradesByHour[hourKey]) {
//         tradesByHour[hourKey] = [];
//       }
      
//       tradesByHour[hourKey].push(trade);
//     });
    
//     // Analyze trading patterns
//     console.log('\nHourly Trading Activity:');
//     const hourlyStats = Object.entries(tradesByHour).map(([hour, trades]) => {
//       const buyTrades = trades.filter(t => t.type === 'buy');
//       const sellTrades = trades.filter(t => t.type === 'sell');
//       const totalVolume = trades.reduce((sum, t) => sum + (t.volume || 0), 0);
      
//       return {
//         hour,
//         totalTrades: trades.length,
//         buyTrades: buyTrades.length,
//         sellTrades: sellTrades.length,
//         ratio: buyTrades.length / (sellTrades.length || 1),
//         volume: totalVolume
//       };
//     });
    
//     // Sort by date/hour
//     hourlyStats.sort((a, b) => new Date(a.hour).getTime() - new Date(b.hour).getTime());
    
//     // Display the most active hours
//     hourlyStats.slice(-5).forEach(stat => {
//       console.log(`\nHour: ${stat.hour}`);
//       console.log(`Total Trades: ${stat.totalTrades}`);
//       console.log(`Buy/Sell: ${stat.buyTrades}/${stat.sellTrades} (Ratio: ${stat.ratio.toFixed(2)})`);
//       console.log(`Volume: $${stat.volume.toFixed(2)}`);
//     });
    
//     // Overall statistics
//     const totalBuys = allTrades.filter(t => t.type === 'buy').length;
//     const totalSells = allTrades.filter(t => t.type === 'sell').length;
//     const totalVolume = allTrades.reduce((sum, t) => sum + (t.volume || 0), 0);
    
//     console.log('\nOverall Statistics:');
//     console.log(`Total Buys: ${totalBuys} (${((totalBuys / allTrades.length) * 100).toFixed(1)}%)`);
//     console.log(`Total Sells: ${totalSells} (${((totalSells / allTrades.length) * 100).toFixed(1)}%)`);
//     console.log(`Buy/Sell Ratio: ${(totalBuys / (totalSells || 1)).toFixed(2)}`);
//     console.log(`Total Volume: $${totalVolume.toFixed(2)}`);
//     console.log(`Average Trade Size: $${(totalVolume / allTrades.length).toFixed(2)}`);
    
//     return { trades: allTrades, hourlyStats };
//   } catch (error) {
//     handleError(error);
//     return null;
//   }
// }

// /**
//  * Utility functions for Solana Tracker API examples
//  */
// import { DataApiError, RateLimitError, ValidationError } from '@solanatracker/data-api';

// /**
//  * Handle API errors with informative messages
//  * @param error The error to handle
//  */
// export function handleError(error: RateLimitError | ValidationError | DataApiError | any): void {
//   if (error instanceof RateLimitError) {
//     console.error('⚠️ Rate limit exceeded. Retry after:', error.retryAfter, 'seconds');
//     console.error('  Message:', error.message);
//   } else if (error instanceof ValidationError) {
//     console.error('⚠️ Validation error:', error.message);
//   } else if (error instanceof DataApiError) {
//     console.error('⚠️ API error:', error.message);
//     console.error('  Status:', error.status);
//     if (error.code) {
//       console.error('  Code:', error.code);
//     }
//   } else {
//     console.error('⚠️ Unexpected error:', error);
//   }
// }

// /**
//  * Format a number as currency string
//  * @param amount The amount to format
//  * @param currency The currency symbol, defaults to USD
//  * @returns Formatted currency string
//  */
// export function formatCurrency(amount: number, currency: string = 'USD'): string {
//   return new Intl.NumberFormat('en-US', {
//     style: 'currency',
//     currency,
//     minimumFractionDigits: 2,
//     maximumFractionDigits: 2
//   }).format(amount);
// }

// /**
//  * Format a number as a percentage
//  * @param value The value to format as percentage
//  * @param decimals Number of decimal places, defaults to 2
//  * @returns Formatted percentage string
//  */
// export function formatPercentage(value: number, decimals: number = 2): string {
//   return `${value > 0 ? '+' : ''}${value.toFixed(decimals)}%`;
// }

// /**
//  * Format a numeric value with appropriate units (K, M, B)
//  * @param value The numeric value to format
//  * @returns Formatted string with appropriate units
//  */
// export function formatNumber(value: number): string {
//   if (value >= 1_000_000_000) {
//     return `${(value / 1_000_000_000).toFixed(2)}B`;
//   } else if (value >= 1_000_000) {
//     return `${(value / 1_000_000).toFixed(2)}M`;
//   } else if (value >= 1_000) {
//     return `${(value / 1_000).toFixed(2)}K`;
//   } else {
//     return value.toFixed(2);
//   }
// }

// /**
//  * Truncate a Solana address for display
//  * @param address The Solana address to truncate
//  * @returns Truncated address (e.g., "Addr5x...y1z2")
//  */
// export function truncateAddress(address: string): string {
//   if (!address || address.length < 10) return address;
//   return `${address.slice(0, 6)}...${address.slice(-4)}`;
// }

// /**
//  * Format a date from a timestamp
//  * @param timestamp The timestamp (in milliseconds)
//  * @returns Formatted date string
//  */
// export function formatDate(timestamp: number): string {
//   return new Date(timestamp).toLocaleString();
// }

// /**
//  * Delay execution for specified milliseconds
//  * @param ms Milliseconds to delay
//  * @returns Promise that resolves after the delay
//  */
// export function delay(ms: number): Promise<void> {
//   return new Promise(resolve => setTimeout(resolve, ms));
// }



// // -------------------------------------------
// // ---- INTEL FROM: src/datastream.ts      ---
// // -------------------------------------------

// // [ OPTIONAL, BUT POWERFUL: IF YOU CAN, COPY AND PASTE THE CONTENTS OF THE 'src/datastream.ts' FILE HERE ]
// // (This gives me the internal blueprint, which is extremely valuable)

// import { EventEmitter } from 'events';
// import "./websocket-polyfill";
// import { TokenInfo, PoolInfo, TokenEvents, TokenRisk, WalletBalanceUpdate } from './interfaces';

// /**
//  * Room types for the WebSocket data stream
//  */
// export enum DatastreamRoom {
//     // Token/pool updates
//     LATEST = 'latest',
//     // Price updates
//     PRICE_BY_TOKEN = 'price-by-token',
//     PRICE_BY_POOL = 'price',
//     // Transactions
//     TOKEN_TRANSACTIONS = 'transaction',
//     // Wallet transactions
//     WALLET_TRANSACTIONS = 'wallet',
//     // Pump.fun stages
//     GRADUATING = 'graduating',
//     GRADUATED = 'graduated',
//     CURVE_PERCENTAGE = 'curve',
//     // Metadata and holders
//     METADATA = 'metadata',
//     HOLDERS = 'holders',
//     // Token changes
//     TOKEN_CHANGES = 'token',
//     POOL_CHANGES = 'pool',
//     // Snipers and insiders
//     SNIPERS = 'sniper',
//     INSIDERS = 'insider'
// }

// /**
//  * Configuration for the Datastream client
//  */
// export interface DatastreamConfig {
//     /**
//      * WebSocket URL for the data stream found on your Dashboard.
//      */
//     wsUrl: string;
//     /**
//      * Whether to automatically reconnect on disconnect
//      * @default true
//      */
//     autoReconnect?: boolean;
//     /**
//      * Initial reconnect delay in milliseconds
//      * @default 2500
//      */
//     reconnectDelay?: number;
//     /**
//      * Maximum reconnect delay in milliseconds
//      * @default 4500
//      */
//     reconnectDelayMax?: number;
//     /**
//      * Randomization factor for reconnect delay
//      * @default 0.5
//      */
//     randomizationFactor?: number;
//     /**
//      * Whether to run WebSocket connections in a Web Worker
//      * @default false
//      */
//     useWorker?: boolean;
//     /**
//      * Custom worker script URL (optional)
//      * If not provided, will use inline worker
//      */
//     workerUrl?: string;
// }

// interface SubscribeResponse<T = any> {
//     room: string;
//     /**
//      * Register a listener for this subscription
//      * @param callback Function to handle incoming data
//      * @returns Object with unsubscribe method
//      */
//     on(callback: (data: T) => void): {
//         unsubscribe: () => void;
//     };
// }

// /**
//  * Message types for worker communication
//  */
// interface WorkerMessage {
//     type: 'connect' | 'disconnect' | 'subscribe' | 'unsubscribe' | 'send';
//     data?: any;
// }

// interface WorkerResponse {
//     type: 'connected' | 'disconnected' | 'message' | 'error' | 'reconnecting';
//     data?: any;
//     socketType?: string;
// }

// /**
//  * Subscription methods for the Datastream client
//  */
// class SubscriptionMethods {
//     private ds: Datastream;
//     public price: PriceSubscriptions;
//     public tx: TransactionSubscriptions;

//     constructor(datastream: Datastream) {
//         this.ds = datastream;
//         this.price = new PriceSubscriptions(datastream);
//         this.tx = new TransactionSubscriptions(datastream);
//     }

//     /**
//      * Subscribe to latest tokens and pools
//      */
//     latest(): SubscribeResponse<TokenDetailWebsocket> {
//         return this.ds._subscribe<TokenDetailWebsocket>('latest');
//     }

//     /**
//      * Subscribe to graduating tokens
//      * @param marketCapThresholdSOL Optional market cap threshold in SOL
//      */
//     graduating(marketCapThresholdSOL?: number): SubscribeResponse<TokenDetailWebsocket> {
//         const room = marketCapThresholdSOL
//             ? `graduating:sol:${marketCapThresholdSOL}`
//             : 'graduating';
//         return this.ds._subscribe<TokenDetailWebsocket>(room);
//     }

//     /**
//  * Subscribe to tokens reaching a specific curve percentage for a market
//  * @param market The market type: 'launchpad', 'pumpfun', 'boop', or 'meteora-curve'
//  * @param percentage The curve percentage threshold (e.g., 30, 50, 75)
//  * @returns Subscription response with curve percentage updates
//  */
//     curvePercentage(market: 'launchpad' | 'pumpfun' | 'boop' | 'meteora-curve', percentage: number): SubscribeResponse<CurvePercentageUpdate> {
//         if (percentage < 0 || percentage > 100) {
//             throw new Error('Percentage must be between 30 and 100');
//         }

//         const room = `${market}:curve:${percentage}`;
//         return this.ds._subscribe<CurvePercentageUpdate>(room);
//     }


//     /**
//      * Subscribe to graduated tokens
//      */
//     graduated(): SubscribeResponse<TokenDetailWebsocket> {
//         return this.ds._subscribe<TokenDetailWebsocket>('graduated');
//     }

//     /**
//      * Subscribe to token metadata updates
//      * @param tokenAddress The token address
//      */
//     metadata(tokenAddress: string): SubscribeResponse<TokenMetadata> {
//         return this.ds._subscribe<TokenMetadata>(`metadata:${tokenAddress}`);
//     }

//     /**
//      * Subscribe to holder count updates for a token
//      * @param tokenAddress The token address
//      */
//     holders(tokenAddress: string): SubscribeResponse<HolderUpdate> {
//         return this.ds._subscribe<HolderUpdate>(`holders:${tokenAddress}`);
//     }

//     /**
//      * Subscribe to token changes (any pool)
//      * @param tokenAddress The token address
//      */
//     token(tokenAddress: string): SubscribeResponse<PoolUpdate> {
//         return this.ds._subscribe<PoolUpdate>(`token:${tokenAddress}`);
//     }

//     /**
//      * Subscribe to pool changes
//      * @param poolId The pool address
//      */
//     pool(poolId: string): SubscribeResponse<PoolUpdate> {
//         return this.ds._subscribe<PoolUpdate>(`pool:${poolId}`);
//     }

//     /**
//      * Subscribe to sniper updates for a token
//      * @param tokenAddress The token address
//      */
//     snipers(tokenAddress: string): SubscribeResponse<SniperInsiderUpdate> {
//         return this.ds._subscribe<SniperInsiderUpdate>(`sniper:${tokenAddress}`);
//     }

//     /**
//      * Subscribe to insider updates for a token
//      * @param tokenAddress The token address
//      */
//     insiders(tokenAddress: string): SubscribeResponse<SniperInsiderUpdate> {
//         return this.ds._subscribe<SniperInsiderUpdate>(`insider:${tokenAddress}`);
//     }
// }

// /**
//  * Price-related subscription methods
//  */
// class PriceSubscriptions {
//     private ds: Datastream;

//     constructor(datastream: Datastream) {
//         this.ds = datastream;
//     }

//     /**
//      * Subscribe to price updates for a token's primary/largest pool
//      * @param tokenAddress The token address
//      */
//     token(tokenAddress: string): SubscribeResponse<PriceUpdate> {
//         return this.ds._subscribe<PriceUpdate>(`price-by-token:${tokenAddress}`);
//     }

//     /**
//      * Subscribe to all price updates for a token across all pools
//      * @param tokenAddress The token address
//      */
//     allPoolsForToken(tokenAddress: string): SubscribeResponse<PriceUpdate> {
//         return this.ds._subscribe<PriceUpdate>(`price:${tokenAddress}`);
//     }

//     /**
//      * Subscribe to price updates for a specific pool
//      * @param poolId The pool address
//      */
//     pool(poolId: string): SubscribeResponse<PriceUpdate> {
//         return this.ds._subscribe<PriceUpdate>(`price:${poolId}`);
//     }
// }



// // 3. If you need TypeScript types for better IDE support
// interface WalletSubscriptionMethods {
//   /**
//    * @deprecated Use .transactions().on() instead
//    */
//   on(callback: (data: WalletTransaction) => void): {
//     unsubscribe: () => void;
//   };
//   room: string;
//   transactions(): SubscribeResponse<WalletTransaction>;
//   balance(): SubscribeResponse<WalletBalanceUpdate>;
//   tokenBalance(tokenAddress: string): SubscribeResponse<WalletBalanceUpdate>;
// }
// /**
//  * Transaction-related subscription methods
//  */
// class TransactionSubscriptions {
//   private ds: Datastream;

//   constructor(datastream: Datastream) {
//     this.ds = datastream;
//   }

//   /**
//    * Subscribe to transactions for a token across all pools
//    * @param tokenAddress The token address
//    */
//   token(tokenAddress: string): SubscribeResponse<TokenTransaction> {
//     return this.ds._subscribe<TokenTransaction>(`transaction:${tokenAddress}`);
//   }

//   /**
//    * Subscribe to transactions for a specific token and pool
//    * @param tokenAddress The token address
//    * @param poolId The pool address
//    */
//   pool(tokenAddress: string, poolId: string): SubscribeResponse<TokenTransaction> {
//     return this.ds._subscribe<TokenTransaction>(`transaction:${tokenAddress}:${poolId}`);
//   }

//   /**
//    * Subscribe to wallet-related events (transactions and balance updates)
//    * 
//    * @example
//    * // For transactions:
//    * datastream.subscribe.tx.wallet('address').transactions().on(callback)
//    * 
//    * // For all balance updates:
//    * datastream.subscribe.tx.wallet('address').balance().on(callback)
//    * 
//    * // For specific token balance:
//    * datastream.subscribe.tx.wallet('address').tokenBalance('token').on(callback)
//    * 
//    * // Legacy (deprecated):
//    * datastream.subscribe.tx.wallet('address').on(callback)
//    * 
//    * @param walletAddress The wallet address
//    */
// wallet(walletAddress: string): WalletSubscriptionMethods {
//     const ds = this.ds;
    
//     // Create the base subscription
//     const baseSubscription = ds._subscribe<WalletTransaction>(`wallet:${walletAddress}`);
    
//     // Add the new methods to the subscription object
//     const enhancedSubscription = {
//       ...baseSubscription,
      
//       // Keep the original on method but mark it as deprecated
//       on: (callback: (data: WalletTransaction) => void) => {

//         return baseSubscription.on(callback);
//       },
      
//       // New methods
//       transactions: () => {
//         return ds._subscribe<WalletTransaction>(`wallet:${walletAddress}`);
//       },
      
//       balance: () => {
//         return ds._subscribe<WalletBalanceUpdate>(`wallet:${walletAddress}:balance`);
//       },
      
//       tokenBalance: (tokenAddress: string) => {
//         return ds._subscribe<WalletBalanceUpdate>(`wallet:${walletAddress}:${tokenAddress}:balance`);
//       }
//     };
    
//     return enhancedSubscription;
//   }
// }



// /**
//  * WebSocket service for real-time data streaming from Solana Tracker
//  */
// export class Datastream extends EventEmitter {
//     public subscribe: SubscriptionMethods;

//     private wsUrl: string;
//     private socket: WebSocket | null = null;
//     private transactionSocket: WebSocket | null = null;
//     private reconnectAttempts = 0;
//     private reconnectDelay: number;
//     private reconnectDelayMax: number;
//     private randomizationFactor: number;
//     private subscribedRooms = new Set<string>();
//     private transactions = new Set<string>();
//     private autoReconnect: boolean;
//     private isConnecting = false;
//     private useWorker: boolean;
//     private worker: Worker | null = null;
//     private workerUrl?: string;

//     /**
//      * Creates a new Datastream client for real-time Solana Tracker data
//      * @param config Configuration options
//      */
//     constructor(config: DatastreamConfig) {
//         super();
//         this.wsUrl = config.wsUrl || '';
//         this.autoReconnect = config.autoReconnect !== false;
//         this.reconnectDelay = config.reconnectDelay || 2500;
//         this.reconnectDelayMax = config.reconnectDelayMax || 4500;
//         this.randomizationFactor = config.randomizationFactor || 0.5;
//         this.useWorker = config.useWorker || false;
//         this.workerUrl = config.workerUrl;
//         this.subscribe = new SubscriptionMethods(this);
//         if (typeof window !== 'undefined') {
//             window.addEventListener('beforeunload', this.disconnect.bind(this));
//         }
//     }

//     /**
//      * Connects to the WebSocket server
//      * @returns Promise that resolves when connected
//      */
//     async connect(): Promise<void> {
//         if (this.useWorker) {
//             return this.connectWithWorker();
//         }

//         if (this.socket && this.transactionSocket) {
//             return;
//         }

//         if (this.isConnecting) {
//             return;
//         }

//         this.isConnecting = true;

//         try {
//             await Promise.all([
//                 this.createSocket('main'),
//                 this.createSocket('transaction')
//             ]);

//             this.isConnecting = false;
//             this.emit('connected');
//         } catch (e) {
//             this.isConnecting = false;
//             this.emit('error', e);

//             if (this.autoReconnect) {
//                 this.reconnect();
//             }
//         }
//     }

//     /**
//      * Connects using Web Worker
//      * @returns Promise that resolves when connected
//      */
//     private async connectWithWorker(): Promise<void> {
//         if (this.worker) {
//             return;
//         }

//         if (this.isConnecting) {
//             return;
//         }

//         this.isConnecting = true;

//         try {
//             if (this.workerUrl) {
//                 this.worker = new Worker(this.workerUrl);
//             } else {
//                 // Create inline worker
//                 const workerCode = this.getWorkerCode();
//                 const blob = new Blob([workerCode], { type: 'application/javascript' });
//                 const workerUrl = URL.createObjectURL(blob);
//                 this.worker = new Worker(workerUrl);
//             }

//             this.setupWorkerListeners();

//             // Send connect message to worker
//             this.worker.postMessage({
//                 type: 'connect',
//                 data: {
//                     wsUrl: this.wsUrl,
//                     autoReconnect: this.autoReconnect,
//                     reconnectDelay: this.reconnectDelay,
//                     reconnectDelayMax: this.reconnectDelayMax,
//                     randomizationFactor: this.randomizationFactor
//                 }
//             });

//             // Wait for connection
//             await new Promise<void>((resolve, reject) => {
//                 const timeout = setTimeout(() => {
//                     reject(new Error('Worker connection timeout'));
//                 }, 10000);

//                 const handler = (e: MessageEvent<WorkerResponse>) => {
//                     if (e.data.type === 'connected') {
//                         clearTimeout(timeout);
//                         this.worker?.removeEventListener('message', handler);
//                         resolve();
//                     } else if (e.data.type === 'error') {
//                         clearTimeout(timeout);
//                         this.worker?.removeEventListener('message', handler);
//                         reject(new Error(e.data.data));
//                     }
//                 };

//                 this.worker!.addEventListener('message', handler);
//             });

//             this.isConnecting = false;
//             this.emit('connected');
//         } catch (e) {
//             this.isConnecting = false;
//             this.emit('error', e);

//             if (this.autoReconnect) {
//                 this.reconnect();
//             }
//         }
//     }

//     /**
//      * Sets up worker event listeners
//      */
//     private setupWorkerListeners(): void {
//         if (!this.worker) return;

//         this.worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
//             const { type, data, socketType } = event.data;

//             switch (type) {
//                 case 'message':
//                     this.handleWorkerMessage(data);
//                     break;
//                 case 'disconnected':
//                     this.emit('disconnected', socketType || 'all');
//                     if (socketType === 'all') {
//                         this.worker = null;
//                     }
//                     break;
//                 case 'error':
//                     this.emit('error', new Error(data));
//                     break;
//                 case 'reconnecting':
//                     this.emit('reconnecting', data);
//                     break;
//             }
//         };

//         this.worker.onerror = (error) => {
//             this.emit('error', error);
//         };
//     }

//     /**
//      * Handles messages from worker
//      */
//     private handleWorkerMessage(data: any): void {
//         const { room, message } = data;

//         // Deduplicate transactions
//         if (message?.tx && this.transactions.has(message.tx)) {
//             return;
//         } else if (message?.tx) {
//             this.transactions.add(message.tx);
//         }

//         // Special handling for price events
//         if (room.includes('price:')) {
//             this.emit(`price-by-token:${message.token}`, message);
//         }

//         this.emit(room, message);
//     }

//     /**
//      * Gets the worker code as a string
//      */
//     private getWorkerCode(): string {
//         return `
//             let mainSocket = null;
//             let transactionSocket = null;
//             let config = {};
//             let reconnectAttempts = 0;
//             let subscribedRooms = new Set();
//             let transactions = new Set();

//             self.addEventListener('message', (event) => {
//                 const { type, data } = event.data;

//                 switch (type) {
//                     case 'connect':
//                         config = data;
//                         connect();
//                         break;
//                     case 'disconnect':
//                         disconnect();
//                         break;
//                     case 'subscribe':
//                         subscribe(data.room);
//                         break;
//                     case 'unsubscribe':
//                         unsubscribe(data.room);
//                         break;
//                     case 'send':
//                         send(data.socket, data.message);
//                         break;
//                 }
//             });

//             async function connect() {
//                 try {
//                     await Promise.all([
//                         createSocket('main'),
//                         createSocket('transaction')
//                     ]);
//                     self.postMessage({ type: 'connected' });
//                 } catch (e) {
//                     self.postMessage({ type: 'error', data: e.message });
//                     if (config.autoReconnect) {
//                         reconnect();
//                     }
//                 }
//             }

//             function createSocket(type) {
//                 return new Promise((resolve, reject) => {
//                     try {
//                         const socket = new WebSocket(config.wsUrl);

//                         socket.onopen = () => {
//                             if (type === 'main') {
//                                 mainSocket = socket;
//                             } else {
//                                 transactionSocket = socket;
//                             }
//                             reconnectAttempts = 0;
//                             setupSocketListeners(socket, type);
//                             resubscribeToRooms();
//                             resolve();
//                         };

//                         socket.onerror = (error) => {
//                             reject(error);
//                         };
//                     } catch (e) {
//                         reject(e);
//                     }
//                 });
//             }

//             function setupSocketListeners(socket, type) {
//                 socket.onmessage = (event) => {
//                     try {
//                         const message = JSON.parse(event.data);
//                         if (message.type === 'message') {
//                             self.postMessage({
//                                 type: 'message',
//                                 data: {
//                                     room: message.room,
//                                     message: message.data
//                                 }
//                             });
//                         }
//                     } catch (error) {
//                         self.postMessage({ type: 'error', data: error.message });
//                     }
//                 };

//                 socket.onclose = () => {
//                     if (type === 'main') {
//                         mainSocket = null;
//                     } else if (type === 'transaction') {
//                         transactionSocket = null;
//                     }

//                     self.postMessage({ type: 'disconnected', socketType: type });

//                     if (config.autoReconnect) {
//                         reconnect();
//                     }
//                 };
//             }

//             function disconnect() {
//                 if (mainSocket) {
//                     mainSocket.close();
//                     mainSocket = null;
//                 }
//                 if (transactionSocket) {
//                     transactionSocket.close();
//                     transactionSocket = null;
//                 }
//                 subscribedRooms.clear();
//                 transactions.clear();
//                 self.postMessage({ type: 'disconnected', socketType: 'all' });
//             }

//             function reconnect() {
//                 self.postMessage({ type: 'reconnecting', data: reconnectAttempts });

//                 const delay = Math.min(
//                     config.reconnectDelay * Math.pow(2, reconnectAttempts),
//                     config.reconnectDelayMax
//                 );

//                 const jitter = delay * config.randomizationFactor;
//                 const reconnectDelay = delay + Math.random() * jitter;

//                 setTimeout(() => {
//                     reconnectAttempts++;
//                     connect();
//                 }, reconnectDelay);
//             }

//             function subscribe(room) {
//                 subscribedRooms.add(room);
//                 const socket = room.includes('transaction') ? transactionSocket : mainSocket;
//                 if (socket && socket.readyState === WebSocket.OPEN) {
//                     socket.send(JSON.stringify({ type: 'join', room }));
//                 }
//             }

//             function unsubscribe(room) {
//                 subscribedRooms.delete(room);
//                 const socket = room.includes('transaction') ? transactionSocket : mainSocket;
//                 if (socket && socket.readyState === WebSocket.OPEN) {
//                     socket.send(JSON.stringify({ type: 'leave', room }));
//                 }
//             }

//             function send(socketType, message) {
//                 const socket = socketType === 'transaction' ? transactionSocket : mainSocket;
//                 if (socket && socket.readyState === WebSocket.OPEN) {
//                     socket.send(message);
//                 }
//             }

//             function resubscribeToRooms() {
//                 if (mainSocket && mainSocket.readyState === WebSocket.OPEN &&
//                     transactionSocket && transactionSocket.readyState === WebSocket.OPEN) {
//                     for (const room of subscribedRooms) {
//                         const socket = room.includes('transaction') ? transactionSocket : mainSocket;
//                         socket.send(JSON.stringify({ type: 'join', room }));
//                     }
//                 }
//             }
//         `;
//     }

//     /**
//      * Creates a WebSocket connection
//      * @param type Socket type ('main' or 'transaction')
//      * @returns Promise that resolves when connected
//      */
//     private createSocket(type: 'main' | 'transaction'): Promise<void> {
//         return new Promise((resolve, reject) => {
//             try {
//                 const socket = new WebSocket(this.wsUrl);

//                 socket.onopen = () => {
//                     if (type === 'main') {
//                         this.socket = socket;
//                     } else {
//                         this.transactionSocket = socket;
//                     }

//                     this.reconnectAttempts = 0;
//                     this.setupSocketListeners(socket, type);
//                     this.resubscribeToRooms();
//                     resolve();
//                 };

//                 socket.onerror = (error) => {
//                     reject(error);
//                 };

//             } catch (e) {
//                 reject(e);
//             }
//         });
//     }

//     /**
//      * Sets up WebSocket event listeners
//      * @param socket The WebSocket connection
//      * @param type Socket type ('main' or 'transaction')
//      */
//     private setupSocketListeners(socket: WebSocket, type: 'main' | 'transaction'): void {
//         socket.onmessage = (event) => {
//             try {
//                 const message = JSON.parse(event.data);
//                 if (message.type === 'message') {
//                     // Deduplicate transactions
//                     if (message.data?.tx && this.transactions.has(message.data.tx)) {
//                         return;
//                     } else if (message.data?.tx) {
//                         this.transactions.add(message.data.tx);
//                     }

//                     // Special handling for price events
//                     if (message.room.includes('price:')) {
//                         this.emit(`price-by-token:${message.data.token}`, message.data);
//                     }

//                     this.emit(message.room, message.data);
//                 }
//             } catch (error) {
//                 this.emit('error', new Error(`Error processing message: ${error}`));
//             }
//         };

//         socket.onclose = () => {
//             this.emit('disconnected', type);

//             if (type === 'main') {
//                 this.socket = null;
//             } else if (type === 'transaction') {
//                 this.transactionSocket = null;
//             }

//             if (this.autoReconnect) {
//                 this.reconnect();
//             }
//         };
//     }

//     /**
//      * Disconnects from the WebSocket server
//      */
//     disconnect(): void {
//         if (this.useWorker && this.worker) {
//             this.worker.postMessage({ type: 'disconnect' });
//             this.worker.terminate();
//             this.worker = null;
//         } else {
//             if (this.socket) {
//                 this.socket.close();
//                 this.socket = null;
//             }

//             if (this.transactionSocket) {
//                 this.transactionSocket.close();
//                 this.transactionSocket = null;
//             }
//         }

//         this.subscribedRooms.clear();
//         this.transactions.clear();
//         this.emit('disconnected', 'all');
//     }

//     /**
//      * Handles reconnection to the WebSocket server
//      */
//     private reconnect(): void {
//         if (!this.autoReconnect) return;

//         this.emit('reconnecting', this.reconnectAttempts);

//         const delay = Math.min(
//             this.reconnectDelay * Math.pow(2, this.reconnectAttempts),
//             this.reconnectDelayMax
//         );

//         const jitter = delay * this.randomizationFactor;
//         const reconnectDelay = delay + Math.random() * jitter;

//         setTimeout(() => {
//             this.reconnectAttempts++;
//             this.connect();
//         }, reconnectDelay);
//     }

//     /**
//      * Subscribes to a data room
//      * @param room The room name to join
//      * @returns Response with room name and on() method for listening
//      * @internal Used by SubscriptionMethods
//      */
//     _subscribe<T = any>(room: string): SubscribeResponse<T> {
//         this.subscribedRooms.add(room);

//         if (this.useWorker && this.worker) {
//             this.worker.postMessage({ type: 'subscribe', data: { room } });
//         } else {
//             const socket = room.includes('transaction')
//                 ? this.transactionSocket
//                 : this.socket;

//             if (socket && socket.readyState === WebSocket.OPEN) {
//                 socket.send(JSON.stringify({ type: 'join', room }));
//             } else {
//                 // If not connected, we'll subscribe when connection is established
//                 this.connect();
//             }
//         }

//         return {
//             room,
//             on: (callback: (data: T) => void) => {
//                 // Create a wrapper that handles arrays automatically
//                 const wrappedCallback = (data: T | T[]) => {
//                     if (Array.isArray(data)) {
//                         // If data is an array, call the callback for each item
//                         data.forEach(item => callback(item));
//                     } else {
//                         // If data is a single item, call the callback directly
//                         callback(data);
//                     }
//                 };

//                 this.on(room, wrappedCallback as any);

//                 return {
//                     unsubscribe: () => {
//                         this.removeListener(room, wrappedCallback as any);
//                     }
//                 };
//             }
//         };
//     }


//     public on(event: string | symbol, listener: (...args: any[]) => void): this {
//         return super.on(event, listener);
//     }

//     public once(event: string | symbol, listener: (...args: any[]) => void): this {
//         return super.once(event, listener);
//     }

//     public off(event: string | symbol, listener: (...args: any[]) => void): this {
//         return super.off(event, listener);
//     }

//     public removeListener(event: string | symbol, listener: (...args: any[]) => void): this {
//         return super.removeListener(event, listener);
//     }

//     public removeAllListeners(event?: string | symbol): this {
//         return super.removeAllListeners(event);
//     }

//     public listeners(event: string | symbol): Function[] {
//         return super.listeners(event);
//     }

//     /**
//      * Unsubscribes from a data room
//      * @param room The room name to leave
//      * @returns Reference to this instance for chaining
//      */
//     unsubscribe(room: string): Datastream {
//         this.subscribedRooms.delete(room);

//         if (this.useWorker && this.worker) {
//             this.worker.postMessage({ type: 'unsubscribe', data: { room } });
//         } else {
//             const socket = room.includes('transaction')
//                 ? this.transactionSocket
//                 : this.socket;

//             if (socket && socket.readyState === WebSocket.OPEN) {
//                 socket.send(JSON.stringify({ type: 'leave', room }));
//             }
//         }

//         return this;
//     }

//     /**
//      * Resubscribes to all previously subscribed rooms after reconnection
//      */
//     private resubscribeToRooms(): void {
//         if (
//             this.socket &&
//             this.socket.readyState === WebSocket.OPEN &&
//             this.transactionSocket &&
//             this.transactionSocket.readyState === WebSocket.OPEN
//         ) {
//             for (const room of this.subscribedRooms) {
//                 const socket = room.includes('transaction')
//                     ? this.transactionSocket
//                     : this.socket;

//                 socket.send(JSON.stringify({ type: 'join', room }));
//             }
//         }
//     }

//     /**
//      * Get the current connection status
//      * @returns True if connected, false otherwise
//      */
//     isConnected(): boolean {
//         if (this.useWorker) {
//             return !!this.worker;
//         }

//         return (
//             !!this.socket &&
//             this.socket.readyState === WebSocket.OPEN &&
//             !!this.transactionSocket &&
//             this.transactionSocket.readyState === WebSocket.OPEN
//         );
//     }
// }

// export interface TokenDetailWebsocket {
//     token: TokenInfo;
//     pools: PoolInfo[];
//     events: TokenEvents;
//     risk: TokenRisk;
// }

// export interface CurvePercentageUpdate {
//     token: TokenInfo;
//     pools: PoolInfo[];
//     events: TokenEvents;
//     risk: TokenRisk;
// }

// // Export types for specific data structures
// export interface TokenTransaction {
//     tx: string;
//     amount: number;
//     priceUsd: number;
//     volume: number;
//     volumeSol?: number;
//     type: 'buy' | 'sell';
//     wallet: string;
//     time: number;
//     program: string;
//     pools?: string[];
// }

// export interface PriceUpdate {
//     price: number;
//     price_quote: number;
//     pool: string;
//     token: string;
//     time: number;
// }

// export interface LaunchpadLiquidity {
//     amount: number;
//     usd: number;
// }

// export interface Launchpad {
//     name: string;
//     url: string;
//     logo: string;
//     baseLiquidity: LaunchpadLiquidity;
//     quoteLiquidity: LaunchpadLiquidity;
// }

// export interface MeteoraCurveLiquidity {
//     base?: number;  // For baseLiquidity
//     quote?: number; // For quoteLiquidity
//     usd: number;
// }

// export interface MeteoraCurve {
//     baseLiquidity: MeteoraCurveLiquidity;
//     quoteLiquidity: MeteoraCurveLiquidity;
//     fee: number;
//     name?: string;  // Optional
//     url?: string;   // Optional
//     logo?: string;  // Optional
// }


// export interface PoolUpdate {
//     liquidity: {
//         quote: number;
//         usd: number;
//     };
//     price: {
//         quote: number;
//         usd: number;
//     };
//     tokenSupply: number;
//     lpBurn: number;
//     tokenAddress: string;
//     marketCap: {
//         quote: number;
//         usd: number;
//     };
//     decimals: number;
//     security: {
//         freezeAuthority: string | null;
//         mintAuthority: string | null;
//     };
//     quoteToken: string;
//     market: string;
//     deployer?: string;
//     lastUpdated: number;
//     createdAt?: number;
//     poolId: string;
//     curvePercentage?: number;
//     curve?: string;
//     txns?: {
//         buys: number;
//         total: number;
//         volume: number;
//         sells: number;
//         volume24h: number;  // Added the new field
//     };
//     bundleId?: string;
    
//     // New fields for different market types
//     launchpad?: Launchpad;        // For raydium-launchpad market
//     meteoraCurve?: MeteoraCurve;  // For meteora-curve market
// }

// export interface HolderUpdate {
//     total: number;
// }

// export interface WalletTransaction {
//     tx: string;
//     amount: number;
//     priceUsd: number;
//     solVolume: number;
//     volume: number;
//     type: 'buy' | 'sell';
//     wallet: string;
//     time: number;
//     program: string;
//     token?: {
//         from: {
//             name: string;
//             symbol: string;
//             image?: string;
//             decimals: number;
//             amount: number;
//             priceUsd?: number;
//             address: string;
//         };
//         to: {
//             name: string;
//             symbol: string;
//             image?: string;
//             decimals: number;
//             amount: number;
//             priceUsd?: number;
//             address: string;
//         };
//     };
// }

// export interface TokenMetadata {
//     name: string;
//     symbol: string;
//     mint: string;
//     uri?: string;
//     decimals: number;
//     hasFileMetaData?: boolean;
//     createdOn?: string;
//     description?: string;
//     image?: string;
//     showName?: boolean;
//     twitter?: string;
//     telegram?: string;
//     website?: string;
//     strictSocials?: {
//         twitter?: string;
//         telegram?: string;
//         website?: string;
//     };
// }

// export interface SniperInsiderUpdate {
//     wallet: string;
//     amount: string;  // raw_amount from the update
//     tokenAmount: number;
//     percentage: number;
//     previousAmount: number;
//     previousPercentage: number;
//     totalSniperPercentage: number;
//     totalInsiderPercentage: number;
// }

//                                          // data-api-sdk/src/data-api.ts
  
//   import {
//   TokenDetailResponse,
//   MultiTokensResponse,
//   TokenHoldersResponse,
//   TopHolder,
//   AthPrice,
//   DeployerTokensResponse,
//   SearchParams,
//   SearchResponse,
//   TokenOverview,
//   PriceData,
//   PriceHistoryData,
//   PriceTimestampData,
//   PriceRangeData,
//   MultiPriceResponse,
//   WalletBasicResponse,
//   TradesResponse,
//   WalletResponse,
//   ChartResponse,
//   HoldersChartResponse,
//   PnLResponse,
//   TokenPnLResponse,
//   FirstBuyerData,
//   TopTradersResponse,
//   TokenStats,
//   WalletChartResponse,
//   CreditsResponse,
//   WalletTradesResponse,
//   ProcessedEvent,
//   SubscriptionResponse
// } from './interfaces';

// import { decodeBinaryEvents } from './event-processor';

// export class DataApiError extends Error {
//   public details?: any;

//   constructor(
//     message: string,
//     public status?: number,
//     public code?: string,
//     details?: any
//   ) {
//     super(message);
//     this.name = 'DataApiError';
//     this.details = details;
//   }
// }

// export class RateLimitError extends DataApiError {
//   constructor(message: string, public retryAfter?: number, details?: any) {
//     super(message, 429, 'RATE_LIMIT_EXCEEDED', details);
//     this.name = 'RateLimitError';
//   }
// }

// export class ValidationError extends DataApiError {
//   constructor(message: string, details?: any) {
//     super(message, 400, 'VALIDATION_ERROR', details);
//     this.name = 'ValidationError';
//   }
// }
// /**
//  * Config options for the Solana Tracker Data API
//  */
// export interface DataApiConfig {
//   /** Your API key from solanatracker.io */
//   apiKey: string;
//   /** Optional base URL override */
//   baseUrl?: string;
// }

// export interface RequestOptions {
//   method: string;
//   body: any;
//   /** Optional headers to include in the request */
//   headers?: Record<string, string>;
//   /** Disable logs for rate limit warnings */
//   disableLogs?: boolean;
// }
// /**
//  * Solana Tracker Data API client
//  */
// export class Client {
//   private apiKey: string;
//   private baseUrl: string;

//   /**
//    * Creates a new instance of the Solana Tracker Data API client
//    * @param config Configuration options including API key
//    */
//   constructor(config: DataApiConfig) {
//     this.apiKey = config.apiKey;
//     this.baseUrl = config.baseUrl || 'https://data.solanatracker.io';
//   }

//   /**
//    * Makes a request to the API
//    * @param endpoint The API endpoint
//    * @param options Additional fetch options
//    * @returns The API response
//    */
//   private async request<T>(endpoint: string, options?: RequestOptions): Promise<T> {
//     const headers = {
//       'x-api-key': this.apiKey,
//       'Content-Type': 'application/json',
//       ...options?.headers,
//     };

//     try {
//       const response = await fetch(`${this.baseUrl}${endpoint}`, {
//         ...options,
//         headers,
//       });

//       if (!response.ok) {
//         // Default error message
//         let errorMessage = `API request failed: ${response.status} ${response.statusText}`;
//         let errorDetails: any = null;

//         try {
//           // Attempt to parse error response as JSON
//           const contentType = response.headers.get('content-type');
//           if (contentType && contentType.includes('application/json')) {
//             errorDetails = await response.json();

//             // Extract error message from various possible fields
//             if (typeof errorDetails === 'string') {
//               errorMessage = errorDetails;
//             } else if (errorDetails && typeof errorDetails === 'object') {
//               // Try different common error message fields
//               if (typeof errorDetails.message === 'string') {
//                 errorMessage = errorDetails.message;
//               } else if (typeof errorDetails.error === 'string') {
//                 errorMessage = errorDetails.error;
//               } else if (typeof errorDetails.detail === 'string') {
//                 errorMessage = errorDetails.detail;
//               } else if (typeof errorDetails.msg === 'string') {
//                 errorMessage = errorDetails.msg;
//               } else if (errorDetails.error && typeof errorDetails.error === 'object') {
//                 // If error is an object, try to extract message from it
//                 if (typeof errorDetails.error.message === 'string') {
//                   errorMessage = errorDetails.error.message;
//                 } else if (typeof errorDetails.error.detail === 'string') {
//                   errorMessage = errorDetails.error.detail;
//                 } else {
//                   // If we can't find a string message, stringify the error object
//                   errorMessage = `API error: ${JSON.stringify(errorDetails.error)}`;
//                 }
//               } else {
//                 // Last resort: stringify the entire error response
//                 errorMessage = `API error: ${JSON.stringify(errorDetails)}`;
//               }
//             }
//           }
//         } catch (parseError) {
//           // If parsing fails, we'll use the default error message
//           console.error('Failed to parse error response:', parseError);
//         }

//         // Handle specific error codes
//         if (response.status === 429) {
//           const retryAfter = response.headers.get('Retry-After');
//           if (!options?.disableLogs) {
//             console.warn(`Rate limit exceeded for ${endpoint}. Retry after: ${retryAfter || '1'} seconds`);
//           }
//           const error = new RateLimitError(errorMessage, retryAfter ? parseInt(retryAfter) : undefined);
//           // Attach error details if available
//           if (errorDetails) {
//             (error as any).details = errorDetails;
//           }
//           throw error;
//         }

//         // For all other errors (including 500)
//         const error = new DataApiError(errorMessage, response.status);
//         // Attach error details if available
//         if (errorDetails) {
//           (error as any).details = errorDetails;
//         }
//         throw error;
//       }

//       return response.json() as Promise<T>;
//     } catch (error) {
//       if (error instanceof DataApiError) {
//         throw error;
//       }
//       // For network errors or other unexpected errors
//       throw new DataApiError(`An unexpected error occurred: ${error instanceof Error ? error.message : 'Unknown error'}`);
//     }
//   }

//   /**
//    * Validates a Solana public key
//    * @param address The address to validate
//    * @param paramName The parameter name for error messaging
//    * @throws ValidationError if the address is invalid
//    */
//   private validatePublicKey(address: string, paramName: string) {
//     // Basic validation - a more robust implementation would use the PublicKey class from @solana/web3.js
//     if (!address || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) {
//       throw new ValidationError(`Invalid ${paramName}: ${address}`);
//     }
//   }

//   // ======== TOKEN ENDPOINTS ========

//   /**
//    * Get comprehensive information about a specific token
//    * @param tokenAddress The token's mint address
//    * @returns Detailed token information
//    */
//   async getTokenInfo(tokenAddress: string): Promise<TokenDetailResponse> {
//     this.validatePublicKey(tokenAddress, 'tokenAddress');
//     return this.request<TokenDetailResponse>(`/tokens/${tokenAddress}`);
//   }

//   /**
//    * Get token information by searching with a pool address
//    * @param poolAddress The pool address
//    * @returns Detailed token information
//    */
//   async getTokenByPool(poolAddress: string): Promise<TokenDetailResponse> {
//     this.validatePublicKey(poolAddress, 'poolAddress');
//     return this.request<TokenDetailResponse>(`/tokens/by-pool/${poolAddress}`);
//   }

//   /**
//    * Get token holders information
//    * @param tokenAddress The token's mint address
//    * @returns Information about token holders
//    */
//   async getTokenHolders(tokenAddress: string): Promise<TokenHoldersResponse> {
//     this.validatePublicKey(tokenAddress, 'tokenAddress');
//     return this.request<TokenHoldersResponse>(`/tokens/${tokenAddress}/holders`);
//   }

//   /**
//    * Get top 20 token holders
//    * @param tokenAddress The token's mint address
//    * @returns Top holders information
//    */
//   async getTopHolders(tokenAddress: string): Promise<TopHolder[]> {
//     this.validatePublicKey(tokenAddress, 'tokenAddress');
//     return this.request<TopHolder[]>(`/tokens/${tokenAddress}/holders/top`);
//   }

//   /**
//    * Get the all-time high price for a token
//    * @param tokenAddress The token's mint address
//    * @returns All-time high price data
//    */
//   async getAthPrice(tokenAddress: string): Promise<AthPrice> {
//     this.validatePublicKey(tokenAddress, 'tokenAddress');
//     return this.request<AthPrice>(`/tokens/${tokenAddress}/ath`);
//   }


//   /**
//    * Get tokens created by a specific wallet with pagination
//    * @param wallet The deployer wallet address
//    * @param page Page number (default: 1)
//    * @param limit Number of items per page (default: 250, max: 500)
//    * @returns List of tokens created by the deployer
//    */
//   async getTokensByDeployer(
//     wallet: string,
//     page?: number,
//     limit?: number
//   ): Promise<DeployerTokensResponse> {
//     this.validatePublicKey(wallet, 'wallet');

//     const params = new URLSearchParams();
//     if (page) params.append('page', page.toString());
//     if (limit) params.append('limit', limit.toString());

//     const query = params.toString() ? `?${params.toString()}` : '';
//     return this.request<DeployerTokensResponse>(`/deployer/${wallet}${query}`);
//   }

//   /**
//    * Search for tokens with flexible filtering options
//    * @param params Search parameters and filters
//    * @returns Search results
//    */
//   async searchTokens(params: SearchParams): Promise<SearchResponse> {
//     const queryParams = new URLSearchParams();
//     for (const [key, value] of Object.entries(params)) {
//       if (value !== undefined) {
//         queryParams.append(key, value.toString());
//       }
//     }
//     return this.request<SearchResponse>(`/search?${queryParams}`);
//   }

//   /**
//    * Get the latest tokens
//    * @param page Page number (1-10)
//    * @returns List of latest tokens
//    */
//   async getLatestTokens(page: number = 1): Promise<TokenDetailResponse[]> {
//     if (page < 1 || page > 10) {
//       throw new ValidationError('Page must be between 1 and 10');
//     }
//     return this.request<TokenDetailResponse[]>(`/tokens/latest?page=${page}`);
//   }

//   /**
//    * Get information about multiple tokens
//    * @param tokenAddresses Array of token addresses
//    * @returns Information about multiple tokens
//    */
//   async getMultipleTokens(tokenAddresses: string[]): Promise<MultiTokensResponse> {
//     if (tokenAddresses.length > 20) {
//       throw new ValidationError('Maximum of 20 tokens per request');
//     }
//     tokenAddresses.forEach((addr) => this.validatePublicKey(addr, 'tokenAddress'));
//     return this.request<MultiTokensResponse>('/tokens/multi', {
//       method: 'POST',
//       body: JSON.stringify({ tokens: tokenAddresses }),
//     });
//   }

//   /**
//    * Get trending tokens
//    * @param timeframe Optional timeframe for trending calculation
//    * @returns List of trending tokens
//    */
//   async getTrendingTokens(timeframe?: string): Promise<TokenDetailResponse[]> {
//     const validTimeframes = ['5m', '15m', '30m', '1h', '2h', '3h', '4h', '5h', '6h', '12h', '24h'];
//     if (timeframe && !validTimeframes.includes(timeframe)) {
//       throw new ValidationError(`Invalid timeframe. Must be one of: ${validTimeframes.join(', ')}`);
//     }
//     const endpoint = timeframe ? `/tokens/trending/${timeframe}` : '/tokens/trending';
//     return this.request<TokenDetailResponse[]>(endpoint);
//   }

//   /**
//    * Get tokens sorted by volume
//    * @param timeframe Optional timeframe for volume calculation
//    * @returns List of tokens sorted by volume
//    */
//   async getTokensByVolume(timeframe?: string): Promise<TokenDetailResponse[]> {
//     const validTimeframes = ['5m', '15m', '30m', '1h', '6h', '12h', '24h'];
//     if (timeframe && !validTimeframes.includes(timeframe)) {
//       throw new ValidationError(`Invalid timeframe. Must be one of: ${validTimeframes.join(', ')}`);
//     }
//     const endpoint = timeframe ? `/tokens/volume/${timeframe}` : '/tokens/volume';
//     return this.request<TokenDetailResponse[]>(endpoint);
//   }

//   /**
//  * Get an overview of latest, graduating, and graduated tokens
//  * @param limit Optional limit for the number of tokens per category
//  * @returns Token overview (Memescope / Pumpvision style)
//  */
//   async getTokenOverview(limit?: number): Promise<TokenOverview> {
//     if (limit !== undefined && (!Number.isInteger(limit) || limit <= 0)) {
//       throw new ValidationError('Limit must be a positive integer');
//     }

//     const endpoint = limit ? `/tokens/multi/all?limit=${limit}` : '/tokens/multi/all';
//     return this.request<TokenOverview>(endpoint);
//   }

//   /**
//    * Get graduated tokens
//    * @returns List of graduated tokens
//    */
//   async getGraduatedTokens(): Promise<TokenDetailResponse[]> {
//     return this.request<TokenDetailResponse[]>('/tokens/multi/graduated');
//   }

//   // ======== PRICE ENDPOINTS ========

//   /**
//    * Get price information for a token
//    * @param tokenAddress The token's mint address
//    * @param priceChanges Include price change percentages
//    * @returns Price data
//    */
//   async getPrice(tokenAddress: string, priceChanges?: boolean): Promise<PriceData> {
//     this.validatePublicKey(tokenAddress, 'tokenAddress');
//     const query = priceChanges ? '&priceChanges=true' : '';
//     return this.request<PriceData>(`/price?token=${tokenAddress}${query}`);
//   }

//   /**
//    * Get historic price information for a token
//    * @param tokenAddress The token's mint address
//    * @returns Historic price data
//    */
//   async getPriceHistory(tokenAddress: string): Promise<PriceHistoryData> {
//     this.validatePublicKey(tokenAddress, 'tokenAddress');
//     return this.request<PriceHistoryData>(`/price/history?token=${tokenAddress}`);
//   }

//   /**
//    * Get price at a specific timestamp
//    * @param tokenAddress The token's mint address
//    * @param timestamp Unix timestamp
//    * @returns Price at the specified timestamp
//    */
//   async getPriceAtTimestamp(tokenAddress: string, timestamp: number): Promise<PriceTimestampData> {
//     this.validatePublicKey(tokenAddress, 'tokenAddress');
//     return this.request<PriceTimestampData>(`/price/history/timestamp?token=${tokenAddress}&timestamp=${timestamp}`);
//   }

//   /**
//    * Get lowest and highest price in a time range
//    * @param tokenAddress The token's mint address
//    * @param timeFrom Start time (unix timestamp)
//    * @param timeTo End time (unix timestamp)
//    * @returns Price range data
//    */
//   async getPriceRange(tokenAddress: string, timeFrom: number, timeTo: number): Promise<PriceRangeData> {
//     this.validatePublicKey(tokenAddress, 'tokenAddress');
//     return this.request<PriceRangeData>(`/price/history/range?token=${tokenAddress}&time_from=${timeFrom}&time_to=${timeTo}`);
//   }

//   /**
//    * Get price information for a token (POST method)
//    * @param tokenAddress The token's mint address
//    * @param priceChanges Include price change percentages
//    * @returns Price data
//    */
//   async postPrice(tokenAddress: string, priceChanges?: boolean): Promise<PriceData> {
//     this.validatePublicKey(tokenAddress, 'tokenAddress');
//     return this.request<PriceData>('/price', {
//       method: 'POST',
//       body: JSON.stringify({
//         token: tokenAddress,
//         priceChanges: priceChanges || false
//       })
//     });
//   }

//   /**
//    * Get price information for multiple tokens
//    * @param tokenAddresses Array of token addresses
//    * @param priceChanges Include price change percentages
//    * @returns Price data for multiple tokens
//    */
//   async getMultiplePrices(tokenAddresses: string[], priceChanges?: boolean): Promise<MultiPriceResponse> {
//     if (tokenAddresses.length > 100) {
//       throw new ValidationError('Maximum of 100 tokens per request');
//     }
//     tokenAddresses.forEach((addr) => this.validatePublicKey(addr, 'tokenAddress'));

//     const query = priceChanges ? '&priceChanges=true' : '';
//     return this.request<MultiPriceResponse>(`/price/multi?tokens=${tokenAddresses.join(',')}${query}`);
//   }

//   /**
//    * Get price information for multiple tokens (POST method)
//    * @param tokenAddresses Array of token addresses
//    * @param priceChanges Include price change percentages
//    * @returns Price data for multiple tokens
//    */
//   async postMultiplePrices(tokenAddresses: string[], priceChanges?: boolean): Promise<MultiPriceResponse> {
//     if (tokenAddresses.length > 100) {
//       throw new ValidationError('Maximum of 100 tokens per request');
//     }
//     tokenAddresses.forEach((addr) => this.validatePublicKey(addr, 'tokenAddress'));

//     return this.request<MultiPriceResponse>('/price/multi', {
//       method: 'POST',
//       body: JSON.stringify({
//         tokens: tokenAddresses,
//         priceChanges: priceChanges || false
//       })
//     });
//   }

//   // ======== WALLET ENDPOINTS ========

//   /**
//    * Get basic wallet information
//    * @param owner Wallet address
//    * @returns Basic wallet data
//    */
//   async getWalletBasic(owner: string): Promise<WalletBasicResponse> {
//     this.validatePublicKey(owner, 'owner');
//     return this.request<WalletBasicResponse>(`/wallet/${owner}/basic`);
//   }


//   /**
//    * Get all tokens in a wallet
//    * @param owner Wallet address
//    * @returns Detailed wallet data
//    */
//   async getWallet(owner: string): Promise<WalletResponse> {
//     this.validatePublicKey(owner, 'owner');
//     return this.request<WalletResponse>(`/wallet/${owner}`);
//   }

//   /**
//    * Get wallet tokens with pagination
//    * @param owner Wallet address
//    * @param page Page number
//    * @returns Paginated wallet data
//    */
//   async getWalletPage(owner: string, page: number): Promise<WalletResponse> {
//     this.validatePublicKey(owner, 'owner');
//     return this.request<WalletResponse>(`/wallet/${owner}/page/${page}`);
//   }

//   /**
//  * Get wallet portfolio chart data with PnL information
//  * @param wallet Wallet address
//  * @returns Wallet chart data with historical values and PnL
//  * @throws DataApiError if no data found for the wallet
//  */
//   async getWalletChart(wallet: string): Promise<WalletChartResponse> {
//     this.validatePublicKey(wallet, 'wallet');
//     return this.request<WalletChartResponse>(`/wallet/${wallet}/chart`);
//   }

//   /**
//    * Get wallet trades
//    * @param owner Wallet address
//    * @param cursor Pagination cursor
//    * @param showMeta Include token metadata
//    * @param parseJupiter Parse Jupiter swaps
//    * @param hideArb Hide arbitrage transactions
//    * @returns Wallet trades data
//    */
//   async getWalletTrades(
//     owner: string,
//     cursor?: number,
//     showMeta?: boolean,
//     parseJupiter?: boolean,
//     hideArb?: boolean
//   ): Promise<WalletTradesResponse> {
//     this.validatePublicKey(owner, 'owner');

//     const params = new URLSearchParams();
//     if (cursor) params.append('cursor', cursor.toString());
//     if (showMeta) params.append('showMeta', 'true');
//     if (parseJupiter) params.append('parseJupiter', 'true');
//     if (hideArb) params.append('hideArb', 'true');

//     const query = params.toString() ? `?${params.toString()}` : '';
//     return this.request<WalletTradesResponse>(`/wallet/${owner}/trades${query}`);
//   }

//   // ======== TRADE ENDPOINTS ========

//   /**
//    * Get trades for a token
//    * @param tokenAddress Token address
//    * @param cursor Pagination cursor
//    * @param showMeta Include token metadata
//    * @param parseJupiter Parse Jupiter swaps
//    * @param hideArb Hide arbitrage transactions
//    * @returns Token trades data
//    */
//   async getTokenTrades(
//     tokenAddress: string,
//     cursor?: number,
//     showMeta?: boolean,
//     parseJupiter?: boolean,
//     hideArb?: boolean
//   ): Promise<TradesResponse> {
//     this.validatePublicKey(tokenAddress, 'tokenAddress');

//     const params = new URLSearchParams();
//     if (cursor) params.append('cursor', cursor.toString());
//     if (showMeta) params.append('showMeta', 'true');
//     if (parseJupiter) params.append('parseJupiter', 'true');
//     if (hideArb) params.append('hideArb', 'true');

//     const query = params.toString() ? `?${params.toString()}` : '';
//     return this.request<TradesResponse>(`/trades/${tokenAddress}${query}`);
//   }

//   /**
//    * Get trades for a specific token and pool
//    * @param tokenAddress Token address
//    * @param poolAddress Pool address
//    * @param cursor Pagination cursor
//    * @param showMeta Include token metadata
//    * @param parseJupiter Parse Jupiter swaps
//    * @param hideArb Hide arbitrage transactions
//    * @returns Pool-specific token trades data
//    */
//   async getPoolTrades(
//     tokenAddress: string,
//     poolAddress: string,
//     cursor?: number,
//     showMeta?: boolean,
//     parseJupiter?: boolean,
//     hideArb?: boolean
//   ): Promise<TradesResponse> {
//     this.validatePublicKey(tokenAddress, 'tokenAddress');
//     this.validatePublicKey(poolAddress, 'poolAddress');

//     const params = new URLSearchParams();
//     if (cursor) params.append('cursor', cursor.toString());
//     if (showMeta) params.append('showMeta', 'true');
//     if (parseJupiter) params.append('parseJupiter', 'true');
//     if (hideArb) params.append('hideArb', 'true');

//     const query = params.toString() ? `?${params.toString()}` : '';
//     return this.request<TradesResponse>(`/trades/${tokenAddress}/${poolAddress}${query}`);
//   }

//   /**
//    * Get trades for a specific token, pool, and wallet
//    * @param tokenAddress Token address
//    * @param poolAddress Pool address
//    * @param owner Wallet address
//    * @param cursor Pagination cursor
//    * @param showMeta Include token metadata
//    * @param parseJupiter Parse Jupiter swaps
//    * @param hideArb Hide arbitrage transactions
//    * @returns User-specific pool trades data
//    */
//   async getUserPoolTrades(
//     tokenAddress: string,
//     poolAddress: string,
//     owner: string,
//     cursor?: number,
//     showMeta?: boolean,
//     parseJupiter?: boolean,
//     hideArb?: boolean
//   ): Promise<TradesResponse> {
//     this.validatePublicKey(tokenAddress, 'tokenAddress');
//     this.validatePublicKey(poolAddress, 'poolAddress');
//     this.validatePublicKey(owner, 'owner');

//     const params = new URLSearchParams();
//     if (cursor) params.append('cursor', cursor.toString());
//     if (showMeta) params.append('showMeta', 'true');
//     if (parseJupiter) params.append('parseJupiter', 'true');
//     if (hideArb) params.append('hideArb', 'true');

//     const query = params.toString() ? `?${params.toString()}` : '';
//     return this.request<TradesResponse>(`/trades/${tokenAddress}/${poolAddress}/${owner}${query}`);
//   }

//   /**
//    * Get trades for a specific token and wallet
//    * @param tokenAddress Token address
//    * @param owner Wallet address
//    * @param cursor Pagination cursor
//    * @param showMeta Include token metadata
//    * @param parseJupiter Parse Jupiter swaps
//    * @param hideArb Hide arbitrage transactions
//    * @returns User-specific token trades data
//    */
//   async getUserTokenTrades(
//     tokenAddress: string,
//     owner: string,
//     cursor?: number,
//     showMeta?: boolean,
//     parseJupiter?: boolean,
//     hideArb?: boolean
//   ): Promise<TradesResponse> {
//     this.validatePublicKey(tokenAddress, 'tokenAddress');
//     this.validatePublicKey(owner, 'owner');

//     const params = new URLSearchParams();
//     if (cursor) params.append('cursor', cursor.toString());
//     if (showMeta) params.append('showMeta', 'true');
//     if (parseJupiter) params.append('parseJupiter', 'true');
//     if (hideArb) params.append('hideArb', 'true');

//     const query = params.toString() ? `?${params.toString()}` : '';
//     return this.request<TradesResponse>(`/trades/${tokenAddress}/by-wallet/${owner}${query}`);
//   }

//   // ======== CHART DATA ENDPOINTS ========

//   /**
//    * Get OHLCV data for a token
//    * @param tokenAddress Token address
//    * @param type Time interval (e.g., "1s", "1m", "1h", "1d")
//    * @param timeFrom Start time (Unix timestamp in seconds)
//    * @param timeTo End time (Unix timestamp in seconds)
//    * @param marketCap Return chart for market cap instead of pricing
//    * @param removeOutliers Disable outlier removal if set to false (default: true)
//    * @returns OHLCV chart data
//    */
//   async getChartData(
//     tokenAddress: string,
//     type?: string,
//     timeFrom?: number,
//     timeTo?: number,
//     marketCap?: boolean,
//     removeOutliers?: boolean
//   ): Promise<ChartResponse> {
//     this.validatePublicKey(tokenAddress, 'tokenAddress');

//     const params = new URLSearchParams();
//     if (type) params.append('type', type);
//     if (timeFrom) params.append('time_from', timeFrom.toString());
//     if (timeTo) params.append('time_to', timeTo.toString());
//     if (marketCap) params.append('marketCap', 'true');
//     if (removeOutliers === false) params.append('removeOutliers', 'false');

//     const query = params.toString() ? `?${params.toString()}` : '';
//     return this.request<ChartResponse>(`/chart/${tokenAddress}${query}`);
//   }

//   /**
//    * Get OHLCV data for a specific token and pool
//    * @param tokenAddress Token address
//    * @param poolAddress Pool address
//    * @param type Time interval (e.g., "1s", "1m", "1h", "1d")
//    * @param timeFrom Start time (Unix timestamp in seconds)
//    * @param timeTo End time (Unix timestamp in seconds)
//    * @param marketCap Return chart for market cap instead of pricing
//    * @param removeOutliers Disable outlier removal if set to false (default: true)
//    * @returns OHLCV chart data for a specific pool
//    */
//   async getPoolChartData(
//     tokenAddress: string,
//     poolAddress: string,
//     type?: string,
//     timeFrom?: number,
//     timeTo?: number,
//     marketCap?: boolean,
//     removeOutliers?: boolean
//   ): Promise<ChartResponse> {
//     this.validatePublicKey(tokenAddress, 'tokenAddress');
//     this.validatePublicKey(poolAddress, 'poolAddress');

//     const params = new URLSearchParams();
//     if (type) params.append('type', type);
//     if (timeFrom) params.append('time_from', timeFrom.toString());
//     if (timeTo) params.append('time_to', timeTo.toString());
//     if (marketCap) params.append('marketCap', 'true');
//     if (removeOutliers === false) params.append('removeOutliers', 'false');

//     const query = params.toString() ? `?${params.toString()}` : '';
//     return this.request<ChartResponse>(`/chart/${tokenAddress}/${poolAddress}${query}`);
//   }

//   /**
//    * Get holder count chart data
//    * @param tokenAddress Token address
//    * @param type Time interval (e.g., "1s", "1m", "1h", "1d")
//    * @param timeFrom Start time (Unix timestamp in seconds)
//    * @param timeTo End time (Unix timestamp in seconds)
//    * @returns Holder count chart data
//    */
//   async getHoldersChart(
//     tokenAddress: string,
//     type?: string,
//     timeFrom?: number,
//     timeTo?: number
//   ): Promise<HoldersChartResponse> {
//     this.validatePublicKey(tokenAddress, 'tokenAddress');

//     const params = new URLSearchParams();
//     if (type) params.append('type', type);
//     if (timeFrom) params.append('time_from', timeFrom.toString());
//     if (timeTo) params.append('time_to', timeTo.toString());

//     const query = params.toString() ? `?${params.toString()}` : '';
//     return this.request<HoldersChartResponse>(`/holders/chart/${tokenAddress}${query}`);
//   }

//   // ======== PNL DATA ENDPOINTS ========

//   /**
//    * Get PnL data for all positions of a wallet
//    * @param wallet Wallet address
//    * @param showHistoricPnL Add PnL data for 1d, 7d and 30d intervals (BETA)
//    * @param holdingCheck Additional check for current holding value
//    * @param hideDetails Return only summary without data for each token
//    * @returns Wallet PnL data
//    */
//   async getWalletPnL(
//     wallet: string,
//     showHistoricPnL?: boolean,
//     holdingCheck?: boolean,
//     hideDetails?: boolean
//   ): Promise<PnLResponse> {
//     this.validatePublicKey(wallet, 'wallet');

//     const params = new URLSearchParams();
//     if (showHistoricPnL) params.append('showHistoricPnL', 'true');
//     if (holdingCheck) params.append('holdingCheck', 'true');
//     if (hideDetails) params.append('hideDetails', 'true');

//     const query = params.toString() ? `?${params.toString()}` : '';
//     return this.request<PnLResponse>(`/pnl/${wallet}${query}`);
//   }

//   /**
//    * Get the first 100 buyers of a token with PnL data
//    * @param tokenAddress Token address
//    * @returns First buyers data with PnL
//    */
//   async getFirstBuyers(tokenAddress: string): Promise<FirstBuyerData[]> {
//     this.validatePublicKey(tokenAddress, 'tokenAddress');
//     return this.request<FirstBuyerData[]>(`/first-buyers/${tokenAddress}`);
//   }

//   /**
//    * Get PnL data for a specific token in a wallet
//    * @param wallet Wallet address
//    * @param tokenAddress Token address
//    * @returns Token-specific PnL data
//    */
//   async getTokenPnL(wallet: string, tokenAddress: string): Promise<TokenPnLResponse> {
//     this.validatePublicKey(wallet, 'wallet');
//     this.validatePublicKey(tokenAddress, 'tokenAddress');
//     return this.request<TokenPnLResponse>(`/pnl/${wallet}/${tokenAddress}`);
//   }

//   // ======== TOP TRADERS ENDPOINTS ========

//   /**
//    * Get the most profitable traders across all tokens
//    * @param page Page number (optional)
//    * @param expandPnL Include detailed PnL data for each token
//    * @param sortBy Sort results by metric ("total" or "winPercentage")
//    * @returns Top traders data
//    */
//   async getTopTraders(
//     page?: number,
//     expandPnL?: boolean,
//     sortBy?: 'total' | 'winPercentage'
//   ): Promise<TopTradersResponse> {
//     const params = new URLSearchParams();
//     if (expandPnL) params.append('expandPnL', 'true');
//     if (sortBy) params.append('sortBy', sortBy);

//     const query = params.toString() ? `?${params.toString()}` : '';
//     const endpoint = page ? `/top-traders/all/${page}${query}` : `/top-traders/all${query}`;

//     return this.request<TopTradersResponse>(endpoint);
//   }

//   /**
//    * Get top 100 traders by PnL for a token
//    * @param tokenAddress Token address
//    * @returns Top traders for a specific token
//    */
//   async getTokenTopTraders(tokenAddress: string): Promise<FirstBuyerData[]> {
//     this.validatePublicKey(tokenAddress, 'tokenAddress');
//     return this.request<FirstBuyerData[]>(`/top-traders/${tokenAddress}`);
//   }

//   // ======== ADDITIONAL ENDPOINTS ========

//   /**
//    * Get detailed stats for a token over various time intervals
//    * @param tokenAddress Token address
//    * @returns Detailed token stats
//    */
//   async getTokenStats(tokenAddress: string): Promise<TokenStats> {
//     this.validatePublicKey(tokenAddress, 'tokenAddress');
//     return this.request<TokenStats>(`/stats/${tokenAddress}`);
//   }

//   /**
//    * Get detailed stats for a specific token and pool
//    * @param tokenAddress Token address
//    * @param poolAddress Pool address
//    * @returns Detailed token-pool stats
//    */
//   async getPoolStats(tokenAddress: string, poolAddress: string): Promise<TokenStats> {
//     this.validatePublicKey(tokenAddress, 'tokenAddress');
//     this.validatePublicKey(poolAddress, 'poolAddress');
//     return this.request<TokenStats>(`/stats/${tokenAddress}/${poolAddress}`);
//   }

//   /**
//  * Get current subscription information including credits, plan, and billing details
//  * @returns Subscription information
//  */
//   async getSubscription(): Promise<SubscriptionResponse> {
//     return this.request<SubscriptionResponse>('/subscription');
//   }

//   /**
//  * Get remaining API credits for the current API key
//  * @returns Credits information
//  */
//   async getCredits(): Promise<CreditsResponse> {
//     return this.request<CreditsResponse>('/credits');
//   }

//   /**
//    * Get events data for a token (all pools)
//    * NOTE: For non-live statistics, use getTokenStats() instead which is more efficient
//    * @param tokenAddress The token's mint address
//    * @returns Decoded events array
//    */
//   async getEvents(tokenAddress: string): Promise<ProcessedEvent[]> {
//     this.validatePublicKey(tokenAddress, 'tokenAddress');

//     // Make a custom request for binary data
//     const response = await fetch(`${this.baseUrl}/events/${tokenAddress}`, {
//       headers: {
//         'x-api-key': this.apiKey,
//         'Accept': 'application/octet-stream'
//       }
//     });

//     if (!response.ok) {
//       if (response.status === 429) {
//         const retryAfter = response.headers.get('Retry-After');
//         throw new RateLimitError(
//           'Rate limit exceeded',
//           retryAfter ? parseInt(retryAfter) : undefined
//         );
//       }
//       throw new DataApiError(
//         `API request failed: ${response.status} ${response.statusText}`,
//         response.status
//       );
//     }

//     const binaryData = await response.arrayBuffer();
//     const events = decodeBinaryEvents(binaryData);

//     return events;
//   }

//   /**
//    * Get events data for a specific token and pool
//    * NOTE: For non-live statistics, use getPoolStats() instead which is more efficient
//    * @param tokenAddress The token's mint address
//    * @param poolAddress The pool's address
//    * @returns Decoded events array
//    */
//   async getPoolEvents(tokenAddress: string, poolAddress: string): Promise<ProcessedEvent[]> {
//     this.validatePublicKey(tokenAddress, 'tokenAddress');
//     this.validatePublicKey(poolAddress, 'poolAddress');

//     // Make a custom request for binary data
//     const response = await fetch(`${this.baseUrl}/events/${tokenAddress}/${poolAddress}`, {
//       headers: {
//         'x-api-key': this.apiKey,
//         'Accept': 'application/octet-stream'
//       }
//     });

//     if (!response.ok) {
//       if (response.status === 429) {
//         const retryAfter = response.headers.get('Retry-After');
//         throw new RateLimitError(
//           'Rate limit exceeded',
//           retryAfter ? parseInt(retryAfter) : undefined
//         );
//       }
//       throw new DataApiError(
//         `API request failed: ${response.status} ${response.statusText}`,
//         response.status
//       );
//     }

//     const binaryData = await response.arrayBuffer();
//     const events = decodeBinaryEvents(binaryData);

//     return events;
//   }
// }

// // Import the interfaces from your main interfaces file
// import { ProcessedEvent, ProcessedStats, TimeframeStats } from './interfaces';

// const timeframes = {
//   "1m": { time: 60 },
//   "5m": { time: 300 },
//   "15m": { time: 900 },
//   "30m": { time: 1800 },
//   "1h": { time: 3600 },
//   "2h": { time: 7200 },
//   "3h": { time: 10800 },
//   "4h": { time: 14400 },
//   "5h": { time: 18000 },
//   "6h": { time: 21600 },
//   "12h": { time: 43200 },
//   "24h": { time: 86400 },
// };

// // Pre-calculate timeframe boundaries for faster lookup
// const timeframeBoundaries = Object.entries(timeframes).map(([key, value]) => ({
//   key,
//   seconds: value.time
// })).sort((a, b) => a.seconds - b.seconds);

// /**
//  * Decode binary data into events array
//  * @param binaryData The binary data to decode
//  * @returns Array of decoded events
//  */
// export function decodeBinaryEvents(binaryData: ArrayBuffer | Uint8Array): ProcessedEvent[] {
//   const data = binaryData instanceof ArrayBuffer ? new Uint8Array(binaryData) : binaryData;
//   const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
//   let offset = 0;

//   const walletCount = view.getUint32(offset, true);
//   offset += 4;

//   const wallets: string[] = [];
//   for (let i = 0; i < walletCount; i++) {
//     const length = view.getUint8(offset++);
//     const walletBytes = data.slice(offset, offset + length);
//     const wallet = new TextDecoder().decode(walletBytes);
//     wallets.push(wallet);
//     offset += length;
//   }

//   const tradeCount = view.getUint32(offset, true);
//   offset += 4;

//   const events: ProcessedEvent[] = [];
//   for (let i = 0; i < tradeCount; i++) {
//     const walletIndex = view.getUint32(offset, true);
//     const amount = view.getFloat32(offset + 4, true);
//     const priceUsd = view.getFloat32(offset + 8, true);
//     const volume = view.getFloat32(offset + 12, true);
//     const typeCode = view.getUint8(offset + 16);
//     const timeInSeconds = view.getUint32(offset + 17, true);

//     events.push({
//       wallet: wallets[walletIndex],
//       amount: amount,
//       priceUsd: priceUsd,
//       volume: volume,
//       type: typeCode === 0 ? 'buy' : 'sell',
//       time: timeInSeconds * 1000
//     });

//     offset += 21;
//   }

//   return events;
// }

// /**
//  * Process events synchronously
//  * @param binaryData Binary data or decoded events array
//  * @returns Processed statistics by timeframe
//  */
// export function processEvents(binaryData: ArrayBuffer | Uint8Array | ProcessedEvent[]): ProcessedStats {
//   let events: ProcessedEvent[];
//   if (binaryData instanceof ArrayBuffer || binaryData instanceof Uint8Array) {
//     events = decodeBinaryEvents(binaryData);
//   } else if (Array.isArray(binaryData)) {
//     events = binaryData;
//   } else {
//     throw new Error('Invalid input: expected binary data or events array');
//   }

//   if (events.length === 0) return {};

//   const currentPrice = parseFloat(events[0].priceUsd.toString());
//   const currentTimestamp = Date.now() / 1000;

//   // Initialize stats structure
//   const stats: Record<string, any> = {};
//   timeframeBoundaries.forEach(({ key }) => {
//     stats[key] = {
//       buys: 0,
//       sells: 0,
//       buyVolume: 0,
//       sellVolume: 0,
//       buyers: new Map<string, boolean>(),
//       sellers: new Map<string, boolean>(),
//       totalTransactions: 0,
//       totalVolume: 0,
//       totalWallets: new Map<string, boolean>(),
//       initialPrice: 0,
//       lastPrice: 0,
//       hasData: false
//     };
//   });

//   // Single pass through events
//   for (let i = 0; i < events.length; i++) {
//     const event = events[i];
//     const { time: timestamp, type, volume, wallet, priceUsd } = event;
    
//     if (type !== "buy" && type !== "sell") continue;
    
//     const eventTime = timestamp / 1000;
//     const timeDiff = currentTimestamp - eventTime;

//     // Find applicable timeframes
//     for (let j = 0; j < timeframeBoundaries.length; j++) {
//       const { key, seconds } = timeframeBoundaries[j];
      
//       if (timeDiff > seconds) continue;
      
//       const period = stats[key];
      
//       if (!period.hasData) {
//         period.initialPrice = parseFloat(priceUsd.toString());
//         period.hasData = true;
//       }

//       period.totalTransactions++;
//       period.totalVolume += parseFloat(volume.toString() || '0');
//       period.totalWallets.set(wallet, true);
//       period.lastPrice = parseFloat(priceUsd.toString());

//       if (type === "buy") {
//         period.buys++;
//         period.buyVolume += parseFloat(volume.toString() || '0');
//         period.buyers.set(wallet, true);
//       } else {
//         period.sells++;
//         period.sellVolume += parseFloat(volume.toString() || '0');
//         period.sellers.set(wallet, true);
//       }
//     }
//   }

//   // Transform final stats
//   const sortedStats: ProcessedStats = {};
//   Object.keys(timeframes).forEach((timeframe) => {
//     const period = stats[timeframe];
    
//     if (!period.hasData) return;
    
//     const priceChangePercent = period.initialPrice > 0 
//       ? 100 * ((currentPrice - period.lastPrice) / period.lastPrice)
//       : 0;

//     const timeframeStats: TimeframeStats = {
//       buyers: period.buyers.size,
//       sellers: period.sellers.size,
//       volume: {
//         buys: period.buyVolume,
//         sells: period.sellVolume,
//         total: period.totalVolume,
//       },
//       transactions: period.totalTransactions,
//       buys: period.buys,
//       sells: period.sells,
//       wallets: period.totalWallets.size,
//       price: period.initialPrice,
//       priceChangePercentage: priceChangePercent,
//     };

//     sortedStats[timeframe as keyof ProcessedStats] = timeframeStats;
//   });

//   return sortedStats;
// }

// /**
//  * Process events asynchronously in chunks
//  * @param binaryData Binary data or decoded events array
//  * @param onProgress Optional progress callback
//  * @returns Processed statistics by timeframe
//  */
// export async function processEventsAsync(
//   binaryData: ArrayBuffer | Uint8Array | ProcessedEvent[], 
//   onProgress?: (progress: number) => void
// ): Promise<ProcessedStats> {
//   let events: ProcessedEvent[];
//   if (binaryData instanceof ArrayBuffer || binaryData instanceof Uint8Array) {
//     events = decodeBinaryEvents(binaryData);
//   } else if (Array.isArray(binaryData)) {
//     events = binaryData;
//   } else {
//     throw new Error('Invalid input: expected binary data or events array');
//   }

//   if (events.length === 0) return {};

//   const CHUNK_SIZE = 100000;
//   const currentPrice = parseFloat(events[0].priceUsd.toString());
//   const currentTimestamp = Date.now() / 1000;

//   // Initialize stats
//   const stats: Record<string, any> = {};
//   timeframeBoundaries.forEach(({ key }) => {
//     stats[key] = {
//       buys: 0,
//       sells: 0,
//       buyVolume: 0,
//       sellVolume: 0,
//       buyers: new Map<string, boolean>(),
//       sellers: new Map<string, boolean>(),
//       totalTransactions: 0,
//       totalVolume: 0,
//       totalWallets: new Map<string, boolean>(),
//       initialPrice: 0,
//       lastPrice: 0,
//       hasData: false
//     };
//   });

//   // Process in chunks
//   for (let chunk = 0; chunk < events.length; chunk += CHUNK_SIZE) {
//     await new Promise<void>(resolve => {
//       setTimeout(() => {
//         const end = Math.min(chunk + CHUNK_SIZE, events.length);
        
//         for (let i = chunk; i < end; i++) {
//           const event = events[i];
//           const { time: timestamp, type, volume, wallet, priceUsd } = event;
          
//           if (type !== "buy" && type !== "sell") continue;
          
//           const eventTime = timestamp / 1000;
//           const timeDiff = currentTimestamp - eventTime;

//           for (let j = 0; j < timeframeBoundaries.length; j++) {
//             const { key, seconds } = timeframeBoundaries[j];
            
//             if (timeDiff > seconds) continue;
            
//             const period = stats[key];
            
//             if (!period.hasData) {
//               period.initialPrice = parseFloat(priceUsd.toString());
//               period.hasData = true;
//             }

//             period.totalTransactions++;
//             period.totalVolume += parseFloat(volume.toString() || '0');
//             period.totalWallets.set(wallet, true);
//             period.lastPrice = parseFloat(priceUsd.toString());

//             if (type === "buy") {
//               period.buys++;
//               period.buyVolume += parseFloat(volume.toString() || '0');
//               period.buyers.set(wallet, true);
//             } else {
//               period.sells++;
//               period.sellVolume += parseFloat(volume.toString() || '0');
//               period.sellers.set(wallet, true);
//             }
//           }
//         }

//         if (onProgress) {
//           onProgress((end / events.length) * 100);
//         }

//         resolve();
//       }, 0);
//     });
//   }

//   // Transform final stats
//   const sortedStats: ProcessedStats = {};
//   Object.keys(timeframes).forEach((timeframe) => {
//     const period = stats[timeframe];
    
//     if (!period.hasData) return;
    
//     const priceChangePercent = period.initialPrice > 0 
//       ? 100 * ((currentPrice - period.lastPrice) / period.lastPrice)
//       : 0;

//     const timeframeStats: TimeframeStats = {
//       buyers: period.buyers.size,
//       sellers: period.sellers.size,
//       volume: {
//         buys: period.buyVolume,
//         sells: period.sellVolume,
//         total: period.totalVolume,
//       },
//       transactions: period.totalTransactions,
//       buys: period.buys,
//       sells: period.sells,
//       wallets: period.totalWallets.size,
//       price: period.initialPrice,
//       priceChangePercentage: priceChangePercent,
//     };

//     sortedStats[timeframe as keyof ProcessedStats] = timeframeStats;
//   });

//   return sortedStats;
// }

// // Export main class and interfaces
// export { Client, DataApiError, RateLimitError, ValidationError } from './data-api';
// export type { DataApiConfig } from './data-api';

// // Export Datastream for real-time updates
// export { 
//   Datastream, 
//   DatastreamRoom,
//   type DatastreamConfig,
//   type PriceUpdate,
//   type TokenTransaction,
//   type PoolUpdate,
//   type HolderUpdate,
//   type WalletTransaction,
//   type TokenMetadata
// } from './datastream';

// // Export all interfaces
// export * from './interfaces';

// // Export all interfaces
// export * from './event-processor';

// /**
//  * WebSocket polyfill for Node.js environments
//  */

// declare global {
//     interface Window {
//       WebSocket: typeof WebSocket;
//     }
//   }
  
//   // Check if we're in a browser or Node.js environment
//   const isBrowser = typeof window !== 'undefined' && typeof window.WebSocket !== 'undefined';
  
//   if (!isBrowser) {
//     try {
//       // Try to load the ws package
//       const WebSocketImpl = require('ws');
      
//       // Create a global WebSocket variable that matches the browser API
//       if (typeof global !== 'undefined' && !global.WebSocket) {
//         // @ts-ignore - Adding WebSocket to global
//         global.WebSocket = WebSocketImpl;
//       }
//     } catch (e) {
//       console.warn(
//         'WebSocket implementation not found. If you are using Node.js, please install the "ws" package: npm install ws'
//       );
//     }
//   }
  
//   export {};

//   {
//     "name": "@solana-tracker/data-api",
//     "version": "0.0.7",
//     "description": "Official Solana Tracker Data API client for accessing Solana Data",
//     "main": "dist/index.js",
//     "module": "dist/index.mjs",
//     "types": "dist/index.d.ts",
//     "exports": {
//         ".": {
//             "import": "./dist/index.mjs",
//             "require": "./dist/index.js",
//             "types": "./dist/index.d.ts"
//         }
//     },
//     "scripts": {
//          "build": "tsup src/index.ts --format esm,cjs --dts",
//         "prepublishOnly": "npm run build"
//     },
//     "keywords": [
//         "solana",
//         "blockchain",
//         "data-api",
//         "crypto",
//         "solanatracker",
//         "tokens",
//         "market-data",
//         "pumpfun",
//         "raydium"
//     ],
//     "author": "Solana Tracker <contact@solana-tracker.io>",
//     "license": "MIT",
//     "repository": {
//         "type": "git",
//         "url": "git+https://github.com/solanatracker/data-api-sdk.git"
//     },
//     "bugs": {
//         "url": "https://github.com/solanatracker/data-api-sdk/issues"
//     },
//     "homepage": "https://www.solanatracker.io/data-api",
//     "dependencies": {
//         "node-fetch": "^3.3.2"
//     },
//     "optionalDependencies": {
//         "ws": "^8.16.0"
//     },
//     "devDependencies": {
//         "@types/jest": "^29.5.12",
//         "@types/node": "^20.11.30",
//         "@typescript-eslint/eslint-plugin": "^7.4.0",
//         "@typescript-eslint/parser": "^7.4.0",
//         "eslint": "^8.57.0",
//         "jest": "^29.7.0",
//         "prettier": "^3.2.5",
//         "ts-jest": "^29.1.2",
//         "tsup": "^8.4.0",
//         "typescript": "^5.4.3"
//     },
//     "engines": {
//         "node": ">=14.0.0"
//     },
//     "files": [
//         "dist/**/*",
//         "README.md",
//         "LICENSE"
//     ]
// }






// {
//     "compilerOptions": {
//       "target": "es2018",
//       "module": "commonjs",
//       "declaration": true,
//       "outDir": "./dist",
//       "rootDir": "./src",
//       "strict": true,
//       "esModuleInterop": true,
//       "skipLibCheck": true,
//       "forceConsistentCasingInFileNames": true
//     },
//     "include": ["src/**/*"],
//     "exclude": ["node_modules", "dist", "examples"]
//   }


