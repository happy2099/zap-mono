// import { 
//   subscribe, 
//   CommitmentLevel, 
//   SubscribeUpdate, 
//   SubscribeUpdateAccount,
//   SubscribeUpdateAccountInfo,
//   LaserstreamConfig 
// } from '../client';
// import * as bs58 from 'bs58';
// const credentials = require('../test-config');

// async function main() {
//   console.log('🏦 Laserstream Account Subscription Example');

//   const config: LaserstreamConfig = {
//     apiKey: credentials.laserstreamProduction.apiKey,
//     endpoint: credentials.laserstreamProduction.endpoint,
//   };

//   const request = {
//     accounts: {
//       "all-accounts": {
//         account: [],
//         owner: [],
//         filters: []
//       }
//     },
//     commitment: CommitmentLevel.PROCESSED,
//     slots: {},
//     transactions: {},
//     transactionsStatus: {},
//     blocks: {},
//     blocksMeta: {},
//     entry: {},
//     accountsDataSlice: [],
//   };

//   const stream = await subscribe(
//     config,
//     request,
//     async (update: SubscribeUpdate) => {
//       if (update.account) {
//         const accountUpdate: SubscribeUpdateAccount = update.account;
//         console.log('\n🏦 Account Update Received!');
//         console.log('  - Slot:', accountUpdate.slot);
//         console.log('  - Is Startup:', accountUpdate.isStartup);
        
//         if (accountUpdate.account) {
//           const accountInfo: SubscribeUpdateAccountInfo = accountUpdate.account;
//           console.log('  - Account Info:');
//           console.log('    - Pubkey:', accountInfo.pubkey ? bs58.encode(accountInfo.pubkey) : 'N/A');
//           console.log('    - Lamports:', accountInfo.lamports);
//           console.log('    - Owner:', accountInfo.owner ? bs58.encode(accountInfo.owner) : 'N/A');
//           console.log('    - Executable:', accountInfo.executable);
//           console.log('    - Rent Epoch:', accountInfo.rentEpoch);
//           console.log('    - Data Length:', accountInfo.data ? accountInfo.data.length : 0);
//           console.log('    - Write Version:', accountInfo.writeVersion);
//           console.log('    - Txn Signature:', accountInfo.txnSignature ? bs58.encode(accountInfo.txnSignature) : 'N/A');
//         }
//       }
//     },
//     async (err) => console.error('❌ Stream error:', err)
//   );

//   console.log(`✅ Account subscription started (id: ${stream.id})`);
// }

// main().catch(console.error); 


// import { subscribe, CommitmentLevel, SubscribeUpdate, LaserstreamConfig } from '../client';
// const credentials = require('../test-config');

// async function main() {
//   console.log('🔍 LaserStream Accounts Data Slice Subscription Example');

//   const config: LaserstreamConfig = {
//     apiKey: credentials.laserstreamProduction.apiKey,
//     endpoint: credentials.laserstreamProduction.endpoint,
//   };

//   const request = {
//     accounts: {
//       "spl-token-accounts": {
//         account: [],
//         owner: ["TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"], // SPL Token program
//         filters: []
//       }
//     },
//     accountsDataSlice: [
//       {
//         offset: 0,   // Start of account data
//         length: 64   // First 64 bytes (mint + authority info)
//       }
//     ],
//     commitment: CommitmentLevel.PROCESSED,
//     slots: {},
//     transactions: {},
//     transactionsStatus: {},
//     blocks: {},
//     blocksMeta: {},
//     entry: {},
//   };

//   const stream = await subscribe(
//     config,
//     request,
//     async (update: SubscribeUpdate) => {
//       console.log(update);
//     },
//     async (err) => console.error('❌ Stream error:', err)
//   );

//   console.log(`✅ Accounts data slice subscription started (id: ${stream.id})`);
// }

// main().catch(console.error); 

// import { 
//   subscribe, 
//   CommitmentLevel, 
//   SubscribeUpdate,
//   SubscribeUpdateBlockMeta,
//   LaserstreamConfig 
// } from '../client';
// const credentials = require('../test-config');

// async function main() {
//   console.log('🏗️ Laserstream Block Meta Subscription Example');

//   const config: LaserstreamConfig = {
//     apiKey: credentials.laserstreamProduction.apiKey,
//     endpoint: credentials.laserstreamProduction.endpoint,
//   };

//   const request = {
//     blocksMeta: {
//       "all-block-meta": {}
//     },
//     commitment: CommitmentLevel.PROCESSED,
//     // Empty objects for unused subscription types
//     accounts: {},
//     slots: {},
//     transactions: {},
//     transactionsStatus: {},
//     blocks: {},
//     entry: {},
//     accountsDataSlice: [],
//   };

//   // Client handles disconnections automatically:
//   // - Reconnects on network issues
//   // - Resumes from last processed slot
//   // - Maintains subscription state
//   const stream = await subscribe(
//     config,
//     request,
//     async (update: SubscribeUpdate) => {
//       if (update.blockMeta) {
//         const blockMeta: SubscribeUpdateBlockMeta = update.blockMeta;
//         console.log('\n🏗️ Block Meta Update Received!');
//         console.log('  - Slot:', blockMeta.slot);
//         console.log('  - Blockhash:', blockMeta.blockhash);
//         console.log('  - Parent Slot:', blockMeta.parentSlot);
//         console.log('  - Parent Blockhash:', blockMeta.parentBlockhash);
//         console.log('  - Block Height:', blockMeta.blockHeight?.blockHeight || 'N/A');
//         console.log('  - Block Time:', blockMeta.blockTime?.timestamp || 'N/A');
//         console.log('  - Executed Transaction Count:', blockMeta.executedTransactionCount);
//         console.log('  - Rewards:', blockMeta.rewards?.rewards?.length || 0);
//       }
//     },
//     async (error: any) => {
//       console.error('❌ Stream error:', error);
//     }
//   );

//   console.log(`✅ Block Meta subscription started with ID: ${stream.id}`);

//   // Cleanup on exit
//   process.on('SIGINT', () => {
//     console.log('\n🛑 Cancelling stream...');
//     stream.cancel();
//     process.exit(0);
//   });
// }

// main().catch(console.error); 

// import { subscribe, CommitmentLevel, LaserstreamConfig, CompressionAlgorithms } from '../client';
// const cfg = require('../test-config');

// async function main() {
//   const config: LaserstreamConfig = {
//     apiKey: cfg.laserstreamProduction.apiKey,
//     endpoint: cfg.laserstreamProduction.endpoint,
//     channelOptions: {
//       'grpc.default_compression_algorithm': CompressionAlgorithms.gzip,  // Try gzip instead
//       'grpc.default_compression_level': 'high',  // High compression level
//     },
//   };

//   const request = {
//     blocks: {
//       "client": {
//         accountInclude: [],
//         includeTransactions: false,
//         includeAccounts: false,
//         includeEntries: false
//       }
//     },
//     commitment: CommitmentLevel.CONFIRMED,
//     accounts: {},
//     slots: {},
//     transactions: {},
//     transactionsStatus: {},
//     blocksMeta: {},
//     entry: {},
//     accountsDataSlice: [],
//   };

//   await subscribe(
//     config,
//     request,
//     async (update) => {
//       if (update.block) {
//         console.log(`Block: ${update.block.slot}`);
//       }
//     },
//     async (error) => {
//       console.error('Error:', error);
//     }
//   );

//   // Keep alive
//   await new Promise(() => {});
// }

// main().catch(console.error); 

// import { subscribe, CommitmentLevel, SubscribeUpdate, StreamHandle, LaserstreamConfig, ChannelOptions } from '../client';

// const credentials = require('../test-config');

// async function main() {
//   console.log('⚙️  Laserstream Channel Options Example');

//   // Custom channel options
//   const channelOptions: ChannelOptions = {
//     // Connection timeouts
//     connectTimeoutSecs: 20,              // 20 seconds instead of default 10
//     timeoutSecs: 60,                     // 60 seconds instead of default 30
    
//     // Message size limits
//     maxDecodingMessageSize: 2000000000,  // 2GB instead of default 1GB
//     maxEncodingMessageSize: 64000000,    // 64MB instead of default 32MB
    
//     // Keep-alive settings
//     http2KeepAliveIntervalSecs: 15,     // 15 seconds instead of default 30
//     keepAliveTimeoutSecs: 10,           // 10 seconds instead of default 5
//     keepAliveWhileIdle: true,
    
//     // Window sizes for flow control
//     initialStreamWindowSize: 8388608,    // 8MB instead of default 4MB
//     initialConnectionWindowSize: 16777216, // 16MB instead of default 8MB
    
//     // Performance options
//     http2AdaptiveWindow: true,
//     tcpNodelay: true,
//     tcpKeepaliveSecs: 30,               // 30 seconds instead of default 60
//     bufferSize: 131072,                 // 128KB instead of default 64KB
//   };

//   // Configuration with custom channel options
//   const config: LaserstreamConfig = {
//     apiKey: credentials.laserstreamProduction.apiKey,
//     endpoint: credentials.laserstreamProduction.endpoint,
//     maxReconnectAttempts: 5,
//     channelOptions: channelOptions
//   };

//   // Subscription request
//   const request = {
//     slots: {
//       client: {
//         filterByCommitment: true,
//       }
//     },
//     commitment: CommitmentLevel.CONFIRMED
//   };

//   try {
//     const stream: StreamHandle = await subscribe(
//       config,
//       request,
//       // Data callback
//       async (update: SubscribeUpdate) => {
//         if (update.slot) {
//           console.log(`🎰 Slot update: ${update.slot.slot}`);
//         } else {
//           console.log('📦 Received update:', update);
//         }
//       },
//       // Error callback
//       async (error: Error) => {
//         console.error('❌ Stream error:', error);
//       }
//     );

//     console.log(`✅ Stream started with ID: ${stream.id}`);

//     // Handle graceful shutdown
//     process.on('SIGINT', async () => {
//       console.log('\n🛑 Shutting down...');
//       stream.cancel();
//       process.exit(0);
//     });

//   } catch (error) {
//     console.error('❌ Failed to subscribe:', error);
//     process.exit(1);
//   }
// }

// main().catch(console.error);

// import { subscribe, CommitmentLevel, SubscribeUpdate, LaserstreamConfig, CompressionAlgorithms } from '../client';

// async function main() {
//   // Try to load from test config or env
//   let apiKey, endpoint;
//   try {
//     const credentials = require('../test-config');
//     apiKey = credentials.laserstreamProduction.apiKey;
//     endpoint = credentials.laserstreamProduction.endpoint;
//   } catch (e) {
//     apiKey = process.env.LASERSTREAM_PRODUCTION_API_KEY || process.env.HELIUS_API_KEY;
//     endpoint = process.env.LASERSTREAM_PRODUCTION_ENDPOINT || process.env.LASERSTREAM_ENDPOINT;
//   }

//   if (!apiKey || !endpoint) {
//     console.error('Please set LASERSTREAM_PRODUCTION_API_KEY or HELIUS_API_KEY and endpoint');
//     process.exit(1);
//   }

//   const config: LaserstreamConfig = {
//     apiKey,
//     endpoint,
//     maxReconnectAttempts: 10,
//     channelOptions: {
//       'grpc.default_compression_algorithm': CompressionAlgorithms.gzip,  // Use gzip compression
//       'grpc.max_receive_message_length': 1_000_000_000,  // 1GB
//       'grpc.max_send_message_length': 32_000_000,     // 32MB
//       'grpc.keepalive_time_ms': 30000,
//       'grpc.keepalive_timeout_ms': 5000,
//     }
//   };

//   const request = {
//     slots: {
//       "compressed-slots": {}
//     },
//     commitment: CommitmentLevel.PROCESSED,
//   };

//   console.log('🚀 Starting stream with gzip compression...');
  
//   let slotCount = 0;
//   const maxSlots = 10;

//   const stream = await subscribe(
//     config,
//     request,
//     async (update: SubscribeUpdate) => {
//       if (update.slot) {
//         slotCount++;
//         console.log(`✅ Received compressed slot update #${slotCount}: slot=${update.slot.slot}`);
        
//         if (slotCount >= maxSlots) {
//           console.log(`\n🎉 Received ${maxSlots} compressed slot updates. Stopping...`);
//           stream.cancel();
//           process.exit(0);
//         }
//       }
//     },
//     async (err) => {
//       console.error('❌ Stream error:', err);
//     }
//   );

//   console.log(`✅ Stream connected with ID: ${stream.id}`);
//   console.log('🔄 Using gzip compression for efficient data transfer');
// }

// main().catch(console.error);

// import { subscribe, CommitmentLevel, SubscribeUpdate, LaserstreamConfig, CompressionAlgorithms } from '../client';

// async function main() {
//   // Try to load from test config or env
//   let apiKey, endpoint;
//   try {
//     const credentials = require('../test-config');
//     apiKey = credentials.laserstreamProduction.apiKey;
//     endpoint = credentials.laserstreamProduction.endpoint;
//   } catch (e) {
//     apiKey = process.env.LASERSTREAM_PRODUCTION_API_KEY || process.env.HELIUS_API_KEY;
//     endpoint = process.env.LASERSTREAM_PRODUCTION_ENDPOINT || process.env.LASERSTREAM_ENDPOINT;
//   }

//   if (!apiKey || !endpoint) {
//     console.error('Please set LASERSTREAM_PRODUCTION_API_KEY or HELIUS_API_KEY and endpoint');
//     process.exit(1);
//   }

//   const config: LaserstreamConfig = {
//     apiKey,
//     endpoint,
//     maxReconnectAttempts: 10,
//     channelOptions: {
//       'grpc.default_compression_algorithm': CompressionAlgorithms.zstd,  // Use zstd compression
//       'grpc.max_receive_message_length': 1_000_000_000,  // 1GB
//       'grpc.max_send_message_length': 32_000_000,     // 32MB
//       'grpc.keepalive_time_ms': 30000,
//       'grpc.keepalive_timeout_ms': 5000,
//     }
//   };

//   const request = {
//     slots: {
//       "compressed-slots": {}
//     },
//     commitment: CommitmentLevel.PROCESSED,
//   };

//   console.log('🚀 Starting stream with zstd compression (more efficient than gzip!)...');
  
//   let slotCount = 0;
//   const maxSlots = 10;

//   const stream = await subscribe(
//     config,
//     request,
//     async (update: SubscribeUpdate) => {
//       if (update.slot) {
//         slotCount++;
//         console.log(`✅ Received zstd compressed slot update #${slotCount}: slot=${update.slot.slot}`);
        
//         if (slotCount >= maxSlots) {
//           console.log(`\n🎉 Received ${maxSlots} zstd compressed slot updates. Stopping...`);
//           stream.cancel();
//           process.exit(0);
//         }
//       }
//     },
//     async (err) => {
//       console.error('❌ Stream error:', err);
//     }
//   );

//   console.log(`✅ Stream connected with ID: ${stream.id}`);
//   console.log('🔄 Using zstd compression for maximum efficiency');
// }

// main().catch(console.error);

// import { 
//   subscribe, 
//   CommitmentLevel, 
//   SubscribeUpdate,
//   SubscribeUpdateEntry,
//   LaserstreamConfig 
// } from '../client';
// import * as bs58 from 'bs58';
// const credentials = require('../test-config');

// async function runEntrySubscription() {
//   console.log('📝 Laserstream Entry Subscription Example');

//   const config: LaserstreamConfig = {
//     apiKey: credentials.laserstreamProduction.apiKey,
//     endpoint: credentials.laserstreamProduction.endpoint,
//   };

//   // Subscribe to entry updates
//   const request = {
//     entry: {
//       "all-entries": {}
//     },
//     commitment: CommitmentLevel.PROCESSED,
//     accounts: {},
//     slots: {},
//     transactions: {},
//     transactionsStatus: {},
//     blocks: {},
//     blocksMeta: {},
//     accountsDataSlice: [],
//   };

//   const stream = await subscribe(
//     config,
//     request,
//     async (update: SubscribeUpdate) => {
//       if (update.entry) {
//         const entryUpdate: SubscribeUpdateEntry = update.entry;
//         console.log('\n📝 Entry Update Received!');
//         console.log('  - Slot:', entryUpdate.slot);
//         console.log('  - Index:', entryUpdate.index);
//         console.log('  - Num Hashes:', entryUpdate.numHashes);
//         console.log('  - Hash:', entryUpdate.hash ? bs58.encode(entryUpdate.hash) : 'N/A');
//         console.log('  - Executed Transaction Count:', entryUpdate.executedTransactionCount);
//         console.log('  - Starting Transaction Index:', entryUpdate.startingTransactionIndex);
//       }
//     },
//     async (error: Error) => {
//       console.error('❌ Stream error:', error);
//     }
//   );

//   console.log(`✅ Entry subscription started with ID: ${stream.id}`);

//   // Cleanup on exit
//   process.on('SIGINT', () => {
//     console.log('\n🛑 Cancelling stream...');
//     stream.cancel();
//     process.exit(0);
//   });
// }

// runEntrySubscription().catch(console.error); 

// import { subscribe, CommitmentLevel, SubscribeUpdate, LaserstreamConfig, CompressionAlgorithms } from '../client';

// async function main() {
//   // Try to load credentials
//   let apiKey, endpoint;
//   try {
//     const credentials = require('../test-config');
//     apiKey = credentials.laserstreamProduction.apiKey;
//     endpoint = credentials.laserstreamProduction.endpoint;
//   } catch (e) {
//     apiKey = process.env.LASERSTREAM_PRODUCTION_API_KEY || process.env.HELIUS_API_KEY;
//     endpoint = process.env.LASERSTREAM_PRODUCTION_ENDPOINT || process.env.LASERSTREAM_ENDPOINT;
//   }

//   if (!apiKey || !endpoint) {
//     console.error('Please set API key and endpoint');
//     process.exit(1);
//   }

//   console.log('🔧 Comprehensive gRPC Channel Options Example');
//   console.log('Demonstrating all supported gRPC options...\n');

//   const config: LaserstreamConfig = {
//     apiKey,
//     endpoint,
//     maxReconnectAttempts: 10,
//     channelOptions: {
//       // Compression
//       'grpc.default_compression_algorithm': CompressionAlgorithms.zstd,
      
//       // Message size limits
//       'grpc.max_send_message_length': 64_000_000,       // 64MB for sending
//       'grpc.max_receive_message_length': 2_000_000_000, // 2GB for receiving large blocks
      
//       // Keep-alive settings (critical for long-lived connections)
//       'grpc.keepalive_time_ms': 20000,        // Send keepalive ping every 20s
//       'grpc.keepalive_timeout_ms': 10000,     // Wait 10s for keepalive response
//       'grpc.keepalive_permit_without_calls': 1, // Send pings even without active calls
      
//       // HTTP/2 settings
//       'grpc.http2.min_time_between_pings_ms': 15000, // Min 15s between pings
//       'grpc.http2.write_buffer_size': 1048576,       // 1MB write buffer
//       'grpc-node.max_session_memory': 67108864,      // 64MB session memory
      
