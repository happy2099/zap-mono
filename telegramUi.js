
// ==========================================
// ========== ZapBot TelegramUI (v2) ========
// ==========================================
// File: telegramUi.js
// Description: Manages all Telegram Bot interactions, including menus, commands, and input flows.

const TelegramBot = require('node-telegram-bot-api');
const bs58 = require('bs58');
const { PublicKey } = require('@solana/web3.js');

// Import shared utilities and config
const { shortenAddress, escapeMarkdownV2, formatLamports } = require('./utils');
const config = require('./config.js');
const { BOT_TOKEN, USER_WALLET_PUBKEY, MIN_SOL_AMOUNT_PER_TRADE, ADMIN_CHAT_ID } = config;

class TelegramUI {
    constructor(dataManager, solanaManager, walletManager) {
        if (!dataManager || !solanaManager || !walletManager) {
            throw new Error("TelegramUI: Missing one or more required manager modules.");
        }
        
        // Store the manager instance
        this.dataManager = dataManager;
        this.solanaManager = solanaManager;
        this.walletManager = walletManager;
        
        // Determine the manager type for compatibility
        this.isdataManager = typeof dataManager.getUser === 'function' && typeof dataManager.all === 'function';
        this.isLegacyDataManager = typeof dataManager.loadTraders === 'function' && typeof dataManager.loadUsers === 'function';
        this.bot = null;

        // In-memory state
        this.activeFlows = new Map();
        this.latestMessageIds = new Map();
        

        // Action Handlers to be bound from the main bot class
        this.actionHandlers = {};

        // Logger
        this.logger = {
            info: (msg, data) => console.log(`[TELEGRAM_UI] ${msg}`, data ? JSON.stringify(data) : ''),
            error: (msg, data) => console.error(`[TELEGRAM_UI] ${msg}`, data ? JSON.stringify(data) : ''),
            warn: (msg, data) => console.warn(`[TELEGRAM_UI] ${msg}`, data ? JSON.stringify(data) : ''),
            debug: (msg, data) => console.log(`[TELEGRAM_UI DEBUG] ${msg}`, data ? JSON.stringify(data) : '')
        };

        this.logger.info("TelegramUI initialized.");
    }

    async initialize() {
        this.logger.info("BOT_TOKEN:", BOT_TOKEN ? "Set" : "Missing");
        console.log("🔍 DEBUG: BOT_TOKEN value:", BOT_TOKEN ? `${BOT_TOKEN.substring(0, 10)}...` : "undefined");
        console.log("🔍 DEBUG: BOT_TOKEN length:", BOT_TOKEN ? BOT_TOKEN.length : 0);
        
        // Check for invalid/placeholder tokens
        if (!BOT_TOKEN || 
            BOT_TOKEN === 'YOUR_TELEGRAM_BOT_TOKEN_HERE' ||
            BOT_TOKEN === '7874427872:AAGxpy0tNV11RjVPszQWRdcqlwDae2lbFoU' ||
            BOT_TOKEN.length < 20) {
            console.warn("⚠️ TelegramUI: No valid bot token found, running in headless mode.");
            console.warn("⚠️ To enable Telegram features, set a valid TELEGRAM_BOT_TOKEN in your .env file");
            return { success: true, mode: 'headless' };
        }
        
        console.log("✅ DEBUG: Token validation passed, proceeding with bot initialization");
        
        try {
            // Check if webhook mode is enabled
            const useWebhook = process.env.USE_WEBHOOK === 'true';
            
            if (useWebhook) {
                // Use webhook mode
                this.bot = new TelegramBot(BOT_TOKEN, { polling: false });
                console.log("✅ DEBUG: Using webhook mode");
            } else {
                // Use polling mode for local development with WSL fixes
                this.bot = new TelegramBot(BOT_TOKEN, { 
                    polling: { 
                        interval: 2000, // Slower polling for WSL stability
                        autoStart: false, 
                        params: { 
                            timeout: 60, // Longer timeout for WSL
                            allowed_updates: ['message', 'callback_query']
                        }
                    },
                    request: {
                        agentOptions: {
                            keepAlive: false, // Disable keepAlive for WSL
                            family: 4 // Force IPv4
                        }
                    }
                });
                console.log("✅ DEBUG: Using polling mode with WSL stability fixes");
            }
            this.logger.info("TelegramBot instance created:", this.bot ? "Success" : "Failed");
            
            // Test the bot token with a timeout
            const authPromise = this.bot.getMe();
            const timeoutPromise = new Promise((_, reject) => 
                setTimeout(() => reject(new Error('Authorization timeout')), 5000)
            );
            
            Promise.race([authPromise, timeoutPromise])
                .then(me => {
                    this.logger.info(`Telegram Bot authorized for: @${me.username}`);
                    console.log("✅ TelegramUI: Bot created in polling mode");
                })
                .catch(err => {
                    console.warn("⚠️ Telegram Bot authorization failed:", err.message);
                    console.warn("⚠️ Bot token may be invalid or network unavailable");
                    console.warn("⚠️ Running in headless mode - Telegram features disabled");
                    this.bot = null;
                    return { success: true, mode: 'headless' };
                });
                
            this.setupEventListeners();
            
        } catch (error) {
            console.error("❌ Failed to create Telegram bot:", error.message);
            console.warn("⚠️ Running in headless mode - Telegram features disabled");
            this.bot = null;
            return { success: true, mode: 'headless' };
        }
    }

    // Start polling or setup webhook
    startPolling() {
        if (!this.bot) {
            console.warn("⚠️ Telegram bot not available - running in headless mode");
            return false;
        }
        
        try {
            const useWebhook = process.env.USE_WEBHOOK === 'true';
            
            if (useWebhook) {
                // Webhook mode - just confirm bot is ready
                console.log("✅ TelegramUI: Bot ready in webhook mode");
                return true;
            } else {
                // Start polling for local development with WSL stability
                this.bot.startPolling({ 
                    interval: 2000, // Slower polling for WSL stability
                    params: { 
                        timeout: 60, // Longer timeout for WSL
                        allowed_updates: ['message', 'callback_query']
                    }
                });
                console.log("✅ TelegramUI: Bot ready in polling mode with WSL stability");
                
                return true;
            }
        } catch (error) {
            console.error("❌ Failed to start bot:", error.message);
            return false;
        }
    }

    bindActionHandlers(handlers) {
        this.actionHandlers = handlers;
    }

    async setupPersistentMenu() {
        try {
            // Set up bot commands for the menu button
            await this.bot.setMyCommands([
                { command: 'start', description: '🚀 Start the bot and show main menu' },
                { command: 'menu', description: '📋 Show main menu' },
                { command: 'help', description: '❓ Get help and support' }
            ]);
            
            // Set up the persistent menu button
            await this.bot.setChatMenuButton({
                menu_button: {
                    type: 'commands'
                }
            });
            
            console.log("✅ Persistent menu button configured");
        } catch (error) {
            console.error("❌ Failed to setup persistent menu:", error.message);
        }
    }

