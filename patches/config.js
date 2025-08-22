// ==========================================
// ============ ZapBot Config.js =============
// ==========================================
// File: config.js
// Description: Centralized configuration, constants, and environment variables.

const dotenv = require('dotenv');
const { PublicKey, SystemProgram, ComputeBudgetProgram, LAMPORTS_PER_SOL, SYSVAR_RENT_PUBKEY, SYSVAR_CLOCK_PUBKEY } = require('@solana/web3.js');
const { TOKEN_PROGRAM_ID: SPL_TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID: SPL_ASSOCIATED_TOKEN_PROGRAM_ID } = require("@solana/spl-token");
const path = require('path');
const { sha256 } = require('@noble/hashes/sha256');


// Load environment variables from .env file immediately
dotenv.config();


// --- Core Environment Variables & Validation ---
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const SOLANA_TRACKER_API_KEY = process.env.SOLANA_TRACKER_API_KEY;
// const RPC_URL = process.env.RPC_URL || 'https://rpc-mainnet.solanatracker.io/?api_key=c556a3b7-0855-40c6-ade1-95424f5feb34';
// const WS_URL = process.env.WS_URL || 'https://rpc-mainnet.solanatracker.io/?api_key=c556a3b7-0855-40c6-ade1-95424f5feb34';
const RPC_URL = process.env.RPC_URL || 'https://mainnet.helius-rpc.com/?api-key=1b3e4d64-cda8-4490-bd5f-1c3ada1b377a';
const WS_URL = process.env.WS_URL || 'wss://mainnet.helius-rpc.com/?api-key=1b3e4d64-cda8-4490-bd5f-1c3ada1b377a';
// const RPC_URL = process.env.RPC_URL || 'https://dark-evocative-owl.solana-mainnet.quiknode.pro/497fc975da6984a5a05cb7ab9da031ca4ecea653';
// const WS_URL = process.env.WS_URL || 'wss://dark-evocative-owl.solana-mainnet.quiknode.pro/497fc975da6984a5a05cb7ab9da031ca4ecea653';
const PREMIUM_RPC_ENDPOINTS = [process.env.RPC_URL_1, process.env.RPC_URL_2, process.env.RPC_URL_3].filter(Boolean);
const USER_WALLET_PUBKEY = process.env.PUBLIC_KEY;
const USER_WALLET_PRIVATE_KEY = process.env.PRIVATE_KEY;
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID;
const FORCE_POLLING_MODE = process.env.FORCE_POLLING_MODE === 'true'; 

const SHYFT_API_KEY = process.env.SHYFT_API_KEY;

const BITQUERY_API_KEY = process.env.BITQUERY_API_KEY;
const BITQUERY_CLIENT_ID = process.env.BITQUERY_API_KEY;
const BITQUERY_CLIENT_SECRET = process.env.BITQUERY_API_KEY;

const PUMP_FUN_API_ENDPOINTS = (process.env.PUMP_FUN_API_ENDPOINTS || 'https://client-api-2-74b1891ee9f9.herokuapp.com/coins/,https://api.pump.fun/coins/').split(',');

// --- API & Service Endpoints ---
const RAYDIUM_TRADE_API_URL = 'https://api.raydium.io/v2';
const SHYFT_GRAPHQL_ENDPOINT = `https://programs.shyft.to/v0/graphql/?api_key=${SHYFT_API_KEY}`;

if (!BOT_TOKEN) { console.error("FATAL: TELEGRAM_BOT_TOKEN missing in .env"); process.exit(1); }
if (!USER_WALLET_PUBKEY || !USER_WALLET_PRIVATE_KEY) { console.error("FATAL: Bot PUBLIC_KEY or PRIVATE_KEY missing in .env."); process.exit(1); }

// --- Solana Native & System Constants ---
const NATIVE_SOL_MINT = 'So11111111111111111111111111111111111111112';
const SYSTEM_PROGRAM_ID = SystemProgram.programId;
const TOKEN_PROGRAM_ID = SPL_TOKEN_PROGRAM_ID;
const ASSOCIATED_TOKEN_PROGRAM_ID = SPL_ASSOCIATED_TOKEN_PROGRAM_ID;
const RENT_PUBKEY = SYSVAR_RENT_PUBKEY;
const CLOCK_PUBKEY = SYSVAR_CLOCK_PUBKEY;
const COMPUTE_BUDGET_PROGRAM_ID = ComputeBudgetProgram.programId;
const LAMPORTS_PER_SOL_CONST = LAMPORTS_PER_SOL;