//       // Connection timeouts
//       'grpc.client_idle_timeout_ms': 300000,  // 5 min idle timeout
//       'grpc.max_connection_idle_ms': 300000,  // 5 min connection idle
      
//       // Additional options (not all may be supported by Rust implementation)
//       'grpc.enable_http_proxy': 0,
//       'grpc.use_local_subchannel_pool': 1,
//       'grpc.max_concurrent_streams': 1000,
//       'grpc.initial_reconnect_backoff_ms': 1000,
//       'grpc.max_reconnect_backoff_ms': 30000,
//     }
//   };

//   const request = {
//     slots: {
//       "test-slots": {}
//     },
//     commitment: CommitmentLevel.PROCESSED,
//   };

//   console.log('📊 Channel Options Summary:');
//   console.log('   Compression: zstd (more efficient than gzip)');
//   console.log('   Max receive size: 2GB (for large blocks)');
//   console.log('   Max send size: 64MB');
//   console.log('   Keep-alive: 20s interval, 10s timeout');
//   console.log('   HTTP/2 write buffer: 1MB');
//   console.log('   Connection idle timeout: 5 minutes\n');

//   let messageCount = 0;
//   const stream = await subscribe(
//     config,
//     request,
//     async (update: SubscribeUpdate) => {
//       if (update.slot) {
//         messageCount++;
//         if (messageCount <= 5) {
//           console.log(`✅ Slot ${update.slot.slot} - Connection stable with custom gRPC options`);
//         }
        
//         if (messageCount === 10) {
//           console.log(`\n✅ Successfully received ${messageCount} updates with custom gRPC configuration`);
//           console.log('🔧 All channel options applied successfully!');
//           stream.cancel();
//           process.exit(0);
//         }
//       }
//     },
//     async (err) => {
//       console.error('❌ Stream error:', err);
//     }
//   );

//   console.log(`✅ Stream connected with ID: ${stream.id}`);
//   console.log('🔄 Testing custom gRPC channel options...\n');
// }

// main().catch(console.error);

// import { 
//   subscribe, 
//   CommitmentLevel, 
//   SubscribeUpdate,
//   SubscribeUpdateSlot,
//   LaserstreamConfig 
// } from '../client';
// // Type imports removed to avoid dependency issues
// const credentials = require('../test-config');

// async function main() {
//   console.log('🎰 Laserstream Slot Subscription Example');

//   const config: LaserstreamConfig = {
//     apiKey: credentials.laserstreamProduction.apiKey,
//     endpoint: credentials.laserstreamProduction.endpoint,
//   };

//   const request = {
//     slots: {
//       "all-slots": {}
//     },
//     commitment: CommitmentLevel.PROCESSED,
//     accounts: {},
//     transactions: {},
//     transactionsStatus: {},
//     blocks: {},
//     blocksMeta: {},
//     entry: {},
//     accountsDataSlice: [],
//   };

//   const stream = await subscribe(
//     config,
//     request,
//     async (update: SubscribeUpdate) => {
//       if (update.slot) {
//         const slotUpdate: SubscribeUpdateSlot = update.slot;
//         console.log('\n🎰 Slot Update Received!');
//         console.log('  - Slot:', slotUpdate.slot);
//         console.log('  - Parent:', slotUpdate.parent || 'N/A');
//         console.log('  - Status:', slotUpdate.status);
//         console.log('  - Dead Error:', slotUpdate.deadError || 'None');
//       }
//     },
//     async (err) => console.error('❌ Stream error:', err)
//   );

//   console.log(`✅ Slot subscription started (id: ${stream.id})`);
// }

// main().catch(console.error); 

// import { subscribe, CommitmentLevel, SubscribeUpdate, StreamHandle, LaserstreamConfig, SubscribeRequest } from '../client';
// import bs58 from 'bs58';

// const credentials = require('../test-config');

// async function main() {

//   const config: LaserstreamConfig = {
//     apiKey: credentials.laserstreamProduction.apiKey,
//     endpoint: credentials.laserstreamProduction.endpoint,
//   };

//   const request = {
//     accounts: {
//       "all-accounts": {
//         account: [],
//         owner: ["TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"],
//         filters: []
//       }
//     },
//     commitment: CommitmentLevel.PROCESSED,
//     slots: {},
//     transactions: {},
//     transactionsStatus: {},
//     blocks: {},
//     blocksMeta: {},
//     entry: {},
//     accountsDataSlice: [],
//   };

//   let message = 0;
//   // Initial subscription request
//   const stream = await subscribe(
//     config,
//     request,
//     async (update: SubscribeUpdate) => {
//       message+=1
//       if(update.account){
//       console.log('🏦 Account Update:', update.account?.account?.owner ? bs58.encode(update.account.account.owner) : 'N/A')
//       }
//       console.log(message)
//       if(message == 50){
//         try{
//         stream.write({
//           accounts: {
//             "all-accounts": {
//               account: [],
//               owner: ["TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"],
//               filters: []
//             }
//           }
//         })
//         }catch(e){
//           console.error('❌ Stream error:', e)
//         }
//       }
//     },
//     async (err) => console.error('❌ Stream error:', err)
//   );

//   // stream.cancel();
// }

// main().catch(console.error);

// import { 
//   subscribe, 
//   CommitmentLevel, 
//   SubscribeUpdate,
//   SubscribeUpdateTransactionStatus,
//   TransactionError,
//   LaserstreamConfig 
// } from '../client';
// import * as bs58 from 'bs58';
// const credentials = require('../test-config');

// async function runTransactionStatusSubscription() {
//   console.log('📊 Laserstream Transaction Status Subscription Example');

//   const config: LaserstreamConfig  = {
//     apiKey: credentials.laserstreamProduction.apiKey,
//     endpoint: credentials.laserstreamProduction.endpoint,
//   };

//   // Subscribe to transaction status updates
//   const request = {
//     transactionsStatus: {
//       "all-tx-status": {
//         vote: false,    // Exclude vote transactions
//         failed: false,  // Exclude failed transactions
//         accountInclude: [],
//         accountExclude: [],
//         accountRequired: []
//       }
//     },
//     commitment: CommitmentLevel.PROCESSED,
//     accounts: {},
//     slots: {},
//     transactions: {},
//     blocks: {},
//     blocksMeta: {},
//     entry: {},
//     accountsDataSlice: [],
//   };

//   const stream = await subscribe(
//     config,
//     request,
//     async (update: SubscribeUpdate) => {
//       if (update.transactionStatus) {
//         const txStatus: SubscribeUpdateTransactionStatus = update.transactionStatus;
//         console.log('\n📊 Transaction Status Update Received!');
//         console.log('  - Slot:', txStatus.slot);
//         console.log('  - Signature:', txStatus.signature ? bs58.encode(txStatus.signature) : 'N/A');
//         console.log('  - Is Vote:', txStatus.isVote);
//         console.log('  - Index:', txStatus.index);
        
//         if (txStatus.err) {
//           const error: TransactionError = txStatus.err;
//           console.log('  - Error:', error.err ? Buffer.from(error.err).toString() : 'N/A');
//         } else {
//           console.log('  - Status: Success');
//         }
//       }
//     },
//     async (error: Error) => {
//       console.error('❌ Stream error:', error);
//     }
//   );

//   console.log(`✅ Transaction Status subscription started with ID: ${stream.id}`);

//   // Cleanup on exit
//   process.on('SIGINT', () => {
//     console.log('\n🛑 Cancelling stream...');
//     stream.cancel();
//     process.exit(0);
//   });
// }

// runTransactionStatusSubscription().catch(console.error); 

// import { 
//   subscribe, 
//   CommitmentLevel, 
//   SubscribeUpdate,
//   SubscribeUpdateTransaction,
//   SubscribeUpdateTransactionInfo,
//   Transaction,
//   Message,
//   MessageAddressTableLookup,
//   TransactionStatusMeta,
//   LaserstreamConfig 
// } from '../client';
// import * as bs58 from 'bs58';
// const credentials = require('../test-config');

// async function runTransactionSubscription() {
//   console.log('💸 Laserstream Transaction Subscription Example');

//   const config: LaserstreamConfig = {
//     apiKey: credentials.laserstreamProduction.apiKey,
//     endpoint: credentials.laserstreamProduction.endpoint,
//   };

//   // Subscribe to transaction updates
//   const request = {
//     transactions: {
//       "all-transactions": {
//         vote: false,    // Exclude vote transactions
//         failed: false,  // Exclude failed transactions
//         accountInclude: [],
//         accountExclude: [],
//         accountRequired: []
//       }
//     },
//     commitment: CommitmentLevel.PROCESSED,
//     // Empty objects for unused subscription types
//     accounts: {},
//     slots: {},
//     transactionsStatus: {},
//     blocks: {},
//     blocksMeta: {},
//     entry: {},
//     accountsDataSlice: [],
//   };

//   const stream = await subscribe(
//     config,
//     request,
//     async (update: SubscribeUpdate) => {
//       // Process transaction updates
//       if (update.transaction) {
//         const txUpdate: SubscribeUpdateTransaction = update.transaction;
//         const txInfo: SubscribeUpdateTransactionInfo | undefined = txUpdate.transaction;
        
//         if (txInfo?.transaction?.message?.versioned && 
//             txInfo.transaction.message.addressTableLookups && 
//             txInfo.transaction.message.addressTableLookups.length > 0) {
          
//           const tx: Transaction = txInfo.transaction;
//           const message: Message = tx.message!;
//           console.log('\n🔍 Found Versioned Transaction with Address Table Lookups!');
//           console.log('📋 Transaction signature:', tx.signatures[0] ? bs58.encode(tx.signatures[0]) : 'N/A');
//           console.log('📊 Number of lookups:', message.addressTableLookups.length);
          
//           message.addressTableLookups.forEach((lookup, index) => {
//             // Check for type inconsistency
//             const isAccountKeyString = typeof lookup.accountKey === 'string';
//             const isAccountKeyBuffer = Buffer.isBuffer(lookup.accountKey);
//             const isWritableIndexesArray = Array.isArray(lookup.writableIndexes);
//             const isWritableIndexesBuffer = Buffer.isBuffer(lookup.writableIndexes);
//             const isReadonlyIndexesArray = Array.isArray(lookup.readonlyIndexes);
//             const isReadonlyIndexesBuffer = Buffer.isBuffer(lookup.readonlyIndexes);
            
//             // Detect the inconsistency pattern
//             const isStringArrayFormat = isAccountKeyString && isWritableIndexesArray && isReadonlyIndexesArray;
//             const isBufferFormat = isAccountKeyBuffer && isWritableIndexesBuffer && isReadonlyIndexesBuffer;
            
//             if (isStringArrayFormat) {
//               console.log(`🚨 INCONSISTENCY DETECTED - Transaction ${tx.signatures[0] ? bs58.encode(tx.signatures[0]) : 'N/A'}`);
//               console.log(`   Format: {accountKey: string, writableIndexes: number[], readonlyIndexes: number[]}`);
//             } else if (!isBufferFormat) {
//               console.log(`❓ MIXED TYPES - Transaction ${tx.signatures[0] ? bs58.encode(tx.signatures[0]) : 'N/A'}`);
//               console.log(`   accountKey: ${typeof lookup.accountKey}, writableIndexes: ${Array.isArray(lookup.writableIndexes) ? 'array' : typeof lookup.writableIndexes}, readonlyIndexes: ${Array.isArray(lookup.readonlyIndexes) ? 'array' : typeof lookup.readonlyIndexes}`);
//             }
//           });
          
//           console.log('\n' + '='.repeat(80) + '\n');
//         }
//       }
//     },
//     async (error: Error) => {
//       console.error('❌ Stream error:', error);
//     }
//   );

//   console.log(`✅ Transaction subscription started with ID: ${stream.id}`);

//   // Cleanup on exit
//   process.on('SIGINT', () => {
//     console.log('\n🛑 Cancelling stream...');
//     stream.cancel();
//     process.exit(0);
//   });
// }

// runTransactionSubscription().catch(console.error); 

// use napi::{bindgen_prelude::*, Env};
// use std::collections::HashMap;
// use std::sync::Arc;
// use uuid::Uuid;
// use serde::Deserialize;
// use serde_json;
// use base64::{Engine as _, engine::general_purpose};

// use yellowstone_grpc_proto::geyser::{
//     SubscribeRequest, SubscribeRequestFilterAccounts, SubscribeRequestFilterBlocks,
//     SubscribeRequestFilterSlots, SubscribeRequestFilterTransactions,
//     SubscribeRequestFilterBlocksMeta, SubscribeRequestFilterEntry,
//     SubscribeRequestAccountsDataSlice, SubscribeRequestPing,
//     SubscribeRequestFilterAccountsFilter, SubscribeRequestFilterAccountsFilterMemcmp,
//     SubscribeRequestFilterAccountsFilterLamports,
//     subscribe_request_filter_accounts_filter_memcmp,
//     subscribe_request_filter_accounts_filter_lamports,
//     subscribe_request_filter_accounts_filter,
// };

// use crate::stream::StreamInner;

// pub struct ClientInner {
//     endpoint: String,
//     token: Option<String>,
//     max_reconnect_attempts: u32,
//     channel_options: Option<ChannelOptions>,
//     // When true, enable replay behavior (internal slot tracking + from_slot on reconnects)
//     // When false, disable replay (no internal slot tracking and no from_slot on reconnects)
//     replay: bool,
// }

// #[derive(Deserialize, Debug, Clone)]
// pub struct ChannelOptions {
//     // gRPC standard channel options
//     #[serde(rename = "grpc.max_send_message_length")]
//     pub grpc_max_send_message_length: Option<i32>,
//     #[serde(rename = "grpc.max_receive_message_length")]
//     pub grpc_max_receive_message_length: Option<i32>,
//     #[serde(rename = "grpc.keepalive_time_ms")]
//     pub grpc_keepalive_time_ms: Option<i32>,
//     #[serde(rename = "grpc.keepalive_timeout_ms")]
//     pub grpc_keepalive_timeout_ms: Option<i32>,
//     #[serde(rename = "grpc.keepalive_permit_without_calls")]
//     pub grpc_keepalive_permit_without_calls: Option<i32>,
//     #[serde(rename = "grpc.default_compression_algorithm")]
//     pub grpc_default_compression_algorithm: Option<i32>,
    
//     // Catch-all for other options
//     #[serde(flatten)]
//     pub other: HashMap<String, serde_json::Value>,
// }

// // Complete serde-based structures matching yellowstone-grpc proto exactly
// #[derive(Deserialize, Debug)]
// pub struct JsSubscribeRequest {
//     pub accounts: Option<HashMap<String, JsAccountFilter>>,
//     pub slots: Option<HashMap<String, JsSlotFilter>>,
//     pub transactions: Option<HashMap<String, JsTransactionFilter>>,
//     #[serde(alias = "transactionsStatus")]
//     pub transactions_status: Option<HashMap<String, JsTransactionFilter>>,
//     pub blocks: Option<HashMap<String, JsBlockFilter>>,
//     #[serde(alias = "blocksMeta")]
//     pub blocks_meta: Option<HashMap<String, JsBlockMetaFilter>>,
//     pub entry: Option<HashMap<String, JsEntryFilter>>,
//     pub commitment: Option<i32>,
//     #[serde(alias = "accountsDataSlice")]
//     pub accounts_data_slice: Option<Vec<JsAccountsDataSlice>>,
//     pub ping: Option<JsPing>,
//     #[serde(alias = "fromSlot")]
//     pub from_slot: Option<u64>,
// }

// #[derive(Deserialize, Debug)]
// pub struct JsAccountFilter {
//     pub account: Option<Vec<String>>,
//     pub owner: Option<Vec<String>>,
//     pub filters: Option<Vec<JsAccountsFilter>>,
//     #[serde(alias = "nonemptyTxnSignature")]
//     pub nonempty_txn_signature: Option<bool>,
//     // Add aliases for consistent interface matching transactions
//     #[serde(alias = "accountInclude")]
//     pub account_include: Option<Vec<String>>,
//     #[serde(alias = "accountExclude")]
//     pub account_exclude: Option<Vec<String>>,
//     #[serde(alias = "accountRequired")]
//     pub account_required: Option<Vec<String>>,
// }

// #[derive(Deserialize, Debug)]
// pub struct JsAccountsFilter {
//     pub memcmp: Option<JsMemcmpFilter>,
//     pub datasize: Option<u64>,
//     #[serde(alias = "tokenAccountState")]
//     pub token_account_state: Option<bool>,
//     pub lamports: Option<JsLamportsFilter>,
// }

// #[derive(Deserialize, Debug)]
// pub struct JsMemcmpFilter {
//     pub offset: u64,
//     pub bytes: Option<String>, // base64 encoded
//     pub base58: Option<String>,
//     pub base64: Option<String>,
// }

// #[derive(Deserialize, Debug)]
// pub struct JsLamportsFilter {
//     pub eq: Option<u64>,
//     pub ne: Option<u64>,
//     pub lt: Option<u64>,
//     pub gt: Option<u64>,
// }

// #[derive(Deserialize, Debug)]
// pub struct JsSlotFilter {
//     #[serde(alias = "filterByCommitment")]
//     pub filter_by_commitment: Option<bool>,
//     #[serde(alias = "interslotUpdates")]
//     pub interslot_updates: Option<bool>,
// }

// #[derive(Deserialize, Debug)]
// pub struct JsTransactionFilter {
//     pub vote: Option<bool>,
//     pub failed: Option<bool>,
//     pub signature: Option<String>,
//     #[serde(alias = "accountInclude")]
//     pub account_include: Option<Vec<String>>,
//     #[serde(alias = "accountExclude")]
//     pub account_exclude: Option<Vec<String>>,
//     #[serde(alias = "accountRequired")]
//     pub account_required: Option<Vec<String>>,
// }

// #[derive(Deserialize, Debug)]
// pub struct JsBlockFilter {
//     #[serde(alias = "accountInclude")]
//     pub account_include: Option<Vec<String>>,
//     #[serde(alias = "includeTransactions")]
//     pub include_transactions: Option<bool>,
//     #[serde(alias = "includeAccounts")]
//     pub include_accounts: Option<bool>,
//     #[serde(alias = "includeEntries")]
//     pub include_entries: Option<bool>,
// }

// #[derive(Deserialize, Debug)]
// pub struct JsBlockMetaFilter {
//     // Empty struct as per proto
// }

// #[derive(Deserialize, Debug)]
// pub struct JsEntryFilter {
//     // Empty struct as per proto
// }

// #[derive(Deserialize, Debug)]
// pub struct JsAccountsDataSlice {
//     pub offset: u64,
//     pub length: u64,
// }

// #[derive(Deserialize, Debug)]
// pub struct JsPing {
//     pub id: i32,
// }