    setupEventListeners() {
        if (!this.bot) return;

        // Set up persistent menu button after bot is ready
        this.setupPersistentMenu().catch(error => {
            console.error("❌ Failed to setup persistent menu:", error.message);
        });

        // Command handlers
        this.bot.onText(/^\/(start|menu)$/, msg => this.handleMenuCommand(msg));
        this.bot.onText(/^\/help$/, msg => this.showHelp(msg.chat.id));
            this.bot.onText(/\/copy (.+)/, (msg, match) => {
        const chatId = msg.chat.id;
        if (this.actionHandlers.onManualCopy && match && match[1]) {
            const signature = match[1];
            this.logger.info(`Detected /copy command. Firing action handler.`);
            this.actionHandlers.onManualCopy(chatId, signature);
        }
    });


        // Callback and message handlers
        this.bot.on('callback_query', cb => this.handleCallbackQuery(cb).catch(err => console.error("CallbackQuery Error:", err)));
        this.bot.on('message', msg => {
            if (msg.text && !msg.text.startsWith('/')) {
                this.handleFlowInput(msg).catch(err => {
                    console.error("Critical error in handleFlowInput:", err);
                    this.sendErrorMessage(msg.chat.id, `Error: ${err.message}`);
                });
            }
        });
        this.bot.on('polling_error', e => console.error(`❌ Telegram Polling Error: ${e.code} - ${e.message}`));
    }

    async requestNewUserChatId(chatId) {
        this.activeFlows.set(chatId, { type: 'admin_add_user_chat_id' });
        const message = "➡️ Step 1/2: Add New User\n\n" +
            "Please enter the unique Telegram Chat ID of your friend. " +
            "They can get this by messaging @userinfobot.";
        await this.sendOrEditMessage(chatId, message, {
            reply_markup: { inline_keyboard: [[{ text: "❌ Cancel", callback_data: "admin_manage_users" }]] }
        });
    }

    async handleMenuCommand(msg) {
        const chatId = msg.chat.id;
        if (this.activeFlows.has(chatId)) {
            const flowType = this.activeFlows.get(chatId)?.type;
            this.activeFlows.delete(chatId);
            await this.sendOrEditMessage(chatId, `_Flow '${escapeMarkdownV2(flowType)}' cancelled\\._`, {}, msg.message_id).catch(() => { });
        }
        await this.showMainMenu(chatId, msg.message_id);
    }

async handleCallbackQuery(cb) {
    const { data, message } = cb;
    const chatId = message.chat.id;

    await this.bot.answerCallbackQuery(cb.id).catch(() => {});
    this.latestMessageIds.set(chatId, message.message_id);
    
    // --- THE STRATEGIC FIX IS HERE ---
    // Before starting any new action, we check if there's an old flow.
    // If there is, we decisively terminate it.
    if (this.activeFlows.has(chatId)) {
        const oldFlowType = this.activeFlows.get(chatId)?.type;
        this.logger.debug(`Terminating stale flow '${oldFlowType}' for user ${chatId} before starting new action '${data}'.`);
        this.activeFlows.delete(chatId);
    }
   try {
        const [action, ...params] = data.split('_');
        const param = params.join('_');

        const simpleRoutes = {
            main_menu: () => this.showMainMenu(chatId),
            help: () => this.showHelp(chatId),
            wallets_menu: () => this.displayWalletManagerMenu(chatId),
            traders_list: () => this.showTradersList(chatId),
            traders_menu: () => this.showTradersList(chatId), // Add missing traders_menu handler
            balance: () => this.displayWalletBalances(chatId),
            withdraw: () => this.handleWithdraw(chatId),
            add_trader: () => this.requestTraderName(chatId),
            set_sol: () => this.requestSolAmount(chatId),
            reset_all: () => this.handleResetConfirmation(chatId),
            start_copy: () => this.showTradersMenu(chatId, 'start'),
            stop_copy: () => this.showTradersMenu(chatId, 'stop'),
            remove_trader: () => this.showTradersMenu(chatId, 'remove'),
            wm_view: () => this.displayWalletList(chatId),
            wm_add: () => this.displayAddWalletMenu(chatId),
            wm_generate: () => this.handleGenerateWallet(chatId),
            wm_import: () => this.handleImportWalletPrompt(chatId),
    
            refresh_balances: () => this.displayWalletBalances(chatId),
        };

        if (simpleRoutes[data]) {
            return await simpleRoutes[data]();
        }

        // Preserve navigation context

        if (action === 'start') {
            await this.actionHandlers.onStartCopy(chatId, param);
            // After starting, just go back to the main menu. Simple and effective.
            return await this.showMainMenu(chatId); 
        }
        if (action === 'stop') {
            await this.actionHandlers.onStopCopy(chatId, param);
            // After stopping, also go back to the main menu.
            return await this.showMainMenu(chatId);
        }
        if (action === 'remove') {
            return await this.handleRemoveTraderConfirmation(chatId, param);
        }
        if (action === 'confirm' && params[0] === 'remove') {
            await this.actionHandlers.onRemoveTrader(chatId, params[1]);
            return await this.showTradersList(chatId); // Show traders list after removing
        }

        if (action === 'delete' && params[0] === 'wallet') {
            return await this.handleDeleteWalletConfirmation(chatId, param.substring('wallet_'.length));
        }
        if (action === 'confirm' && params[0] === 'delete' && params[1] === 'wallet') {
            await this.actionHandlers.onDeleteWallet(chatId, params.slice(2).join('_'));
            return await this.displayWalletList(chatId); // Refresh wallet list
        }
        
        
        console.warn(`Unhandled callback data: ${data}`);
        await this.sendErrorMessage(chatId, `Unknown action: ${data}`);

    } catch (e) {
        console.error("Error processing callback query:", e);
        await this.sendErrorMessage(chatId, `An error occurred processing that action: ${e.message}`);
    }
}