// --- Platform Program IDs ---
const PUMP_FUN_PROGRAM_ID = new PublicKey('6EF8rrecthR5DkVaGFKLkma4YkdrkvPPHoqUPLQkwQjR');
const PUMP_FUN_PROGRAM_ID_VARIANT = new PublicKey('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P');
const PUMP_FUN_AMM_PROGRAM_ID = new PublicKey('pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA');
const PHOTON_PROGRAM_ID = new PublicKey('BSfD6SHZigAfDWSjzD5Q41jw8LmKwtmjskPH9XW1mrRW');
const RAYDIUM_V4_PROGRAM_ID = new PublicKey('675kPX9MHTjS2zt1qFR1UARY7hdK2uQDchjADx1Z1gkv');
const RAYDIUM_LAUNCHPAD_PROGRAM_ID = new PublicKey('LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj');
const RAYDIUM_CPMM_PROGRAM_ID = new PublicKey('CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C');
const RAYDIUM_CLMM_PROGRAM_ID = new PublicKey('CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK');
const RAYDIUM_LAUNCHPAD_AUTHORITY = new PublicKey('WLHv2UAZm6z4KyaaELi5pjdbJh6RESMva1Rnn8pJVVh'); 
const AXIOM_PROGRAM_IDS = [
    new PublicKey('AxiomfHaWDemCFBLBayqnEnNwE6b7B2Qz3UmzMpgbMG6'),
    new PublicKey('AxiomxSitiyXyPjKgJ9XSrdhsydtZsskZTEDam3PxKcC')
];
const METEORA_DBC_PROGRAM_IDS = [
    new PublicKey('dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN'),
    new PublicKey('DBCFiGetD2C2s9w2b1G9dwy2J2B6Jq2mRGuo1S4t61d')
];
const METEORA_DLMM_PROGRAM_ID = new PublicKey('LBUZKhRxPF3XUpBCjp4TbnHErfpSA1Nk1ixL2SAH2xM');
const METEORA_CP_AMM_PROGRAM_ID = new PublicKey("CPAMdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG");

const OPENBOOK_PROGRAM_ID = new PublicKey('srmqPvymJeFKQ4zGQed1GFppgkRHL9kaELCbyksJtPX');
const OPENBOOK_V3_PROGRAM_ID = new PublicKey('srmq2Vp3e2wBq3dDDjWM9t48Xm21S2Jd2eBE4Pj4u7d');


// --- Platform Specific Account Addresses & Seeds ---
const PUMP_FUN_GLOBAL = new PublicKey('4wTV1YmiEkRvAtNtsSGPtUrqRYQpFibwr4WQKeibKTLc');
const PUMP_FUN_FEE_RECIPIENT = new PublicKey('CebN5WGQ4jvEPvsVU4EoHEpgzq1VV7AbicfhtW4f5nT7');
const PHOTON_GLOBAL_STATE = new PublicKey('7Fsr6y7FUnuZDRTxezdQvZK5unWxmk7GbNvge5xPUDFj');


// --- Instruction Discriminators ---
const PUMP_FUN_BUY_DISCRIMINATOR = Buffer.from(sha256('global:buy')).slice(0, 8);
const PUMP_FUN_SELL_DISCRIMINATOR = Buffer.from(sha256('global:sell')).slice(0, 8);
const PUMP_AMM_BUY_DISCRIMINATOR = Buffer.from([27, 57, 130, 10, 211, 244, 242, 167]);
const PUMP_AMM_SELL_DISCRIMINATOR = Buffer.from([124, 74, 67, 128, 26, 10, 120, 93]);
const RAYDIUM_SWAP_BASE_IN_DISCRIMINATOR = Buffer.from([0x09]);