// impl ClientInner {
//     pub fn new(
//         endpoint: String,
//         token: Option<String>,
//         max_reconnect_attempts: Option<u32>,
//         channel_options: Option<ChannelOptions>,
//         replay: Option<bool>,
//     ) -> Result<Self> {
//         Ok(Self {
//             endpoint,
//             token,
//             max_reconnect_attempts: max_reconnect_attempts.unwrap_or(120),
//             channel_options,
//             // Default to true (replay enabled) unless explicitly set to false
//             replay: replay.unwrap_or(true),
//         })
//     }

//     // Complete automatic deserialization matching yellowstone-grpc proto exactly
//     pub fn js_to_subscribe_request(&self, env: &Env, js_obj: Object) -> Result<SubscribeRequest> {
//         let js_request: JsSubscribeRequest = env.from_js_value(js_obj)?;
        
//         let mut request = SubscribeRequest::default();
        
//         // Handle accounts with complete filter support
//         if let Some(accounts) = js_request.accounts {
//             let mut accounts_map = HashMap::new();
//             for (key, filter) in accounts {
//                 let mut yellowstone_filter = SubscribeRequestFilterAccounts::default();
                

                
//                 // Handle account field (legacy interface)
//                 if let Some(account_list) = filter.account {
//                     yellowstone_filter.account = account_list;
//                 }
                
//                 // Handle accountInclude field (consistent interface)
//                 if let Some(account_include_list) = filter.account_include {
//                     yellowstone_filter.account = account_include_list;
//                 }
                
//                 if let Some(owner_list) = filter.owner {
//                     yellowstone_filter.owner = owner_list;
//                 }
                
//                 // Handle accountExclude - NOT directly supported by Yellowstone accounts filter
//                 // This would need to be implemented via complex filters, which is beyond scope
//                 if let Some(_account_exclude_list) = filter.account_exclude {
//                     // accountExclude not directly supported for account subscriptions
//                 }
                
//                 // Handle accountRequired - NOT directly supported by Yellowstone accounts filter
//                 if let Some(_account_required_list) = filter.account_required {
//                     // accountRequired not directly supported for account subscriptions
//                 }
                
//                 if let Some(nonempty_txn_signature) = filter.nonempty_txn_signature {
//                     yellowstone_filter.nonempty_txn_signature = Some(nonempty_txn_signature);
//                 }
                
//                 // Handle complete filters
//                 if let Some(filters) = filter.filters {
//                     let mut yellowstone_filters = Vec::new();
//                     for js_filter in filters {
//                         let mut yellowstone_accounts_filter = SubscribeRequestFilterAccountsFilter::default();
                        
//                         if let Some(memcmp) = js_filter.memcmp {
//                             let mut memcmp_filter = SubscribeRequestFilterAccountsFilterMemcmp {
//                                 offset: memcmp.offset,
//                                 data: None,
//                             };
                            
//                             if let Some(bytes_str) = memcmp.bytes {
//                                 let bytes_data = general_purpose::STANDARD.decode(&bytes_str)
//                                     .map_err(|e| Error::new(Status::InvalidArg, format!("Invalid base64 bytes: {}", e)))?;
//                                 memcmp_filter.data = Some(subscribe_request_filter_accounts_filter_memcmp::Data::Bytes(bytes_data));
//                             } else if let Some(base58_str) = memcmp.base58 {
//                                 memcmp_filter.data = Some(subscribe_request_filter_accounts_filter_memcmp::Data::Base58(base58_str));
//                             } else if let Some(base64_str) = memcmp.base64 {
//                                 memcmp_filter.data = Some(subscribe_request_filter_accounts_filter_memcmp::Data::Base64(base64_str));
//                             }
                            
//                             yellowstone_accounts_filter.filter = Some(subscribe_request_filter_accounts_filter::Filter::Memcmp(memcmp_filter));
//                         }
                        
//                         if let Some(datasize) = js_filter.datasize {
//                             yellowstone_accounts_filter.filter = Some(subscribe_request_filter_accounts_filter::Filter::Datasize(datasize));
//                         }
                        
//                         if let Some(token_account_state) = js_filter.token_account_state {
//                             yellowstone_accounts_filter.filter = Some(subscribe_request_filter_accounts_filter::Filter::TokenAccountState(token_account_state));
//                         }
                        
//                         if let Some(lamports) = js_filter.lamports {
//                             let mut lamports_filter = SubscribeRequestFilterAccountsFilterLamports::default();
                            
//                             if let Some(eq) = lamports.eq {
//                                 lamports_filter.cmp = Some(subscribe_request_filter_accounts_filter_lamports::Cmp::Eq(eq));
//                             } else if let Some(ne) = lamports.ne {
//                                 lamports_filter.cmp = Some(subscribe_request_filter_accounts_filter_lamports::Cmp::Ne(ne));
//                             } else if let Some(lt) = lamports.lt {
//                                 lamports_filter.cmp = Some(subscribe_request_filter_accounts_filter_lamports::Cmp::Lt(lt));
//                             } else if let Some(gt) = lamports.gt {
//                                 lamports_filter.cmp = Some(subscribe_request_filter_accounts_filter_lamports::Cmp::Gt(gt));
//                             }
                            
//                             yellowstone_accounts_filter.filter = Some(subscribe_request_filter_accounts_filter::Filter::Lamports(lamports_filter));
//                         }
                        
//                         yellowstone_filters.push(yellowstone_accounts_filter);
//                     }
//                     yellowstone_filter.filters = yellowstone_filters;
//                 }
                
//                 accounts_map.insert(key, yellowstone_filter);
//             }
//             request.accounts = accounts_map;
//         }
        
//         // Handle slots with complete filter support
//         if let Some(slots) = js_request.slots {
//             let mut slots_map = HashMap::new();
//             for (key, filter) in slots {
//                 let mut yellowstone_filter = SubscribeRequestFilterSlots::default();
                
//                 if let Some(filter_by_commitment) = filter.filter_by_commitment {
//                     yellowstone_filter.filter_by_commitment = Some(filter_by_commitment);
//                 }
                
//                 if let Some(interslot_updates) = filter.interslot_updates {
//                     yellowstone_filter.interslot_updates = Some(interslot_updates);
//                 }
                
//                 slots_map.insert(key, yellowstone_filter);
//             }
//             request.slots = slots_map;
//         }
        
//         // Handle transactions with complete filter support
//         if let Some(transactions) = js_request.transactions {
//             let mut transactions_map = HashMap::new();
//             for (key, filter) in transactions {
//                 let mut yellowstone_filter = SubscribeRequestFilterTransactions::default();
                
//                 yellowstone_filter.vote = filter.vote;
//                 yellowstone_filter.failed = filter.failed;
//                 yellowstone_filter.signature = filter.signature;
                
//                 if let Some(account_include) = filter.account_include {
//                     yellowstone_filter.account_include = account_include;
//                 }
                
//                 if let Some(account_exclude) = filter.account_exclude {
//                     yellowstone_filter.account_exclude = account_exclude;
//                 }
                
//                 if let Some(account_required) = filter.account_required {
//                     yellowstone_filter.account_required = account_required;
//                 }
                
//                 transactions_map.insert(key, yellowstone_filter);
//             }
//             request.transactions = transactions_map;
//         }
        
//         // Handle transactions_status with complete filter support
//         if let Some(transactions_status) = js_request.transactions_status {
//             let mut transactions_status_map = HashMap::new();
//             for (key, filter) in transactions_status {
//                 let mut yellowstone_filter = SubscribeRequestFilterTransactions::default();
                
//                 yellowstone_filter.vote = filter.vote;
//                 yellowstone_filter.failed = filter.failed;
//                 yellowstone_filter.signature = filter.signature;
                
//                 if let Some(account_include) = filter.account_include {
//                     yellowstone_filter.account_include = account_include;
//                 }
                
//                 if let Some(account_exclude) = filter.account_exclude {
//                     yellowstone_filter.account_exclude = account_exclude;
//                 }
                
//                 if let Some(account_required) = filter.account_required {
//                     yellowstone_filter.account_required = account_required;
//                 }
                
//                 transactions_status_map.insert(key, yellowstone_filter);
//             }
//             request.transactions_status = transactions_status_map;
//         }
        
//         // Handle blocks with complete filter support
//         if let Some(blocks) = js_request.blocks {
//             let mut blocks_map = HashMap::new();
//             for (key, filter) in blocks {
//                 let mut yellowstone_filter = SubscribeRequestFilterBlocks::default();
                
//                 if let Some(account_include) = filter.account_include {
//                     yellowstone_filter.account_include = account_include;
//                 }
                
//                 yellowstone_filter.include_transactions = filter.include_transactions;
//                 yellowstone_filter.include_accounts = filter.include_accounts;
//                 yellowstone_filter.include_entries = filter.include_entries;
                
//                 blocks_map.insert(key, yellowstone_filter);
//             }
//             request.blocks = blocks_map;
//         }
        
//         // Handle blocks_meta
//         if let Some(blocks_meta) = js_request.blocks_meta {
//             let mut blocks_meta_map = HashMap::new();
//             for (key, _filter) in blocks_meta {
//                 blocks_meta_map.insert(key, SubscribeRequestFilterBlocksMeta::default());
//             }
//             request.blocks_meta = blocks_meta_map;
//         }
        
//         // Handle entry
//         if let Some(entry) = js_request.entry {
//             let mut entry_map = HashMap::new();
//             for (key, _filter) in entry {
//                 entry_map.insert(key, SubscribeRequestFilterEntry::default());
//             }
//             request.entry = entry_map;
//         }
        
//         // Handle commitment
//         request.commitment = js_request.commitment;
        
//         // Handle accounts_data_slice
//         if let Some(accounts_data_slice) = js_request.accounts_data_slice {
//             let mut yellowstone_slices = Vec::new();
//             for slice in accounts_data_slice {
//                 yellowstone_slices.push(SubscribeRequestAccountsDataSlice {
//                     offset: slice.offset,
//                     length: slice.length,
//                 });
//             }
//             request.accounts_data_slice = yellowstone_slices;
//         }
        
//         // Handle ping
//         if let Some(ping) = js_request.ping {
//             request.ping = Some(SubscribeRequestPing {
//                 id: ping.id,
//             });
//         }
        
//         // Handle from_slot
//         request.from_slot = js_request.from_slot;
        

        
//         Ok(request)
//     }

//     pub async fn subscribe_internal_bytes(
//         &self,
//         subscribe_request: SubscribeRequest,
//         ts_callback: napi::threadsafe_function::ThreadsafeFunction<
//             crate::SubscribeUpdateBytes,
//             napi::threadsafe_function::ErrorStrategy::CalleeHandled,
//         >,
//     ) -> Result<crate::StreamHandle> {
//         let stream_id = Uuid::new_v4().to_string();

//         let stream_inner = Arc::new(StreamInner::new_bytes(
//             stream_id.clone(),
//             self.endpoint.clone(),
//             self.token.clone(),
//             subscribe_request,
//             ts_callback,
//             self.max_reconnect_attempts,
//             self.channel_options.clone(),
//             self.replay,
//         )?);

//         // Register stream in global registry for lifecycle management
//         crate::register_stream(stream_id.clone(), stream_inner.clone());

//         Ok(crate::StreamHandle {
//             id: stream_id,
//             inner: stream_inner,
//         })
//     }
// }

// mod client;
// mod proto;
// mod stream;

// use napi::bindgen_prelude::*;
// use napi::threadsafe_function::{ErrorStrategy, ThreadsafeFunction};
// use napi::{Env, JsFunction, JsObject, NapiRaw, NapiValue};
// use napi_derive::napi;
// use std::sync::Arc;
// use std::sync::atomic::{AtomicBool, Ordering};
// use std::collections::HashMap;
// use parking_lot::Mutex;
// use std::sync::LazyLock;
// use yellowstone_grpc_proto;
// use yellowstone_grpc_proto::geyser::SubscribeUpdate as YellowstoneSubscribeUpdate;
// use prost::Message;

// // Re-export the generated protobuf types
// pub use proto::*;

// // Global stream registry for lifecycle management
// static STREAM_REGISTRY: LazyLock<Mutex<HashMap<String, Arc<stream::StreamInner>>>> = LazyLock::new(|| Mutex::new(HashMap::new()));
// static SIGNAL_HANDLERS_REGISTERED: AtomicBool = AtomicBool::new(false);
// static ACTIVE_STREAM_COUNT: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0);

// // Simple wrapper that contains the protobuf bytes
// pub struct SubscribeUpdateBytes(pub Vec<u8>);

// impl ToNapiValue for SubscribeUpdateBytes {
//     unsafe fn to_napi_value(env: napi::sys::napi_env, val: Self) -> napi::Result<napi::sys::napi_value> {
//         // Create a Uint8Array from the protobuf bytes (zero-copy)
//         let env = unsafe { napi::Env::from_raw(env) };
//         let buffer = env.create_buffer_with_data(val.0)?;
//         unsafe { Ok(buffer.into_unknown().raw()) }
//     }
// }

// // Internal function to register a stream in the global registry
// pub fn register_stream(id: String, stream: Arc<stream::StreamInner>) {
//     let mut registry = STREAM_REGISTRY.lock();
//     registry.insert(id, stream);
//     ACTIVE_STREAM_COUNT.fetch_add(1, Ordering::SeqCst);
// }

// // Internal function to unregister a stream from the global registry
// pub fn unregister_stream(id: &str) {
//     let mut registry = STREAM_REGISTRY.lock();
//     if registry.remove(id).is_some() {
//         ACTIVE_STREAM_COUNT.fetch_sub(1, Ordering::SeqCst);
//     }
// }

// // Internal function to setup signal handlers and keep-alive
// fn setup_global_lifecycle_management(_env: &Env) -> Result<()> {
//     // Only register signal handlers once
//     if SIGNAL_HANDLERS_REGISTERED.compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst).is_ok() {
//         // In a production implementation, you would register proper signal handlers here
//         // For now, we rely on the tokio runtime and stream references to keep the process alive
//     }
    
//     Ok(())
// }

// // Graceful shutdown function
// #[napi]
// pub fn shutdown_all_streams(_env: Env) -> Result<()> {
//     let mut registry = STREAM_REGISTRY.lock();
    
//     for (_id, stream) in registry.iter() {
//         let _ = stream.cancel();
//     }
    
//     registry.clear();
//     ACTIVE_STREAM_COUNT.store(0, Ordering::SeqCst);
    
//     Ok(())
// }

// // Get active stream count
// #[napi]
// pub fn get_active_stream_count() -> u32 {
//     ACTIVE_STREAM_COUNT.load(Ordering::SeqCst)
// }

// // Convert SubscribeUpdate to bytes for zero-copy transfer to JS
// pub fn subscribe_update_to_bytes(update: YellowstoneSubscribeUpdate) -> Result<Vec<u8>> {
//     // Serialize the protobuf message back to bytes
//     let mut buf = Vec::new();
//     update.encode(&mut buf).map_err(|e| {
//         Error::new(Status::GenericFailure, format!("Failed to encode protobuf: {}", e))
//     })?;
//     Ok(buf)
// }

// // Commitment levels enum (keeping for API compatibility)
// #[napi]
// pub enum CommitmentLevel {
//     PROCESSED = 0,
//     CONFIRMED = 1,
//     FINALIZED = 2,
// }

// // Main client struct
// #[napi]
// pub struct LaserstreamClient {
//     inner: Arc<client::ClientInner>,
// }

// #[napi]
// impl LaserstreamClient {
//     #[napi(constructor)]
//     pub fn new(
//         env: Env,
//         endpoint: String,
//         token: Option<String>,
//         max_reconnect_attempts: Option<u32>,
//         channel_options: Option<Object>,
//         replay: Option<bool>,
//     ) -> Result<Self> {
//         let parsed_channel_options = if let Some(opts_obj) = channel_options {
//             let opts: client::ChannelOptions = env.from_js_value(opts_obj)?;
//             Some(opts)
//         } else {
//             None
//         };
        
//         let inner = Arc::new(client::ClientInner::new(
//             endpoint,
//             token,
//             max_reconnect_attempts,
//             parsed_channel_options,
//             replay,
//         )?);
//         Ok(Self { inner })
//     }

//     #[napi(
//         ts_args_type = "request: any, callback: (error: Error | null, updateBytes: Uint8Array) => void",
//         ts_return_type = "Promise<StreamHandle>"
//     )]
//     pub fn subscribe(&self, env: Env, request: Object, callback: JsFunction) -> Result<JsObject> {
//         // Setup global lifecycle management on first use
//         setup_global_lifecycle_management(&env)?;
        
//         let subscribe_request = self.inner.js_to_subscribe_request(&env, request)?;

//         // Threadsafe function that forwards protobuf bytes to JS
//         let ts_callback: ThreadsafeFunction<SubscribeUpdateBytes, ErrorStrategy::CalleeHandled> =
//             callback.create_threadsafe_function(0, |ctx| {
//                 let bytes_wrapper: SubscribeUpdateBytes = ctx.value;
//                 let js_uint8array = unsafe { SubscribeUpdateBytes::to_napi_value(ctx.env.raw(), bytes_wrapper)? };
//                 Ok(vec![unsafe { napi::JsUnknown::from_raw(ctx.env.raw(), js_uint8array)? }])
//             })?;

//         let client_inner = self.inner.clone();

//         env.spawn_future(async move {
//             client_inner
//                 .subscribe_internal_bytes(subscribe_request, ts_callback)
//                 .await
//         })
//     }
// }

// // Stream handle
// #[napi]
// pub struct StreamHandle {
//     pub id: String,
//     inner: Arc<stream::StreamInner>,
// }

// #[napi]
// impl StreamHandle {
//     #[napi]
//     pub fn cancel(&self) -> Result<()> {
//         // Unregister from global registry first
//         unregister_stream(&self.id);
        
//         // Then cancel the actual stream
//         self.inner.cancel()
//     }
    
//     #[napi(ts_args_type = "request: any")]
//     pub fn write(&self, env: Env, request: Object) -> Result<()> {
//         // Parse the JavaScript request object into a protobuf SubscribeRequest
//         let client_inner = client::ClientInner::new(
//             String::new(), // dummy values, we only need the parsing functionality
//             None,
//             None,
//             None,
//             None,
//         )?;
//         let subscribe_request = client_inner.js_to_subscribe_request(&env, request)?;
        
//         // Send the request through the write channel
//         self.inner.write(subscribe_request)
//     }
// }


// // Re-export yellowstone-grpc-proto types
// pub use yellowstone_grpc_proto::geyser;
// pub use yellowstone_grpc_proto::solana;
// pub use yellowstone_grpc_proto::prost;

// // For compatibility, re-export commonly used types
// pub use yellowstone_grpc_proto::geyser::*;

// /* tslint:disable */
// /* eslint-disable */
// /* prettier-ignore */

// /* auto-generated by NAPI-RS */

// const { existsSync } = require('fs')
// const { join } = require('path')

// const { platform, arch } = process

// let nativeBinding = null
// let localFileExisted = false
// let loadError = null