    async showMainMenu(chatId, messageId = null, additionalMessage = "") {
        try {
            // Load data for the specific user
            let userSol = config.DEFAULT_SOL_TRADE_AMOUNT;
            let userTraders = {};
            
            try {
                if (this.isdataManager) {
                    // Database approach
                    let user = await this.dataManager.getUser(chatId);
                    
                    // If user doesn't exist, create them automatically
                    if (!user) {
                        this.logger.info('User not found, creating new user', { chatId });
                        try {
                            // Get user info from Telegram
                            const chatMember = await this.bot.getChatMember(chatId, chatId);
                            const userInfo = chatMember.user;
                            
                            // Create user with Telegram info
                            const userId = await this.dataManager.createUser(chatId, {
                                firstName: userInfo.first_name || null,
                                lastName: userInfo.last_name || null,
                                telegramUsername: userInfo.username || null,
                                isActive: true,
                                isAdmin: false
                            });
                            
                            // Get the newly created user
                            user = await this.dataManager.getUser(chatId);
                            this.logger.info('Created new user successfully', { chatId, userId, username: userInfo.username });
                        } catch (error) {
                            this.logger.error('Failed to create user, using minimal data', { chatId, error: error.message });
                            // Fallback: create user with minimal data
                            const userId = await this.dataManager.createUser(chatId, {
                                firstName: 'User',
                                isActive: true,
                                isAdmin: false
                            });
                            user = await this.dataManager.getUser(chatId);
                        }
                    }
                    
                    if (user) {
                        // Get SOL amount from user settings
                        const userSettings = await this.dataManager.getUserSettings(chatId);
                        userSol = userSettings.solAmount || config.DEFAULT_SOL_TRADE_AMOUNT;
                        
                        const traders = await this.dataManager.getTraders(chatId);
                        userTraders = {};
                        traders.forEach(trader => {
                            userTraders[trader.name] = {
                                wallet: trader.wallet,
                                active: trader.active === true || trader.active === 1,
                                addedAt: trader.created_at
                            };
                        });
                    }
                } else if (this.isLegacyDataManager) {
                    // Legacy dataManager approach
                    const solAmounts = await this.dataManager.loadSolAmounts();
                    userSol = solAmounts[String(chatId)] || solAmounts.default || config.DEFAULT_SOL_TRADE_AMOUNT;

                    // Use the same logic as the first branch to process traders correctly
                    const traders = await this.dataManager.getTraders(chatId);
                    userTraders = {};
                    traders.forEach(trader => {
                        userTraders[trader.name] = {
                            wallet: trader.wallet,
                            active: trader.active === true || trader.active === 1,
                            addedAt: trader.created_at
                        };
                    });
                }
            } catch (error) {
                console.error('Error loading user data for main menu:', error);
            }

            // Get user-specific wallet count from database
            const userWalletCount = await this.walletManager.getTradingWalletCount(chatId);
            const activeTradersCount = Object.values(userTraders).filter(t => t.active).length;
            const totalTradersCount = Object.values(userTraders).length;
            
            // Debug logging removed for cleaner logs

            // Build clean, professional message with better formatting
            let message = additionalMessage ? `_${escapeMarkdownV2(additionalMessage)}_\n\n` : "";
            
            // Header with nice styling
            message += `┌─────────────────────────┐\n`;
            message += `│    *🚀 ZAP TRADE BOT*   │\n`;
            message += `└─────────────────────────┘\n\n`;
            
            // Status section with clean formatting
            message += `📊 *TRADING STATUS*\n`;
            message += `├ Active Traders: \`${activeTradersCount}/${totalTradersCount}\`\n`;
            message += `├ Trade Amount: \`${userSol.toFixed(4)} SOL\`\n`;
            message += `└ Wallets: \`${userWalletCount}\`\n\n`;
            
            message += `🎯 *SELECT ACTION:*`;

            const keyboard = [
                // Row 1: Primary Actions (Start/Stop)
                [
                    { text: "🟢 START COPY", callback_data: "start_copy" }, 
                    { text: "🔴 STOP COPY", callback_data: "stop_copy" }
                ],
                // Row 2: Trader Management  
                [
                    { text: "👤 Add Trader", callback_data: "add_trader" }, 
                    { text: "🗑️ Remove Trader", callback_data: "remove_trader" }
                ],
                // Row 3: Wallet Operations
                [
                    { text: "💼 Wallets", callback_data: "wallets_menu" }, 
                    { text: "💰 Balances", callback_data: "balance" }
                ],
                // Row 4: Information
                [
                    { text: "📋 List Traders", callback_data: "traders_list" }, 
                    { text: "💸 Withdraw", callback_data: "withdraw" }
                ],
                // Row 5: Configuration
                [
                    { text: "⚙️ Set SOL Amount", callback_data: "set_sol" }, 
                    { text: "🔧 Settings", callback_data: "reset_all" }
                ],
                // Row 6: Help
                [
                    { text: "❓ Help & Support", callback_data: "help" }
                ]
            ];
            
            // Admins get a special button
            try {
                const user = await this.dataManager.getUser(chatId);
                if (user && user.is_admin === 1) {
                    keyboard.push([{ text: "👑 Admin Panel", callback_data: "admin_panel" }]);
                }
            } catch (error) {
                console.error('Error checking admin status for menu:', error);
            }
            
            await this.sendOrEditMessage(chatId, message, { 
                reply_markup: { inline_keyboard: keyboard }, 
                parse_mode: 'MarkdownV2' 
            }, messageId);

        } catch (error) {
            console.error(`❌ Error showing main menu for chat ${chatId}:`, error);
            // Attempt to send a very simple fallback message
            try { 
                await this.bot.sendMessage(chatId, "Error displaying menu. Please try /start again."); 
            } catch { }
        }
    }


    async showAdminPanel(chatId) {
        // A safety check to ensure only the admin can access this.
        try {
            const user = await this.dataManager.getUser(chatId);
            if (!user || user.is_admin !== 1) {
                return this.showMainMenu(chatId);
            }
        } catch (error) {
            console.error('Error checking admin status:', error);
            return this.showMainMenu(chatId);
        }

        const message = `*👑 Admin God-Mode Panel*\n\nWelcome, operator\\. Select a command\\.`;

        const keyboard = [
            [{ text: "👀 View User Activity", callback_data: "admin_view_activity" }],
            [{ text: "💹 View User PnL", callback_data: "admin_view_pnl" }],
            [{ text: "📊 Bot Statistics", callback_data: "admin_bot_stats" }],
            [{ text: "🏥 System Health", callback_data: "admin_system_health" }],
            [{ text: "👥 Manage Users", callback_data: "admin_manage_users" }],
            [{ text: "⚙️ Global Settings", callback_data: "admin_global_settings" }],
            [{ text: "🏠 Main Menu", callback_data: "main_menu" }]
        ];

        await this.sendOrEditMessage(chatId, message, { reply_markup: { inline_keyboard: keyboard } });
    }

    async displayUserActivity(chatId) {
        // Double-check admin privileges
        try {
            const user = await this.dataManager.getUser(chatId);
            if (!user || user.is_admin !== 1) return;
        } catch (error) {
            console.error('Error checking admin status:', error);
            return;
        }

        let message = `*👀 Live User Activity*\n\n`;
        let allTraders = {};
        let allSettings = { userSettings: {} };

        try {
            if (this.dataManager && typeof this.dataManager.loadTraders === 'function') {
                // Legacy dataManager approach
                allTraders = await this.dataManager.loadTraders();
                allSettings = await this.dataManager.loadSettings();
            } else if (this.dataManager && typeof this.dataManager.all === 'function') {
                // Database approach
                const traders = await this.dataManager.all('SELECT * FROM traders WHERE active = 1');
                const users = await this.dataManager.all('SELECT * FROM users');
                
                allTraders = {};
                traders.forEach(trader => {
                    const user = users.find(u => u.id === trader.user_id);
                    if (user) {
                        allTraders[trader.name] = {
                            wallet: trader.wallet,
                            active: trader.active === true || trader.active === 1,
                            chatId: user.chat_id,
                            addedAt: trader.created_at
                        };
                    }
                });
                
                // Build settings structure
                allSettings = { userSettings: {} };
                users.forEach(user => {
                    const userSettings = JSON.parse(user.settings || '{}');
                    allSettings.userSettings[user.chat_id] = userSettings;
                });
            }
        } catch (error) {
            console.error('Error loading data for user activity:', error);
        }

        const activeTrades = [];
        for (const traderName in allTraders) {
            const trader = allTraders[traderName];
            if (trader.active && trader.chatId) {
                activeTrades.push({
                    traderName,
                    ...trader
                });
            }
        }

        if (activeTrades.length === 0) {
            message += "_No users are currently copying any traders\\._";
        } else {

            for (const trade of activeTrades) {
                const userChatIdStr = String(trade.chatId);
                message += `*User:* \`${userChatIdStr}\`\n`
                    + `*Is Copying:* _${escapeMarkdownV2(trade.traderName)}_\n`
                    + `*Source Addr:* \`${escapeMarkdownV2(trade.wallet)}\`\n\n`;
            }
        }

        const keyboard = [
            [{ text: "🔄 Refresh", callback_data: "admin_view_activity" }],
            [{ text: "🔙 Back to Admin Panel", callback_data: "admin_panel" }]
        ];

        await this.sendOrEditMessage(chatId, message, {
            reply_markup: { inline_keyboard: keyboard },
            disable_web_page_preview: true
        });
    }