// --- Combined Platform ID Mapping ---
const PLATFORM_IDS = {
    PUMP_FUN: PUMP_FUN_PROGRAM_ID,
    PUMP_FUN_VARIANT: PUMP_FUN_PROGRAM_ID_VARIANT,
    PUMP_FUN_AMM: PUMP_FUN_AMM_PROGRAM_ID,
    PHOTON: PHOTON_PROGRAM_ID,
    RAYDIUM_V4: RAYDIUM_V4_PROGRAM_ID,
    RAYDIUM_LAUNCHPAD: RAYDIUM_LAUNCHPAD_PROGRAM_ID,
    RAYDIUM_CLMM: RAYDIUM_CLMM_PROGRAM_ID,
    RAYDIUM_CPMM: RAYDIUM_CPMM_PROGRAM_ID, 
    OPENBOOK: OPENBOOK_PROGRAM_ID,
    AXIOM: AXIOM_PROGRAM_IDS,
    METEORA_DBC: METEORA_DBC_PROGRAM_IDS,
    METEORA_DLMM: METEORA_DLMM_PROGRAM_ID,
       METEORA_CP_AMM: METEORA_CP_AMM_PROGRAM_ID, 
    OPENBOOK_V3: OPENBOOK_V3_PROGRAM_ID,
    'Jupiter Aggregator': new PublicKey('JUP6LwwmjhEGGjp4tfXXFW2uJTkV5WkxSfCSsFUxXH5'), // Jupiter Aggregator V6 Program ID
    // Add other platforms as needed
};

// --- Bot Operation Constants ---
const MAX_RETRIES = 3;
const RETRY_DELAY = 1200;
const MIN_SOL_AMOUNT_PER_TRADE = 0.001;
const TRANSACTION_FEE_ESTIMATE = 0.00015; // Estimate in SOL
const TRANSACTION_TIMEOUT = 90000; // ms
const BLOCKHASH_CACHE_EXPIRATION = 50000; // ms
const BLOCKHASH_REFRESH_INTERVAL_MS = 25000; // ms
const SIGNATURE_EXPIRATION_MS = 5 * 60 * 1000; // 5 minutes
const DEFAULT_SOL_TRADE_AMOUNT = 0.1;

// --- File Paths ---
const DATA_DIR = path.resolve(process.cwd(), 'data');
const LOGS_DIR = path.resolve(process.cwd(), 'logs');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const TRADERS_FILE = path.join(DATA_DIR, 'traders.json');
const SOL_AMOUNTS_FILE = path.join(DATA_DIR, 'sol_amounts.json');
const SAVED_ADDRESSES_FILE = path.join(DATA_DIR, 'saved_addresses.json');
const TRADE_STATS_FILE = path.join(DATA_DIR, 'trade_stats.json');
const WITHDRAWAL_HISTORY_FILE = path.join(DATA_DIR, 'withdrawal_history.json');
const POSITIONS_FILE = path.join(DATA_DIR, 'positions.json');
const WALLET_FILE = path.join(DATA_DIR, 'wallets.enc.json');
const PROCESSED_POOLS_FILE = path.join(DATA_DIR, 'processed_pools.json');

// --- Jito & MEV Protection Configuration ---
const JITO_BLOCK_ENGINE_URL = process.env.JITO_BLOCK_ENGINE_URL || 'https://ny.block-engine.jito.wtf';
const MEV_PROTECTION = {
    enabled: process.env.MEV_PROTECTION_ENABLED === 'true',
    useMock: process.env.USE_MOCK_JITO === 'true',
    jitoTipAccount: process.env.JITO_TIP_ACCOUNT ? new PublicKey(process.env.JITO_TIP_ACCOUNT) : new PublicKey('96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5'),
    defaultTipLamports: parseInt(process.env.JITO_DEFAULT_TIP_LAMPORTS || '10000'),
    maxTipLamports: parseInt(process.env.JITO_MAX_TIP_LAMPORTS || '1000000'),
    priorityFees: {
        low: parseInt(process.env.PRIORITY_FEE_LOW || '5000'),
        normal: parseInt(process.env.PRIORITY_FEE_NORMAL || '10000'),
        medium: parseInt(process.env.PRIORITY_FEE_MEDIUM || '50000'),
        high: parseInt(process.env.PRIORITY_FEE_HIGH || '250000'),
        ultra: parseInt(process.env.PRIORITY_FEE_ULTRA || '1000000'),
    },
    networkState: {
        lastUpdated: 0,
        congestionLevel: 'normal', // can be 'low', 'normal', 'high'
        updateInterval: 45000, // Check congestion every 45s
        _isUpdating: false
    }
};