// switch (platform) {
//   case 'darwin':
//     switch (arch) {
//       case 'x64':
//         localFileExisted = existsSync(join(__dirname, 'laserstream-napi.darwin-x64.node'))
//         try {
//           if (localFileExisted) {
//             nativeBinding = require('./laserstream-napi.darwin-x64.node')
//           } else {
//             nativeBinding = require('helius-laserstream-darwin-x64')
//           }
//         } catch (e) {
//           loadError = e
//         }
//         break
//       case 'arm64':
//         localFileExisted = existsSync(join(__dirname, 'laserstream-napi.darwin-arm64.node'))
//         try {
//           if (localFileExisted) {
//             nativeBinding = require('./laserstream-napi.darwin-arm64.node')
//           } else {
//             nativeBinding = require('helius-laserstream-darwin-arm64')
//           }
//         } catch (e) {
//           loadError = e
//         }
//         break
//       default:
//         throw new Error(`Unsupported architecture on macOS: ${arch}`)
//     }
//     break
//   case 'linux':
//     switch (arch) {
//       case 'x64':
//         // Try local glibc build first
//         localFileExisted = existsSync(join(__dirname, 'laserstream-napi.linux-x64-gnu.node'))
//         if (localFileExisted) {
//           try {
//             nativeBinding = require('./laserstream-napi.linux-x64-gnu.node')
//             break
//           } catch (e) {
//             loadError = e
//           }
//         }
        
//         // Try local musl build
//         const localMuslExisted = existsSync(join(__dirname, 'laserstream-napi.linux-x64-musl.node'))
//         if (localMuslExisted) {
//           try {
//             nativeBinding = require('./laserstream-napi.linux-x64-musl.node')
//             break
//           } catch (e) {
//             loadError = e
//           }
//         }

//         // Try glibc package, fallback to musl package
//         try {
//           nativeBinding = require('helius-laserstream-linux-x64-gnu')
//         } catch (e) {
//           try {
//             nativeBinding = require('helius-laserstream-linux-x64-musl')
//           } catch (muslError) {
//             loadError = e
//           }
//         }
//         break
//       case 'arm64':
//         // Try local glibc build first
//         localFileExisted = existsSync(join(__dirname, 'laserstream-napi.linux-arm64-gnu.node'))
//         if (localFileExisted) {
//           try {
//             nativeBinding = require('./laserstream-napi.linux-arm64-gnu.node')
//             break
//           } catch (e) {
//             loadError = e
//           }
//         }
        
//         // Try local musl build
//         const localMuslArm64Existed = existsSync(join(__dirname, 'laserstream-napi.linux-arm64-musl.node'))
//         if (localMuslArm64Existed) {
//           try {
//             nativeBinding = require('./laserstream-napi.linux-arm64-musl.node')
//             break
//           } catch (e) {
//             loadError = e
//           }
//         }

//         // Try glibc package, fallback to musl package
//         try {
//           nativeBinding = require('helius-laserstream-linux-arm64-gnu')
//         } catch (e) {
//           try {
//             nativeBinding = require('helius-laserstream-linux-arm64-musl')
//           } catch (muslError) {
//             loadError = e
//           }
//         }
//         break
//       default:
//         throw new Error(`Unsupported architecture on Linux: ${arch}`)
//     }
//     break
//   default:
//     throw new Error(`Unsupported OS: ${platform}, architecture: ${arch}`)
// }

// if (!nativeBinding) {
//   if (loadError) {
//     throw loadError
//   }
//   throw new Error(`Failed to load native binding`)
// }

// const { shutdownAllStreams, getActiveStreamCount, CommitmentLevel, LaserstreamClient, StreamHandle } = nativeBinding

// module.exports.shutdownAllStreams = shutdownAllStreams
// module.exports.getActiveStreamCount = getActiveStreamCount
// module.exports.CommitmentLevel = CommitmentLevel
// module.exports.LaserstreamClient = LaserstreamClient
// module.exports.StreamHandle = StreamHandle

// const { LaserstreamClient: NapiClient, CommitmentLevel, shutdownAllStreams, getActiveStreamCount } = require('./index');
// const { initProtobuf, decodeSubscribeUpdate } = require('./proto-decoder');

// // Compression algorithms enum
// const CompressionAlgorithms = {
//   identity: 0,
//   deflate: 1,
//   gzip: 2,
//   zstd: 3  // zstd is supported in our Rust NAPI bindings
// };

// // Initialize protobuf on module load
// let protobufInitialized = false;

// async function ensureProtobufInitialized() {
//   if (!protobufInitialized) {
//     await initProtobuf();
//     protobufInitialized = true;
//   }
// }

// // Single subscribe function using NAPI directly
// async function subscribe(config, request, onData, onError) {
//   // Ensure protobuf is initialized
//   await ensureProtobufInitialized();

//   // Create NAPI client instance directly
//   const napiClient = new NapiClient(
//     config.endpoint,
//     config.apiKey,
//     config.maxReconnectAttempts,
//     config.channelOptions,
//     config.replay
//   );

//   // Wrap the callbacks to decode protobuf bytes
//   const wrappedCallback = (error, updateBytes) => {
//     if (error) {
//       if (onError) {
//         onError(error);
//       }
//       return;
//     }

//     try {
//       // Decode the protobuf bytes to JavaScript object
//       const decodedUpdate = decodeSubscribeUpdate(updateBytes);
//       if (onData) {
//         onData(decodedUpdate);
//       }
//     } catch (decodeError) {
//       if (onError) {
//         onError(decodeError);
//       }
//     }
//   };

//   // Call the NAPI client directly with the wrapped callback
//   try {
//     const streamHandle = await napiClient.subscribe(request, wrappedCallback);
//     return streamHandle;
//   } catch (error) {
//     if (onError) {
//       onError(error);
//     }
//     throw error;
//   }
// }

// // Export clean API with only NAPI-based subscribe
// module.exports = {
//   subscribe,
//   CommitmentLevel,
//   CompressionAlgorithms,
//   initProtobuf,
//   decodeSubscribeUpdate,
//   // re-export lifecycle helpers from native binding
//   shutdownAllStreams,
//   getActiveStreamCount,
// }; 

// Code Examples (LaserStream SDK)
// Slot Updates
// Account Updates
// Transaction Updates
// Blocks
// Block Metadata
// Entries

// Copy

// Ask AI
// import { subscribe, CommitmentLevel, LaserstreamConfig, SubscribeRequest } from 'helius-laserstream'

// async function main() {
//     const subscriptionRequest: SubscribeRequest = {
//         transactions: {},
//         commitment: CommitmentLevel.CONFIRMED,
//         accounts: {},
//         slots: {
//             slot: { filterByCommitment: true },
//         },
//         transactionsStatus: {},
//         blocks: {},
//         blocksMeta: {},
//         entry: {},
//         accountsDataSlice: [],
//     };

//     const config: LaserstreamConfig = {
//         apiKey: 'YOUR_API_KEY', // Replace with your key
//         endpoint: 'https://laserstream-mainnet-ewr.helius-rpc.com', // Choose your closest region
//     }

//     await subscribe(config, subscriptionRequest, async (data) => {
//         console.log(data);
//     }, async (error) => {
//         console.error(error);
//     });
// }

// main().catch(console.error);

// import { subscribe, CommitmentLevel, LaserstreamConfig, SubscribeRequest } from 'helius-laserstream'

// async function main() {
//     const subscriptionRequest: SubscribeRequest = {
//         accounts: {
//             accountSubscribe: {
//                 account: ["EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"], // USDC mint account
//                 owner: [],
//                 filters: []
//             }
//         },
//         accountsDataSlice: [],
//         commitment: CommitmentLevel.CONFIRMED,
//         slots: {},
//         transactions: {},
//         transactionsStatus: {},
//         blocks: {},
//         blocksMeta: {},
//         entry: {}
//     };

//     const config: LaserstreamConfig = {
//         apiKey: 'YOUR_API_KEY', // Replace with your key
//         endpoint: 'https://laserstream-mainnet-ewr.helius-rpc.com', // Choose your closest region
//     }

//     await subscribe(config, subscriptionRequest, async (data) => {
//         console.log(data);
//     }, async (error) => {
//         console.error(error);
//     });
// }

// main().catch(console.error);

// import { subscribe, CommitmentLevel, LaserstreamConfig, SubscribeRequest } from 'helius-laserstream'

// async function main() {
//     const subscriptionRequest: SubscribeRequest = {
//         transactions: {
//             client: {
//                 accountInclude: ['TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'],
//                 accountExclude: [],
//                 accountRequired: [],
//                 vote: false,
//                 failed: false
//             }
//         },
//         commitment: CommitmentLevel.CONFIRMED,
//         accounts: {},
//         slots: {},
//         transactionsStatus: {},
//         blocks: {},
//         blocksMeta: {},
//         entry: {},
//         accountsDataSlice: [],
//     };

//     const config: LaserstreamConfig = {
//         apiKey: 'YOUR_API_KEY', // Replace with your key
//         endpoint: 'https://laserstream-mainnet-ewr.helius-rpc.com', // Choose your closest region
//     }

//     await subscribe(config, subscriptionRequest, async (data) => {
//         console.log(data);
//     }, async (error) => {
//         console.error(error);
//     });
// }

// main().catch(console.error);

// import { subscribe, CommitmentLevel, LaserstreamConfig, SubscribeRequest } from 'helius-laserstream'

// async function main() {
//     const subscriptionRequest: SubscribeRequest = {
//         entry: {},
//         accounts: {},
//         accountsDataSlice: [],
//         slots: {},
//         blocks: {
//             blocks: {
//                 accountInclude: []
//             }
//         },
//         blocksMeta: {},
//         transactions: {},
//         transactionsStatus: {},
//         commitment: CommitmentLevel.CONFIRMED,
//     };

//     const config: LaserstreamConfig = {
//         apiKey: 'YOUR_API_KEY', // Replace with your key
//         endpoint: 'https://laserstream-mainnet-ewr.helius-rpc.com', // Choose your closest region
//     }

//     await subscribe(config, subscriptionRequest, async (data) => {
//         console.log(data);
//     }, async (error) => {
//         console.error(error);
//     });
// }

// main().catch(console.error);

// import { subscribe, CommitmentLevel, LaserstreamConfig, SubscribeRequest } from 'helius-laserstream'

// async function main() {
//     const subscriptionRequest: SubscribeRequest = {
//         entry: {},
//         accounts: {},
//         accountsDataSlice: [],
//         slots: {},
//         blocks: {},
//         blocksMeta: {
//             blockmetadata: {}
//         },
//         transactions: {},
//         transactionsStatus: {},
//         commitment: CommitmentLevel.CONFIRMED,
//     };

//     const config: LaserstreamConfig = {
//         apiKey: 'YOUR_API_KEY', // Replace with your key
//         endpoint: 'https://laserstream-mainnet-ewr.helius-rpc.com', // Choose your closest region
//     }

//     await subscribe(config, subscriptionRequest, async (data) => {
//         console.log(data);
//     }, async (error) => {
//         console.error(error);
//     });
// }

// main().catch(console.error);

// import { subscribe, CommitmentLevel, LaserstreamConfig, SubscribeRequest } from 'helius-laserstream'

// async function main() {
//     const subscriptionRequest: SubscribeRequest = {
//         entry: {
//             entrySubscribe: {}  // Subscribe to all entries
//         },
//         accounts: {},
//         accountsDataSlice: [],
//         slots: {},
//         blocks: {},
//         blocksMeta: {},
//         transactions: {},
//         transactionsStatus: {},
//         commitment: CommitmentLevel.CONFIRMED,
//     };

//     const config: LaserstreamConfig = {
//         apiKey: 'YOUR_API_KEY', // Replace with your key
//         endpoint: 'https://laserstream-mainnet-ewr.helius-rpc.com', // Choose your closest region
//     }

//     await subscribe(config, subscriptionRequest, async (data) => {
//         console.log(data);
//     }, async (error) => {
//         console.error(error);
//     });
// }

// main().catch(console.error);

// # LaserStream gRPC: High-Performance Data Streaming

// > Stream real-time Solana blockchain data with LaserStream gRPC. Highly configurable low-latency streams with historical replay and multi-region support.

// ## Overview

// LaserStream's gRPC offering builds on a Yellowstone-based interface and enhances it with features like historical replay, multi-node failover, and a fully managed environment. LaserStream uses the open source gRPC protocol, ensuring no vendor lock-in and maximum compatibility with existing gRPC implementations.

// You can connect either directly with `@yellowstone-grpc` or use the higher-level **[Helius LaserStream SDK](https://github.com/helius-labs/laserstream-sdk)** for added benefits (auto-reconnect, subscription management, error handling, etc.).

// <Warning>
//   **Performance Notice**: If you experience any lag or performance issues with your LaserStream connection, please refer to the [Troubleshooting section](#troubleshooting-%2F-faq) for common causes and solutions related to client performance and network optimization.
// </Warning>

// <Divider />

// ## Endpoints & Regions

// LaserStream is available in multiple regions worldwide. Choose the endpoint closest to your application for optimal performance:

// ### Mainnet Endpoints

// | Region   | Location                        | Endpoint                                          |
// | -------- | ------------------------------- | ------------------------------------------------- |
// | **ewr**  | Newark, NJ (near New York)      | `https://laserstream-mainnet-ewr.helius-rpc.com`  |
// | **pitt** | Pittsburgh, US (Central)        | `https://laserstream-mainnet-pitt.helius-rpc.com` |
// | **slc**  | Salt Lake City, US (West Coast) | `https://laserstream-mainnet-slc.helius-rpc.com`  |
// | **ams**  | Amsterdam, Europe               | `https://laserstream-mainnet-ams.helius-rpc.com`  |
// | **fra**  | Frankfurt, Europe               | `https://laserstream-mainnet-fra.helius-rpc.com`  |
// | **tyo**  | Tokyo, Asia                     | `https://laserstream-mainnet-tyo.helius-rpc.com`  |
// | **sgp**  | Singapore, Asia                 | `https://laserstream-mainnet-sgp.helius-rpc.com`  |

// ### Devnet Endpoint

// | Network    | Location                   | Endpoint                                        |
// | ---------- | -------------------------- | ----------------------------------------------- |
// | **Devnet** | Newark, NJ (near New York) | `https://laserstream-devnet-ewr.helius-rpc.com` |

// <Tip>
//   **Network & Region Selection**:

//   * For **production applications**, choose the mainnet endpoint closest to your server for best performance. For example, if deploying in Europe, use either the Amsterdam (`ams`) or Frankfurt (`fra`) endpoint.
//   * For **development and testing**, use the devnet endpoint: `https://laserstream-devnet-ewr.helius-rpc.com`.
// </Tip>

// ## Quickstart

// <Steps>
//   <Step title="Create a New Project">
//     ```bash
//     mkdir laserstream-grpc-demo
//     cd laserstream-grpc-demo
//     npm init -y
//     ```
//   </Step>

//   <Step title="Install Dependencies">
//     ```bash
//     npm install helius-laserstream
//     npm install --save-dev typescript ts-node
//     npx tsc --init
//     ```
//   </Step>

//   <Step title="Obtain Your API Key">
//     Generate a key from the [Helius Dashboard](https://dashboard.helius.dev/). This key will serve as your authentication token for LaserStream.

//     <Note>
//       **Plan Requirements**: LaserStream devnet requires a Developer or Business plan. LaserStream mainnet requires a Professional plan. Ensure your Helius account has the appropriate plan to access LaserStream features.
//     </Note>
//   </Step>

//   <Step title="Create a Subscription Script">
//     Create **`index.ts`** with the following:

//     ```typescript
//     import { subscribe, CommitmentLevel, LaserstreamConfig, SubscribeRequest } from 'helius-laserstream'

//     async function main() {
//       const subscriptionRequest: SubscribeRequest = {
//         transactions: {
//           client: {
//             accountInclude: ['TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'],
//             accountExclude: [],
//             accountRequired: [],
//             vote: false,
//             failed: false
//           }
//         },
//         commitment: CommitmentLevel.CONFIRMED,
//         accounts: {},
//         slots: {},
//         transactionsStatus: {},
//         blocks: {},
//         blocksMeta: {},
//         entry: {},
//         accountsDataSlice: [],
//         // Optionally, you can replay missed data by specifying a fromSlot:
//         // fromSlot: '224339000'
//         // Note: Currently, you can only replay data from up to 3000 slots in the past.
//       };

//     // Replace the values below with your actual LaserStream API key and endpoint
//     const config: LaserstreamConfig = {
//       apiKey: 'YOUR_API_KEY', // Replace with your key from https://dashboard.helius.dev/
//       endpoint: 'https://laserstream-mainnet-ewr.helius-rpc.com', // Choose your closest region
//     }

//       await subscribe(config, subscriptionRequest, async (data) => {
        
//         console.log(data);

//       }, async (error) => {
//         console.error(error);
//       });
//     }

//     main().catch(console.error);
//     ```
//   </Step>

//   <Step title="Replace Your API Key and Choose Your Region">
//     In `index.ts`, update the `config` object with:

//     1. Your actual API key from the [Helius Dashboard](https://dashboard.helius.dev/)
//     2. The LaserStream endpoint closest to your server location

//     ```typescript
//     const config: LaserstreamConfig = {
//       apiKey: 'YOUR_ACTUAL_API_KEY', // Replace with your key from Helius Dashboard
//       endpoint: 'https://laserstream-mainnet-fra.helius-rpc.com', // Example: Frankfurt mainnet
//       // For devnet: endpoint: 'https://laserstream-devnet-ewr.helius-rpc.com'
//     }
//     ```

//     **Network & Region Selection Examples:**

//     * **For Production (Mainnet)**:
//       * Europe: Use `fra` (Frankfurt) or `ams` (Amsterdam)
//       * US East: Use `ewr` (New York)
//       * US West: Use `slc` (Salt Lake City)
//       * Asia: Use `tyo` (Tokyo) or `sgp` (Singapore)
//     * **For Development (Devnet)**: Use `https://laserstream-devnet-ewr.helius-rpc.com`
//   </Step>

//   <Step title="Run and View Results">
//     ```bash
//     npx ts-node index.ts
//     ```

//     Whenever a `confirmed` token transaction involves `TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA`, you'll see the data in your console.
//   </Step>
// </Steps>

// <Divider />

// ## Subscribe Request

// In the subscribe request, you need to include the following general parameters:

// <Note>
//   **Historical Replay:** You can optionally include a `fromSlot: string` field in the main `SubscribeRequest` object to replay data from a specific slot onwards. Currently, replay is supported for up to 3000 slots in the past.
// </Note>

// <ParamField type="enum">
//   Specifies the commitment level, which can be **processed**, **confirmed**, or **finalized**.
// </ParamField>

// <ParamField type="array">
//   An array of objects `{ offset: uint64, length: uint64 }` that allows you to receive only the required data slices from accounts.
// </ParamField>