    async displayUserPnl(chatId) {
        try {
            const user = await this.dataManager.getUser(chatId);
            if (!user || user.is_admin !== 1) return;
        } catch (error) {
            console.error('Error checking admin status:', error);
            return;
        }

        await this.sendOrEditMessage(chatId, "⏳ _Calculating all user positions and fetching live market prices\\.\\.\\._", {});

        let grandTotalSolSpent = 0;
        let grandTotalCurrentValue = 0;
        let finalMessage = `*💹 User Profit & Loss Report*\n\n`;

        // Get the SOL price first for all calculations
        const solPriceUsd = await this.notificationManager.getSolPriceInUSD();

        // Get user positions from database
        let allUserPositions = new Map();
        try {
            if (this.dataManager && this.dataManager.userPositions) {
                // Legacy dataManager approach
                allUserPositions = this.dataManager.userPositions;
            } else if (this.dataManager && typeof this.dataManager.all === 'function') {
                // Database approach - get positions from user settings
                const users = await this.dataManager.all('SELECT * FROM users');
                allUserPositions = new Map();
                
                users.forEach(user => {
                    const userSettings = JSON.parse(user.settings || '{}');
                    if (userSettings.positions) {
                        const positionMap = new Map();
                        for (const [mint, position] of Object.entries(userSettings.positions)) {
                            positionMap.set(mint, position);
                        }
                        allUserPositions.set(user.chat_id, positionMap);
                    }
                });
            }
        } catch (error) {
            console.error('Error loading user positions:', error);
        }

        if (allUserPositions.size === 0) {
            finalMessage += "_No users have any open positions\\._";
        } else {
            // Step 1: Gather all unique token mints we need prices for
            const allMints = new Set();
            for (const userPositionMap of allUserPositions.values()) {
                for (const mint of userPositionMap.keys()) {
                    allMints.add(mint);
                }
            }

            // Step 2: Fetch all prices in ONE efficient API call
            const priceMap = await this.apiManager.getTokenPrices(Array.from(allMints));

            // Step 3: Iterate and build the report for each user
            for (const [userId, userPositionMap] of allUserPositions.entries()) {
                let userTotalSolSpent = 0;
                let userTotalCurrentValue = 0;
                let userReport = `*User:* \`${userId}\`\n`;
                let hasPositions = false;

                for (const [mint, position] of userPositionMap.entries()) {
                    if (position.amountRaw <= 0n) continue; // Skip sold-out positions
                    hasPositions = true;

                    const tokenPriceSol = priceMap.get(mint);
                    const currentValueSol = tokenPriceSol ? (Number(position.amountRaw) / (10 ** 9)) * tokenPriceSol : 0; // Assuming 9 decimals for now
                    const pnlSol = currentValueSol - position.solSpent;
                    const pnlIcon = pnlSol >= 0 ? '🟢' : '🔴';

                    userTotalSolSpent += position.solSpent;
                    userTotalCurrentValue += currentValueSol;

                    userReport += ` *-* \`${escapeMarkdownV2(shortenAddress(mint))}\`\n`
                        + `   *Spent:* ${escapeMarkdownV2(position.solSpent.toFixed(4))} SOL\n`
                        + `   *Value:* ${escapeMarkdownV2(currentValueSol.toFixed(4))} SOL\n`
                        + `   *P/L:* ${pnlIcon} ${escapeMarkdownV2(pnlSol.toFixed(4))} SOL\n`;
                }

                if (hasPositions) {
                    const userTotalPnl = userTotalCurrentValue - userTotalSolSpent;
                    const userPnlIcon = userTotalPnl >= 0 ? '🟢' : '🔴';
                    userReport += ` *User Total P/L:* ${userPnlIcon} ${escapeMarkdownV2(userTotalPnl.toFixed(4))} SOL\n\n`;
                    finalMessage += userReport;

                    grandTotalSolSpent += userTotalSolSpent;
                    grandTotalCurrentValue += userTotalCurrentValue;
                }
            }
        }

        const grandTotalPnl = grandTotalCurrentValue - grandTotalSolSpent;
        const grandPnlIcon = grandTotalPnl >= 0 ? '🟢' : '🔴';

      finalMessage += `*===========================*\n`
             + `*Bot Grand Total P/L:* ${grandPnlIcon} *${escapeMarkdownV2(grandTotalPnl.toFixed(4))} SOL*\n`
             // THE FIX: Remove the unescaped parentheses from the fallback message.
             + `_Value in USD: ~\\$${escapeMarkdownV2((grandTotalPnl * solPriceUsd).toFixed(2))} \\(at current SOL price\\)_`;
        const keyboard = [
            [{ text: "🔄 Refresh", callback_data: "admin_view_pnl" }],
            [{ text: "🔙 Back to Admin Panel", callback_data: "admin_panel" }]
        ];

        await this.sendOrEditMessage(chatId, finalMessage, {
            reply_markup: { inline_keyboard: keyboard },
            disable_web_page_preview: true
        });
    }

    async showUserManagementMenu(chatId) {
        const message = "✅ *User Whitelist Management*\n\nHere you can add new friends to the bot or remove them\\.";
        const keyboard = [
            [{ text: "➕ Add New User", callback_data: "admin_add_user_prompt" }],
            [{ text: "❌ Remove User", callback_data: "admin_remove_user_prompt" }],
            [{ text: "🔙 Back to Admin Panel", callback_data: "admin_panel" }]
        ];
        await this.sendOrEditMessage(chatId, message, { reply_markup: { inline_keyboard: keyboard } });
    }

    async showUserSelectionForActivity(chatId) {
        let users = {};
        try {
            if (this.dataManager && typeof this.dataManager.loadUsers === 'function') {
                // Legacy dataManager approach
                users = await this.dataManager.loadUsers();
            } else if (this.dataManager && typeof this.dataManager.all === 'function') {
                // Database approach
                const dbUsers = await this.dataManager.all('SELECT * FROM users');
                users = {};
                dbUsers.forEach(user => {
                    const userSettings = JSON.parse(user.settings || '{}');
                    users[user.chat_id] = userSettings.username || user.chat_id;
                });
            }
        } catch (error) {
            console.error('Error loading users for activity selection:', error);
        }
        
        const userList = Object.entries(users);

        let message = "*📊 View User Activity*\n\nSelect a user to inspect their setup\\.";
        const buttons = [];

        if (userList.length === 0) {
            message += "\n\n_No users have been whitelisted yet\\._";
        } else {
            userList.forEach(([userId, username]) => {
                buttons.push([{ text: `👤 ${username}`, callback_data: `admin_inspect_${userId}` }]);
            });
        }

        buttons.push([{ text: "🔙 Back to Admin Panel", callback_data: "admin_panel" }]);
        await this.sendOrEditMessage(chatId, message, { reply_markup: { inline_keyboard: buttons } });
    }

