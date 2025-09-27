// ==============================================================
// ====== ZapBot UNIFIED Config (v3.1 - Performance Tuned) ======
// ==============================================================
// File: config.js
// Description: Central configuration file for the "Golden Clone" engine.
// It is the SINGLE SOURCE OF TRUTH, reading directly from the clean .env file.

const { PublicKey, SystemProgram, ComputeBudgetProgram, SYSVAR_RENT_PUBKEY, SYSVAR_CLOCK_PUBKEY, LAMPORTS_PER_SOL } = require('@solana/web3.js');
const { TOKEN_PROGRAM_ID: SPL_TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID: SPL_ASSOCIATED_TOKEN_PROGRAM_ID } = require('@solana/spl-token');

// Native SOL mint address
const NATIVE_SOL_MINT = 'So11111111111111111111111111111111111111112';

// Load environment variables from our single, clean .env file
require('dotenv').config();

// ==============================================================
// ====== CORE INFRASTRUCTURE CONFIGURATION =====================
// ==============================================================

const HELIUS_API_KEY = process.env.HELIUS_API_KEY;

// These endpoints are the definitive, single source of truth for all connections.
const HELIUS_ENDPOINTS = {
    rpc: process.env.HELIUS_RPC_URL || `https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`,          // Your premium RPC
    websocket: process.env.HELIUS_WS_URL || `wss://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`,     // Your premium WebSocket
    laserstream_grpc: process.env.LASERSTREAM_GRPC_URL,                         // Primary gRPC for detection
    laserstream_grpc_alt: process.env.LASERSTREAM_GRPC_ALT_URL,               // Fallback gRPC
    sender: process.env.SENDER_ENDPOINT                                         // Primary API for sending transactions
};