// <ParamField type="boolean">
//   Some cloud providers (like Cloudflare) may close idle streams after a period of inactivity. To prevent this and keep the connection alive without needing to resend filters, set this to **true**. The server will respond with a Pong message every 15 seconds.
// </ParamField>

// ```typescript
// const subscriptionRequest: SubscribeRequest = {
//   commitment: CommitmentLevel.CONFIRMED,
//   accountsDataSlice: [],
//   transactions: {},
//   accounts: {},
//   slots: {},
//   blocks: {},
//   blocksMeta: {},
//   entry: {},
// }
// ```

// Next, you'll need to specify the filters for the data you want to subscribe to, such as accounts, blocks, slots, or transactions.

// <Accordion title="Slots">
//   Define filters for slot updates. The key you use (e.g., `mySlotLabel`) is a **user-defined label** for this specific filter configuration, allowing you to potentially define multiple named configurations if needed (though typically one is sufficient).

//   <ParamField type="boolean">
//     By default, slots are sent for all commitment levels. With this filter, you can choose to receive only the selected commitment level.
//   </ParamField>

//   <ParamField type="boolean">
//     Enables the subscription to receive updates for changes within a slot, not just at the beginning of new slots. This is useful for more granular, low-latency slot data.
//   </ParamField>

//   ```typescript
//   slots: {
//     // mySlotLabel is a user-defined name for this slot update filter configuration
//     mySlotLabel: {
//       // filterByCommitment: true => Only broadcast slot updates at the specified subscribeRequest commitment
//       filterByCommitment: true
//       // interslotUpdates: true allows receiving updates for changes occurring within a slot, not just new slots.
//       interslotUpdates: true
//     }
//   },
//   ```
// </Accordion>

// <Accordion title="Accounts">
//   Define filters for account data updates. The key you use (e.g., `tokenAccounts`) is a **user-defined label** for this specific filter configuration.

//   <ParamField type="array">
//     Matches any public key from the provided array.
//   </ParamField>

//   <ParamField type="array">
//     The account owner's public key. Matches any public key from the provided array.
//   </ParamField>

//   <ParamField type="array">
//     Similar to the filters in [getProgramAccounts](https://solana.com/docs/rpc/http/getprogramaccounts). This is an array of `dataSize` and/or `memcmp` filters. Supported encoding includes `bytes`, `base58`, and `base64`.
//   </ParamField>

//   If all fields are empty, all accounts are broadcasted. Otherwise:

//   * Fields operate as a logical **AND**.
//   * Values within arrays act as a logical **OR** (except within `filters`, which operate as a logical **AND**).

//   ```typescript
//   accounts: {
//     // tokenAccounts is a user-defined label for this account filter configuration
//     tokenAccounts: {
//       // Matches any of these public keys (logical OR)
//       account: ["9SHQTA66Ekh7ZgMnKWsjxXk6DwXku8przs45E8bcEe38"],
//       // Matches owners that are any of these public keys
//       owner: ["TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"],
//       // Filters - all must match (AND logic)
//       filters: [
//         { dataSize: 165 },
//         {
//           memcmp: {
//             offset: 0,
//             data: { base58: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" }
//           }
//         }
//       ]
//     }
//   },
//   ```
// </Accordion>

// <Accordion title="Transaction">
//   Define filters for transaction updates. The key you use (e.g., `myTxSubscription`) is a **user-defined label** for this specific filter configuration.

//   <ParamField type="boolean">
//     Enable or disable the broadcast of vote transactions.
//   </ParamField>

//   <ParamField type="boolean">
//     Enable or disable the broadcast of failed transactions.
//   </ParamField>

//   <ParamField type="string">
//     Broadcast only transactions matching the specified signature.
//   </ParamField>

//   <ParamField type="array">
//     Filter transactions that involve any account from the provided list.
//   </ParamField>

//   <ParamField type="array">
//     Exclude transactions that involve any account from the provided list (opposite of `accountInclude`).
//   </ParamField>

//   <ParamField type="array">
//     Filter transactions that involve all accounts from the provided list (all accounts must be used).
//   </ParamField>

//   If all fields are left empty, all transactions are broadcasted. Otherwise:

//   * Fields operate as a logical **AND**.
//   * Values within arrays are treated as a logical **OR** (except for `accountRequired`, where all must match).

//   ```typescript
//   transactions: {
//     // myTxSubscription is a user-defined label for this transaction filter configuration
//     myTxSubscription: {
//       vote: false,
//       failed: false,
//       signature: "",
//       // Transaction must include at least one of these public keys (OR)
//       accountInclude: ["86xCnPeV69n6t3DnyGvkKobf9FdN2H9oiVDdaMpo2MMY"],
//       // Exclude if it matches any of these
//       accountExclude: [],
//       // Require all accounts in this array (AND)
//       accountRequired: []
//     }
//   },
//   ```
// </Accordion>

// <Accordion title="Block">
//   Define filters for block updates. The key you use (e.g., `myBlockLabel`) is a **user-defined label** for this specific filter configuration.

//   <ParamField type="array">
//     Filters transactions and accounts that involve any account from the provided list.
//   </ParamField>

//   <ParamField type="boolean">
//     Includes all transactions in the broadcast.
//   </ParamField>

//   <ParamField type="boolean">
//     Includes all account updates in the broadcast.
//   </ParamField>

//   <ParamField type="boolean">
//     Includes all entries in the broadcast.
//   </ParamField>

//   ```typescript
//   blocks: {
//     // myBlockLabel is a user-defined label for this block filter configuration
//     myBlockLabel: {
//       // Only broadcast blocks referencing these accounts
//       accountInclude: ["86xCnPeV69n6t3DnyGvkKobf9FdN2H9oiVDdaMpo2MMY"],
//       includeTransactions: true,
//       includeAccounts: false,
//       includeEntries: false
//     }
//   },
//   ```
// </Accordion>

// <Accordion title="Blocks Meta">
//   This functions similarly to Blocks but excludes transactions, accounts, and entries. The key you use (e.g., `blockmetadata`) is a **user-defined label** for this subscription. Currently, no filters are available for block metadata—all messages are broadcasted by default.

//   ```typescript
//   blocksMeta: {
//     blockmetadata: {}
//   },
//   ```
// </Accordion>

// <Accordion title="Entries">
//   Subscribe to ledger entries. The key you use (e.g., `entrySubscribe`) is a **user-defined label** for this subscription. Currently, there are no filters available for entries; all entries are broadcasted.

//   ```typescript
//   entry: {
//     entrySubscribe: {}
//   },
//   ```
// </Accordion>

// <Divider />

// ## Code Examples (LaserStream SDK)

// <Tabs>
//   <Tab title="Slot Updates">
//     ```typescript
//     import { subscribe, CommitmentLevel, LaserstreamConfig, SubscribeRequest } from 'helius-laserstream'

//     async function main() {
//         const subscriptionRequest: SubscribeRequest = {
//             transactions: {},
//             commitment: CommitmentLevel.CONFIRMED,
//             accounts: {},
//             slots: {
//                 slot: { filterByCommitment: true },
//             },
//             transactionsStatus: {},
//             blocks: {},
//             blocksMeta: {},
//             entry: {},
//             accountsDataSlice: [],
//         };

//         const config: LaserstreamConfig = {
//             apiKey: 'YOUR_API_KEY', // Replace with your key
//             endpoint: 'https://laserstream-mainnet-ewr.helius-rpc.com', // Choose your closest region
//         }

//         await subscribe(config, subscriptionRequest, async (data) => {
//             console.log(data);
//         }, async (error) => {
//             console.error(error);
//         });
//     }

//     main().catch(console.error);
//     ```
//   </Tab>

//   <Tab title="Account Updates">
//     ```typescript
//     import { subscribe, CommitmentLevel, LaserstreamConfig, SubscribeRequest } from 'helius-laserstream'

//     async function main() {
//         const subscriptionRequest: SubscribeRequest = {
//             accounts: {
//                 accountSubscribe: {
//                     account: ["EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"], // USDC mint account
//                     owner: [],
//                     filters: []
//                 }
//             },
//             accountsDataSlice: [],
//             commitment: CommitmentLevel.CONFIRMED,
//             slots: {},
//             transactions: {},
//             transactionsStatus: {},
//             blocks: {},
//             blocksMeta: {},
//             entry: {}
//         };

//         const config: LaserstreamConfig = {
//             apiKey: 'YOUR_API_KEY', // Replace with your key
//             endpoint: 'https://laserstream-mainnet-ewr.helius-rpc.com', // Choose your closest region
//         }

//         await subscribe(config, subscriptionRequest, async (data) => {
//             console.log(data);
//         }, async (error) => {
//             console.error(error);
//         });
//     }

//     main().catch(console.error);
//     ```
//   </Tab>

//   <Tab title="Transaction Updates">
//     ```typescript
//     import { subscribe, CommitmentLevel, LaserstreamConfig, SubscribeRequest } from 'helius-laserstream'

//     async function main() {
//         const subscriptionRequest: SubscribeRequest = {
//             transactions: {
//                 client: {
//                     accountInclude: ['TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'],
//                     accountExclude: [],
//                     accountRequired: [],
//                     vote: false,
//                     failed: false
//                 }
//             },
//             commitment: CommitmentLevel.CONFIRMED,
//             accounts: {},
//             slots: {},
//             transactionsStatus: {},
//             blocks: {},
//             blocksMeta: {},
//             entry: {},
//             accountsDataSlice: [],
//         };

//         const config: LaserstreamConfig = {
//             apiKey: 'YOUR_API_KEY', // Replace with your key
//             endpoint: 'https://laserstream-mainnet-ewr.helius-rpc.com', // Choose your closest region
//         }

//         await subscribe(config, subscriptionRequest, async (data) => {
//             console.log(data);
//         }, async (error) => {
//             console.error(error);
//         });
//     }

//     main().catch(console.error);
//     ```
//   </Tab>

//   <Tab title="Blocks">
//     ```typescript
//     import { subscribe, CommitmentLevel, LaserstreamConfig, SubscribeRequest } from 'helius-laserstream'

//     async function main() {
//         const subscriptionRequest: SubscribeRequest = {
//             entry: {},
//             accounts: {},
//             accountsDataSlice: [],
//             slots: {},
//             blocks: {
//                 blocks: {
//                     accountInclude: []
//                 }
//             },
//             blocksMeta: {},
//             transactions: {},
//             transactionsStatus: {},
//             commitment: CommitmentLevel.CONFIRMED,
//         };

//         const config: LaserstreamConfig = {
//             apiKey: 'YOUR_API_KEY', // Replace with your key
//             endpoint: 'https://laserstream-mainnet-ewr.helius-rpc.com', // Choose your closest region
//         }

//         await subscribe(config, subscriptionRequest, async (data) => {
//             console.log(data);
//         }, async (error) => {
//             console.error(error);
//         });
//     }

//     main().catch(console.error);
//     ```
//   </Tab>

//   <Tab title="Block Metadata">
//     ```typescript
//     import { subscribe, CommitmentLevel, LaserstreamConfig, SubscribeRequest } from 'helius-laserstream'

//     async function main() {
//         const subscriptionRequest: SubscribeRequest = {
//             entry: {},
//             accounts: {},
//             accountsDataSlice: [],
//             slots: {},
//             blocks: {},
//             blocksMeta: {
//                 blockmetadata: {}
//             },
//             transactions: {},
//             transactionsStatus: {},
//             commitment: CommitmentLevel.CONFIRMED,
//         };

//         const config: LaserstreamConfig = {
//             apiKey: 'YOUR_API_KEY', // Replace with your key
//             endpoint: 'https://laserstream-mainnet-ewr.helius-rpc.com', // Choose your closest region
//         }

//         await subscribe(config, subscriptionRequest, async (data) => {
//             console.log(data);
//         }, async (error) => {
//             console.error(error);
//         });
//     }

//     main().catch(console.error);
//     ```
//   </Tab>

//   <Tab title="Entries">
//     ```typescript
//     import { subscribe, CommitmentLevel, LaserstreamConfig, SubscribeRequest } from 'helius-laserstream'

//     async function main() {
//         const subscriptionRequest: SubscribeRequest = {
//             entry: {
//                 entrySubscribe: {}  // Subscribe to all entries
//             },
//             accounts: {},
//             accountsDataSlice: [],
//             slots: {},
//             blocks: {},
//             blocksMeta: {},
//             transactions: {},
//             transactionsStatus: {},
//             commitment: CommitmentLevel.CONFIRMED,
//         };

//         const config: LaserstreamConfig = {
//             apiKey: 'YOUR_API_KEY', // Replace with your key
//             endpoint: 'https://laserstream-mainnet-ewr.helius-rpc.com', // Choose your closest region
//         }

//         await subscribe(config, subscriptionRequest, async (data) => {
//             console.log(data);
//         }, async (error) => {
//             console.error(error);
//         });
//     }

//     main().catch(console.error);
//     ```
//   </Tab>
// </Tabs>

// <Divider />

// ## SDK Options

// We provide official SDKs for multiple programming languages:

// * **TypeScript**: [LaserStream TypeScript SDK](https://github.com/helius-labs/laserstream-sdk)
// * **Rust**: [LaserStream Rust SDK](https://github.com/helius-labs/laserstream-sdk/tree/main/rust)
// * **Go**: [LaserStream Go SDK](https://github.com/helius-labs/laserstream-sdk/tree/main/go)

// For other languages or custom implementations, you can use the [Yellowstone gRPC proto files](https://github.com/rpcpool/yellowstone-grpc/tree/v6.0.0%2Bsolana.2.2.12/yellowstone-grpc-proto/proto) directly to generate gRPC clients for your preferred language.

// <Divider />

// ## Troubleshooting / FAQ

// <Accordion title="Q: I'm experiencing lag or slow performance with my LaserStream connection. What could be causing this?">
//   **A:** Performance issues with LaserStream connections are typically caused by:

//   * **Javascript Client Slowness**: The JavaScript client may lag behind when processing too many messages or consuming too much bandwidth. Consider filtering your subscriptions more narrowly to reduce message volume or using another language.

//   * **Limited local bandwidth**: Heavy subscriptions can overwhelm clients with limited network bandwidth. Monitor your network usage and consider upgrading your connection or reducing subscription scope.

//   * **Geographic distance**: Running subscriptions against servers that are geographically far away can cause performance issues. TCP packets may get dropped on long routes, and you're limited by the slowest intermediate network path. **Solution**: Choose the LaserStream endpoint closest to your server location from our available regions (see [Endpoints & Regions](#mainnet-endpoints) above).

//   * **Client-side processing bottlenecks**: Ensure your message processing logic is optimized and doesn't block the main thread for extended periods.

//   **Debugging Client Lag**: To help you debug client, we built a tool to test for the max bandwidth from your node to a Laserstream gRPC server. To use it run:

//   ```
//   cargo install helius-laserstream-bandwidth
//   helius-laserstream-bandwidth --laserstream-url $LASERSTREAM_URL --api-key $API_KEY
//   ```

//   The output returns the max network capacity between your server and the Laserstream server. At a minimum, you need 10MB/s to subscribe to all transaction data and 80MB/s to subscribe to all account data. We recommend having at least 2x the required capacity for optimal performance.
// </Accordion>

// <Accordion title="Q: I'm getting connection errors. What should I check?">
//   **A:** Verify your API key and endpoint are correct and that your network allows outbound gRPC connections to the specified endpoint. Check the [Helius status page](https://helius.statuspage.io/) for any ongoing incidents.
// </Accordion>

// <Accordion title="Q: Why aren't my filters working as expected?">
//   **A:** Double-check the logical operators (AND/OR) described in the filter sections. Ensure public keys are correct. Review the commitment level specified in your request.
// </Accordion>

// <Accordion title="Q: Can I subscribe to multiple types of data (e.g., accounts and transactions) in one request?">
//   **A:** Yes, you can define filter configurations under multiple keys (e.g., `accounts`, `transactions`) within the same `SubscribeRequest` object.
// </Accordion>


// # Helius Sender: Ultra-Low Latency Solana Transaction Submission

// > Ultra-low latency Solana transaction submission with dual routing to validators and Jito infrastructure. No credits consumed, global endpoints, optimized for high-frequency trading.

// ## Overview

// Helius Sender is a specialized service for ultra-low latency transaction submission. It optimizes transaction latency by sending to both Solana validators and [Jito](https://docs.jito.wtf/) simultaneously, providing multiple pathways for your transactions to be included in blocks.

// <CardGroup cols={2}>
//   <Card title="Dual Routing" icon="route">
//     Sends to both validators and Jito for optimal speed
//   </Card>

//   <Card title="Global Endpoints" icon="globe">
//     HTTPS endpoint auto-routes to nearest location for frontends, regional HTTP for backends
//   </Card>

//   <Card title="No Credits" icon="coins">
//     Available on all plans without consuming API credits
//   </Card>

//   <Card title="High Throughput" icon="gauge-high">
//     Default 6 TPS, contact us for higher limits
//   </Card>
// </CardGroup>

// ## Quick Start Guide

// Ready to submit your first ultra-low latency Solana transaction? This guide will get you started with Helius Sender in minutes. The best part: **you don't need any paid plan or special access** - Sender is available to all users and doesn't consume API credits.

// <Steps titleSize="h3">
//   <Step title="Create Your Free Helius Account">
//     Start by creating your free account at the [Helius Dashboard](https://dashboard.helius.dev/dashboard). Sender is available on all plans, including the free tier, and doesn't consume any API credits.
//   </Step>

//   <Step title="Get Your API Key">
//     Navigate to the [API Keys](https://dashboard.helius.dev/api-keys) section and copy your key. You'll use this for getting blockhashes and transaction confirmation, while Sender handles the transaction submission.
//   </Step>

//   <Step title="Send Your First Transaction">
//     Let's send a simple SOL transfer using Sender. This example includes all required components: tip, priority fee, and skipped preflight.

//     ```typescript [expandable]
//     import { 
//       Connection, 
//       TransactionMessage,
//       VersionedTransaction,
//       SystemProgram, 
//       PublicKey,
//       Keypair,
//       LAMPORTS_PER_SOL,
//       ComputeBudgetProgram
//     } from '@solana/web3.js';
//     import bs58 from 'bs58';

//     const TIP_ACCOUNTS = [
//       "4ACfpUFoaSD9bfPdeu6DBt89gB6ENTeHBXCAi87NhDEE",
//       "D2L6yPZ2FmmmTKPgzaMKdhu6EWZcTpLy1Vhx8uvZe7NZ", 
//       "9bnz4RShgq1hAnLnZbP8kbgBg1kEmcJBYQq3gQbmnSta"
//       // ... more tip accounts available
//     ];

//     async function sendWithSender(
//       keypair: Keypair, 
//       recipientAddress: string
//     ): Promise<string> {
//       const connection = new Connection(
//         'https://mainnet.helius-rpc.com/?api-key=YOUR_API_KEY'
//       );
      
//       const { value: { blockhash } } = await connection.getLatestBlockhashAndContext('confirmed');
      
