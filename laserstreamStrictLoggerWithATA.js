const fs = require("fs");
const { subscribe, CommitmentLevel, decodeSubscribeUpdate } = require('helius-laserstream');

// --- CONFIG ---
const config = require('./config.js');
const LASERSTREAM_GRPC_URL = config.LASERSTREAM_GRPC_URL || "https://laserstream-mainnet-sgp.helius-rpc.com";

// Active traders from traders.json
const ACTIVE_TRADERS = [
  { name: "H", wallet: "Av3xWHJ5EsoLZag6pr7LKbrGgLRTaykXomDD5kBhL9YQ" },
  { name: "oz", wallet: "DZAa55HwXgv5hStwaTEJGXZz1DhHejvpb7Yr762urXam" }
];

const TEMP_FILE = "strict-swaps.json";

// All DEX/Router Program IDs from config.js
const DEX_PROGRAM_IDS = new Set([
  // Pump.fun
  "6EF8rrecthR5DkVaGFKLkma4YkdrkvPPHoqUPLQkwQjR", // Pump.fun Program ID
  "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P", // Pump.fun Program ID Variant
  "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA", // Pump.fun AMM Program ID
  "4wTV1YmiEkRvAtNtsSGPtUrqRYQMe5SKy2uB4JCNsSNk", // Pump.fun Global
  "CebN5WGQ4jvEPvsVU4EoHEpgzq1VV7AbicfhtW4xC9iM", // Pump.fun Fee Recipient
  
  // Raydium
  "675kPX9MHTjS2zt1qFR1UARY7hdK2uQDchjADx1Z1gkv", // Raydium V4
  "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8", // Raydium AMM V4
  "LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj", // Raydium Launchpad
  "CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C", // Raydium CPMM
  "CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK", // Raydium CLMM
  
  // Meteora
  "LBUZKhRxPF3XUpBCjp4TbnHErfpSA1Nk1ixL2SAH2xM", // Meteora DLMM
  "dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN", // Meteora DBC
  "DBCFiGetD2C2s9w2b1G9dwy2J2B6Jq2mRGuo1S4t61d", // Meteora DBC
  "CPAMdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG", // Meteora CP AMM
  
  // Jupiter & Others
  "JUP6LwwmjhEGGjp4tfXXFW2uJTkV5WkxSfCSsFUxXH5", // Jupiter Aggregator
  "BSfD6SHZigAfDWSjzD5Q41jw8LmKwtmjskPH9XW1mrRW", // Photon
  "AxiomfHaWDemCFBLBayqnEnNwE6b7B2Qz3UmzMpgbMG6", // Axiom
  "AxiomxSitiyXyPjKgJ9XSrdhsydtZsskZTEDam3PxKcC", // Axiom
  "srmqPvymJeFKQ4zGQed1GFppgkRHL9kaELCbyksJtPX", // OpenBook
  "srmq2Vp3e2wBq3dDDjWM9t48Xm21S2Jd2eBE4Pj4u7d", // OpenBook V3
  "whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc", // Whirlpool
  "F5tfvbLog9VdGUPqBDTT8rgXvTTcq7e5UiGnupL1zvBq"  // Custom Router
]);

// Associated Token Program ID (for ATA creation detection)
const ASSOCIATED_TOKEN_PROGRAM_ID = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";

// --- Strict Trade Filter (ATA allowed) ---
function isStrictSwap(swapData) {
  if (!swapData) return false;

  // Extract program IDs from the swap data
  const programIds = swapData.programIds || [];

  // Must include known DEX/Router programs (from config.js)
  const hasSwapProgram = programIds.some(id => DEX_PROGRAM_IDS.has(id));
  
  if (!hasSwapProgram) return false;

  // Must involve SOL spent (positive change in lamports = SOL spent)
  const solSpent = swapData.solChange && swapData.solChange > 0;

  // Must receive a token or have token transfers
  const tokenReceived = swapData.tokenTransfers && swapData.tokenTransfers.length > 0;

  // Log for debugging
  console.log(`🔍 Checking swap: SOL spent: ${solSpent}, Token received: ${tokenReceived}, Programs: ${programIds.join(', ')}`);

  return solSpent && tokenReceived;
}

// --- Save to JSON ---
function saveStrictSwap(data) {
  let json = [];
  if (fs.existsSync(TEMP_FILE)) {
    json = JSON.parse(fs.readFileSync(TEMP_FILE));
  }
  json.push(data);
  fs.writeFileSync(TEMP_FILE, JSON.stringify(json, null, 2));
  console.log("✅ Logged strict swap:", data.signature);
}

