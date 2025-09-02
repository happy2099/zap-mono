// ==========================================
// ====== ZapBot UNIFIED Config (CJS) =======
// ==========================================
// File: config.js
// Description: Central configuration file using CommonJS for compatibility.

const { PublicKey } = require('@solana/web3.js');
const dotenv = require('dotenv');
dotenv.config();

const config = {
    // --- Telegram & Admin ---
    BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN || '7874427872:AAGxpy0tNV11RjVPszQWRdcqlwDae2lbFoU',
    ADMIN_CHAT_ID: process.env.ADMIN_CHAT_ID || '6032767351',

    // --- Solana Network ---
    RPC_URL: process.env.RPC_URL || 'https://mainnet.helius-rpc.com/?api-key=b9a69ad0-d823-429e-8c18-7cbea0e31769',
    WS_URL: process.env.WS_URL || 'wss://mainnet.helius-rpc.com/?api-key=b9a69ad0-d823-429e-8c18-7cbea0e31769',
    LASERSTREAM_ENDPOINT: process.env.LASERSTREAM_ENDPOINT || 'https://laserstream-mainnet-sgp.helius-rpc.com',
    RPC_FALLBACK_URLS: process.env.RPC_FALLBACK_URLS ? process.env.RPC_FALLBACK_URLS.split(',') : [],

    SENDER_ENDPOINT: process.env.SENDER_ENDPOINT || 'http://sg-sender.helius-rpc.com/fast', // Singapore endpoint for lowest latency
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
    
    // --- Constants ---
    NATIVE_SOL_MINT: 'So11111111111111111111111111111111111111112',
    LAMPORTS_PER_SOL_CONST: 1_000_000_000,
    TOKEN_PROGRAM_ID: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'),
    TOKEN_2022_PROGRAM_ID: new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpG4MZN'),
    COMPUTE_BUDGET_PROGRAM_ID: new PublicKey('ComputeBudget111111111111111111111111111111'),
    
    // --- File Paths ---
    DATA_DIR: 'data',
    LOGS_DIR: 'logs',
    SETTINGS_FILE: 'data/settings.json',
    TRADERS_FILE: 'data/traders.json',
    SOL_AMOUNTS_FILE: 'data/sol_amounts.json',
    SAVED_ADDRESSES_FILE: 'data/saved_addresses.json',
    TRADE_STATS_FILE: 'data/trade_stats.json',
    WITHDRAWAL_HISTORY_FILE: 'data/withdrawal_history.json',
    POSITIONS_FILE: 'data/positions.json',
    USERS_FILE: 'data/users.json',
    WALLET_FILE: 'data/wallets.json',
    PROCESSED_POOLS_FILE: 'data/processed_pools.json',

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
        RAYDIUM_V4: new PublicKey('675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8'),
        RAYDIUM_LAUNCHPAD: new PublicKey('LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj'),
        RAYDIUM_CPMM: new PublicKey('CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C'),
        RAYDIUM_CLMM: new PublicKey('CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK'),
        PUMP_FUN: new PublicKey('6EF8rrecthR5DkVaGFKLkma4YkdrkvPPHoqUPLQkwQjR'),
        PUMP_FUN_VARIANT: new PublicKey('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P'),
        PUMP_FUN_AMM: new PublicKey('pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA'),
        METEORA_DLMM: new PublicKey('LBUZKhRxPF3XUpBCjp4cd4YfXbG6TfvB2eRCcsgAsPY'),
        METEORA_DBC: [
            new PublicKey('DBCPdKzM5LgZm1u3SAn8Dkdkrwtn2A2argzdisE61m2F'),
        ],
        METEORA_CP_AMM: new PublicKey('MTCPmFupf4vm3b1D2bS2e9tqAbM6tCHM42Eny9g9f6Z'),
        'Jupiter Aggregator': new PublicKey('JUP6LkbZbjS1jKKwapdHNy7A9erNsYcRcRdcJsu7WBV'),
        PHOTON: new PublicKey('GMN8N6sNfA3iTjHupG2GfF2yAShP2d4JAXW6S1mMAJv3'),
        AXIOM: new PublicKey('AXSwtggda59qbW2wKhonS1f44t42bLhNoHYb1bggC1fM'),
    },

    // --- PUMP.FUN Specifics ---
    PUMP_FUN_API_ENDPOINTS: process.env.PUMP_FUN_API_ENDPOINTS?.split(',') || [
        'https://client-api-2-74b1891ee9f9.herokuapp.com/coins/',
        'https://api.pump.fun/coins/',
    ],
    PUMP_FUN_BUY_DISCRIMINATOR: Buffer.from([0x66, 0x06, 0x3d, 0x11, 0x01, 0x05, 0x24, 0x72]),
    PUMP_FUN_SELL_DISCRIMINATOR: Buffer.from([0x2a, 0x7a, 0x81, 0x76, 0x27, 0x66, 0x93, 0x9f]),
    PUMP_FUN_PROGRAM_ID: new PublicKey('6EF8rrecthR5DkVaGFKLkma4YkdrkvPPHoqUPLQkwQjR'),
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