//       // Build transaction with tip transfer and transfer to recipient
//       const transaction = new VersionedTransaction(
//         new TransactionMessage({
//           instructions: [
//             ComputeBudgetProgram.setComputeUnitLimit({ units: 100_000 }),
//             ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 200_000 }),
//             SystemProgram.transfer({
//               fromPubkey: keypair.publicKey,
//               toPubkey: new PublicKey(recipientAddress),
//               lamports: 0.001 * LAMPORTS_PER_SOL,
//             }),
//             SystemProgram.transfer({
//               fromPubkey: keypair.publicKey,
//               toPubkey: new PublicKey(TIP_ACCOUNTS[Math.floor(Math.random() * TIP_ACCOUNTS.length)]),
//               lamports: 0.001 * LAMPORTS_PER_SOL,
//             })
//           ],
//           payerKey: keypair.publicKey,
//           recentBlockhash: blockhash,
//         }).compileToV0Message()
//       );

//       transaction.sign([keypair]);
//       console.log('Sending transaction via Sender endpoint...');

//       const response = await fetch('http://slc-sender.helius-rpc.com/fast', {
//         method: 'POST',
//         headers: { 'Content-Type': 'application/json' },
//         body: JSON.stringify({
//           jsonrpc: '2.0',
//           id: Date.now().toString(),
//           method: 'sendTransaction',
//           params: [
//             Buffer.from(transaction.serialize()).toString('base64'),
//             {
//               encoding: 'base64',
//               skipPreflight: true, // Required for Sender
//               maxRetries: 0
//             }
//           ]
//         })
//       });
      
//       const json = await response.json();
//       if (json.error) {
//         throw new Error(json.error.message);
//       }
      
//       console.log('Transaction sent:', json.result);
//       return json.result;
//     }

//     // Usage
//     const keypair = Keypair.fromSecretKey(bs58.decode('YOUR_PRIVATE_KEY'));
//     sendWithSender(keypair, 'RECIPIENT_ADDRESS');
//     ```
//   </Step>

//   <Step title="Success! Understanding What Happened">
//     You've successfully submitted a transaction via Sender! Here's what made it work:

//     * **No credits consumed**: Sender is free for all users
//     * **Dual routing**: Your transaction was sent to both validators and Jito simultaneously
//     * **Required tip**: The 0.001 SOL tip enables Jito's auction participation
//     * **Priority fee**: Signals validators your willingness to pay for priority processing
//     * **Skipped preflight**: Optimizes for speed over validation
//   </Step>
// </Steps>

// **What's Next?** The code above works, but you can optimize further with dynamic fees, automatic compute unit calculation, and retry logic. Check out the [Simple Code Example](#simple-code-example) and [Advanced Example with Dynamic Optimization](#advanced-example-with-dynamic-optimization) below for production-ready implementations with detailed explanations.

// ## Routing Options

// <CardGroup cols={2}>
//   <Card title="Default Dual Routing" icon="arrows-split-up-and-left">
//     Sends transactions to both Solana validators and Jito infrastructure simultaneously for maximum inclusion probability. Requires minimum 0.001 SOL tip.
//   </Card>

//   <Card title="SWQOS-Only Alternative" icon="dollar-sign">
//     For cost-optimized trading, add `?swqos_only=true` to any endpoint URL. Routes exclusively through SWQOS infrastructure with a lower 0.0005 SOL minimum tip requirement.
//   </Card>
// </CardGroup>

// ## Requirements

// <Warning>
//   **Mandatory Requirements**: All transactions must include tips (0.001 SOL minimum, or 0.0005 SOL for SWQOS-only), priority fees, and skip preflight checks.
// </Warning>

// ### 1. Skip Preflight (Mandatory)

// The `skipPreflight` parameter **must** be set to `true`. Sender is optimized for traders who prioritize speed over transaction validation.

// ```typescript
// {
//   "skipPreflight": true  // Required: must be true
// }
// ```

// <Warning>
//   Since preflight checks are skipped, ensure your transactions are properly constructed and funded before submission. Invalid transactions will be rejected by the network after submission.
// </Warning>

// ### 2. Tips and Priority Fees Required

// All transactions submitted through Sender **must include both tips and priority fees**:

// * **Tips**: Minimum 0.001 SOL transfer to a designated tip account (or 0.0005 SOL for SWQOS-only)

// <Accordion title="Designated Tip Accounts (mainnet-beta)">
//   ```text
//   4ACfpUFoaSD9bfPdeu6DBt89gB6ENTeHBXCAi87NhDEE
//   D2L6yPZ2FmmmTKPgzaMKdhu6EWZcTpLy1Vhx8uvZe7NZ
//   9bnz4RShgq1hAnLnZbP8kbgBg1kEmcJBYQq3gQbmnSta
//   5VY91ws6B2hMmBFRsXkoAAdsPHBJwRfBht4DXox3xkwn
//   2nyhqdwKcJZR2vcqCyrYsaPVdAnFoJjiksCXJ7hfEYgD
//   2q5pghRs6arqVjRvT5gfgWfWcHWmw1ZuCzphgd5KfWGJ
//   wyvPkWjVZz1M8fHQnMMCDTQDbkManefNNhweYk5WkcF
//   3KCKozbAaF75qEU33jtzozcJ29yJuaLJTy2jFdzUY8bT
//   4vieeGHPYPG2MmyPRcYjdiDmmhN3ww7hsFNap8pVN3Ey
//   4TQLFNWK8AovT1gFvda5jfw2oJeRMKEmw7aH6MGBJ3or
//   ```
// </Accordion>

// * **Priority Fees**: Compute unit pricing via `ComputeBudgetProgram.setComputeUnitPrice` to prioritize your transaction in the validator queue

// #### Why Both Are Required

// * **Tips**: Enable access to Jito's infrastructure and auction-based transaction inclusion
// * **Priority Fees**: Signal to validators your willingness to pay for priority processing through Solana's native prioritization system
// * **Dual Benefit**: Tips give you access to Jito's auction, while priority fees improve your transaction's priority with validators—together they maximize inclusion probability

// #### Tip and Priority Fee Guidelines

// **Jito Tips**: Minimum 0.001 SOL is mandatory for auction participation. For current best-practice tip sizing, see the [Jito tip guidelines](https://docs.jito.wtf/lowlatencytxnsend/#tips).

// **Priority Fees**: Use the [Helius Priority Fee API](/priority-fee-api) for real-time fee recommendations.

// ## Endpoints

// Sender endpoints are available in multiple configurations depending on your use case:

// <Tabs>
//   <Tab title="Frontend/Browser Applications">
//     **Recommended for frontend applications to avoid CORS issues:**

//     ```
//     https://sender.helius-rpc.com/fast         # Global HTTPS endpoint
//     ```

//     <Note>
//       The HTTPS endpoint resolves CORS preflight failures that occur with browser-based applications when using the regional HTTP endpoints. This endpoint automatically routes to the nearest location for optimal performance. Use this for all frontend/browser implementations.
//     </Note>
//   </Tab>

//   <Tab title="Backend/Server Applications">
//     **Regional HTTP endpoints for optimal server-to-server latency:**

//     ```
//     http://slc-sender.helius-rpc.com/fast      # Salt Lake City
//     http://ewr-sender.helius-rpc.com/fast      # Newark
//     http://lon-sender.helius-rpc.com/fast      # London  
//     http://fra-sender.helius-rpc.com/fast      # Frankfurt
//     http://ams-sender.helius-rpc.com/fast      # Amsterdam
//     http://sg-sender.helius-rpc.com/fast       # Singapore
//     http://tyo-sender.helius-rpc.com/fast      # Tokyo
//     ```

//     <Note>
//       For backend/server applications, choose the regional HTTP endpoint closest to your infrastructure for optimal performance.
//     </Note>
//   </Tab>

//   <Tab title="Connection Warming">
//     **HTTPS (Frontend):**

//     ```
//     https://sender.helius-rpc.com/ping         # Global HTTPS ping (auto-routes to nearest location)
//     ```

//     **HTTP (Backend):**

//     ```
//     http://slc-sender.helius-rpc.com/ping      # Salt Lake City
//     http://ewr-sender.helius-rpc.com/ping      # Newark
//     http://lon-sender.helius-rpc.com/ping      # London  
//     http://fra-sender.helius-rpc.com/ping      # Frankfurt
//     http://ams-sender.helius-rpc.com/ping      # Amsterdam
//     http://sg-sender.helius-rpc.com/ping       # Singapore
//     http://tyo-sender.helius-rpc.com/ping      # Tokyo
//     ```
//   </Tab>
// </Tabs>

// ## Connection Warming

// For applications with long periods between transaction submissions, use the ping endpoint to maintain warm connections and reduce cold start latency.

// ### Ping Endpoint Usage

// The ping endpoint accepts simple GET requests and returns a basic response to keep connections alive:

// ```bash
// # Frontend applications - use HTTPS (auto-routes to nearest location)
// curl https://sender.helius-rpc.com/ping

// # Backend applications - use regional HTTP
// curl http://slc-sender.helius-rpc.com/ping
// ```

// ```typescript
// // Keep connection warm during idle periods
// async function warmConnection(endpoint: string) {
//   try {
//     const response = await fetch(`${endpoint}/ping`);
//     console.log('Connection warmed:', response.ok);
//   } catch (error) {
//     console.warn('Failed to warm connection:', error);
//   }
// }

// // Frontend applications - use HTTPS endpoint
// setInterval(() => {
//   warmConnection('https://sender.helius-rpc.com');
// }, 30000);

// // Backend/server applications - use regional HTTP endpoint
// setInterval(() => {
//   warmConnection('http://slc-sender.helius-rpc.com');
// }, 30000);
// ```

// <Tip>
//   Use connection warming when your application has gaps longer than 1 minute between transactions to maintain optimal submission latency.
// </Tip>

// ## Usage

// The Sender endpoint uses the same `sendTransaction` method as standard RPC endpoints but with specific requirements for optimal performance. **All transactions must include both tips and priority fees, plus skip preflight checks.**

// ### Basic Request Format

// ```typescript
// {
//   "id": "unique-request-id",
//   "jsonrpc": "2.0", 
//   "method": "sendTransaction",
//   "params": [
//     "BASE64_ENCODED_TRANSACTION", // Must include both tip and priority fee instructions
//     {
//       "encoding": "base64",
//       "skipPreflight": true,       // Required: must be true
//       "maxRetries": 0
//     }
//   ]
// }
// ```

// <Warning>
//   The `BASE64_ENCODED_TRANSACTION` above must contain both a SOL transfer instruction with minimum tip to designated tip accounts AND a compute unit price instruction. Without both requirements, your transaction will be rejected.
// </Warning>

// ### Simple Code Example

// ```typescript [expandable]
// import { 
//   Connection, 
//   TransactionMessage,
//   VersionedTransaction,
//   SystemProgram, 
//   PublicKey,
//   Keypair,
//   LAMPORTS_PER_SOL,
//   ComputeBudgetProgram
// } from '@solana/web3.js';
// import bs58 from 'bs58';

// const PRIV_B58 = 'Your Private Key';
// const RECIPIENT = 'Random Recipient';
// const HELIUS_API_KEY = 'Your API Key';
// const TIP_ACCOUNTS = [
//   "4ACfpUFoaSD9bfPdeu6DBt89gB6ENTeHBXCAi87NhDEE",
//   "D2L6yPZ2FmmmTKPgzaMKdhu6EWZcTpLy1Vhx8uvZe7NZ", 
//   "9bnz4RShgq1hAnLnZbP8kbgBg1kEmcJBYQq3gQbmnSta",
//   "5VY91ws6B2hMmBFRsXkoAAdsPHBJwRfBht4DXox3xkwn",
//   "2nyhqdwKcJZR2vcqCyrYsaPVdAnFoJjiksCXJ7hfEYgD",
//   "2q5pghRs6arqVjRvT5gfgWfWcHWmw1ZuCzphgd5KfWGJ",
//   "wyvPkWjVZz1M8fHQnMMCDTQDbkManefNNhweYk5WkcF",
//   "3KCKozbAaF75qEU33jtzozcJ29yJuaLJTy2jFdzUY8bT",
//   "4vieeGHPYPG2MmyPRcYjdiDmmhN3ww7hsFNap8pVN3Ey",
//   "4TQLFNWK8AovT1gFvda5jfw2oJeRMKEmw7aH6MGBJ3or"
// ];

// async function sendWithSender(
//   keypair: Keypair, 
//   recipientAddress: string
// ): Promise<string> {
//   const connection = new Connection(
//     `https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`
//   );
  
//   const { value: { blockhash } } = await connection.getLatestBlockhashAndContext('confirmed');
  
//   // Build transaction with tip transfer and transfer to recipient
//   const transaction = new VersionedTransaction(
//     new TransactionMessage({
//       instructions: [
//         ComputeBudgetProgram.setComputeUnitLimit({ units: 100_000 }),
//         ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 200_000 }),
//         SystemProgram.transfer({
//           fromPubkey: keypair.publicKey,
//           toPubkey: new PublicKey(recipientAddress),
//           lamports: 0.001 * LAMPORTS_PER_SOL,
//         }),
//         SystemProgram.transfer({
//           fromPubkey: keypair.publicKey,
//           toPubkey: new PublicKey(TIP_ACCOUNTS[Math.floor(Math.random() * TIP_ACCOUNTS.length)]),
//           lamports: 0.001 * LAMPORTS_PER_SOL,
//         })
//       ],
//       payerKey: keypair.publicKey,
//       recentBlockhash: blockhash,
//     }).compileToV0Message()
//   );

//   // Sign transaction
//   transaction.sign([keypair]);
//   console.log('Sending transaction via Sender endpoint...');

//   // Frontend: Use HTTPS endpoint to avoid CORS issues
//   const SENDER_ENDPOINT = 'https://sender.helius-rpc.com/fast'; 
//   // Backend: Use regional HTTP endpoint closest to your servers
//   // const SENDER_ENDPOINT = 'http://slc-sender.helius-rpc.com/fast';
//   const response = await fetch(SENDER_ENDPOINT, {
//     method: 'POST',
//     headers: { 'Content-Type': 'application/json' },
//     body: JSON.stringify({
//       jsonrpc: '2.0',
//       id: Date.now().toString(),
//       method: 'sendTransaction',
//       params: [
//         Buffer.from(transaction.serialize()).toString('base64'),
//         {
//           encoding: 'base64',
//           skipPreflight: true, // Required for Sender
//           maxRetries: 0
//         }
//       ]
//     })
//   });
//   const json = await response.json();
//   if (json.error) {
//     throw new Error(json.error.message);
//   }
//   const signature = json.result;
//   console.log('Transaction sent:', signature);
  
//   // Confirmation check
//   for (let i = 0; i < 30; i++) {
//     const status = await connection.getSignatureStatuses([signature]);
//     console.log('Status:', status?.value[0]?.confirmationStatus || 'pending');
    
//     if (status?.value[0]?.confirmationStatus === "confirmed") {
//       console.log('Transaction confirmed!');
//       return signature;
//     }
    
//     await new Promise(resolve => setTimeout(resolve, 500));
//   }
  
//   console.log('Transaction may have succeeded but confirmation timed out');
//   return signature;
// }

// // Send transaction
// sendWithSender(Keypair.fromSecretKey(bs58.decode(PRIV_B58)), RECIPIENT);
// ```

// ### Advanced Example with Dynamic Optimization

// The advanced example improves on the simple version with dynamic Jito tips (75th percentile), automatic compute unit calculation, dynamic priority fees, and retry logic.

// ```typescript [expandable]
// import { 
//   Connection, 
//   TransactionMessage,
//   VersionedTransaction,
//   SystemProgram, 
//   PublicKey,
//   Keypair,
//   LAMPORTS_PER_SOL,
//   ComputeBudgetProgram,
//   TransactionInstruction
// } from '@solana/web3.js';
// import bs58 from 'bs58';

// const TIP_ACCOUNTS = [
//   "4ACfpUFoaSD9bfPdeu6DBt89gB6ENTeHBXCAi87NhDEE",
//   "D2L6yPZ2FmmmTKPgzaMKdhu6EWZcTpLy1Vhx8uvZe7NZ", 
//   "9bnz4RShgq1hAnLnZbP8kbgBg1kEmcJBYQq3gQbmnSta",
//   "5VY91ws6B2hMmBFRsXkoAAdsPHBJwRfBht4DXox3xkwn",
//   "2nyhqdwKcJZR2vcqCyrYsaPVdAnFoJjiksCXJ7hfEYgD",
//   "2q5pghRs6arqVjRvT5gfgWfWcHWmw1ZuCzphgd5KfWGJ",
//   "wyvPkWjVZz1M8fHQnMMCDTQDbkManefNNhweYk5WkcF",
//   "3KCKozbAaF75qEU33jtzozcJ29yJuaLJTy2jFdzUY8bT",
//   "4vieeGHPYPG2MmyPRcYjdiDmmhN3ww7hsFNap8pVN3Ey",
//   "4TQLFNWK8AovT1gFvda5jfw2oJeRMKEmw7aH6MGBJ3or"
// ];

// async function getDynamicTipAmount(): Promise<number> {
//   try {
//     const response = await fetch('https://bundles.jito.wtf/api/v1/bundles/tip_floor');
//     const data = await response.json();
    
//     if (data && data[0] && typeof data[0].landed_tips_75th_percentile === 'number') {
//       const tip75th = data[0].landed_tips_75th_percentile;
//       // Use 75th percentile but minimum 0.001 SOL
//       return Math.max(tip75th, 0.001);
//     }
    
//     // Fallback if API fails or data is invalid
//     return 0.001;
//   } catch (error) {
//     console.warn('Failed to fetch dynamic tip amount, using fallback:', error);
//     return 0.001; // Fallback to minimum
//   }
// }

// async function sendWithSender(
//   keypair: Keypair, 
//   instructions: TransactionInstruction[]
// ): Promise<string> {
//   const connection = new Connection('https://mainnet.helius-rpc.com/?api-key=YOUR_API_KEY');
  
//   // Validate user hasn't included compute budget instructions
//   const hasComputeBudget = instructions.some(ix => 
//     ix.programId.equals(ComputeBudgetProgram.programId)
//   );
//   if (hasComputeBudget) {
//     throw new Error('Do not include compute budget instructions - they are added automatically');
//   }
  
//   // Create copy of instructions to avoid modifying the original array
//   const allInstructions = [...instructions];
  
//   // Get dynamic tip amount from Jito API (75th percentile, minimum 0.001 SOL)
//   const tipAmountSOL = await getDynamicTipAmount();
//   const tipAccount = new PublicKey(TIP_ACCOUNTS[Math.floor(Math.random() * TIP_ACCOUNTS.length)]);
  
//   console.log(`Using dynamic tip amount: ${tipAmountSOL} SOL`);
  
//   allInstructions.push(
//     SystemProgram.transfer({
//       fromPubkey: keypair.publicKey,
//       toPubkey: tipAccount,
//       lamports: tipAmountSOL * LAMPORTS_PER_SOL,
//     })
//   );
  