const config = {
    // --- Telegram & Admin ---
    BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
    ADMIN_CHAT_ID: process.env.ADMIN_CHAT_ID,
    
    // --- Core Infrastructure ---
    HELIUS_API_KEY: HELIUS_API_KEY,
    HELIUS_ENDPOINTS: HELIUS_ENDPOINTS,
    
    // --- Singapore Regional Endpoints (Optimized for Asia-Pacific) ---
    SINGAPORE_ENDPOINTS: {
        rpc: process.env.HELIUS_RPC_URL || `https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`,
        websocket: process.env.HELIUS_WS_URL || `wss://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`,
        sender: process.env.SENDER_ENDPOINT || 'https://mainnet.helius-rpc.com/fast',
        laserstream: process.env.LASERSTREAM_GRPC_URL,
    },

    // --- ⭐ NEW: LASERSTREAM PERFORMANCE TUNING ---
    // This is the critical gRPC configuration for the LaserStream SDK.
    LASERSTREAM_CONFIG: {
        maxReconnectAttempts: 15, // Increased for better reliability
        commitment: 0,  // Fastest possible detection signal (0 = PROCESSED)
        channelOptions: {
            'grpc.max_send_message_length': 64 * 1024 * 1024,
            'grpc.max_receive_message_length': 100 * 1024 * 1024,
            'grpc.keepalive_time_ms': 20000,
            'grpc.keepalive_timeout_ms': 10000,
            'grpc.keepalive_permit_without_calls': 1,
            'grpc.http2.min_time_between_pings_ms': 15000,
        }
    },
    
    // --- Wallet Configuration ---
    USER_WALLET_PUBKEY: process.env.PUBLIC_KEY,
    USER_WALLET_PRIVATE_KEY: process.env.PRIVATE_KEY,
    WALLET_ENCRYPTION_KEY: process.env.WALLET_ENCRYPTION_KEY,
    
    // --- Bot Operation ---
    DEFAULT_SOL_TRADE_AMOUNT: parseFloat(process.env.DEFAULT_SOL_TRADE_AMOUNT) || 0.01,

    // --- Performance & Execution ---
    MAX_RETRIES: parseInt(process.env.MAX_RETRIES) || 3,
    DEFAULT_JITO_TIP_LAMPORTS: parseInt(process.env.DEFAULT_JITO_TIP_LAMPORTS, 10) || 10000,
    
    // --- Transaction Filtering ---
    TRANSACTION_FILTERING: {
        ENABLED: true,
        MAX_AGE_SECONDS: 30,
        LOG_FILTERED_TRANSACTIONS: true,
        // 🎯 EARLY FILTERING: Prevent expensive analysis on non-trades
        EARLY_FILTERING: {
            ENABLED: true,
            MIN_SOL_CHANGE_LAMPORTS: 100000, // 0.0001 SOL minimum change
            LOG_EARLY_FILTERS: true
        }
    },

    TIP_ACCOUNTS: [
        "4ACfpUFoaSD9bfPdeu6DBt89gB6ENTeHBXCAi87NhDEE", "D2L6yPZ2FmmmTKPgzaMKdhu6EWZcTpLy1Vhx8uvZe7NZ",
        "9bnz4RShgq1hAnLnZbP8kbgBg1kEmcJBYQq3gQbmnSta", "5VY91ws6B2hMmBFRsXkoAAdsPHBJwRfBht4DXox3xkwn",
        "2nyhqdwKcJZR2vcqCyrYsaPVdAnFoJjiksCXJ7hfEYgD", "2q5pghRs6arqVjRvT5gfgWfWcHWmw1ZuCzphgd5KfWGJ",
        "wyvPkWjVZz1M8fHQnMMCDTQDbkManefNNhweYk5WkcF", "3KCKozbAaF75qEU33jtzozcJ29yJuaLJTy2jFdzUY8bT"
    ],

    // --- Solana Native & System Constants ---
    NATIVE_SOL_MINT: 'So11111111111111111111111111111111111111112',
    SYSTEM_PROGRAM_ID: SystemProgram.programId,
    TOKEN_PROGRAM_ID: SPL_TOKEN_PROGRAM_ID,
    TOKEN_2022_PROGRAM_ID: new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb'),
    ASSOCIATED_TOKEN_PROGRAM_ID: SPL_ASSOCIATED_TOKEN_PROGRAM_ID,
    RENT_PUBKEY: SYSVAR_RENT_PUBKEY,
    CLOCK_PUBKEY: SYSVAR_CLOCK_PUBKEY,
    COMPUTE_BUDGET_PROGRAM_ID: ComputeBudgetProgram.programId,
    LAMPORTS_PER_SOL_CONST: LAMPORTS_PER_SOL,
    
    // ==============================================================
    // ====== THE BRAIN of the GOLDEN FILTER ========================
    // ==============================================================
    
    // ====== ACTUAL DEX PROGRAM IDs (The Real Platforms) ===========
    DEX_PROGRAM_IDS: {
        // Raydium DEX Programs
        RAYDIUM_V4: new PublicKey('675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8'),
        RAYDIUM_CPMM: new PublicKey('CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C'),
        RAYDIUM_CLMM: new PublicKey('CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK'),
        RAYDIUM_AMM: new PublicKey('675kPX9MHTjS2zt1qFR1UARY7hdK2uQDchjADx1Z1gkv'),
        RAYDIUM_STABLE_SWAP: new PublicKey('5quBtoiQqxF9Jv6KYKctB59NT3gtJD2Y65kdnB1Uev3h'),
        
        // Pump.fun DEX Programs
        PUMP_FUN: new PublicKey('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P'),
        PUMP_FUN_AMM: new PublicKey('pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA'),
        PUMP_FUN_V2: new PublicKey('6HB1VBBS8LrdQiR9MZcXV5VdpKFb7vjTMZuQQEQEPioC'),
        
        // Meteora DEX Programs
        METEORA_DLMM: new PublicKey('LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo'),
        METEORA_DBC: [
            new PublicKey('dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN'),
            new PublicKey('DBCFiGetD2C2s9w2b1G9dwy2J2B6Jq2mRGuo1S4t61d'),
        ],
        METEORA_CP_AMM: new PublicKey('CPAMdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG'),
        
        // Orca DEX Programs
        WHIRLPOOL: new PublicKey('whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc'),
        
        // Serum/OpenBook DEX Programs
        SERUM_DEX_V3: new PublicKey('9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin'),
        OPENBOOK: new PublicKey('srmqPvymJeFKQ4zGQed1GFppgkRHL9kaELCbyksJtPX'),
        OPENBOOK_V3: new PublicKey('srmq2Vp3e2wBq3dDDjWM9t48Xm21S2Jd2eBE4Pj4u7d'),
        
        // Raydium Launchpad
        RAYDIUM_LAUNCHPAD: new PublicKey('LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj'),
    },
    
    // ====== ROUTER PROGRAM IDs (Aggregators, Not Real DEXs) =======
    ROUTER_PROGRAM_IDS: {
        // Jupiter Routers (Aggregators)
        JUPITER_V4: new PublicKey('JUP6LwwmjhEGGjp4tfXXFW2uJTkV5WkxSfCSsFUxXH5'),
        JUPITER_V6: new PublicKey('JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4'),
        JUPITER_AMM_ROUTING: new PublicKey('routeUGWgWzqBWFcrCfv8tritsqukccJPu3q5GPP3xS'),
        
        // Third-Party Routers
        PHOTON: new PublicKey('BSfD6SHZigAfDWSjzD5Q41jw8LmKwtmjskPH9XW1mrRW'),
        AXIOM: new PublicKey('AxiomfHaWDemCFBLBayqnEnNwE6b7B2Qz3UmzMpgbMG6'),
        BLOOM_ROUTER: new PublicKey('b1oomGGqPKGD6errbyfbVMBuzSC8WtAAYo8MwNafWW1'),
        PRIVATE_ROUTER: new PublicKey('AzcZqCRUQgKEg5FTAgY7JacATABEYCEfMbjXEzspLYFB'),
        PUMP_FUN_ROUTER: new PublicKey('F5tfvbLog9VdGUPqBDTT8rgXvTTcq7e5UiGnupL1zvBq'),
    },
    
    // ====== LEGACY SUPPORT (Backward Compatibility) ================
    // Note: PLATFORM_IDS will be populated after the object is created
    // to avoid circular reference issues
    
    // --- PUMP.FUN Specifics (Needed for Reconstruction Logic) ---
    PUMP_FUN_CONSTANTS: {
        GLOBAL: new PublicKey('4wTV1YmiEkRvAtNtsSGPtUrqRYQMe5SKy2uB4JCNsSNk'),
        FEE_RECIPIENT: new PublicKey('CebN5WGQ4jvEPvsVU4EoHEpgzq1VV7AbicfhtW4xC9iM'),
        BUY_DISCRIMINATOR: Buffer.from('169168196c813e37', 'hex'),
        SELL_DISCRIMINATOR: Buffer.from('43a0271383796d13', 'hex'),
    },
    
    // Native SOL mint address
    NATIVE_SOL_MINT: NATIVE_SOL_MINT,
};

// ====== LEGACY SUPPORT (Backward Compatibility) ================
// Combine both DEX and Router IDs for backward compatibility
config.PLATFORM_IDS = {
    ...Object.fromEntries(
        Object.entries(config.DEX_PROGRAM_IDS).map(([key, value]) => [key, value])
    ),
    ...Object.fromEntries(
        Object.entries(config.ROUTER_PROGRAM_IDS).map(([key, value]) => [key, value])
    )
};

module.exports = config;