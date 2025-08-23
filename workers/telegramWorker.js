import BaseWorker from './templates/baseWorker.js';
import { parentPort } from 'worker_threads';
import TelegramBot from 'node-telegram-bot-api';

class TelegramWorker extends BaseWorker {
    constructor() {
        super();
        this.bot = null;
        this.isInitialized = false;
    }

    async initialize() {
        await super.initialize();
        
        // Initialize Telegram bot
        await this.initializeTelegramBot();
        
        // Register custom message handlers
        this.registerHandler('SEND_MESSAGE', this.handleSendMessage.bind(this));
        this.registerHandler('SEND_NOTIFICATION', this.handleSendNotification.bind(this));
        
        console.log('TelegramWorker initialized');
    }

    async initializeTelegramBot() {
        const token = process.env.TELEGRAM_BOT_TOKEN;
        
        if (!token) {
            console.log('No Telegram bot token provided - running in headless mode');
            return;
        }

        try {
            this.bot = new TelegramBot(token, { polling: false });
            
            // Setup basic command handlers
            this.setupCommandHandlers();
            
            this.isInitialized = true;
            console.log('Telegram bot initialized successfully');
        } catch (error) {
            console.error('Failed to initialize Telegram bot:', error);
            throw error;
        }
    }

    setupCommandHandlers() {
        if (!this.bot) return;

        // Handle /start command
        this.bot.onText(/\/start/, async (msg) => {
            const chatId = msg.chat.id;
            await this.handleStartCommand(chatId);
        });

        // Handle callback queries
        this.bot.on('callback_query', async (callbackQuery) => {
            await this.handleCallbackQuery(callbackQuery);
        });

        // Handle text messages
        this.bot.on('message', async (msg) => {
            if (msg.text && !msg.text.startsWith('/')) {
                await this.handleTextMessage(msg);
            }
        });
    }

    async handleStartCommand(chatId) {
        try {
            const welcomeMessage = `🎉 Welcome to ZapBot!

I'm your Solana copy trading assistant. Here's what I can do:

📊 Monitor successful traders
🔄 Copy their trades automatically
💰 Manage your trading portfolio
📈 Track your performance

Use the menu below to get started!`;

            const keyboard = {
                inline_keyboard: [
                    [
                        { text: '📊 Add Trader', callback_data: 'add_trader' },
                        { text: '👥 My Traders', callback_data: 'my_traders' }
                    ],
                    [
                        { text: '💰 Wallets', callback_data: 'wallets' },
                        { text: '📈 Performance', callback_data: 'performance' }
                    ],
                    [
                        { text: '⚙️ Settings', callback_data: 'settings' },
                        { text: '❓ Help', callback_data: 'help' }
                    ]
                ]
            };

            await this.bot.sendMessage(chatId, welcomeMessage, {
                reply_markup: keyboard,
                parse_mode: 'Markdown'
            });
        } catch (error) {
            console.error('Error handling start command:', error);
        }
    }

    async handleCallbackQuery(callbackQuery) {
        const chatId = callbackQuery.message.chat.id;
        const data = callbackQuery.data;

        try {
            switch (data) {
                case 'add_trader':
                    await this.handleAddTrader(chatId);
                    break;
                case 'my_traders':
                    await this.handleMyTraders(chatId);
                    break;
                case 'wallets':
                    await this.handleWallets(chatId);
                    break;
                case 'performance':
                    await this.handlePerformance(chatId);
                    break;
                case 'settings':
                    await this.handleSettings(chatId);
                    break;
                case 'help':
                    await this.handleHelp(chatId);
                    break;
                default:
                    await this.bot.answerCallbackQuery(callbackQuery.id, {
                        text: 'Unknown command'
                    });
            }
        } catch (error) {
            console.error('Error handling callback query:', error);
            await this.bot.answerCallbackQuery(callbackQuery.id, {
                text: 'An error occurred'
            });
        }
    }

    async handleTextMessage(msg) {
        const chatId = msg.chat.id;
        const text = msg.text;

        try {
            // Handle trader wallet input
            if (text.includes('wallet') || text.length > 30) {
                await this.handleTraderWalletInput(chatId, text);
            } else {
                await this.bot.sendMessage(chatId, 'Please use the menu buttons to navigate.');
            }
        } catch (error) {
            console.error('Error handling text message:', error);
        }
    }