module.exports.JANITOR_PUMP_MCAP_THRESHOLD = 4000;
module.exports.JANITOR_DEX_MCAP_THRESHOLD = 2000;
module.exports.JANITOR_DEX_GRACE_PERIOD_MS = 10 * 60 * 1000;

// Export all constants at once
module.exports = {
    BOT_TOKEN,
    RPC_URL,
    RPC_FALLBACK_URLS: [],
    WS_URL,
    ADMIN_CHAT_ID,
    PREMIUM_RPC_ENDPOINTS,
    USER_WALLET_PUBKEY,
    USER_WALLET_PRIVATE_KEY,
    SHYFT_API_KEY,
    RAYDIUM_TRADE_API_URL,
    SHYFT_GRAPHQL_ENDPOINT,
    NATIVE_SOL_MINT,
    SYSTEM_PROGRAM_ID,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
    RENT_PUBKEY,
    CLOCK_PUBKEY,
    COMPUTE_BUDGET_PROGRAM_ID,
    LAMPORTS_PER_SOL_CONST,
    PUMP_FUN_PROGRAM_ID,
    PUMP_FUN_PROGRAM_ID_VARIANT,
    PUMP_FUN_AMM_PROGRAM_ID,
    PHOTON_PROGRAM_ID,
    RAYDIUM_V4_PROGRAM_ID,
    RAYDIUM_LAUNCHPAD_PROGRAM_ID,
    RAYDIUM_CLMM_PROGRAM_ID,
     RAYDIUM_CPMM_PROGRAM_ID,
     RAYDIUM_LAUNCHPAD_AUTHORITY, 
     OPENBOOK_PROGRAM_ID,
     OPENBOOK_V3_PROGRAM_ID,
    AXIOM_PROGRAM_IDS,
    METEORA_DBC_PROGRAM_IDS,
    METEORA_DLMM_PROGRAM_ID,
    METEORA_CP_AMM_PROGRAM_ID,
    PUMP_FUN_GLOBAL,
    PUMP_FUN_FEE_RECIPIENT,
    PHOTON_GLOBAL_STATE,
    PUMP_FUN_BUY_DISCRIMINATOR,
    PUMP_FUN_SELL_DISCRIMINATOR,
    PUMP_AMM_BUY_DISCRIMINATOR,
    PUMP_AMM_SELL_DISCRIMINATOR,
    PUMP_FUN_API_ENDPOINTS,
    RAYDIUM_SWAP_BASE_IN_DISCRIMINATOR,
    PLATFORM_IDS,
    MAX_RETRIES,
    RETRY_DELAY,
    MIN_SOL_AMOUNT_PER_TRADE,
    TRANSACTION_FEE_ESTIMATE,
    TRANSACTION_TIMEOUT,
    BLOCKHASH_CACHE_EXPIRATION,
    BLOCKHASH_REFRESH_INTERVAL_MS,
    SIGNATURE_EXPIRATION_MS,
    DEFAULT_SOL_TRADE_AMOUNT,
    DATA_DIR,
    LOGS_DIR,
    SETTINGS_FILE,
    TRADERS_FILE,
    SOL_AMOUNTS_FILE,
    SAVED_ADDRESSES_FILE,
    TRADE_STATS_FILE,
    WITHDRAWAL_HISTORY_FILE,
    POSITIONS_FILE,
    WALLET_FILE,
    PROCESSED_POOLS_FILE,
    JITO_BLOCK_ENGINE_URL,
    MEV_PROTECTION,
    SOLANA_TRACKER_API_KEY,
    FORCE_POLLING_MODE,
    BITQUERY_API_KEY,
     BITQUERY_CLIENT_ID,   // EXPORT THIS
    BITQUERY_CLIENT_SECRET, // EXPORT THIS
     USERS_FILE: path.join(DATA_DIR, 'users.json'),
       // Cache Janitor Config
    JANITOR_PUMP_MCAP_THRESHOLD: 100000,       // $100K
    JANITOR_DEX_MCAP_THRESHOLD: 250000,        // $250K
    JANITOR_DEX_GRACE_MS: 3600000,             // 1 hour
    JANITOR_LAUNCHPAD_MCAP_THRESHOLD: 50000,   // $50K
    JANITOR_LAUNCHPAD_GRACE_MS: 300000         // 5 minutes
    
};