//   // Get recent blockhash with context (Helius best practice)
//   const { value: blockhashInfo } = await connection.getLatestBlockhashAndContext('confirmed');
//   const { blockhash, lastValidBlockHeight } = blockhashInfo;
  
//   // Simulate transaction to get compute units
//   const testInstructions = [
//     ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }),
//     ...allInstructions,
//   ];

//   const testTransaction = new VersionedTransaction(
//     new TransactionMessage({
//       instructions: testInstructions,
//       payerKey: keypair.publicKey,
//       recentBlockhash: blockhash,
//     }).compileToV0Message()
//   );
//   testTransaction.sign([keypair]);

//   const simulation = await connection.simulateTransaction(testTransaction, {
//     replaceRecentBlockhash: true,
//     sigVerify: false,
//   });

//   if (!simulation.value.unitsConsumed) {
//     throw new Error('Simulation failed to return compute units');
//   }

//   // Set compute unit limit with minimum 1000 CUs and 10% margin (Helius best practice)
//   const units = simulation.value.unitsConsumed;
//   const computeUnits = units < 1000 ? 1000 : Math.ceil(units * 1.1);
  
//   // Get dynamic priority fee from Helius Priority Fee API
//   const priorityFee = await getPriorityFee(
//     connection, 
//     allInstructions, 
//     keypair.publicKey, 
//     blockhash
//   );
  
//   // Add compute budget instructions at the BEGINNING (must be first)
//   allInstructions.unshift(
//     ComputeBudgetProgram.setComputeUnitPrice({ microLamports: priorityFee })
//   );
//   allInstructions.unshift(
//     ComputeBudgetProgram.setComputeUnitLimit({ units: computeUnits })
//   );

//   // Build final optimized transaction
//   const transaction = new VersionedTransaction(
//     new TransactionMessage({
//       instructions: allInstructions,
//       payerKey: keypair.publicKey,
//       recentBlockhash: blockhash,
//     }).compileToV0Message()
//   );
//   transaction.sign([keypair]);

//   // Send via Sender endpoint with retry logic
//   return await sendWithRetry(transaction, connection, lastValidBlockHeight);
// }

// async function getPriorityFee(
//   connection: Connection, 
//   instructions: TransactionInstruction[], 
//   payerKey: PublicKey, 
//   blockhash: string
// ): Promise<number> {
//   try {
//     const tempTx = new VersionedTransaction(
//       new TransactionMessage({
//         instructions,
//         payerKey,
//         recentBlockhash: blockhash,
//       }).compileToV0Message()
//     );
    
//     const response = await fetch(connection.rpcEndpoint, {
//       method: "POST",
//       headers: { "Content-Type": "application/json" },
//       body: JSON.stringify({
//         jsonrpc: "2.0",
//         id: "1",
//         method: "getPriorityFeeEstimate",
//         params: [{
//           transaction: bs58.encode(tempTx.serialize()),
//           options: { recommended: true },
//         }],   
//       }),
//     });
    
//     const data = await response.json();
//     return data.result?.priorityFeeEstimate ? 
//       Math.ceil(data.result.priorityFeeEstimate * 1.2) : 50_000;
//   } catch {
//     return 50_000; // Fallback fee
//   }
// }

// async function sendWithRetry(
//   transaction: VersionedTransaction,
//   connection: Connection,
//   lastValidBlockHeight: number
// ): Promise<string> {
//   const maxRetries = 3;
//   // Frontend: Use HTTPS endpoint to avoid CORS issues
//   const endpoint = 'https://sender.helius-rpc.com/fast';
//   // Backend: Use regional HTTP endpoint closest to your servers
//   // const endpoint = 'http://slc-sender.helius-rpc.com/fast';
  
//   for (let attempt = 0; attempt < maxRetries; attempt++) {
//     try {
//       // Check blockhash validity
//       const currentHeight = await connection.getBlockHeight('confirmed');
//       if (currentHeight > lastValidBlockHeight) {
//         throw new Error('Blockhash expired');
//       }
      
//       // Send transaction via Sender endpoint
//       const response = await fetch(endpoint, {
//         method: 'POST',
//         headers: { 'Content-Type': 'application/json' },
//         body: JSON.stringify({
//           jsonrpc: "2.0",
//           id: Date.now().toString(),
//           method: "sendTransaction",
//           params: [
//             Buffer.from(transaction.serialize()).toString('base64'),
//             {
//               encoding: "base64",
//               skipPreflight: true,    // Required for Sender
//               maxRetries: 0           // Implement your own retry logic
//             }
//           ]
//         })
//       });
      
//       const result = await response.json();
//       if (result.error) throw new Error(result.error.message);
      
//       console.log(`Transaction sent: ${result.result}`);
//       return await confirmTransaction(result.result, connection);
      
//     } catch (error) {
//       console.warn(`Attempt ${attempt + 1} failed:`, error);
//       if (attempt === maxRetries - 1) throw error;
//       await new Promise(resolve => setTimeout(resolve, 2000));
//     }
//   }
  
//   throw new Error('All retry attempts failed');
// }

// async function confirmTransaction(
//   signature: string, 
//   connection: Connection
// ): Promise<string> {
//   const timeout = 15000;
//   const interval = 3000;
//   const startTime = Date.now();
  
//   while (Date.now() - startTime < timeout) {
//     try {
//       const status = await connection.getSignatureStatuses([signature]);
//       if (status?.value[0]?.confirmationStatus === "confirmed") {
//         return signature;
//       }
//     } catch (error) {
//       console.warn('Status check failed:', error);
//     }
//     await new Promise(resolve => setTimeout(resolve, interval));
//   }
  
//   throw new Error(`Transaction confirmation timeout: ${signature}`);
// }

// // Example usage following standard Helius docs pattern
// export async function exampleUsage() {
//   const keypair = Keypair.fromSecretKey(new Uint8Array([/* your secret key */]));
  
//   // 1. Prepare your transaction instructions (USER ADDS THEIR INSTRUCTIONS HERE)
//   const instructions: TransactionInstruction[] = [
//     SystemProgram.transfer({
//       fromPubkey: keypair.publicKey,
//       toPubkey: new PublicKey("RECIPIENT_ADDRESS"),
//       lamports: 0.1 * LAMPORTS_PER_SOL,
//     }),
//     // Add more instructions as needed
//   ];
  
//   // 2. Send with Sender (automatically adds tip + optimizations)
//   try {
//     const signature = await sendWithSender(keypair, instructions);
//     console.log(`Successful transaction: ${signature}`);
//   } catch (error) {
//     console.error('Transaction failed:', error);
//   }
// }

// export { sendWithSender };
// ```

// ## Best Practices

// ### Endpoint Selection

// * **Frontend Applications**: Use `https://sender.helius-rpc.com/fast` to avoid CORS preflight failures. This endpoint automatically routes to the nearest location for optimal performance.
// * **Backend Applications**: Choose the regional HTTP [endpoint](#endpoints) closest to your infrastructure for optimal performance

// ### Connection Warming

// * Use the `/ping` endpoint during idle periods longer than 1 minute
// * Implement periodic ping calls (every 30-60 seconds) to maintain warm connections
// * Warm connections before high-frequency trading sessions begin

// ### Transaction Setup

// * Use `skipPreflight: true` and `maxRetries: 0`
// * Implement your own retry logic
// * Include minimum 0.001 SOL tip to designated accounts
// * Fetch blockhash with `'confirmed'` commitment
// * Set appropriate compute unit limits

// ## Rate Limits and Scaling

// * **Default Rate Limit**: 6 transactions per second
// * **No Credit Usage**: Sender transactions don't consume API credits from your plan

// ## Support and Scaling

// For production deployments requiring higher throughput:

// 1. **Create a Support Ticket**: Include your expected TPS and use case details
// 2. **Provide Metrics**: Share your current transaction patterns

// Contact support through the [Helius Dashboard](https://dashboard.helius.dev) or join our [Discord community](https://discord.com/invite/6GXdee3gBj).


//     # Helius Sender: Ultra-Low Latency Solana Transaction Submission

// > Ultra-low latency Solana transaction submission with dual routing to validators and Jito infrastructure. No credits consumed, global endpoints, optimized for high-frequency trading.

// ## Overview

// Helius Sender is a specialized service for ultra-low latency transaction submission. It optimizes transaction latency by sending to both Solana validators and [Jito](https://docs.jito.wtf/) simultaneously, providing multiple pathways for your transactions to be included in blocks.

// <CardGroup cols={2}>
//   <Card title="Dual Routing" icon="route">
//     Sends to both validators and Jito for optimal speed
//   </Card>

//   <Card title="Global Endpoints" icon="globe">
//     HTTPS endpoint auto-routes to nearest location for frontends, regional HTTP for backends
//   </Card>

//   <Card title="No Credits" icon="coins">
//     Available on all plans without consuming API credits
//   </Card>

//   <Card title="High Throughput" icon="gauge-high">
//     Default 6 TPS, contact us for higher limits
//   </Card>
// </CardGroup>

// ## Quick Start Guide

// Ready to submit your first ultra-low latency Solana transaction? This guide will get you started with Helius Sender in minutes. The best part: **you don't need any paid plan or special access** - Sender is available to all users and doesn't consume API credits.

// <Steps titleSize="h3">
//   <Step title="Create Your Free Helius Account">
//     Start by creating your free account at the [Helius Dashboard](https://dashboard.helius.dev/dashboard). Sender is available on all plans, including the free tier, and doesn't consume any API credits.
//   </Step>

//   <Step title="Get Your API Key">
//     Navigate to the [API Keys](https://dashboard.helius.dev/api-keys) section and copy your key. You'll use this for getting blockhashes and transaction confirmation, while Sender handles the transaction submission.
//   </Step>

//   <Step title="Send Your First Transaction">
//     Let's send a simple SOL transfer using Sender. This example includes all required components: tip, priority fee, and skipped preflight.

//     ```typescript [expandable]
//     import { 
//       Connection, 
//       TransactionMessage,
//       VersionedTransaction,
//       SystemProgram, 
//       PublicKey,
//       Keypair,
//       LAMPORTS_PER_SOL,
//       ComputeBudgetProgram
//     } from '@solana/web3.js';
//     import bs58 from 'bs58';

//     const TIP_ACCOUNTS = [
//       "4ACfpUFoaSD9bfPdeu6DBt89gB6ENTeHBXCAi87NhDEE",
//       "D2L6yPZ2FmmmTKPgzaMKdhu6EWZcTpLy1Vhx8uvZe7NZ", 
//       "9bnz4RShgq1hAnLnZbP8kbgBg1kEmcJBYQq3gQbmnSta"
//       // ... more tip accounts available
//     ];

//     async function sendWithSender(
//       keypair: Keypair, 
//       recipientAddress: string
//     ): Promise<string> {
//       const connection = new Connection(
//         'https://mainnet.helius-rpc.com/?api-key=YOUR_API_KEY'
//       );
      
//       const { value: { blockhash } } = await connection.getLatestBlockhashAndContext('confirmed');
      
//       // Build transaction with tip transfer and transfer to recipient
//       const transaction = new VersionedTransaction(
//         new TransactionMessage({
//           instructions: [
//             ComputeBudgetProgram.setComputeUnitLimit({ units: 100_000 }),
//             ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 200_000 }),
//             SystemProgram.transfer({
//               fromPubkey: keypair.publicKey,
//               toPubkey: new PublicKey(recipientAddress),
//               lamports: 0.001 * LAMPORTS_PER_SOL,
//             }),
//             SystemProgram.transfer({
//               fromPubkey: keypair.publicKey,
//               toPubkey: new PublicKey(TIP_ACCOUNTS[Math.floor(Math.random() * TIP_ACCOUNTS.length)]),
//               lamports: 0.001 * LAMPORTS_PER_SOL,
//             })
//           ],
//           payerKey: keypair.publicKey,
//           recentBlockhash: blockhash,
//         }).compileToV0Message()
//       );

//       transaction.sign([keypair]);
//       console.log('Sending transaction via Sender endpoint...');

//       const response = await fetch('http://slc-sender.helius-rpc.com/fast', {
//         method: 'POST',
//         headers: { 'Content-Type': 'application/json' },
//         body: JSON.stringify({
//           jsonrpc: '2.0',
//           id: Date.now().toString(),
//           method: 'sendTransaction',
//           params: [
//             Buffer.from(transaction.serialize()).toString('base64'),
//             {
//               encoding: 'base64',
//               skipPreflight: true, // Required for Sender
//               maxRetries: 0
//             }
//           ]
//         })
//       });
      
//       const json = await response.json();
//       if (json.error) {
//         throw new Error(json.error.message);
//       }
      
//       console.log('Transaction sent:', json.result);
//       return json.result;
//     }

//     // Usage
//     const keypair = Keypair.fromSecretKey(bs58.decode('YOUR_PRIVATE_KEY'));
//     sendWithSender(keypair, 'RECIPIENT_ADDRESS');
//     ```
//   </Step>

//   <Step title="Success! Understanding What Happened">
//     You've successfully submitted a transaction via Sender! Here's what made it work:

//     * **No credits consumed**: Sender is free for all users
//     * **Dual routing**: Your transaction was sent to both validators and Jito simultaneously
//     * **Required tip**: The 0.001 SOL tip enables Jito's auction participation
//     * **Priority fee**: Signals validators your willingness to pay for priority processing
//     * **Skipped preflight**: Optimizes for speed over validation
//   </Step>
// </Steps>

// **What's Next?** The code above works, but you can optimize further with dynamic fees, automatic compute unit calculation, and retry logic. Check out the [Simple Code Example](#simple-code-example) and [Advanced Example with Dynamic Optimization](#advanced-example-with-dynamic-optimization) below for production-ready implementations with detailed explanations.

// ## Routing Options

// <CardGroup cols={2}>
//   <Card title="Default Dual Routing" icon="arrows-split-up-and-left">
//     Sends transactions to both Solana validators and Jito infrastructure simultaneously for maximum inclusion probability. Requires minimum 0.001 SOL tip.
//   </Card>

//   <Card title="SWQOS-Only Alternative" icon="dollar-sign">
//     For cost-optimized trading, add `?swqos_only=true` to any endpoint URL. Routes exclusively through SWQOS infrastructure with a lower 0.0005 SOL minimum tip requirement.
//   </Card>
// </CardGroup>

// ## Requirements

// <Warning>
//   **Mandatory Requirements**: All transactions must include tips (0.001 SOL minimum, or 0.0005 SOL for SWQOS-only), priority fees, and skip preflight checks.
// </Warning>

// ### 1. Skip Preflight (Mandatory)

// The `skipPreflight` parameter **must** be set to `true`. Sender is optimized for traders who prioritize speed over transaction validation.

// ```typescript
// {
//   "skipPreflight": true  // Required: must be true
// }
// ```

// <Warning>
//   Since preflight checks are skipped, ensure your transactions are properly constructed and funded before submission. Invalid transactions will be rejected by the network after submission.
// </Warning>

// ### 2. Tips and Priority Fees Required

// All transactions submitted through Sender **must include both tips and priority fees**:

// * **Tips**: Minimum 0.001 SOL transfer to a designated tip account (or 0.0005 SOL for SWQOS-only)

// <Accordion title="Designated Tip Accounts (mainnet-beta)">
//   ```text
//   4ACfpUFoaSD9bfPdeu6DBt89gB6ENTeHBXCAi87NhDEE
//   D2L6yPZ2FmmmTKPgzaMKdhu6EWZcTpLy1Vhx8uvZe7NZ
//   9bnz4RShgq1hAnLnZbP8kbgBg1kEmcJBYQq3gQbmnSta
//   5VY91ws6B2hMmBFRsXkoAAdsPHBJwRfBht4DXox3xkwn
//   2nyhqdwKcJZR2vcqCyrYsaPVdAnFoJjiksCXJ7hfEYgD
//   2q5pghRs6arqVjRvT5gfgWfWcHWmw1ZuCzphgd5KfWGJ
//   wyvPkWjVZz1M8fHQnMMCDTQDbkManefNNhweYk5WkcF
//   3KCKozbAaF75qEU33jtzozcJ29yJuaLJTy2jFdzUY8bT
//   4vieeGHPYPG2MmyPRcYjdiDmmhN3ww7hsFNap8pVN3Ey
//   4TQLFNWK8AovT1gFvda5jfw2oJeRMKEmw7aH6MGBJ3or
//   ```
// </Accordion>

// * **Priority Fees**: Compute unit pricing via `ComputeBudgetProgram.setComputeUnitPrice` to prioritize your transaction in the validator queue

// #### Why Both Are Required

// * **Tips**: Enable access to Jito's infrastructure and auction-based transaction inclusion
// * **Priority Fees**: Signal to validators your willingness to pay for priority processing through Solana's native prioritization system
// * **Dual Benefit**: Tips give you access to Jito's auction, while priority fees improve your transaction's priority with validators—together they maximize inclusion probability

// #### Tip and Priority Fee Guidelines

// **Jito Tips**: Minimum 0.001 SOL is mandatory for auction participation. For current best-practice tip sizing, see the [Jito tip guidelines](https://docs.jito.wtf/lowlatencytxnsend/#tips).

// **Priority Fees**: Use the [Helius Priority Fee API](/priority-fee-api) for real-time fee recommendations.

// ## Endpoints

// Sender endpoints are available in multiple configurations depending on your use case:

// <Tabs>
//   <Tab title="Frontend/Browser Applications">
//     **Recommended for frontend applications to avoid CORS issues:**

//     ```
//     https://sender.helius-rpc.com/fast         # Global HTTPS endpoint
//     ```

//     <Note>
//       The HTTPS endpoint resolves CORS preflight failures that occur with browser-based applications when using the regional HTTP endpoints. This endpoint automatically routes to the nearest location for optimal performance. Use this for all frontend/browser implementations.
//     </Note>
//   </Tab>

//   <Tab title="Backend/Server Applications">
//     **Regional HTTP endpoints for optimal server-to-server latency:**

//     ```
//     http://slc-sender.helius-rpc.com/fast      # Salt Lake City
//     http://ewr-sender.helius-rpc.com/fast      # Newark
//     http://lon-sender.helius-rpc.com/fast      # London  
//     http://fra-sender.helius-rpc.com/fast      # Frankfurt
//     http://ams-sender.helius-rpc.com/fast      # Amsterdam
//     http://sg-sender.helius-rpc.com/fast       # Singapore
//     http://tyo-sender.helius-rpc.com/fast      # Tokyo
//     ```

//     <Note>
//       For backend/server applications, choose the regional HTTP endpoint closest to your infrastructure for optimal performance.
//     </Note>
//   </Tab>

//   <Tab title="Connection Warming">
//     **HTTPS (Frontend):**

//     ```
//     https://sender.helius-rpc.com/ping         # Global HTTPS ping (auto-routes to nearest location)
//     ```

//     **HTTP (Backend):**

