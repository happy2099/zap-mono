// ==========================================
// ====== ZapBot UNIFIED Config (CJS) =======
// ==========================================
// File: config.js
// Description: Central configuration file using CommonJS for compatibility.

const { PublicKey, SystemProgram, ComputeBudgetProgram, SYSVAR_RENT_PUBKEY, SYSVAR_CLOCK_PUBKEY, LAMPORTS_PER_SOL } = require('@solana/web3.js');
const { TOKEN_PROGRAM_ID: SPL_TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID: SPL_ASSOCIATED_TOKEN_PROGRAM_ID } = require('@solana/spl-token');
const dotenv = require('dotenv');
dotenv.config();

const config = {
    // --- Telegram & Admin ---
    BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN || '7874427872:AAGxpy0tNV11RjVPszQWRdcqlwDae2lbFoU',
    ADMIN_CHAT_ID: process.env.ADMIN_CHAT_ID || '6032767351',

    // --- Solana Network ---
    RPC_URL: process.env.RPC_URL || 'https://mainnet.helius-rpc.com/?api-key=b9a69ad0-d823-429e-8c18-7cbea0e31769',
    WS_URL: process.env.WS_URL || 'wss://mainnet.helius-rpc.com/?api-key=b9a69ad0-d823-429e-8c18-7cbea0e31769',
    LASERSTREAM_ENDPOINT: process.env.LASERSTREAM_ENDPOINT || 'wss://mainnet.helius-rpc.com/?api-key=b9a69ad0-d823-429e-8c18-7cbea0e31769',
    RPC_FALLBACK_URLS: process.env.RPC_FALLBACK_URLS ? process.env.RPC_FALLBACK_URLS.split(',') : [],

    // --- Singapore Regional Endpoints (Optimized for Asia-Pacific) ---
    SINGAPORE_ENDPOINTS: {
        rpc: process.env.SGP_RPC_URL || 'https://mainnet.helius-rpc.com/?api-key=b9a69ad0-d823-429e-8c18-7cbea0e31769',
        sender: process.env.SGP_SENDER_URL || 'https://mainnet.helius-rpc.com/?api-key=b9a69ad0-d823-429e-8c18-7cbea0e31769',
        laserstream: process.env.SGP_LASERSTREAM_URL || 'wss://mainnet.helius-rpc.com/?api-key=b9a69ad0-d823-429e-8c18-7cbea0e31769',
        websocket: process.env.SGP_WS_URL || 'wss://mainnet.helius-rpc.com/?api-key=b9a69ad0-d823-429e-8c18-7cbea0e31769'
    },
    
    SENDER_ENDPOINT: process.env.SENDER_ENDPOINT || 'https://mainnet.helius-rpc.com/?api-key=b9a69ad0-d823-429e-8c18-7cbea0e31769', // Helius mainnet endpoint for lowest latency
    TIP_ACCOUNTS: [
        "4ACfpUFoaSD9bfPdeu6DBt89gB6ENTeHBXCAi87NhDEE",
        "D2L6yPZ2FmmmTKPgzaMKdhu6EWZcTpLy1Vhx8uvZe7NZ",
        "9bnz4RShgq1hAnLnZbP8kbgBg1kEmcJBYQq3gQbmnSta",
        "5VY91ws6B2hMmBFRsXkoAAdsPHBJwRfBht4DXox3xkwn",
        "2nyhqdwKcJZR2vcqCyrYsaPVdAnFoJjiksCXJ7hfEYgD",
        "2q5pghRs6arqVjRvT5gfgWfWcHWmw1ZuCzphgd5KfWGJ",
        "wyvPkWjVZz1M8fHQnMMCDTQDbkManefNNhweYk5WkcF",
        "3KCKozbAaF75qEU33jtzozcJ29yJuaLJTy2jFdzUY8bT",
        "4vieeGHPYPG2MmyPRcYjdiDmmhN3ww7hsFNap8pVN3Ey",
        "4TQLFNWK8AovT1gFvda5jfw2oJeRMKEmw7aH6MGBJ3or"
        // Add more from the official Helius list if desired
    ],
    DEFAULT_JITO_TIP_LAMPORTS: parseInt(process.env.DEFAULT_JITO_TIP_LAMPORTS, 10) || 10000,

    // --- Helius ---
   // --- Helius ---
    HELIUS_API_KEY: (() => {
        const key = process.env.HELIUS_API_KEY;
        if (!key || key.startsWith('YOUR_')) {
            console.error("❌ FATAL: HELIUS_API_KEY is not set in your .env file or is still the default value.");
            // We can return null here so the bot fails gracefully with a clear message later.
            return null;
        }
        return key;
    })(),


    // Laserstream endpoint (choose closest to your location)
LASERSTREAM_ENDPOINT: process.env.LASERSTREAM_ENDPOINT || 'https://laserstream-mainnet-sgp.helius-rpc.com',

    // Alternative endpoints for redundancy
    LASERSTREAM_ENDPOINTS: [
        'https://laserstream-mainnet-tyo.helius-rpc.com',    // Tokyo
        'https://laserstream-mainnet-ny.helius-rpc.com',     // New York
        'https://laserstream-mainnet-lon.helius-rpc.com',    // London
        'https://laserstream-mainnet-fra.helius-rpc.com'     // Frankfurt
    ],

    // Streaming configuration
    LASERSTREAM_CONFIG: {
        maxReconnectAttempts: 10,
        replay: true, // Resume from last processed slot
        commitment: 'CONFIRMED', // PROCESSED, CONFIRMED, or FINALIZED
        
        // Channel options for optimal performance
        channelOptions: {
            connectTimeoutSecs: 20,
            maxDecodingMessageSize: 2_000_000_000, // 2GB
            http2KeepAliveIntervalSecs: 15,
            keepAliveTimeoutSecs: 10,
            keepAliveWhileIdle: true,
            http2AdaptiveWindow: true,
            tcpNodelay: true,
            bufferSize: 131_072 // 128KB
        }
    },

    // Performance thresholds - PURE COPY BOT: NO RESTRICTIONS!
    PERFORMANCE_THRESHOLDS: {
        maxAnalysisTime: 1000,        // Max analysis time in ms (very high)
        maxCopyTradeDelay: 1000,      // Max delay from detection to execution (very high)
        minCopyTradeAmount: 0,        // Minimum amount to copy (NO MINIMUM!)
        maxCopyTradeAmount: 999999999999, // Maximum amount to copy (NO MAXIMUM!)
        slippageTolerance: 1000,      // Slippage tolerance in basis points (10%)
        maxRetries: 5                 // Maximum retry attempts for failed trades
    },

    // --- Wallets ---
    USER_WALLET_PUBKEY: process.env.PUBLIC_KEY || '',
    USER_WALLET_PRIVATE_KEY: process.env.PRIVATE_KEY || '',
    WALLET_ENCRYPTION_KEY: process.env.WALLET_ENCRYPTION_KEY,

    // --- External APIs ---
    SHYFT_API_KEY: process.env.SHYFT_API_KEY || 'YOUR_SHYFT_API_KEY_HERE',

    // --- Bot Operation ---
    DEFAULT_SOL_TRADE_AMOUNT: parseFloat(process.env.DEFAULT_SOL_TRADE_AMOUNT) || 0.01,
    MIN_SOL_AMOUNT_PER_TRADE: parseFloat(process.env.MIN_SOL_AMOUNT_PER_TRADE) || 0.0001,
    FORCE_POLLING_MODE: process.env.FORCE_POLLING_MODE === 'true',
    
    // --- Logging & Filtering ---
    ENABLE_NOISE_FILTERING: false, // PURE COPY BOT: NO NOISE FILTERING!
    LOG_LEVEL: process.env.LOG_LEVEL || 'info', // debug, info, warn, error
    FILTER_DUST_TRANSACTIONS: false, // PURE COPY BOT: NO DUST FILTERING!
    SHOW_RAW_TRANSACTIONS: process.env.SHOW_RAW_TRANSACTIONS === 'true', // Default disabled
    LOGS_DIR: process.env.LOGS_DIR || './logs', // Directory for log files
    
    // --- ULTRA-LOW LATENCY LASERSTREAM OPTIMIZATIONS ---
    LASERSTREAM_ENDPOINT: process.env.LASERSTREAM_ENDPOINT || 'https://laserstream-mainnet-sgp.helius-rpc.com',
    
    // Regional endpoints for optimal performance (choose closest to your location)
    LASERSTREAM_REGIONAL_ENDPOINTS: {
        singapore: 'https://laserstream-mainnet-sgp.helius-rpc.com',    // Asia-Pacific (Recommended)
        tokyo: 'https://laserstream-mainnet-tyo.helius-rpc.com',       // Japan
        frankfurt: 'https://laserstream-mainnet-fra.helius-rpc.com',   // Europe
        amsterdam: 'https://laserstream-mainnet-ams.helius-rpc.com',   // Europe
        newyork: 'https://laserstream-mainnet-ewr.helius-rpc.com',     // US East
        pittsburgh: 'https://laserstream-mainnet-pitt.helius-rpc.com', // US Central
        saltlake: 'https://laserstream-mainnet-slc.helius-rpc.com'     // US West
    },
    
    // ULTRA-LOW LATENCY configuration
    LASERSTREAM_ULTRA_CONFIG: {
        maxReconnectAttempts: 10,
        replay: true, // Resume from last processed slot
        commitment: 'PROCESSED', // Fastest possible detection
        
        // Channel options for sub-100ms latency
        channelOptions: {
            // Connection optimizations
            connectTimeoutSecs: 20,
            maxDecodingMessageSize: 2_000_000_000, // 2GB
            maxEncodingMessageSize: 64_000_000,    // 64MB
            
            // Keep-alive optimizations
            http2KeepAliveIntervalSecs: 15,
            keepAliveTimeoutSecs: 10,
            keepAliveWhileIdle: true,
            
            // Flow control optimizations
            initialStreamWindowSize: 8_388_608,      // 8MB
            initialConnectionWindowSize: 16_777_216, // 16MB
            
            // Performance optimizations
            http2AdaptiveWindow: true,
            tcpNodelay: true,
            bufferSize: 131_072, // 128KB
            
            // Compression optimizations
            'grpc.default_compression_algorithm': 'zstd', // Most efficient
            'grpc.max_receive_message_length': 1_000_000_000, // 1GB
            'grpc.max_send_message_length': 32_000_000,      // 32MB
            'grpc.keepalive_time_ms': 20000,                 // 20s
            'grpc.keepalive_timeout_ms': 10000,              // 10s
            'grpc.http2.min_time_between_pings_ms': 15000,   // 15s
            'grpc.http2.write_buffer_size': 1_048_576,       // 1MB
            'grpc-node.max_session_memory': 67_108_864,      // 64MB
            
            // Connection optimizations
            'grpc.client_idle_timeout_ms': 300000,            // 5 min
            'grpc.max_connection_idle_ms': 300000,            // 5 min
            'grpc.max_concurrent_streams': 1000,              // 1000 streams
            'grpc.initial_reconnect_backoff_ms': 1000,        // 1s
            'grpc.max_reconnect_backoff_ms': 30000            // 30s
        }
    },
    
    // --- ULTRA-FAST EXECUTION (SENDER) ---
    SENDER_ENDPOINT: process.env.SENDER_ENDPOINT || 'https://sender.helius-rpc.com/fast',
    
    // Regional Sender endpoints for optimal execution
    SENDER_REGIONAL_ENDPOINTS: {
        global: 'https://sender.helius-rpc.com/fast',         // Global (Recommended)
        singapore: 'http://sgp-sender.helius-rpc.com/fast',  // Singapore
        tokyo: 'http://tyo-sender.helius-rpc.com/fast',      // Tokyo
        frankfurt: 'http://fra-sender.helius-rpc.com/fast',  // Frankfurt
        newyork: 'http://ewr-sender.helius-rpc.com/fast',    // New York
        saltlake: 'http://slc-sender.helius-rpc.com/fast'    // Salt Lake City
    },

    // --- Solana Native & System Constants ---
    NATIVE_SOL_MINT: 'So11111111111111111111111111111111111111112',
    SYSTEM_PROGRAM_ID: SystemProgram.programId,
    TOKEN_PROGRAM_ID: SPL_TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID: SPL_ASSOCIATED_TOKEN_PROGRAM_ID,
    RENT_PUBKEY: SYSVAR_RENT_PUBKEY,
    CLOCK_PUBKEY: SYSVAR_CLOCK_PUBKEY,
    COMPUTE_BUDGET_PROGRAM_ID: ComputeBudgetProgram.programId,
    LAMPORTS_PER_SOL_CONST: LAMPORTS_PER_SOL,
    TOKEN_2022_PROGRAM_ID: new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpG4MZN'),

    // --- MEV & Priority Fees ---
    MEV_PROTECTION: {
        enabled: process.env.MEV_PROTECTION_ENABLED === 'true',
        jitoBlockEngineUrl: process.env.JITO_BLOCK_ENGINE_URL,
        defaultTipLamports: parseInt(process.env.JITO_DEFAULT_TIP_LAMPORTS, 10) || 10000,
        priorityFees: {
            low: parseInt(process.env.PRIORITY_FEE_LOW, 10) || 5000,
            normal: parseInt(process.env.PRIORITY_FEE_NORMAL, 10) || 20000,
            high: parseInt(process.env.PRIORITY_FEE_HIGH, 10) || 100000,
            ultra: parseInt(process.env.PRIORITY_FEE_ULTRA, 10) || 500000,
        },
        networkState: {
            congestionLevel: 'normal',
            updateInterval: 30000
        }
    },
    
    // --- Platform & Program IDs ---
    PLATFORM_IDS: {
        RAYDIUM_V4: new PublicKey('675kPX9MHTjS2zt1qFR1UARY7hdK2uQDchjADx1Z1gkv'),
        RAYDIUM_LAUNCHPAD: new PublicKey('LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj'),
        RAYDIUM_CPMM: new PublicKey('CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C'),
        RAYDIUM_CLMM: new PublicKey('CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK'),
        PUMP_FUN: new PublicKey('6EF8rrecthR5DkVaGFKLkma4YkdrkvPPHoqUPLQkwQjR'),
        PUMP_FUN_VARIANT: new PublicKey('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P'),
        PUMP_FUN_AMM: new PublicKey('pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA'),
        METEORA_DLMM: new PublicKey('LBUZKhRxPF3XUpBCjp4TbnHErfpSA1Nk1ixL2SAH2xM'),
        METEORA_DBC: [
            new PublicKey('dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN'),
            new PublicKey('DBCFiGetD2C2s9w2b1G9dwy2J2B6Jq2mRGuo1S4t61d'),
        ],
        METEORA_CP_AMM: new PublicKey('CPAMdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG'),
        'Jupiter Aggregator': new PublicKey('JUP6LwwmjhEGGjp4tfXXFW2uJTkV5WkxSfCSsFUxXH5'),
        PHOTON: new PublicKey('BSfD6SHZigAfDWSjzD5Q41jw8LmKwtmjskPH9XW1mrRW'),
        AXIOM: [
            new PublicKey('AxiomfHaWDemCFBLBayqnEnNwE6b7B2Qz3UmzMpgbMG6'),
            new PublicKey('AxiomxSitiyXyPjKgJ9XSrdhsydtZsskZTEDam3PxKcC')
        ],
        // Add missing platform IDs that the analyzer expects
        RAYDIUM_AMM: new PublicKey('675kPX9MHTjS2zt1qFR1UARY7hdK2uQDchjADx1Z1gkv'), // Same as V4
        METEORA_DBC_PROGRAM_IDS: [
            new PublicKey('dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN'),
            new PublicKey('DBCFiGetD2C2s9w2b1G9dwy2J2B6Jq2mRGuo1S4t61d'),
        ],
        METEORA_CP_AMM_PROGRAM_ID: new PublicKey('CPAMdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG'),
        OPENBOOK: new PublicKey('srmqPvymJeFKQ4zGQed1GFppgkRHL9kaELCbyksJtPX'),
        OPENBOOK_V3: new PublicKey('srmq2Vp3e2wBq3dDDjWM9t48Xm21S2Jd2eBE4Pj4u7d'),
        // REMOVED: F5tf...zvBq is not a program ID - it's an account address
       
        
    },

    // --- PUMP.FUN Specifics (Now Helius-powered) ---
    PUMP_FUN_API_ENDPOINTS: process.env.PUMP_FUN_API_ENDPOINTS?.split(',') || [
        'https://frontend-api.pump.fun/coins/',  // Official frontend API
        'https://api.pump.fun/coins/',           // Official API  
    ],
    // Note: Primary data fetching now uses Helius RPC for reliability
    PUMP_FUN_BUY_DISCRIMINATOR: Buffer.from([0x66, 0x06, 0x3d, 0x11, 0x01, 0x05, 0x24, 0x72]),
    PUMP_FUN_SELL_DISCRIMINATOR: Buffer.from([0x2a, 0x7a, 0x81, 0x76, 0x27, 0x66, 0x93, 0x9f]),
    PUMP_AMM_BUY_DISCRIMINATOR: Buffer.from([27, 57, 130, 10, 211, 244, 242, 167]),
    PUMP_AMM_SELL_DISCRIMINATOR: Buffer.from([124, 74, 67, 128, 26, 10, 120, 93]),
    PUMP_FUN_PROGRAM_ID: new PublicKey('6EF8rrecthR5DkVaGFKLkma4YkdrkvPPHoqUPLQkwQjR'),
    PUMP_FUN_PROGRAM_ID_VARIANT: new PublicKey('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P'),
    PUMP_FUN_AMM_PROGRAM_ID: new PublicKey('pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA'),
    PUMP_FUN_GLOBAL: new PublicKey('4wTV1YmiEkRvAtNtsSGPtUrqRYQMe5SKy2uB4JCNsSNk'),
    PUMP_FUN_FEE_RECIPIENT: new PublicKey('CebN5WGQ4jvEPvsVU4EoHEpgzq1S77jyZ52gXSJGTk5M'),

    // --- JANITOR CACHE CLEANER ---
    JANITOR_PUMP_MCAP_THRESHOLD: 1000,
    JANITOR_LAUNCHPAD_MCAP_THRESHOLD: 50000,
    JANITOR_DEX_MCAP_THRESHOLD: 250000,
    JANITOR_LAUNCHPAD_GRACE_MS: 300000,
    JANITOR_DEX_GRACE_MS: 3600000,
};

module.exports = config;