    async showHelp(chatId) {
        const helpText = `*ZapBot Help Menu*\n\n` +
            `Use the /menu command or buttons to navigate\\. Key features:\n` +
            `\\- *Add/Remove Traders*: Manage source wallets to copy\\.\n` +
            `\\- *Start/Stop Copy*: Enable/disable copying for specific traders\\.\n` +
            `\\- *Wallets*: Manage your trading wallets \\(generate/import/set primary\\)\\.\n` +
            `\\- *Balances*: Check SOL balances of all wallets\\.`;
        await this.sendOrEditMessage(chatId, helpText, {
            reply_markup: { inline_keyboard: [[{ text: "🏠 Main Menu", callback_data: "main_menu" }]] }
        });
    }

async showTradersList(chatId) {
    // Use database instead of dataManager
    let userTraders = {};
    try {
        // Always use database approach
        this.logger.debug(`Loading traders for chatId: ${chatId}`);
        const traders = await this.dataManager.getTraders(chatId);
        this.logger.debug(`Found ${traders.length} traders for chatId: ${chatId}`);
        
        // Convert traders to the expected format
        userTraders = {};
        traders.forEach(trader => {
            userTraders[trader.name] = {
                wallet: trader.wallet,
                active: trader.active === true || trader.active === 1,
                addedAt: trader.created_at
            };
        });
        
        // console.log(`[Traders List] Processed ${Object.keys(userTraders).length} traders:`, Object.keys(userTraders));
    } catch (error) {
        console.error('Error loading traders:', error);
        userTraders = {};
    }
    
    const traderEntries = Object.entries(userTraders);

    let message = "*📋 Your Configured Traders*";

    if (traderEntries.length === 0) {
        message += "\n\n_🤷 You haven't added any traders yet\\._";
    } else {
        // Get SOL amount for this user
        let solAmt = config.DEFAULT_SOL_TRADE_AMOUNT;
        try {
            const user = await this.dataManager.getUser(chatId);
            if (user) {
                // Get SOL amount from user settings
                const userSettings = await this.dataManager.getUserSettings(chatId);
                solAmt = userSettings.solAmount || config.DEFAULT_SOL_TRADE_AMOUNT;
            }
        } catch (error) {
            console.error('Error loading SOL amount for traders list:', error);
        }
        
        const solAmtStr = `${parseFloat(solAmt).toFixed(4)} SOL`;

        const traderBlocks = traderEntries
            .sort((a, b) => a[0].localeCompare(b[0]))
            .map(([name, trader]) => {
                const statusIcon = trader.active ? "🟢" : "⚪️";
                const statusText = trader.active ? "Active" : "Inactive";

                const mainLine = `${statusIcon} *${escapeMarkdownV2(name)}* \\- _${escapeMarkdownV2(statusText)}_`;
                const amountLine = `• Amount: \`${escapeMarkdownV2(solAmtStr)}\``;

                return `${mainLine}\n${amountLine}`;
            });

        message += "\n\n" + traderBlocks.join("\n\n");
    }

    await this.sendOrEditMessage(chatId, message, {
        reply_markup: {
            inline_keyboard: [[{ text: "🔙 Back to Main Menu", callback_data: "main_menu" }]],
        },
        parse_mode: "MarkdownV2",
        disable_web_page_preview: true,
    });
}



async showTradersMenu(chatId, action) {
    // Always use database approach
    let userTraders = {};
    try {
        const traders = await this.dataManager.getTraders(chatId);
        userTraders = {};
        traders.forEach(trader => {
            userTraders[trader.name] = {
                wallet: trader.wallet,
                active: trader.active === true || trader.active === 1,
                addedAt: trader.created_at
            };
        });
    } catch (error) {
        console.error('Error loading traders for menu:', error);
        userTraders = {};
    }
    
    let title, filterFn, cbPrefix, emptyMsg, header;

    switch (action) {
        case 'start':
            title = "▶️ Select Trader to START";
            filterFn = ([, t]) => !t.active;
            cbPrefix = "start_";
            emptyMsg = "All your traders are already active.";
            header = "Select one of your inactive traders:";
            break;
        case 'stop':
            title = "⛔ Select Trader to STOP";
            filterFn = ([, t]) => t.active;
            cbPrefix = "stop_";
            emptyMsg = "You have no active traders to stop.";
            header = "Select one of your active traders:";
            break;
        case 'remove':
            title = "🗑️ Select Trader to REMOVE";
            filterFn = () => true;
            cbPrefix = "remove_";
            emptyMsg = "You have no traders configured.";
            header = "Select any of your traders to remove:";
            break;
        default: return;
    }

    const filteredTraders = Object.entries(userTraders).filter(filterFn);
    
    // Sort traders alphabetically by name
    filteredTraders.sort(([nameA], [nameB]) => nameA.localeCompare(nameB));
    
    // THE FIX: We don't escape our own headers.
    let message = `*${escapeMarkdownV2(title)}*\\n\\n${header}`;

    // THE FIX: We add the status icons back to the buttons for a professional look.
    const buttons = filteredTraders.map(([name, trader]) => {
        const icon = trader.active ? '🟢' : '⚪️';
        return [{ text: `${icon} ${name}`, callback_data: `${cbPrefix}${name}` }];
    });

    if (filteredTraders.length === 0) {
        message += `\\n\\n${emptyMsg}`;
    }

    buttons.push([{ text: "🔙 Back to Main Menu", callback_data: "main_menu" }]);

    await this.sendOrEditMessage(chatId, message, {
        reply_markup: { inline_keyboard: buttons }
        // We don't need to specify parse_mode here because sendOrEditMessage does it for us.
    });
}
 
    async displayWalletManagerMenu(chatId) {
        const message = `*💼 Wallet Manager*\n\nManage wallets used for copy trading\\.\nWithdrawals use the separate Bot Wallet defined in \`.env\`\\.`;
        const keyboard = [
            [{ text: "👁️ List Trading Wallets", callback_data: "wm_view" }, { text: "💰 Check Balances", callback_data: "balance" }],
            [{ text: "➕ Add New Trading Wallet", callback_data: "wm_add" }],
            [{ text: "🔄 Refresh All Balances", callback_data: "refresh_balances" }],
            [{ text: "🔙 Main Menu", callback_data: "main_menu" }]
        ];
        await this.sendOrEditMessage(chatId, message, { 
            reply_markup: { inline_keyboard: keyboard },
            parse_mode: "MarkdownV2"
        });
    }


    async displaySettingsMenu(chatId) {
        const message = `*⚙️ Settings & Reset*\n\nManage bot-wide settings or reset data\\.`;
        const keyboard = [
            [{ text: "🔄 Refresh All Balances", callback_data: "refresh_balances" }],
            [{ text: "🚨 Reset ALL Bot Data", callback_data: "reset_all" }],
            [{ text: "🔙 Main Menu", callback_data: "main_menu" }]
        ];
        await this.sendOrEditMessage(chatId, message, { reply_markup: { inline_keyboard: keyboard } });
    }

    async displayWalletBalances(chatId) {
        await this.sendOrEditMessage(chatId, "⏳ Fetching wallet balances...", {});

        try {
            // Get user's wallets from database
            const userWallets = await this.dataManager.getUserWallets(chatId);
            
            const botBalance = await this.solanaManager.getSOLBalance(config.USER_WALLET_PUBKEY); 

            // Create clean, readable message
            let message = `💰 Wallet Balances\n\n`;
            let totalSol = 0;

            // Bot wallet section
            const botBalStr = botBalance !== null ? `${botBalance.toFixed(4)} SOL` : 'N/A';
            message += `🤖 Bot Wallet: ${botBalStr}\n\n`;

            // User wallets section
            if (userWallets.length === 0) {
                message += `📱 Your Wallets:\n`;
                message += `No trading wallets configured\n\n`;
            } else {
                message += `📱 Your Wallets:\n\n`;
                
                // Update balances for each wallet
                for (const wallet of userWallets) {
                    try {
                        const balance = await this.solanaManager.getSOLBalance(wallet.public_key);
                        await this.dataManager.updateWalletBalance(wallet.id, balance);
                        
                        // Clean wallet display with shortened address
                        const shortAddr = wallet.public_key.length > 20 ? 
                            `${wallet.public_key.substring(0, 8)}...${wallet.public_key.substring(wallet.public_key.length - 8)}` : 
                            wallet.public_key;
                        
                        message += `${wallet.label}\n`;
                        message += `${shortAddr}\n`;
                        message += `${(balance || 0).toFixed(4)} SOL\n\n`;
                        
                        totalSol += (balance || 0);
                    } catch (error) {
                        console.error(`Error fetching balance for wallet ${wallet.label}:`, error);
                        
                        // Fallback to cached balance
                        const shortAddr = wallet.public_key.length > 20 ? 
                            `${wallet.public_key.substring(0, 8)}...${wallet.public_key.substring(wallet.public_key.length - 8)}` : 
                            wallet.public_key;
                        
                        message += `${wallet.label}\n`;
                        message += `${shortAddr}\n`;
                        message += `${(wallet.balance || 0).toFixed(4)} SOL (cached)\n\n`;
                        
                        totalSol += (wallet.balance || 0);
                    }
                }
            }
            
            // Total balance section
            message += `Total Balance: ${totalSol.toFixed(4)} SOL`;

            const keyboard = [
                [{ text: "🔄 Refresh", callback_data: "refresh_balances" }],
                [{ text: "🔙 Main Menu", callback_data: "main_menu" }]
            ];
            
            await this.sendOrEditMessage(chatId, message, { 
                reply_markup: { inline_keyboard: keyboard }
            });
        } catch (error) {
            console.error("[Balance Display] Error fetching balances:", error);
            await this.sendErrorMessage(chatId, "Failed to fetch balances. Please check logs and try again.");
        }
    }