//     ```
//     http://slc-sender.helius-rpc.com/ping      # Salt Lake City
//     http://ewr-sender.helius-rpc.com/ping      # Newark
//     http://lon-sender.helius-rpc.com/ping      # London  
//     http://fra-sender.helius-rpc.com/ping      # Frankfurt
//     http://ams-sender.helius-rpc.com/ping      # Amsterdam
//     http://sg-sender.helius-rpc.com/ping       # Singapore
//     http://tyo-sender.helius-rpc.com/ping      # Tokyo
//     ```
//   </Tab>
// </Tabs>

// ## Connection Warming

// For applications with long periods between transaction submissions, use the ping endpoint to maintain warm connections and reduce cold start latency.

// ### Ping Endpoint Usage

// The ping endpoint accepts simple GET requests and returns a basic response to keep connections alive:

// ```bash
// # Frontend applications - use HTTPS (auto-routes to nearest location)
// curl https://sender.helius-rpc.com/ping

// # Backend applications - use regional HTTP
// curl http://slc-sender.helius-rpc.com/ping
// ```

// ```typescript
// // Keep connection warm during idle periods
// async function warmConnection(endpoint: string) {
//   try {
//     const response = await fetch(`${endpoint}/ping`);
//     console.log('Connection warmed:', response.ok);
//   } catch (error) {
//     console.warn('Failed to warm connection:', error);
//   }
// }

// // Frontend applications - use HTTPS endpoint
// setInterval(() => {
//   warmConnection('https://sender.helius-rpc.com');
// }, 30000);

// // Backend/server applications - use regional HTTP endpoint
// setInterval(() => {
//   warmConnection('http://slc-sender.helius-rpc.com');
// }, 30000);
// ```

// <Tip>
//   Use connection warming when your application has gaps longer than 1 minute between transactions to maintain optimal submission latency.
// </Tip>

// ## Usage

// The Sender endpoint uses the same `sendTransaction` method as standard RPC endpoints but with specific requirements for optimal performance. **All transactions must include both tips and priority fees, plus skip preflight checks.**

// ### Basic Request Format

// ```typescript
// {
//   "id": "unique-request-id",
//   "jsonrpc": "2.0", 
//   "method": "sendTransaction",
//   "params": [
//     "BASE64_ENCODED_TRANSACTION", // Must include both tip and priority fee instructions
//     {
//       "encoding": "base64",
//       "skipPreflight": true,       // Required: must be true
//       "maxRetries": 0
//     }
//   ]
// }
// ```

// <Warning>
//   The `BASE64_ENCODED_TRANSACTION` above must contain both a SOL transfer instruction with minimum tip to designated tip accounts AND a compute unit price instruction. Without both requirements, your transaction will be rejected.
// </Warning>

// ### Simple Code Example

// ```typescript [expandable]
// import { 
//   Connection, 
//   TransactionMessage,
//   VersionedTransaction,
//   SystemProgram, 
//   PublicKey,
//   Keypair,
//   LAMPORTS_PER_SOL,
//   ComputeBudgetProgram
// } from '@solana/web3.js';
// import bs58 from 'bs58';

// const PRIV_B58 = 'Your Private Key';
// const RECIPIENT = 'Random Recipient';
// const HELIUS_API_KEY = 'Your API Key';
// const TIP_ACCOUNTS = [
//   "4ACfpUFoaSD9bfPdeu6DBt89gB6ENTeHBXCAi87NhDEE",
//   "D2L6yPZ2FmmmTKPgzaMKdhu6EWZcTpLy1Vhx8uvZe7NZ", 
//   "9bnz4RShgq1hAnLnZbP8kbgBg1kEmcJBYQq3gQbmnSta",
//   "5VY91ws6B2hMmBFRsXkoAAdsPHBJwRfBht4DXox3xkwn",
//   "2nyhqdwKcJZR2vcqCyrYsaPVdAnFoJjiksCXJ7hfEYgD",
//   "2q5pghRs6arqVjRvT5gfgWfWcHWmw1ZuCzphgd5KfWGJ",
//   "wyvPkWjVZz1M8fHQnMMCDTQDbkManefNNhweYk5WkcF",
//   "3KCKozbAaF75qEU33jtzozcJ29yJuaLJTy2jFdzUY8bT",
//   "4vieeGHPYPG2MmyPRcYjdiDmmhN3ww7hsFNap8pVN3Ey",
//   "4TQLFNWK8AovT1gFvda5jfw2oJeRMKEmw7aH6MGBJ3or"
// ];

// async function sendWithSender(
//   keypair: Keypair, 
//   recipientAddress: string
// ): Promise<string> {
//   const connection = new Connection(
//     `https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`
//   );
  
//   const { value: { blockhash } } = await connection.getLatestBlockhashAndContext('confirmed');
  
//   // Build transaction with tip transfer and transfer to recipient
//   const transaction = new VersionedTransaction(
//     new TransactionMessage({
//       instructions: [
//         ComputeBudgetProgram.setComputeUnitLimit({ units: 100_000 }),
//         ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 200_000 }),
//         SystemProgram.transfer({
//           fromPubkey: keypair.publicKey,
//           toPubkey: new PublicKey(recipientAddress),
//           lamports: 0.001 * LAMPORTS_PER_SOL,
//         }),
//         SystemProgram.transfer({
//           fromPubkey: keypair.publicKey,
//           toPubkey: new PublicKey(TIP_ACCOUNTS[Math.floor(Math.random() * TIP_ACCOUNTS.length)]),
//           lamports: 0.001 * LAMPORTS_PER_SOL,
//         })
//       ],
//       payerKey: keypair.publicKey,
//       recentBlockhash: blockhash,
//     }).compileToV0Message()
//   );

//   // Sign transaction
//   transaction.sign([keypair]);
//   console.log('Sending transaction via Sender endpoint...');

//   // Frontend: Use HTTPS endpoint to avoid CORS issues
//   const SENDER_ENDPOINT = 'https://sender.helius-rpc.com/fast'; 
//   // Backend: Use regional HTTP endpoint closest to your servers
//   // const SENDER_ENDPOINT = 'http://slc-sender.helius-rpc.com/fast';
//   const response = await fetch(SENDER_ENDPOINT, {
//     method: 'POST',
//     headers: { 'Content-Type': 'application/json' },
//     body: JSON.stringify({
//       jsonrpc: '2.0',
//       id: Date.now().toString(),
//       method: 'sendTransaction',
//       params: [
//         Buffer.from(transaction.serialize()).toString('base64'),
//         {
//           encoding: 'base64',
//           skipPreflight: true, // Required for Sender
//           maxRetries: 0
//         }
//       ]
//     })
//   });
//   const json = await response.json();
//   if (json.error) {
//     throw new Error(json.error.message);
//   }
//   const signature = json.result;
//   console.log('Transaction sent:', signature);
  
//   // Confirmation check
//   for (let i = 0; i < 30; i++) {
//     const status = await connection.getSignatureStatuses([signature]);
//     console.log('Status:', status?.value[0]?.confirmationStatus || 'pending');
    
//     if (status?.value[0]?.confirmationStatus === "confirmed") {
//       console.log('Transaction confirmed!');
//       return signature;
//     }
    
//     await new Promise(resolve => setTimeout(resolve, 500));
//   }
  
//   console.log('Transaction may have succeeded but confirmation timed out');
//   return signature;
// }

// // Send transaction
// sendWithSender(Keypair.fromSecretKey(bs58.decode(PRIV_B58)), RECIPIENT);
// ```

// ### Advanced Example with Dynamic Optimization

// The advanced example improves on the simple version with dynamic Jito tips (75th percentile), automatic compute unit calculation, dynamic priority fees, and retry logic.

// ```typescript [expandable]
// import { 
//   Connection, 
//   TransactionMessage,
//   VersionedTransaction,
//   SystemProgram, 
//   PublicKey,
//   Keypair,
//   LAMPORTS_PER_SOL,
//   ComputeBudgetProgram,
//   TransactionInstruction
// } from '@solana/web3.js';
// import bs58 from 'bs58';

// const TIP_ACCOUNTS = [
//   "4ACfpUFoaSD9bfPdeu6DBt89gB6ENTeHBXCAi87NhDEE",
//   "D2L6yPZ2FmmmTKPgzaMKdhu6EWZcTpLy1Vhx8uvZe7NZ", 
//   "9bnz4RShgq1hAnLnZbP8kbgBg1kEmcJBYQq3gQbmnSta",
//   "5VY91ws6B2hMmBFRsXkoAAdsPHBJwRfBht4DXox3xkwn",
//   "2nyhqdwKcJZR2vcqCyrYsaPVdAnFoJjiksCXJ7hfEYgD",
//   "2q5pghRs6arqVjRvT5gfgWfWcHWmw1ZuCzphgd5KfWGJ",
//   "wyvPkWjVZz1M8fHQnMMCDTQDbkManefNNhweYk5WkcF",
//   "3KCKozbAaF75qEU33jtzozcJ29yJuaLJTy2jFdzUY8bT",
//   "4vieeGHPYPG2MmyPRcYjdiDmmhN3ww7hsFNap8pVN3Ey",
//   "4TQLFNWK8AovT1gFvda5jfw2oJeRMKEmw7aH6MGBJ3or"
// ];

// async function getDynamicTipAmount(): Promise<number> {
//   try {
//     const response = await fetch('https://bundles.jito.wtf/api/v1/bundles/tip_floor');
//     const data = await response.json();
    
//     if (data && data[0] && typeof data[0].landed_tips_75th_percentile === 'number') {
//       const tip75th = data[0].landed_tips_75th_percentile;
//       // Use 75th percentile but minimum 0.001 SOL
//       return Math.max(tip75th, 0.001);
//     }
    
//     // Fallback if API fails or data is invalid
//     return 0.001;
//   } catch (error) {
//     console.warn('Failed to fetch dynamic tip amount, using fallback:', error);
//     return 0.001; // Fallback to minimum
//   }
// }

// async function sendWithSender(
//   keypair: Keypair, 
//   instructions: TransactionInstruction[]
// ): Promise<string> {
//   const connection = new Connection('https://mainnet.helius-rpc.com/?api-key=YOUR_API_KEY');
  
//   // Validate user hasn't included compute budget instructions
//   const hasComputeBudget = instructions.some(ix => 
//     ix.programId.equals(ComputeBudgetProgram.programId)
//   );
//   if (hasComputeBudget) {
//     throw new Error('Do not include compute budget instructions - they are added automatically');
//   }
  
//   // Create copy of instructions to avoid modifying the original array
//   const allInstructions = [...instructions];
  
//   // Get dynamic tip amount from Jito API (75th percentile, minimum 0.001 SOL)
//   const tipAmountSOL = await getDynamicTipAmount();
//   const tipAccount = new PublicKey(TIP_ACCOUNTS[Math.floor(Math.random() * TIP_ACCOUNTS.length)]);
  
//   console.log(`Using dynamic tip amount: ${tipAmountSOL} SOL`);
  
//   allInstructions.push(
//     SystemProgram.transfer({
//       fromPubkey: keypair.publicKey,
//       toPubkey: tipAccount,
//       lamports: tipAmountSOL * LAMPORTS_PER_SOL,
//     })
//   );
  
//   // Get recent blockhash with context (Helius best practice)
//   const { value: blockhashInfo } = await connection.getLatestBlockhashAndContext('confirmed');
//   const { blockhash, lastValidBlockHeight } = blockhashInfo;
  
//   // Simulate transaction to get compute units
//   const testInstructions = [
//     ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }),
//     ...allInstructions,
//   ];

//   const testTransaction = new VersionedTransaction(
//     new TransactionMessage({
//       instructions: testInstructions,
//       payerKey: keypair.publicKey,
//       recentBlockhash: blockhash,
//     }).compileToV0Message()
//   );
//   testTransaction.sign([keypair]);

//   const simulation = await connection.simulateTransaction(testTransaction, {
//     replaceRecentBlockhash: true,
//     sigVerify: false,
//   });

//   if (!simulation.value.unitsConsumed) {
//     throw new Error('Simulation failed to return compute units');
//   }

//   // Set compute unit limit with minimum 1000 CUs and 10% margin (Helius best practice)
//   const units = simulation.value.unitsConsumed;
//   const computeUnits = units < 1000 ? 1000 : Math.ceil(units * 1.1);
  
//   // Get dynamic priority fee from Helius Priority Fee API
//   const priorityFee = await getPriorityFee(
//     connection, 
//     allInstructions, 
//     keypair.publicKey, 
//     blockhash
//   );
  
//   // Add compute budget instructions at the BEGINNING (must be first)
//   allInstructions.unshift(
//     ComputeBudgetProgram.setComputeUnitPrice({ microLamports: priorityFee })
//   );
//   allInstructions.unshift(
//     ComputeBudgetProgram.setComputeUnitLimit({ units: computeUnits })
//   );

//   // Build final optimized transaction
//   const transaction = new VersionedTransaction(
//     new TransactionMessage({
//       instructions: allInstructions,
//       payerKey: keypair.publicKey,
//       recentBlockhash: blockhash,
//     }).compileToV0Message()
//   );
//   transaction.sign([keypair]);

//   // Send via Sender endpoint with retry logic
//   return await sendWithRetry(transaction, connection, lastValidBlockHeight);
// }

// async function getPriorityFee(
//   connection: Connection, 
//   instructions: TransactionInstruction[], 
//   payerKey: PublicKey, 
//   blockhash: string
// ): Promise<number> {
//   try {
//     const tempTx = new VersionedTransaction(
//       new TransactionMessage({
//         instructions,
//         payerKey,
//         recentBlockhash: blockhash,
//       }).compileToV0Message()
//     );
    
//     const response = await fetch(connection.rpcEndpoint, {
//       method: "POST",
//       headers: { "Content-Type": "application/json" },
//       body: JSON.stringify({
//         jsonrpc: "2.0",
//         id: "1",
//         method: "getPriorityFeeEstimate",
//         params: [{
//           transaction: bs58.encode(tempTx.serialize()),
//           options: { recommended: true },
//         }],   
//       }),
//     });
    
//     const data = await response.json();
//     return data.result?.priorityFeeEstimate ? 
//       Math.ceil(data.result.priorityFeeEstimate * 1.2) : 50_000;
//   } catch {
//     return 50_000; // Fallback fee
//   }
// }

// async function sendWithRetry(
//   transaction: VersionedTransaction,
//   connection: Connection,
//   lastValidBlockHeight: number
// ): Promise<string> {
//   const maxRetries = 3;
//   // Frontend: Use HTTPS endpoint to avoid CORS issues
//   const endpoint = 'https://sender.helius-rpc.com/fast';
//   // Backend: Use regional HTTP endpoint closest to your servers
//   // const endpoint = 'http://slc-sender.helius-rpc.com/fast';
  
//   for (let attempt = 0; attempt < maxRetries; attempt++) {
//     try {
//       // Check blockhash validity
//       const currentHeight = await connection.getBlockHeight('confirmed');
//       if (currentHeight > lastValidBlockHeight) {
//         throw new Error('Blockhash expired');
//       }
      
//       // Send transaction via Sender endpoint
//       const response = await fetch(endpoint, {
//         method: 'POST',
//         headers: { 'Content-Type': 'application/json' },
//         body: JSON.stringify({
//           jsonrpc: "2.0",
//           id: Date.now().toString(),
//           method: "sendTransaction",
//           params: [
//             Buffer.from(transaction.serialize()).toString('base64'),
//             {
//               encoding: "base64",
//               skipPreflight: true,    // Required for Sender
//               maxRetries: 0           // Implement your own retry logic
//             }
//           ]
//         })
//       });
      
//       const result = await response.json();
//       if (result.error) throw new Error(result.error.message);
      
//       console.log(`Transaction sent: ${result.result}`);
//       return await confirmTransaction(result.result, connection);
      
//     } catch (error) {
//       console.warn(`Attempt ${attempt + 1} failed:`, error);
//       if (attempt === maxRetries - 1) throw error;
//       await new Promise(resolve => setTimeout(resolve, 2000));
//     }
//   }
  
//   throw new Error('All retry attempts failed');
// }

// async function confirmTransaction(
//   signature: string, 
//   connection: Connection
// ): Promise<string> {
//   const timeout = 15000;
//   const interval = 3000;
//   const startTime = Date.now();
  
//   while (Date.now() - startTime < timeout) {
//     try {
//       const status = await connection.getSignatureStatuses([signature]);
//       if (status?.value[0]?.confirmationStatus === "confirmed") {
//         return signature;
//       }
//     } catch (error) {
//       console.warn('Status check failed:', error);
//     }
//     await new Promise(resolve => setTimeout(resolve, interval));
//   }
  
//   throw new Error(`Transaction confirmation timeout: ${signature}`);
// }

// // Example usage following standard Helius docs pattern
// export async function exampleUsage() {
//   const keypair = Keypair.fromSecretKey(new Uint8Array([/* your secret key */]));
  
//   // 1. Prepare your transaction instructions (USER ADDS THEIR INSTRUCTIONS HERE)
//   const instructions: TransactionInstruction[] = [
//     SystemProgram.transfer({
//       fromPubkey: keypair.publicKey,
//       toPubkey: new PublicKey("RECIPIENT_ADDRESS"),
//       lamports: 0.1 * LAMPORTS_PER_SOL,
//     }),
//     // Add more instructions as needed
//   ];
  
//   // 2. Send with Sender (automatically adds tip + optimizations)
//   try {
//     const signature = await sendWithSender(keypair, instructions);
//     console.log(`Successful transaction: ${signature}`);
//   } catch (error) {
//     console.error('Transaction failed:', error);
//   }
// }

// export { sendWithSender };
// ```

// ## Best Practices

// ### Endpoint Selection

// * **Frontend Applications**: Use `https://sender.helius-rpc.com/fast` to avoid CORS preflight failures. This endpoint automatically routes to the nearest location for optimal performance.
// * **Backend Applications**: Choose the regional HTTP [endpoint](#endpoints) closest to your infrastructure for optimal performance

// ### Connection Warming

// * Use the `/ping` endpoint during idle periods longer than 1 minute
// * Implement periodic ping calls (every 30-60 seconds) to maintain warm connections
// * Warm connections before high-frequency trading sessions begin

// ### Transaction Setup

// * Use `skipPreflight: true` and `maxRetries: 0`
// * Implement your own retry logic
// * Include minimum 0.001 SOL tip to designated accounts
// * Fetch blockhash with `'confirmed'` commitment
// * Set appropriate compute unit limits

// ## Rate Limits and Scaling

// * **Default Rate Limit**: 6 transactions per second
// * **No Credit Usage**: Sender transactions don't consume API credits from your plan

// ## Support and Scaling

// For production deployments requiring higher throughput:

// 1. **Create a Support Ticket**: Include your expected TPS and use case details
// 2. **Provide Metrics**: Share your current transaction patterns

// Contact support through the [Helius Dashboard](https://dashboard.helius.dev) or join our [Discord community](https://discord.com/invite/6GXdee3gBj).
