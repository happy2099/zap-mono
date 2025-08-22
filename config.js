// config.js
import dotenv from 'dotenv';
dotenv.config();

// Keep your named exports if other parts of your old code use them directly,
// but also create a default export object for the bot's main config.
export const PRIVATE_KEY_RAW = process.env.PRIVATE_KEY; // Example if needed elsewhere
export const RPC_URL_RAW = process.env.RPC_URL;         // Example

export default {
    telegramBotToken: process.env.TELEGRAM_BOT_TOKEN, // <<< Use this key
    adminChatId: process.env.ADMIN_CHAT_ID ? parseInt(process.env.ADMIN_CHAT_ID) : null,
    rpcUrl: process.env.RPC_URL || 'https://mainnet.helius-rpc.com/?api-key=YOUR_HELIUS_KEY',
    wsUrl: process.env.WS_URL || 'wss://mainnet.helius-rpc.com/?api-key=YOUR_HELIUS_KEY',
    fixedSolAmount: parseFloat(process.env.FIXED_SOL_AMOUNT) || 0.1,
    minSolAmountPerTrade: parseFloat(process.env.MIN_SOL_AMOUNT_PER_TRADE) || 0.001,
    // Add other necessary configurations here
    jito: {
        enabled: process.env.MEV_PROTECTION_ENABLED === 'true',
        blockEngineUrl: process.env.JITO_BLOCK_ENGINE_URL,
        // authKeypairPath: process.env.JITO_AUTH_KEYPAIR_PATH, // If you load from path
        useMockJito: process.env.USE_MOCK_JITO === 'true'
    },
    // ... any other configs your bot needs from .env
};