    async handleAddTrader(chatId) {
        const message = `📊 Add a Trader

To add a trader, please send me their wallet address.

You can find wallet addresses from:
• Solscan.io
• Solana Explorer
• Trading platforms

Send the wallet address and I'll start monitoring their trades!`;

        await this.bot.sendMessage(chatId, message);
    }

    async handleMyTraders(chatId) {
        // This would integrate with the data manager to get user's traders
        const message = `👥 Your Traders

You haven't added any traders yet.

Use "Add Trader" to start monitoring successful traders!`;

        await this.bot.sendMessage(chatId, message);
    }

    async handleWallets(chatId) {
        const message = `💰 Wallet Management

You haven't set up any wallets yet.

To start copy trading, you'll need to:
1. Generate a new wallet, or
2. Import an existing wallet

Would you like to create a new wallet?`;

        const keyboard = {
            inline_keyboard: [
                [
                    { text: '🆕 Generate Wallet', callback_data: 'generate_wallet' },
                    { text: '📥 Import Wallet', callback_data: 'import_wallet' }
                ],
                [
                    { text: '🔙 Back to Menu', callback_data: 'back_to_menu' }
                ]
            ]
        };

        await this.bot.sendMessage(chatId, message, { reply_markup: keyboard });
    }

    async handlePerformance(chatId) {
        const message = `📈 Performance Overview

No trading activity yet.

Once you start copy trading, you'll see:
• Total trades executed
• Success rate
• Profit/Loss
• Best performing traders`;

        await this.bot.sendMessage(chatId, message);
    }

    async handleSettings(chatId) {
        const message = `⚙️ Settings

Configure your copy trading preferences:

• Trade amount per transaction
• Maximum concurrent trades
• Stop loss settings
• Notification preferences`;

        const keyboard = {
            inline_keyboard: [
                [
                    { text: '💰 Set Trade Amount', callback_data: 'set_trade_amount' },
                    { text: '🔔 Notifications', callback_data: 'notifications' }
                ],
                [
                    { text: '🔙 Back to Menu', callback_data: 'back_to_menu' }
                ]
            ]
        };

        await this.bot.sendMessage(chatId, message, { reply_markup: keyboard });
    }

    async handleHelp(chatId) {
        const message = `❓ Help & Support

Need help with ZapBot? Here are some common questions:

🤔 How does copy trading work?
ZapBot monitors successful traders and automatically copies their trades to your wallet.

💰 How much should I invest?
Start small! We recommend testing with small amounts first.

🔒 Is it safe?
Your private keys stay on your device. We never have access to your funds.

📞 Need more help?
Contact support or check our documentation.`;

        await this.bot.sendMessage(chatId, message);
    }

    async handleTraderWalletInput(chatId, walletAddress) {
        // Validate wallet address format
        if (!this.isValidSolanaAddress(walletAddress)) {
            await this.bot.sendMessage(chatId, '❌ Invalid wallet address. Please provide a valid Solana wallet address.');
            return;
        }

        // Send to main thread for processing
        parentPort.postMessage({
            type: 'ADD_TRADER_REQUEST',
            data: {
                chatId: chatId,
                walletAddress: walletAddress
            },
            timestamp: Date.now()
        });

        await this.bot.sendMessage(chatId, '✅ Trader wallet received! I\'m analyzing their trading history...');
    }

    isValidSolanaAddress(address) {
        // Basic Solana address validation
        return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address);
    }

    async handleSendMessage(message) {
        const { chatId, text, options } = message.data;
        
        if (!this.bot || !this.isInitialized) {
            console.error('Telegram bot not initialized');
            return;
        }

        try {
            await this.bot.sendMessage(chatId, text, options);
        } catch (error) {
            console.error('Error sending message:', error);
        }
    }

    async handleSendNotification(message) {
        const { chatId, text, options } = message.data;
        
        if (!this.bot || !this.isInitialized) {
            console.error('Telegram bot not initialized');
            return;
        }

        try {
            await this.bot.sendMessage(chatId, text, options);
        } catch (error) {
            console.error('Error sending notification:', error);
        }
    }

    async cleanup() {
        console.log('Cleaning up TelegramWorker...');
        
        if (this.bot) {
            this.bot.stopPolling();
        }
        
        console.log('TelegramWorker cleanup complete');
    }
}

// Initialize worker
const worker = new TelegramWorker();
worker.initialize();

// Handle messages from main thread
parentPort.on('message', async (message) => {
    await worker.handleMessage(message);
});