    async handleWithdraw(chatId) {
        this.activeFlows.set(chatId, { type: 'withdraw_amount' });
        const message = `💸 Withdraw SOL from Bot Wallet\n\nPlease enter the amount of SOL to withdraw.`;
        await this.sendOrEditMessage(chatId, message, {
            reply_markup: { inline_keyboard: [[{ text: "❌ Cancel", callback_data: "main_menu" }]] }
        });
    }

   async displayWalletList(chatId) {
        try {
            // Update balances before display for fresh info
            await this.walletManager.updateAllBalances(true); // Force refresh
            
            // Get user's wallets directly from the database
            const userWallets = await this.dataManager.getUserWallets(chatId);
            const tradingWallets = userWallets; // All wallets in user_wallets table are trading wallets
            
            let message = `💼 Trading Wallets\n`;
            let buttons = [];

            if (tradingWallets.length === 0) {
                message += "\nNo trading wallets configured. Use '➕ Add Wallet' to generate or import one.";
                buttons.push([{ text: "➕ Add Wallet", callback_data: "wm_add" }]);
                buttons.push([{ text: "🔙 Back to Wallet Menu", callback_data: "wallets_menu" }]);
            } else {
                message += "\n(Balances refreshed)\n";
                
                tradingWallets.sort((a, b) => a.label.localeCompare(b.label)).forEach(wallet => {
                    const balance = wallet.balance || 0;
                    const balanceStr = balance.toFixed(4);
                    message += `${wallet.label}\n`;
                    message += `Balance: ${balanceStr} SOL\n\n`;
                    buttons.push([{ text: `🗑️ Delete ${wallet.label}`, callback_data: `delete_wallet_${wallet.label}` }]);
                });
                
                buttons.push([{ text: "🔄 Refresh Balances", callback_data: "wm_view" }]);
                buttons.push([{ text: "🔙 Back to Wallet Menu", callback_data: "wallets_menu" }]);
            }
            
            await this.sendOrEditMessage(chatId, message, { 
                reply_markup: { inline_keyboard: buttons }, 
                disable_web_page_preview: true 
            });
        } catch (error) {
            console.error("[Wallet List] Error displaying wallet list:", error);
            await this.sendErrorMessage(chatId, "Error displaying wallet list.");
        }
    }

    async displayAddWalletMenu(chatId) {
        const message = `*➕ Add New Trading Wallet*`;
        const keyboard = [
            [{ text: "⚙️ Generate New Wallet", callback_data: "wm_generate" }],
            [{ text: "🔑 Import From Private Key", callback_data: "wm_import" }],
            [{ text: "🔙 Cancel", callback_data: "wallets_menu" }]
        ];
        await this.sendOrEditMessage(chatId, message, { reply_markup: { inline_keyboard: keyboard } });
    }



    async handleRemoveTraderConfirmation(chatId, traderName) {
        const message = `⚠️ *Confirm Removal* ⚠️\n\nAre you sure you want to remove trader *${escapeMarkdownV2(traderName)}*\\? This action cannot be undone\\.`;
        await this.sendOrEditMessage(chatId, message, {
            reply_markup: {
                inline_keyboard: [
                    [{ text: `🗑️ Yes, Remove`, callback_data: `confirm_remove_${traderName}` }],
                    [{ text: `🔙 No, Cancel`, callback_data: 'remove_trader' }]
                ]
            }
        });
    }

    async handleDeleteWalletConfirmation(chatId, walletLabel) {
        console.log(`[DeleteWallet] Confirmation requested for: ${walletLabel} by chat ${chatId}`);
        
        // Check if wallet still exists
        const userWallets = await this.dataManager.getUserWallets(chatId);
        const wallet = userWallets.find(w => w.label === walletLabel);
        
        if (!wallet) {
            await this.sendErrorMessage(chatId, `Wallet "${walletLabel}" not found. Maybe already deleted?`);
            return await this.displayWalletList(chatId); // Refresh list
        }

        const message = `🚨 Confirm Deletion 🚨\n\n` +
            `Are you absolutely sure you want to permanently delete trading wallet ${walletLabel}?\n\n` +
            `⚠️ This action CANNOT be undone! The private key stored in the bot for this wallet WILL BE LOST unless you have it saved elsewhere!\n\n` +
            `Funds on the blockchain are safe, but access via the bot will be removed.`;

        const keyboard = [
            [
                { text: `🗑️ YES, Delete ${walletLabel}`, callback_data: `confirm_delete_wallet_${walletLabel}` },
                { text: `❌ NO, Cancel`, callback_data: `wm_view` }
            ]
        ];

        await this.sendOrEditMessage(chatId, message, {
            parse_mode: "MarkdownV2",
            reply_markup: { inline_keyboard: keyboard }
        });
    }

    async handleResetConfirmation(chatId) {
        this.activeFlows.set(chatId, { type: 'confirm_reset' });
        const message = `🚨 WARNING: IRREVERSIBLE ACTION 🚨\n\n` +
            `This will delete ALL bot data, including wallets. To confirm, type the phrase RESET NOW exactly.`;
        await this.sendOrEditMessage(chatId, message, {
            reply_markup: {
                inline_keyboard: [[{ text: "❌ Cancel Reset", callback_data: "main_menu" }]]
            }
        });
    }

    async requestTraderName(chatId) {
        this.activeFlows.set(chatId, { type: 'add_trader_name' });
        await this.sendOrEditMessage(chatId, "✏️ Enter a unique NAME for the trader.", { reply_markup: { inline_keyboard: [[{ text: "❌ Cancel", callback_data: "main_menu" }]] } });
    }

    async requestSolAmount(chatId) {
        this.activeFlows.set(chatId, { type: 'set_sol' });
        
        let currentAmount = config.DEFAULT_SOL_TRADE_AMOUNT;
        try {
            if (this.dataManager && typeof this.dataManager.loadSolAmounts === 'function') {
                // Legacy dataManager approach
        const amounts = await this.dataManager.loadSolAmounts();
                currentAmount = amounts[String(chatId)] || amounts.default;
            } else if (this.dataManager && typeof this.dataManager.getUser === 'function') {
                // Database approach
                const user = await this.dataManager.getUser(chatId);
                if (user) {
                    const userSettings = JSON.parse(user.settings || '{}');
                    currentAmount = userSettings.solAmount || config.DEFAULT_SOL_TRADE_AMOUNT;
                }
            }
        } catch (error) {
            console.error('Error loading SOL amount:', error);
        }
        
        const msg = `💲 Enter the SOL amount per trade\n\nCurrent: ${currentAmount} SOL\nMinimum: ${MIN_SOL_AMOUNT_PER_TRADE} SOL`;
        await this.sendOrEditMessage(chatId, msg, { reply_markup: { inline_keyboard: [[{ text: "❌ Cancel", callback_data: "main_menu" }]] } });
    }

