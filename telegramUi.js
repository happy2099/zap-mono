
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
    constructor(databaseManager, solanaManager, walletManager) {
        if (!databaseManager || !solanaManager || !walletManager) {
            throw new Error("TelegramUI: Missing one or more required manager modules.");
        }
        
        // Store the manager instance
        this.databaseManager = databaseManager;
        this.solanaManager = solanaManager;
        this.walletManager = walletManager;
        
        // Determine the manager type for compatibility
        this.isDatabaseManager = typeof databaseManager.getUser === 'function' && typeof databaseManager.all === 'function';
        this.isLegacyDataManager = typeof databaseManager.loadTraders === 'function' && typeof databaseManager.loadUsers === 'function';
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

    initialize() {
        this.logger.info("BOT_TOKEN:", BOT_TOKEN ? "Set" : "Missing");
        if (!BOT_TOKEN || BOT_TOKEN === 'YOUR_TELEGRAM_BOT_TOKEN_HERE') {
            console.warn("⚠️ TelegramUI: No valid bot token found, running in headless mode.");
            return { success: true, mode: 'headless' };
        }
        this.bot = new TelegramBot(BOT_TOKEN, { polling: { interval: 300, autoStart: false, params: { timeout: 10 } } });
        this.logger.info("TelegramBot instance created:", this.bot ? "Success" : "Failed");
        this.bot.getMe().then(me => this.logger.info(`Telegram Bot authorized for: @${me.username}`)).catch(err => {
            console.error("Telegram Bot authorization failed:", err);
            this.bot = null;
        });
        this.setupEventListeners();
        
        // Don't start polling automatically - let the worker control it
        console.log("⚠️ TelegramUI: Bot created but polling NOT started automatically");
    }

    // Add method to manually start polling
    startPolling() {
        if (!this.bot) {
            console.error("❌ Cannot start polling: Bot not initialized");
            return false;
        }
        
        try {
            this.bot.startPolling({ interval: 300, params: { timeout: 10 } });
            console.log("✅ TelegramUI: Polling started manually");
            return true;
        } catch (error) {
            console.error("❌ Failed to start polling:", error.message);
            return false;
        }
    }

    bindActionHandlers(handlers) {
        this.actionHandlers = handlers;
    }

    setupEventListeners() {
        if (!this.bot) return;

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
        const message = "➡️ *Step 1/2: Add New User*\n\n" +
            "Please enter the unique *Telegram Chat ID* of your friend\\. " +
            "They can get this by messaging `@userinfobot`\\.";
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
            admin_panel: () => this.showAdminPanel(chatId),
            admin_view_activity: () => this.displayUserActivity(chatId),
            admin_view_pnl: () => this.displayUserPnl(chatId),
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


    async showMainMenu(chatId, messageId = null) {
        // Load data for the specific user
        let userSol = config.DEFAULT_SOL_TRADE_AMOUNT;
        let userTraders = {};
        
        try {
            if (this.isDatabaseManager) {
                // Database approach
                const user = await this.databaseManager.getUser(chatId);
                if (user) {
                    // Get SOL amount from user_trading_settings table
                    const tradingSettings = await this.databaseManager.get('SELECT sol_amount_per_trade FROM user_trading_settings WHERE user_id = ?', [user.id]);
                    userSol = tradingSettings?.sol_amount_per_trade || config.DEFAULT_SOL_TRADE_AMOUNT;
                    

                    
                    const traders = await this.databaseManager.getTraders(chatId);
                    userTraders = {};
                    traders.forEach(trader => {
                        userTraders[trader.name] = {
                            wallet: trader.wallet,
                            active: trader.active === 1,
                            addedAt: trader.created_at
                        };
                    });
                }
            } else if (this.isLegacyDataManager) {
                // Legacy dataManager approach
                const solAmounts = await this.databaseManager.loadSolAmounts();
                userSol = solAmounts[String(chatId)] || solAmounts.default || config.DEFAULT_SOL_TRADE_AMOUNT;

                const settings = await this.databaseManager.loadSettings();
                const userSettings = settings.userSettings?.[String(chatId)] || {};

                
                userTraders = await this.databaseManager.loadTraders(chatId);
            }
        } catch (error) {
            console.error('Error loading user data for main menu:', error);
        }

        // Get user-specific wallet count from database
        const userWalletCount = await this.walletManager.getTradingWalletCount(chatId);
        const activeTradersCount = Object.values(userTraders).filter(t => t.active).length;
        const totalTradersCount = Object.values(userTraders).length;
        const message = `*🚀 ZapTrade Bot Menu*\n\n` +
             `📊 Your Active Copies: *${activeTradersCount} / ${totalTradersCount} trader\\(s\\) active*\n`+ 
             `💰 Your Trade Size: *${escapeMarkdownV2(userSol.toFixed(4) + ' SOL')}\\.*\n` +
            `💼 Your Wallets: *${userWalletCount}*\n\n` +
            `Choose an action:`;

        const keyboard = [
            [{ text: "▶️ Start Copy", callback_data: "start_copy" }, { text: "⛔ Stop Copy", callback_data: "stop_copy" }],
            [{ text: "➕ Add Trader", callback_data: "add_trader" }, { text: "❌ Remove Trader", callback_data: "remove_trader" }],
            [{ text: "💼 My Wallets", callback_data: "wallets_menu" }, { text: "💰 My Balances", callback_data: "balance" }],
            [{ text: "📋 List Traders", callback_data: "traders_list" }, { text: "💸 Withdraw", callback_data: "withdraw" }],
            [{ text: "💲 Set SOL Amt", callback_data: "set_sol" }, { text: "⚙️ Reset Bot", callback_data: "reset_all" }]
        ];
        // Admins get a special button
        try {
            const user = await this.databaseManager.getUser(chatId);
            if (user && user.is_admin === 1) {
                keyboard.push([{ text: "👑 Admin Panel", callback_data: "admin_panel" }]);
            }
        } catch (error) {
            console.error('Error checking admin status for menu:', error);
        }
        await this.sendOrEditMessage(chatId, message, { reply_markup: { inline_keyboard: keyboard } }, messageId);
    }


    async showAdminPanel(chatId) {
        // A safety check to ensure only the admin can access this.
        try {
            const user = await this.databaseManager.getUser(chatId);
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
            const user = await this.databaseManager.getUser(chatId);
            if (!user || user.is_admin !== 1) return;
        } catch (error) {
            console.error('Error checking admin status:', error);
            return;
        }

        let message = `*👀 Live User Activity*\n\n`;
        let allTraders = {};
        let allSettings = { userSettings: {} };

        try {
            if (this.databaseManager && typeof this.databaseManager.loadTraders === 'function') {
                // Legacy databaseManager approach
                allTraders = await this.databaseManager.loadTraders();
                allSettings = await this.databaseManager.loadSettings();
            } else if (this.databaseManager && typeof this.databaseManager.all === 'function') {
                // Database approach
                const traders = await this.databaseManager.all('SELECT * FROM traders WHERE active = 1');
                const users = await this.databaseManager.all('SELECT * FROM users');
                
                allTraders = {};
                traders.forEach(trader => {
                    const user = users.find(u => u.id === trader.user_id);
                    if (user) {
                        allTraders[trader.name] = {
                            wallet: trader.wallet,
                            active: trader.active === 1,
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
            const user = await this.databaseManager.getUser(chatId);
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
            if (this.databaseManager && this.databaseManager.userPositions) {
                // Legacy databaseManager approach
                allUserPositions = this.databaseManager.userPositions;
            } else if (this.databaseManager && typeof this.databaseManager.all === 'function') {
                // Database approach - get positions from user settings
                const users = await this.databaseManager.all('SELECT * FROM users');
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
            if (this.databaseManager && typeof this.databaseManager.loadUsers === 'function') {
                // Legacy databaseManager approach
                users = await this.databaseManager.loadUsers();
            } else if (this.databaseManager && typeof this.databaseManager.all === 'function') {
                // Database approach
                const dbUsers = await this.databaseManager.all('SELECT * FROM users');
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
    // Use database instead of databaseManager
    let userTraders = {};
    try {
        // Always use database approach
        this.logger.debug(`Loading traders for chatId: ${chatId}`);
        const traders = await this.databaseManager.getTraders(chatId);
        this.logger.debug(`Found ${traders.length} traders for chatId: ${chatId}`);
        
        // Convert traders to the expected format
        userTraders = {};
        traders.forEach(trader => {
            userTraders[trader.name] = {
                wallet: trader.wallet,
                active: trader.active === 1,
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
            const user = await this.databaseManager.getUser(chatId);
            if (user) {
                // Get SOL amount from user_trading_settings table
                const tradingSettings = await this.databaseManager.get('SELECT sol_amount_per_trade FROM user_trading_settings WHERE user_id = ?', [user.id]);
                solAmt = tradingSettings?.sol_amount_per_trade || config.DEFAULT_SOL_TRADE_AMOUNT;
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
        const traders = await this.databaseManager.getTraders(chatId);
        userTraders = {};
        traders.forEach(trader => {
            userTraders[trader.name] = {
                wallet: trader.wallet,
                active: trader.active === 1,
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
            emptyMsg = "_All your traders are already active\\._";
            header = "*Select one of your inactive traders:*";
            break;
        case 'stop':
            title = "⛔ Select Trader to STOP";
            filterFn = ([, t]) => t.active;
            cbPrefix = "stop_";
            emptyMsg = "_You have no active traders to stop\\._";
            header = "*Select one of your active traders:*";
            break;
        case 'remove':
            title = "🗑️ Select Trader to REMOVE";
            filterFn = () => true;
            cbPrefix = "remove_";
            emptyMsg = "_You have no traders configured\\._";
            header = "*Select any of your traders to remove:*";
            break;
        default: return;
    }

    const filteredTraders = Object.entries(userTraders).filter(filterFn);
    
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
        const message = `*💼 Wallet Manager*\n\nManage wallets used for copy trading\\.`;
        const keyboard = [
            [{ text: "👁️ List/Delete Wallets", callback_data: "wm_view" }, { text: "💰 Check Balances", callback_data: "balance" }],
            [{ text: "➕ Add New Wallet", callback_data: "wm_add" }],
            [{ text: "🔙 Main Menu", callback_data: "main_menu" }]
        ];
        await this.sendOrEditMessage(chatId, message, { reply_markup: { inline_keyboard: keyboard } });
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
        await this.sendOrEditMessage(chatId, "⏳ Fetching wallet balances\\.\\.\\.", {});

        try {
            // Get user's wallets from database
            const userWallets = await this.databaseManager.getUserWallets(chatId);
            
            const botBalance = await this.solanaManager.getSOLBalance(config.USER_WALLET_PUBKEY); 

            // Escape "n" properly if you have it in string literals.
            let message = `*💰 Wallet Balances*\n\n`;
            let totalSol = 0;

            const botBalStr = botBalance !== null ? `*${escapeMarkdownV2(botBalance.toFixed(4))} SOL*` : '_N/A_';
            message += `🤖 *Bot Wallet*: ${botBalStr}\n\n*Your Wallets:*\n`;

            if (userWallets.length === 0) {
                message += "_No trading wallets configured\\._";
            } else {
                // Update balances for each wallet
                for (const wallet of userWallets) {
                    try {
                        const balance = await this.solanaManager.getSOLBalance(wallet.public_key);
                        await this.databaseManager.updateWalletBalance(wallet.id, balance);
                        
                        const balStr = escapeMarkdownV2((balance || 0).toFixed(4));
                        message += `\n📈 *${escapeMarkdownV2(wallet.label)}*\n` + 
                                   `   Addr: \`${escapeMarkdownV2(wallet.public_key)}\`\n` +
                                   `   Balance: *${balStr} SOL*\n`;
                        totalSol += (balance || 0);
                    } catch (error) {
                        console.error(`Error fetching balance for wallet ${wallet.label}:`, error);
                        const balStr = escapeMarkdownV2((wallet.balance || 0).toFixed(4));
                        message += `\n📈 *${escapeMarkdownV2(wallet.label)}*\n` + 
                                   `   Addr: \`${escapeMarkdownV2(wallet.public_key)}\`\n` +
                                   `   Balance: *${balStr} SOL* \\(cached\\)\n`;
                        totalSol += (wallet.balance || 0);
                    }
                }
                message += `\n💎 *Total Balance:* *${escapeMarkdownV2(totalSol.toFixed(4) + ' SOL')}*`; // Final sum message// Final sum message
            }

            const keyboard = [[{ text: "🔄 Refresh", callback_data: "balance" }, { text: "🔙 Main Menu", callback_data: "main_menu" }]];
            await this.sendOrEditMessage(chatId, message, { reply_markup: { inline_keyboard: keyboard }, disable_web_page_preview: true });
        } catch (error) {
            console.error("[Balance Display] Error fetching balances:", error);
            await this.sendErrorMessage(chatId, "Failed to fetch balances\\. Please check logs and try again\\.");
        }
    }

    async handleWithdraw(chatId) {
        this.activeFlows.set(chatId, { type: 'withdraw_amount' });
        const message = `💸 *Withdraw SOL from Bot Wallet*\n\n` +
            `Please enter the amount of SOL to withdraw\\.`;
        await this.sendOrEditMessage(chatId, message, {
            reply_markup: { inline_keyboard: [[{ text: "❌ Cancel", callback_data: "main_menu" }]] }
        });
    }

   async displayWalletList(chatId) {
        try {
            // Get user's wallets directly from the database
            const userWallets = await this.databaseManager.getUserWallets(chatId);
            
            let message = `*💼 Your Trading Wallets*\n\n`; // Add extra newline for spacing
            let buttons = [];

            if (userWallets.length === 0) { // Check the length of YOUR user's wallets
                message += "_You have no trading wallets\\. Use the 'Add' button to create one\\._";
            } else {
                userWallets.sort((a, b) => a.label.localeCompare(b.label)).forEach(w => {
                    const balStr = escapeMarkdownV2((w.balance || 0).toFixed(4));
                    message += `📈 *${escapeMarkdownV2(w.label)}*\n` + // Newline after label with primary indicator
                               `   Addr: \`${escapeMarkdownV2(w.public_key)}\`\n` + // Properly escaped address, and consistent newline
                               `   Balance: *${balStr} SOL*\n\n`; // Extra newline for spacing between wallets
                    buttons.push([{ text: `🗑️ Delete ${w.label}`, callback_data: `delete_wallet_${w.label}` }]);
                });
            }
            buttons.push([{ text: "🔙 Back", callback_data: "wallets_menu" }]);
            await this.sendOrEditMessage(chatId, message, { reply_markup: { inline_keyboard: buttons }, disable_web_page_preview: true });
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
        const message = `🚨 *Confirm Deletion* 🚨\n\nAre you sure you want to delete wallet **${escapeMarkdownV2(walletLabel)}**\\? This is irreversible\\!`;
        await this.sendOrEditMessage(chatId, message, {
            reply_markup: {
                inline_keyboard: [
                    [{ text: `🗑️ YES, Delete`, callback_data: `confirm_delete_wallet_${walletLabel}` }],
                    [{ text: `❌ NO, Cancel`, callback_data: `wm_view` }]
                ]
            }
        });
    }

    async handleResetConfirmation(chatId) {
        this.activeFlows.set(chatId, { type: 'confirm_reset' });
        const message = `🚨 *WARNING: IRREVERSIBLE ACTION* 🚨\n\n` +
            `This will delete ALL bot data, including wallets\\. To confirm, type the phrase \`RESET NOW\` exactly\\.`;
        await this.sendOrEditMessage(chatId, message, {
            reply_markup: {
                inline_keyboard: [[{ text: "❌ Cancel Reset", callback_data: "main_menu" }]]
            }
        });
    }

    async requestTraderName(chatId) {
        this.activeFlows.set(chatId, { type: 'add_trader_name' });
        await this.sendOrEditMessage(chatId, "✏️ Enter a unique *NAME* for the trader\\.", { reply_markup: { inline_keyboard: [[{ text: "❌ Cancel", callback_data: "main_menu" }]] } });
    }

    async requestSolAmount(chatId) {
        this.activeFlows.set(chatId, { type: 'set_sol' });
        
        let currentAmount = config.DEFAULT_SOL_TRADE_AMOUNT;
        try {
            if (this.databaseManager && typeof this.databaseManager.loadSolAmounts === 'function') {
                // Legacy databaseManager approach
        const amounts = await this.databaseManager.loadSolAmounts();
                currentAmount = amounts[String(chatId)] || amounts.default;
            } else if (this.databaseManager && typeof this.databaseManager.getUser === 'function') {
                // Database approach
                const user = await this.databaseManager.getUser(chatId);
                if (user) {
                    const userSettings = JSON.parse(user.settings || '{}');
                    currentAmount = userSettings.solAmount || config.DEFAULT_SOL_TRADE_AMOUNT;
                }
            }
        } catch (error) {
            console.error('Error loading SOL amount:', error);
        }
        
        const msg = `💲 Enter the *SOL* amount per trade \\(Current: ${escapeMarkdownV2(currentAmount)}\\)\\. Minimum: ${escapeMarkdownV2(MIN_SOL_AMOUNT_PER_TRADE)}\\.`;
        await this.sendOrEditMessage(chatId, msg, { reply_markup: { inline_keyboard: [[{ text: "❌ Cancel", callback_data: "main_menu" }]] } });
    }

    async handleImportWalletPrompt(chatId) {
        this.activeFlows.set(chatId, { type: 'add_wallet_label', action: 'import' });
        await this.sendOrEditMessage(chatId, "✏️ Enter a *LABEL* for the wallet you are importing\\.", { reply_markup: { inline_keyboard: [[{ text: "❌ Cancel", callback_data: "wallets_menu" }]] } });
    }

    async handleGenerateWallet(chatId) {
        this.activeFlows.set(chatId, { type: 'add_wallet_label', action: 'generate' });
        await this.sendOrEditMessage(chatId, "✏️ Enter a *LABEL* for the new wallet to generate\\.", { reply_markup: { inline_keyboard: [[{ text: "❌ Cancel", callback_data: "wallets_menu" }]] } });
    }

   async handleFlowInput(msg) {
    const { chat: { id: chatId }, text } = msg;
    const flow = this.activeFlows.get(chatId);
    if (!flow) return;

    try {
        switch (flow.type) {
            case 'add_trader_name':
                const traderName = text.trim();
                if (!traderName) throw new Error("Trader name cannot be empty\\.");
                
                // Check if trader name already exists
                let traders = {};
                try {
                    if (this.databaseManager && typeof this.databaseManager.loadTraders === 'function') {
                        // Legacy databaseManager approach
                        traders = await this.databaseManager.loadTraders();
                    } else if (this.databaseManager && typeof this.databaseManager.all === 'function') {
                        // Database approach - check all traders for this user
                        const userTraders = await this.databaseManager.getTraders(chatId);
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
                    throw new Error("Invalid Solana wallet address\\. Please try again\\.");
                }
                break;

            case 'set_sol':
                const amount = parseFloat(text.trim());
                if (isNaN(amount) || amount <= 0) throw new Error(`Invalid amount. Must be greater than 0`);

                // --- UPGRADED SAVE LOGIC ---
                try {
                    if (this.databaseManager && typeof this.databaseManager.loadSolAmounts === 'function') {
                        // Legacy databaseManager approach
                const amounts = await this.databaseManager.loadSolAmounts();
                        amounts[String(chatId)] = amount;
                await this.databaseManager.saveSolAmounts(amounts);
                    } else if (this.databaseManager && typeof this.databaseManager.updateUserSettings === 'function') {
                        // Database approach
                        const user = await this.databaseManager.getUser(chatId);
                        if (user) {
                            const userSettings = JSON.parse(user.settings || '{}');
                            userSettings.solAmount = amount;
                            await this.databaseManager.updateUserSettings(chatId, userSettings);
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
                if (!label) throw new Error("Label cannot be empty\\.");

                if (flow.action === 'import') {
                    this.activeFlows.set(chatId, { type: 'add_wallet_privatekey', label: label });
                    await this.sendOrEditMessage(chatId, `🔑 Now paste the Base58 *PRIVATE KEY* for wallet "${escapeMarkdownV2(label)}":`);
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
                    await this.sendErrorMessage(chatId, "Please enter a valid SOL amount greater than 0\\.");
                    return;
                }
                this.activeFlows.set(chatId, { type: 'withdraw_address', amount: withdrawAmount });
                await this.sendOrEditMessage(chatId, `💸 *Withdraw ${withdrawAmount} SOL*\n\n` +
                    `Please enter the destination Solana address\\.`);
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
                    throw new Error("Invalid Chat ID\\. It should only contain numbers\\.");
                }
                this.activeFlows.set(chatId, { type: 'admin_add_user_username', userId: userId });
                await this.sendOrEditMessage(chatId, `➡️ *Step 2/2: Set Username*\n\n` +
                    `Chat ID set to \`${escapeMarkdownV2(userId)}\`\\. Now, enter a unique username for this person \\(e\\.g\\., 'Rahul'\\)\\.`);
                break;

            case 'admin_add_user_username':
                const username = text.trim();
                if (!username) throw new Error("Username cannot be empty\\.");

                try {
                    if (this.databaseManager && typeof this.databaseManager.loadUsers === 'function') {
                        // Legacy databaseManager approach
                const users = await this.databaseManager.loadUsers();
                        users[flow.userId] = username;
                await this.databaseManager.saveUsers(users);
                    } else if (this.databaseManager && typeof this.databaseManager.updateUserSettings === 'function') {
                        // Database approach
                        const user = await this.databaseManager.getUser(flow.userId);
                        if (user) {
                            const userSettings = JSON.parse(user.settings || '{}');
                            userSettings.username = username;
                            await this.databaseManager.updateUserSettings(flow.userId, userSettings);
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
            if (this.databaseManager && typeof this.databaseManager.loadUsers === 'function') {
                // Legacy databaseManager approach
                users = await this.databaseManager.loadUsers();
            } else if (this.databaseManager && typeof this.databaseManager.all === 'function') {
                // Database approach
                const dbUsers = await this.databaseManager.all('SELECT * FROM users');
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
            if (this.databaseManager && typeof this.databaseManager.loadUsers === 'function') {
                // Legacy databaseManager approach
        const users = await this.databaseManager.loadUsers();
        const username = users[userIdToRemove];
        if (username) {
            delete users[userIdToRemove];
            await this.databaseManager.saveUsers(users);
                    await this.sendOrEditMessage(chatId, `✅ User *${escapeMarkdownV2(username)}* has been removed\\.`);
        } else {
                    await this.sendOrEditMessage(chatId, "❌ User not found\\.");
                }
            } else if (this.databaseManager && typeof this.databaseManager.deleteUser === 'function') {
                // Database approach
                const user = await this.databaseManager.getUser(userIdToRemove);
                if (user) {
                    const userSettings = JSON.parse(user.settings || '{}');
                    const username = userSettings.username || userIdToRemove;
                    await this.databaseManager.deleteUser(userIdToRemove);
                    await this.sendOrEditMessage(chatId, `✅ User *${escapeMarkdownV2(username)}* has been removed\\.`);
                } else {
                    await this.sendOrEditMessage(chatId, "❌ User not found\\.");
                }
            } else {
                await this.sendOrEditMessage(chatId, "❌ User removal not supported\\.");
            }
        } catch (error) {
            console.error('Error removing user:', error);
            await this.sendOrEditMessage(chatId, "❌ Failed to remove user\\.");
        }
        
        if (false) { // This will never execute, but keeps the original logic structure
            await this.sendOrEditMessage(chatId, `⚠️ User with ID \`${escapeMarkdownV2(userIdToRemove)}\` not found\\.`);
        }

        // Show the updated list
        await this.showUserRemovalList(chatId);
    }


    async sendOrEditMessage(chatId, text, options = {}, messageId = null) {
        messageId = messageId || this.latestMessageIds.get(chatId);
        const finalOptions = { parse_mode: 'MarkdownV2', disable_web_page_preview: true, ...options };
        
        // Ensure text is properly escaped for MarkdownV2 if not already escaped
        const escapedText = text.includes('\\-') ? text : escapeMarkdownV2(text);

        try {
            if (messageId) {
                const editedMessage = await this.bot.editMessageText(escapedText, { ...finalOptions, chat_id: chatId, message_id: messageId });
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
                const newMessage = await this.bot.sendMessage(chatId, escapedText, finalOptions);
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
            await this.bot.sendMessage(chatId, `❌ *Error*\n\n${escapeMarkdownV2(text)}`, { parse_mode: 'MarkdownV2' });
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