// --- Start LaserStream gRPC ---
async function startLaserStream() {
  console.log("🔌 Connecting to LaserStream gRPC...");
  console.log("📍 Endpoint:", LASERSTREAM_GRPC_URL);
  
  try {
    // Get wallets to monitor
    const walletsToMonitor = ACTIVE_TRADERS.map(trader => trader.wallet);
    
    // Get major DEX programs to monitor
    const majorPrograms = [
      "6EF8rrecthR5DkVaGFKLkma4YkdrkvPPHoqUPLQkwQjR", // Pump.fun
      "675kPX9MHTjS2zt1qFR1UARY7hdK2uQDchjADx1Z1gkv", // Raydium V4
      "JUP6LwwmjhEGGjp4tfXXFW2uJTkV5WkxSfCSsFUxXH5", // Jupiter
      "BSfD6SHZigAfDWSjzD5Q41jw8LmKwtmjskPH9XW1mrRW", // Photon
      "F5tfvbLog9VdGUPqBDTT8rgXvTTcq7e5UiGnupL1zvBq"  // Custom Router
    ];
    
    console.log(`📡 Monitoring ${walletsToMonitor.length} trader wallets and ${majorPrograms.length} DEX programs...`);
    
    // Configure LaserStream gRPC connection
    const laserstreamConfig = {
      apiKey: config.HELIUS_API_KEY,
      endpoint: LASERSTREAM_GRPC_URL,
      maxReconnectAttempts: 15,
      channelOptions: {
        'grpc.max_send_message_length': 64 * 1024 * 1024,      // 64MB
        'grpc.max_receive_message_length': 100 * 1024 * 1024,  // 100MB
        'grpc.keepalive_time_ms': 20000,           // Ping every 20s
        'grpc.keepalive_timeout_ms': 10000,        // Wait 10s for response
        'grpc.keepalive_permit_without_calls': 1,  // Send pings even when idle
        'grpc.http2.min_time_between_pings_ms': 15000,
        'grpc.http2.write_buffer_size': 1024 * 1024,           // 1MB write buffer
        'grpc-node.max_session_memory': 64 * 1024 * 1024,      // 64MB session memory
        'grpc.initial_stream_window_size': 16 * 1024 * 1024,   // 16MB stream window
        'grpc.initial_connection_window_size': 32 * 1024 * 1024, // 32MB connection window
      }
    };
    
    if (!laserstreamConfig.apiKey) {
      const errorMsg = "Cannot subscribe: HELIUS_API_KEY is missing.";
      console.error(`❌ ${errorMsg}`);
      return;
    }
    
    // Create subscription request matching the working LaserStreamManager exactly
    const subscriptionRequest = {
      // Monitor specific trader accounts for balance changes
      accounts: {
        "trader-accounts": {
          account: walletsToMonitor,
          owner: [],
          filters: []
        }
      },
      // Monitor transactions involving trader wallets (exact match to working version)
      transactions: { 
        "copy-trade-detection": { 
          accountRequired: walletsToMonitor, 
          vote: false,
          failed: false,
          accountInclude: [], // Include all accounts in transaction
          accountExclude: []  // Don't exclude any accounts
        }
      },
      // Get transaction status updates
      transactionsStatus: {
        "trade-confirmation": {
          accountRequired: walletsToMonitor
        }
      },
      commitment: CommitmentLevel.PROCESSED,
      // Enhanced data slicing for quick analysis
      accountsDataSlice: [
        {
          offset: 0,   // Start of account data
          length: 128  // First 128 bytes for quick token/balance analysis
        }
      ]
    };
    
    console.log(`🔧 Using gRPC subscription with raw data extraction`);
    
    // Enhanced callback with raw data processing
    const streamCallback = (rawUpdateData) => {
      try {
        // The data is already decoded by the LaserStream library
        const update = rawUpdateData;
        
        console.log('📡 Received gRPC update:', {
          hasTransaction: !!update.transaction,
          hasAccount: !!update.account,
          hasTransactionStatus: !!update.transactionStatus,
          filters: update.filters,
          slot: update.slot
        });
        
        // Handle different types of updates
        if (update.transaction) {
          console.log('🎯 Processing transaction update');
          processTransactionUpdate(update);
        } else if (update.transactionStatus) {
          console.log('📊 Processing transaction status update');
          processTransactionStatusUpdate(update);
        } else if (update.account) {
          console.log('💰 Processing account update');
          processAccountUpdate(update);
        }
        
      } catch (processError) {
        console.error('❌ Error processing gRPC update:', processError);
      }
    };
    
    // Start the gRPC subscription
    const stream = await subscribe(
      laserstreamConfig, 
      subscriptionRequest, 
      streamCallback
    );
    
    console.log(`✅ LaserStream gRPC connected successfully. Stream ID: ${stream.id}`);

    } catch (error) {
    const errorMsg = `Failed to connect to LaserStream gRPC: ${error.message || error}`;
    console.error(`❌ ${errorMsg}`);
    
    // Attempt to reconnect after 5 seconds
    setTimeout(() => {
      console.log("🔄 Attempting to reconnect...");
      startLaserStream();
    }, 5000);
  }

  // Process transaction updates from gRPC
  function processTransactionUpdate(updateData) {
    try {
      const transactionData = updateData.transaction;
      if (!transactionData) return;
      
      console.log(`📡 Transaction update received: ${transactionData.signature}`);
      
      // Check if this transaction involves any of our active traders
      const accountKeys = transactionData.transaction?.message?.accountKeys || [];
      const involvedTrader = ACTIVE_TRADERS.find(trader => 
        accountKeys.includes(trader.wallet)
      );
      
      if (involvedTrader) {
        console.log(`🎯 Found transaction involving trader ${involvedTrader.name}: ${transactionData.signature}`);
        
        // Extract transaction details
        const tx = transactionData.transaction;
        const meta = transactionData.meta;
        
        if (tx && meta) {
          // Extract program IDs from both regular and versioned transactions
          let programIds = [];
          
          if (tx.message?.instructions) {
            // Regular transaction
            programIds = tx.message.instructions.map(ix => ix.programId?.toString());
          } else if (tx.message?.compiledInstructions) {
            // Versioned transaction - need to get all account keys
            const allAccountKeys = [...(tx.message.staticAccountKeys || [])];
            
            // Add loaded addresses if they exist
            if (meta.loadedAddresses) {
              if (meta.loadedAddresses.writable) {
                allAccountKeys.push(...meta.loadedAddresses.writable);
              }
              if (meta.loadedAddresses.readonly) {
                allAccountKeys.push(...meta.loadedAddresses.readonly);
              }
            }
            
            programIds = tx.message.compiledInstructions.map(ix => {
              const programId = allAccountKeys[ix.programIdIndex];
              return programId ? programId.toString() : 'unknown';
            });
          }
          
          // Check if this is a swap transaction
          const swapData = {
            signature: transactionData.signature,
            trader: involvedTrader.name,
            traderWallet: involvedTrader.wallet,
            programIds: programIds,
            solChange: meta.postBalances?.[0] - meta.preBalances?.[0] || 0,
            tokenTransfers: meta.preTokenBalances || [],
            ataCreated: programIds.includes(ASSOCIATED_TOKEN_PROGRAM_ID),
            timestamp: Date.now(),
            rawData: transactionData
          };
          
          console.log(`🔍 Checking swap data:`, {
            signature: swapData.signature,
            trader: swapData.trader,
            programIds: swapData.programIds,
            solChange: swapData.solChange,
            hasInstructions: tx.message?.instructions?.length || 0
          });
          
          // Check if this is a valid swap
          if (isStrictSwap(swapData)) {
            saveStrictSwap(swapData);
          } else {
            console.log(`❌ Transaction failed strict swap filter`);
          }
        }
      } else {
        console.log(`👀 Transaction not involving any active traders: ${transactionData.signature}`);
      }
    } catch (error) {
      console.error("❌ Error processing transaction update:", error.message);
    }
  }

  // Process account updates from gRPC
  function processAccountUpdate(updateData) {
    try {
      const accountData = updateData.account;
      if (!accountData) return;
      
      console.log(`💰 Account update received for wallet: ${accountData.account.pubkey.toString('base64')}`);
      
      // Check if this is one of our monitored traders
      const traderWallet = Buffer.from(accountData.account.pubkey).toString('base64');
      const involvedTrader = ACTIVE_TRADERS.find(trader => 
        trader.wallet === traderWallet || 
        Buffer.from(trader.wallet, 'base64').equals(accountData.account.pubkey)
      );
      
      if (involvedTrader) {
        console.log(`🎯 Account update for trader ${involvedTrader.name}: ${accountData.account.lamports} lamports`);
        // Account updates show balance changes but don't contain transaction details
        // We rely on transaction updates for DEX trade detection
      }
    } catch (error) {
      console.error("❌ Error processing account update:", error.message);
    }
  }

  // Process transaction status updates from gRPC
  function processTransactionStatusUpdate(updateData) {
    try {
      const statusData = updateData.transactionStatus;
      if (!statusData) return;
      
      console.log(`📊 Transaction status update: ${statusData.signature}`);
      // Transaction status updates show if transactions succeeded/failed
      // We can use this to filter out failed transactions
    } catch (error) {
      console.error("❌ Error processing transaction status update:", error.message);
    }
  }
}

// --- MAIN ---
console.log(`🚀 Starting LaserStream Strict Logger for ${ACTIVE_TRADERS.length} active traders`);
ACTIVE_TRADERS.forEach(trader => {
  console.log(`   📍 ${trader.name}: ${trader.wallet}`);
});
console.log(`📁 Output file: ${TEMP_FILE}`);
console.log(`🔍 Monitoring ${DEX_PROGRAM_IDS.size} DEX/Router programs...`);

// Add heartbeat to show the script is working
setInterval(() => {
  console.log(`💓 Heartbeat: ${new Date().toISOString()} - Monitoring active`);
}, 30000); // Every 30 seconds

// Start the gRPC LaserStream connection
startLaserStream().catch(error => {
  console.error('❌ Failed to start LaserStream:', error);
  process.exit(1);
});