    async handleImportWalletPrompt(chatId) {
        this.activeFlows.set(chatId, { type: 'add_wallet_label', action: 'import' });
        await this.sendOrEditMessage(chatId, "✏️ Enter a LABEL for the wallet you are importing.", { reply_markup: { inline_keyboard: [[{ text: "❌ Cancel", callback_data: "wallets_menu" }]] } });
    }

    async handleGenerateWallet(chatId) {
        this.activeFlows.set(chatId, { type: 'add_wallet_label', action: 'generate' });
        await this.sendOrEditMessage(chatId, "✏️ Enter a LABEL for the new wallet to generate.", { reply_markup: { inline_keyboard: [[{ text: "❌ Cancel", callback_data: "wallets_menu" }]] } });
    }

   async handleFlowInput(msg) {
    const { chat: { id: chatId }, text } = msg;
    const flow = this.activeFlows.get(chatId);
    if (!flow) return;

    try {
        switch (flow.type) {
            case 'add_trader_name':
                const traderName = text.trim();
                if (!traderName) throw new Error("Trader name cannot be empty.");
                
                // Check if trader name already exists
                let traders = {};
                try {
                    if (this.dataManager && typeof this.dataManager.loadTraders === 'function') {
                        // Legacy dataManager approach
                        traders = await this.dataManager.loadTraders();
                    } else if (this.dataManager && typeof this.dataManager.all === 'function') {
                        // Database approach - check all traders for this user
                        const userTraders = await this.dataManager.getTraders(chatId);
                        traders = {};
                        userTraders.forEach(trader => {
                            traders[trader.name] = trader;
                        });
                    }
                } catch (error) {
                    console.error('Error checking trader names:', error);
                }
                
                if (traders[traderName]) {
                    throw new Error(`Trader name "${traderName}" already exists.`);
                }
                this.activeFlows.set(chatId, { type: 'add_trader_wallet', name: traderName });
                await this.sendOrEditMessage(chatId, `✅ Name set to *${escapeMarkdownV2(traderName)}*\\.\n\nNow, enter the Solana WALLET ADDRESS for this trader\\.`, {});
                break;

            case 'add_trader_wallet':
                const walletAddress = text.trim();
                try {
                    const walletAddress = text.replace(/\s/g, ''); // Validate address
                    await this.actionHandlers.onAddTrader(chatId, flow.name, walletAddress);
                    this.activeFlows.delete(chatId);
                    // --- NEW: Delete the user's typed message ---
                    try {
                        await this.bot.deleteMessage(chatId, msg.message_id);
                    } catch (e) {
                        console.warn(`[TelegramUI] Could not delete user message: ${e.message}`);
                    }
                } catch (e) {
                    throw new Error("Invalid Solana wallet address. Please try again.");
                }
                break;

            case 'set_sol':
                const amount = parseFloat(text.trim());
                if (isNaN(amount) || amount <= 0) throw new Error(`Invalid amount. Must be greater than 0`);

                // --- UPGRADED SAVE LOGIC ---
                try {
                    if (this.dataManager && typeof this.dataManager.loadSolAmounts === 'function') {
                        // Legacy dataManager approach
                const amounts = await this.dataManager.loadSolAmounts();
                        amounts[String(chatId)] = amount;
                await this.dataManager.saveSolAmounts(amounts);
                    } else if (this.dataManager && typeof this.dataManager.updateUserSettings === 'function') {
                        // Database approach
                        const user = await this.dataManager.getUser(chatId);
                        if (user) {
                            const userSettings = JSON.parse(user.settings || '{}');
                            userSettings.solAmount = amount;
                            await this.dataManager.updateUserSettings(chatId, userSettings);
                        }
                    }
                } catch (error) {
                    console.error('Error saving SOL amount:', error);
                    throw new Error('Failed to save SOL amount. Please try again.');
                }
                // --- END UPGRADE ---

                this.activeFlows.delete(chatId);
                // --- NEW: Delete the user's typed message ---
                try {
                    await this.bot.deleteMessage(chatId, msg.message_id);
                } catch (e) {
                    console.warn(`[TelegramUI] Could not delete user message: ${e.message}`);
                }
                await this.showMainMenu(chatId); // Refresh main menu to show new amount
                break;

            case 'confirm_reset':
                if (text === 'RESET NOW') {
                    await this.actionHandlers.onResetData(chatId);
                } else {
                    await this.bot.sendMessage(chatId, "Reset cancelled\\. Phrase did not match\\.");
                }
                this.activeFlows.delete(chatId);
                // --- NEW: Delete the user's typed message ---
                try {
                    await this.bot.deleteMessage(chatId, msg.message_id);
                } catch (e) {
                    console.warn(`[TelegramUI] Could not delete user message: ${e.message}`);
                }
                break;

            case 'add_wallet_label':
                const label = text.trim();
                if (!label) throw new Error("Label cannot be empty.");

                if (flow.action === 'import') {
                    this.activeFlows.set(chatId, { type: 'add_wallet_privatekey', label: label });
                    await this.sendOrEditMessage(chatId, `🔑 Now paste the Base58 PRIVATE KEY for wallet "${label}":`);
                } else if (flow.action === 'generate') {
                    await this.actionHandlers.onGenerateWallet(chatId, label);
                    this.activeFlows.delete(chatId);
                    
                    // Refresh wallet balances after successful generation
                    setTimeout(async () => {
                        try {
                            await this.walletManager.updateAllBalances(true);
                            console.log(`[TelegramUI] Refreshed balances after wallet generation for user ${chatId}`);
                        } catch (error) {
                            console.error(`[TelegramUI] Error refreshing balances after generation:`, error);
                        }
                    }, 1000);
                    
                    // --- NEW: Delete the user's typed message ---
                    try {
                        await this.bot.deleteMessage(chatId, msg.message_id);
                    } catch (e) {
                        console.warn(`[TelegramUI] Could not delete user message: ${e.message}`);
                    }
                }
                break;

            case 'add_wallet_privatekey':
                const cleanedPrivateKey = text.replace(/\s/g, ''); // Removes all whitespace
                await this.actionHandlers.onImportWallet(chatId, flow.label, cleanedPrivateKey);
                this.activeFlows.delete(chatId);
                
                // Refresh wallet balances after successful import
                setTimeout(async () => {
                    try {
                        await this.walletManager.updateAllBalances(true);
                        console.log(`[TelegramUI] Refreshed balances after wallet import for user ${chatId}`);
                    } catch (error) {
                        console.error(`[TelegramUI] Error refreshing balances after import:`, error);
                    }
                }, 1000);
                
                // --- NEW: Delete the user's typed message ---
                try {
                    await this.bot.deleteMessage(chatId, msg.message_id);
                } catch (e) {
                    console.warn(`[TelegramUI] Could not delete user message: ${e.message}`);
                }
                break;

            case 'withdraw_amount':
                // Store the amount and ask for address
                const withdrawAmount = parseFloat(text.trim());
                if (isNaN(withdrawAmount) || withdrawAmount <= 0) {
                    await this.sendErrorMessage(chatId, "Please enter a valid SOL amount greater than 0.");
                    return;
                }
                this.activeFlows.set(chatId, { type: 'withdraw_address', amount: withdrawAmount });
                await this.sendOrEditMessage(chatId, `💸 Withdraw ${withdrawAmount} SOL\n\n` +
                    `Please enter the destination Solana address.`);
                break;

            case 'withdraw_address':
                // Call the proper withdrawal handler with amount and address
                if (this.actionHandlers.onWithdraw && flow.amount) {
                    await this.actionHandlers.onWithdraw(chatId, text.trim(), flow.amount);
                } else {
                    await this.bot.sendMessage(chatId, `Withdrawal functionality is not available. Please contact support.`);
                }
                this.activeFlows.delete(chatId);
                // --- NEW: Delete the user's typed message ---
                try {
                    await this.bot.deleteMessage(chatId, msg.message_id);
                } catch (e) {
                    console.warn(`[TelegramUI] Could not delete user message: ${e.message}`);
                }
                break;

            case 'admin_add_user_chat_id':
                const userId = text.trim();
                if (!/^\d+$/.test(userId)) {
                    throw new Error("Invalid Chat ID. It should only contain numbers.");
                }
                this.activeFlows.set(chatId, { type: 'admin_add_user_username', userId: userId });
                await this.sendOrEditMessage(chatId, `➡️ Step 2/2: Set Username\n\n` +
                    `Chat ID set to ${userId}. Now, enter a unique username for this person (e.g., 'Rahul').`);
                break;

            case 'admin_add_user_username':
                const username = text.trim();
                if (!username) throw new Error("Username cannot be empty.");

                try {
                    if (this.dataManager && typeof this.dataManager.loadUsers === 'function') {
                        // Legacy dataManager approach
                const users = await this.dataManager.loadUsers();
                        users[flow.userId] = username;
                await this.dataManager.saveUsers(users);
                    } else if (this.dataManager && typeof this.dataManager.updateUserSettings === 'function') {
                        // Database approach
                        const user = await this.dataManager.getUser(flow.userId);
                        if (user) {
                            const userSettings = JSON.parse(user.settings || '{}');
                            userSettings.username = username;
                            await this.dataManager.updateUserSettings(flow.userId, userSettings);
                        }
                    }
                } catch (error) {
                    console.error('Error saving username:', error);
                    throw new Error('Failed to save username. Please try again.');
                }

                this.activeFlows.delete(chatId); // End the flow
                // --- NEW: Delete the user's typed message ---
                try {
                    await this.bot.deleteMessage(chatId, msg.message_id);
                } catch (e) {
                    console.warn(`[TelegramUI] Could not delete user message: ${e.message}`);
                }

                await this.sendOrEditMessage(chatId, `✅ *User Whitelisted\\!*\n` +
                    `User: *${escapeMarkdownV2(username)}*\n` +
                    `Chat ID: \`${escapeMarkdownV2(flow.userId)}\``);

                // Show the manage users menu again
                await this.showUserManagementMenu(chatId);
                break;

            default:
                console.warn(`Unhandled flow type: ${flow.type}`);
                this.activeFlows.delete(chatId);
        }
    } catch (e) {
        await this.sendErrorMessage(chatId, e.message);
    }
}

    async showUserRemovalList(chatId) {
        let users = {};
        try {
            if (this.dataManager && typeof this.dataManager.loadUsers === 'function') {
                // Legacy dataManager approach
                users = await this.dataManager.loadUsers();
            } else if (this.dataManager && typeof this.dataManager.all === 'function') {
                // Database approach
                const dbUsers = await this.dataManager.all('SELECT * FROM users');
                users = {};
                dbUsers.forEach(user => {
                    const userSettings = JSON.parse(user.settings || '{}');
                    users[user.chat_id] = userSettings.username || user.chat_id;
                });
            }
        } catch (error) {
            console.error('Error loading users for removal list:', error);
        }
        
        const userList = Object.entries(users);

        let message = "🗑️ *Select a User to Remove*\n\nTap a user's name to remove them from the whitelist\\.";
        const buttons = [];

        if (userList.length === 0) {
            message += "\n\n_No users have been whitelisted yet\\._";
        } else {
            userList.forEach(([userId, username]) => {
                // IMPORTANT: Ensure the userId does not belong to the admin
                if (String(userId) !== String(config.ADMIN_CHAT_ID)) {
                    buttons.push([{ text: `👤 ${username}`, callback_data: `admin_remove_user_execute_${userId}` }]);
                }
            });
        }

        buttons.push([{ text: "🔙 Back to User Management", callback_data: "admin_manage_users" }]);
        await this.sendOrEditMessage(chatId, message, { reply_markup: { inline_keyboard: buttons } });
    }

    async handleRemoveUser(chatId, userIdToRemove) {
        try {
            if (this.dataManager && typeof this.dataManager.loadUsers === 'function') {
                // Legacy dataManager approach
        const users = await this.dataManager.loadUsers();
        const username = users[userIdToRemove];
        if (username) {
            delete users[userIdToRemove];
            await this.dataManager.saveUsers(users);
                    await this.sendOrEditMessage(chatId, `✅ User *${escapeMarkdownV2(username)}* has been removed\\.`);
        } else {
                    await this.sendOrEditMessage(chatId, "❌ User not found\\.");
                }
            } else if (this.dataManager && typeof this.dataManager.deleteUser === 'function') {
                // Database approach
                const user = await this.dataManager.getUser(userIdToRemove);
                if (user) {
                    const userSettings = JSON.parse(user.settings || '{}');
                    const username = userSettings.username || userIdToRemove;
                    await this.dataManager.deleteUser(userIdToRemove);
                    await this.sendOrEditMessage(chatId, `✅ User *${escapeMarkdownV2(username)}* has been removed\\.`);
                } else {
                    await this.sendOrEditMessage(chatId, "❌ User not found\\.");
                }
            } else {
                await this.sendOrEditMessage(chatId, "❌ User removal not supported\\.");
            }
        } catch (error) {
            console.error('Error removing user:', error);
            await this.sendOrEditMessage(chatId, "❌ Failed to remove user.");
        }
        
        if (false) { // This will never execute, but keeps the original logic structure
            await this.sendOrEditMessage(chatId, `⚠️ User with ID \`${escapeMarkdownV2(userIdToRemove)}\` not found\\.`);
        }

        // Show the updated list
        await this.showUserRemovalList(chatId);
    }


    async sendOrEditMessage(chatId, text, options = {}, messageId = null) {
        messageId = messageId || this.latestMessageIds.get(chatId);
        const finalOptions = { disable_web_page_preview: true, ...options };
        
        // Only use MarkdownV2 if parse_mode is not explicitly set to null
        if (options.parse_mode !== null) {
            finalOptions.parse_mode = 'MarkdownV2';
            // Ensure text is properly escaped for MarkdownV2 if not already escaped
            // Harden: Ensure text is a string before calling includes()
            const safeText = typeof text === 'string' ? text : String(text);
            const escapedText = safeText.includes('\\-') ? safeText : escapeMarkdownV2(safeText);
            finalOptions.text = escapedText;
        } else {
            finalOptions.text = text;
        }

        try {
            if (messageId) {
                const editedMessage = await this.bot.editMessageText(finalOptions.text, { ...finalOptions, chat_id: chatId, message_id: messageId });
                this.latestMessageIds.set(chatId, editedMessage.message_id);
                return editedMessage;
            } else {
                throw new Error("No message ID to edit, will send new.");
            }
        } catch (editError) {
            if (editError.message?.includes("message is not modified")) {
                return null;
            }

            try {
                const newMessage = await this.bot.sendMessage(chatId, finalOptions.text, finalOptions);
                this.latestMessageIds.set(chatId, newMessage.message_id);
                return newMessage;
            } catch (sendError) {
                console.error(`CRITICAL: Failed to SEND message after edit failed:`, sendError.message);
                return null;
            }
        }
    }

    async sendErrorMessage(chatId, text) {
        if (!this.bot) return;
        try {
            await this.bot.sendMessage(chatId, `❌ Error\n\n${text}`);
        } catch (e) {
            console.error(`Failed to send error message to chat ${chatId}:`, e);
        }
    }

    stop() {
        if (this.bot && this.bot.isPolling()) this.bot.stopPolling({ cancel: true });
        this.logger.info("TelegramUI stopped.");
    }

}

module.exports = TelegramUI;