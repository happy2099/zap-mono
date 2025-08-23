
// ==========================================
// ========== ZapBot TelegramUI (v2) ========
// ==========================================
// File: telegramUi.js
// Description: Manages all Telegram Bot interactions, including menus, commands, and input flows.

const TelegramBot = require('node-telegram-bot-api');
const bs58 = require('bs58');
const { PublicKey } = require('@solana/web3.js');

// Import shared utilities and config
const { shortenAddress, escapeMarkdownV2, formatLamports, createUserFriendlyMessage, getUserGreeting } = require('./utils');
const config = require('./patches/config.js');
const { BOT_TOKEN, USER_WALLET_PUBKEY, MIN_SOL_AMOUNT_PER_TRADE, ADMIN_CHAT_ID } = config;

class TelegramUI {
    constructor(dataManager, solanaManager, walletManager) {
        if (!dataManager || !solanaManager || !walletManager) {
            throw new Error("TelegramUI: Missing one or more required manager modules.");
        }
        this.dataManager = dataManager;
        this.solanaManager = solanaManager;
        this.walletManager = walletManager;
        this.bot = null;

        // In-memory state
        this.activeFlows = new Map();
        this.latestMessageIds = new Map();
        

        // Action Handlers to be bound from the main bot class
        this.actionHandlers = {};

        console.log("TelegramUI initialized.");
    }

    initialize() {
        console.log("BOT_TOKEN:", BOT_TOKEN ? "Set" : "Missing");
        if (!BOT_TOKEN || BOT_TOKEN === 'YOUR_TELEGRAM_BOT_TOKEN_HERE') {
            console.warn("⚠️ TelegramUI: No valid bot token found, running in headless mode.");
            return { success: true, mode: 'headless' };
        }
        this.bot = new TelegramBot(BOT_TOKEN, { polling: { interval: 300, autoStart: true, params: { timeout: 10 } } });
        console.log("TelegramBot instance created:", this.bot ? "Success" : "Failed");
        this.bot.getMe().then(me => console.log(`Telegram Bot authorized for: @${me.username}`)).catch(err => {
            console.error("Telegram Bot authorization failed:", err);
            this.bot = null;
        });
        this.setupEventListeners();
    }

    bindActionHandlers(handlers) {
        this.actionHandlers = handlers;
    }

    setNotificationManager(notificationManager) {
        this.notificationManager = notificationManager;
    }

    setApiManager(apiManager) {
        this.apiManager = apiManager;
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
            console.log(`[TELEGRAM_UI] Detected /copy command. Firing action handler.`);
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
            "Please enter the unique *Telegram Chat ID* of your friend. " +
            "They can get this by messaging `@userinfobot`.";
        await this.sendOrEditMessage(chatId, message, {
            reply_markup: { inline_keyboard: [[{ text: "❌ Cancel", callback_data: "admin_manage_users" }]] }
        });
    }

    async handleMenuCommand(msg) {
        const chatId = msg.chat.id;
        
        // Save user information to database
        await this.saveUserInfo(msg);
        
        if (this.activeFlows.has(chatId)) {
            const flowType = this.activeFlows.get(chatId)?.type;
            this.activeFlows.delete(chatId);
            await this.sendOrEditMessage(chatId, `_Flow '${flowType}' cancelled._`, {}, msg.message_id).catch(() => { });
        }
        await this.showMainMenu(chatId, msg.message_id);
    }

    async saveUserInfo(msg) {
        try {
            const chatId = msg.chat.id;
            const user = msg.from;
            
            if (user) {
                // Use the actual Telegram user's name
                const displayName = user.first_name || user.username || `User${chatId}`;
                
                // Save user info directly to database
                try {
                    await this.dataManager.saveUser(chatId, { 
                        username: displayName
                    });
                } catch (dbError) {
                    console.log('Could not save user in database:', dbError.message);
                }
            }
        } catch (error) {
            console.error('Error saving user info:', error);
        }
    }

async handleCallbackQuery(cb) {
    const { data, message } = cb;
    const chatId = message.chat.id;

    await this.bot.answerCallbackQuery(cb.id).catch(() => {});
    this.latestMessageIds.set(chatId, message.message_id);
    
    if (this.activeFlows.has(chatId) && !data.startsWith('confirm_')) {
        this.activeFlows.delete(chatId);
        await this.sendOrEditMessage(chatId, `_Flow cancelled._`, { parse_mode: 'MarkdownV2' }, message.message_id).catch(() => {});
    }

   try {
        const [action, ...params] = data.split('_');
        const param = params.join('_');

        // Check admin access for admin-only functions
        if (data.startsWith('admin_') && data !== 'admin_panel') {
            const isAdmin = await this.dataManager.isUserAdmin(chatId.toString());
            if (!isAdmin) {
                await this.sendOrEditMessage(chatId, "❌ *Access Denied*\n\nYou don't have admin privileges to access this function.");
                return;
            }
        }

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
            select_primary_wallet_menu: () => this.displayPrimaryWalletSelection(chatId),
            refresh_balances: () => this.displayWalletBalances(chatId),
            admin_panel: () => this.showAdminPanel(chatId),
            admin_view_activity: () => this.displayUserActivity(chatId),
            admin_view_pnl: () => this.displayUserPnl(chatId),
            admin_manage_users: () => this.showUserManagementMenu(chatId),
            admin_bot_stats: () => this.showBotStatistics(chatId),
            admin_system_health: () => this.showSystemHealth(chatId),
            admin_global_settings: () => this.showGlobalSettings(chatId),
            admin_add_user_prompt: () => this.requestNewUserChatId(chatId),
            admin_remove_user_prompt: () => this.showUserRemovalList(chatId),
            admin_manage_admins: () => this.showAdminManagement(chatId),
            admin_list_users: () => this.showAllUsers(chatId),
            admin_promote_user: () => this.requestUserToPromote(chatId),
            admin_demote_user: () => this.requestUserToDemote(chatId),
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
        if (action === 'set' && params[0] === 'primary' && params[1] === 'wallet') {
            await this.actionHandlers.onSetPrimaryWallet(chatId, params.slice(2).join('_'));
            return await this.displayPrimaryWalletSelection(chatId, 'Primary wallet updated!');
        }
        if (action === 'delete' && params[0] === 'wallet') {
            return await this.handleDeleteWalletConfirmation(chatId, param.substring('wallet_'.length));
        }
        if (action === 'confirm' && params[0] === 'delete' && params[1] === 'wallet') {
            await this.actionHandlers.onDeleteWallet(chatId, params.slice(2).join('_'));
            return await this.displayWalletList(chatId); // Refresh wallet list
        }
        
        // Admin promotion/demotion handlers
        if (action === 'admin' && params[0] === 'promote' && params[1] === 'execute') {
            const userIdToPromote = params.slice(2).join('_');
            await this.handlePromoteUser(chatId, userIdToPromote);
            return;
        }
        
        if (action === 'admin' && params[0] === 'demote' && params[1] === 'execute') {
            const userIdToDemote = params.slice(2).join('_');
            await this.handleDemoteUser(chatId, userIdToDemote);
            return;
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
        const solAmounts = await this.dataManager.loadSolAmounts();
        const userSol = solAmounts[String(chatId)] || solAmounts.default || config.DEFAULT_SOL_TRADE_AMOUNT;

        // Get user-specific primary wallet setting
        const primaryCopyWalletLabel = await this.dataManager.getPrimaryWalletLabel(chatId);

        // Get user-specific wallet count
        const allWallets = this.walletManager.getAllWallets();
        const userWalletCount = allWallets.tradingWallets.length;

        // Get user greeting - try to get from database first, fallback to 'Trader'
        let userName = 'Trader';
        try {
            const user = await this.dataManager.getUser(chatId);
            userName = user?.username || user?.first_name || 'Trader';
        } catch (error) {
            console.log('Could not get user from database, using fallback name');
        }
        const greeting = getUserGreeting({ first_name: userName });

        // The message is now fully personalized
        const userTraders = await this.dataManager.loadTraders(chatId);
        const activeTradersCount = Object.values(userTraders).filter(t => t.active).length;
        const totalTradersCount = Object.values(userTraders).length;
        const message = `${greeting}\n\n🚀 *ZapTrade Bot Menu*\n\n` +
             `📊 Your Active Copies: ${activeTradersCount} / ${totalTradersCount} trader(s) active\n`+ 
            `💰 Your Trade Size: ${escapeMarkdownV2(userSol.toString())} SOL\n` +
            `💼 Your Wallets: ${userWalletCount} ${primaryCopyWalletLabel ? `(Primary: ${escapeMarkdownV2(primaryCopyWalletLabel)})` : `(⚠️ Primary NOT Set)`}\n\n` +
            `Choose an action:`;
        console.log("Debug: Type of escapeMarkdownV2:", typeof escapeMarkdownV2);

        const keyboard = [
            [{ text: "▶️ Start Copy", callback_data: "start_copy" }, { text: "⛔ Stop Copy", callback_data: "stop_copy" }],
            [{ text: "➕ Add Trader", callback_data: "add_trader" }, { text: "❌ Remove Trader", callback_data: "remove_trader" }],
            [{ text: "💼 My Wallets", callback_data: "wallets_menu" }, { text: "💰 My Balances", callback_data: "balance" }],
            [{ text: "📋 List Traders", callback_data: "traders_list" }, { text: "💸 Withdraw", callback_data: "withdraw" }],
            [{ text: "💲 Set SOL Amt", callback_data: "set_sol" }, { text: "⚙️ Reset Bot", callback_data: "reset_all" }]
        ];
        // Admins get a special button
        const isAdmin = await this.dataManager.isUserAdmin(chatId.toString());
        if (isAdmin) {
            keyboard.push([{ text: "👑 Admin Panel", callback_data: "admin_panel" }]);
        }
        await this.sendOrEditMessage(chatId, message, { reply_markup: { inline_keyboard: keyboard } }, messageId);
    }


    async showAdminPanel(chatId) {
        // A safety check to ensure only admins can access this.
        const isAdmin = await this.dataManager.isUserAdmin(chatId.toString());
        if (!isAdmin) {
            await this.sendOrEditMessage(chatId, "❌ *Access Denied*\n\nYou don't have admin privileges to access this panel.");
            return;
        }

        const message = `👑 *Admin God-Mode Panel*\n\nWelcome, operator. Select a command.`;

        const keyboard = [
            [{ text: "👀 View User Activity", callback_data: "admin_view_activity" }],
            [{ text: "💹 View User P&L", callback_data: "admin_view_pnl" }],
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
        const isAdmin = await this.dataManager.isUserAdmin(chatId.toString());
        if (!isAdmin) return;

        let message = `*👀 Live User Activity*\n\n`;
        const allTraders = await this.dataManager.loadTraders();
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
            // Asynchronously fetch all wallet labels to make it efficient
            const allSettings = await this.dataManager.loadSettings();

            for (const trade of activeTrades) {
                const userChatIdStr = String(trade.chatId);
                const userSettings = allSettings.userSettings?.[userChatIdStr] || {};
               const walletLabel = userSettings.primaryCopyWalletLabel || `Fallback: 1st Wallet`;

                message += `*User:* \`${userChatIdStr}\`\n`
                    + `*Is Copying:* _${escapeMarkdownV2(trade.traderName)}_\n`
                    + `*Using Wallet:* _${escapeMarkdownV2(walletLabel)}_\n`
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
        const isAdmin = await this.dataManager.isUserAdmin(chatId.toString());
        if (!isAdmin) return;

        await this.sendOrEditMessage(chatId, "⏳ _Calculating all user positions and fetching live market prices\\.\\.\\._", {});

        let grandTotalSolSpent = 0;
        let grandTotalCurrentValue = 0;
        let finalMessage = `*💹 User Profit & Loss Report*\n\n`;

        // Get the SOL price first for all calculations
        const solPriceUsd = await this.notificationManager.getSolPriceInUSD();

        const allUserPositions = this.dataManager.userPositions; // This is the nested Map

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
            if (!this.notificationManager || !this.notificationManager.apiManager) {
                throw new Error('API Manager not available for price fetching');
            }
            const priceMap = await this.notificationManager.apiManager.getTokenPrices(Array.from(allMints));

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
                        + `   *Spent:* ${position.solSpent.toFixed(4)} SOL\n`
                        + `   *Value:* ${currentValueSol.toFixed(4)} SOL\n`
                        + `   *P/L:* ${pnlIcon} ${pnlSol.toFixed(4)} SOL\n`;
                }

                if (hasPositions) {
                    const userTotalPnl = userTotalCurrentValue - userTotalSolSpent;
                    const userPnlIcon = userTotalPnl >= 0 ? '🟢' : '🔴';
                    userReport += ` *User Total P/L:* ${userPnlIcon} ${userTotalPnl.toFixed(4)} SOL\n\n`;
                    finalMessage += userReport;

                    grandTotalSolSpent += userTotalSolSpent;
                    grandTotalCurrentValue += userTotalCurrentValue;
                }
            }
        }

        const grandTotalPnl = grandTotalCurrentValue - grandTotalSolSpent;
        const grandPnlIcon = grandTotalPnl >= 0 ? '🟢' : '🔴';

      finalMessage += `*===========================*\n`
             + `*Bot Grand Total P/L:* ${grandPnlIcon} *${grandTotalPnl.toFixed(4)} SOL*\n`
             + `_Value in USD: ~$${(grandTotalPnl * solPriceUsd).toFixed(2)}_`;
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
        const users = await this.dataManager.loadUsers();
        const userCount = Object.keys(users).length;
        const admins = await this.dataManager.getAllAdmins();
        const adminCount = admins.length;
        
        const message = `✅ *User Management*\n\n` +
            `👥 Total Users: *${userCount}*\n` +
            `👑 Total Admins: *${adminCount}*\n\n` +
            `Manage bot users and permissions:`;
            
        const keyboard = [
            [{ text: "➕ Add New User", callback_data: "admin_add_user_prompt" }],
            [{ text: "❌ Remove User", callback_data: "admin_remove_user_prompt" }],
            [{ text: "👑 Manage Admins", callback_data: "admin_manage_admins" }],
            [{ text: "📋 List All Users", callback_data: "admin_list_users" }],
            [{ text: "🔙 Back to Admin Panel", callback_data: "admin_panel" }]
        ];
        await this.sendOrEditMessage(chatId, message, { reply_markup: { inline_keyboard: keyboard } });
    }

    async showBotStatistics(chatId) {
        const users = await this.dataManager.loadUsers();
        const allTraders = await this.dataManager.loadTraders();
        
        let totalTraders = 0;
        let activeTraders = 0;
        
        for (const [userId, userTraders] of Object.entries(allTraders.user_traders || {})) {
            for (const [name, trader] of Object.entries(userTraders)) {
                totalTraders++;
                if (trader.active) activeTraders++;
            }
        }
        
        const message = `📊 *Bot Statistics*\n\n` +
            `👥 Total Users: *${Object.keys(users).length}*\n` +
            `📈 Total Traders: *${totalTraders}*\n` +
            `🟢 Active Traders: *${activeTraders}*\n` +
            `⚪ Inactive Traders: *${totalTraders - activeTraders}*\n\n` +
            `_Last updated: ${new Date().toLocaleString()}_`;
            
        const keyboard = [
            [{ text: "🔄 Refresh", callback_data: "admin_bot_stats" }],
            [{ text: "🔙 Back to Admin Panel", callback_data: "admin_panel" }]
        ];
        await this.sendOrEditMessage(chatId, message, { reply_markup: { inline_keyboard: keyboard } });
    }

    async showSystemHealth(chatId) {
        const uptime = process.uptime();
        const memUsage = process.memoryUsage();
        
        const message = `🏥 *System Health*\n\n` +
            `⏱️ Uptime: *${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m*\n` +
            `💾 Memory: *${Math.round(memUsage.heapUsed / 1024 / 1024)}MB / ${Math.round(memUsage.heapTotal / 1024 / 1024)}MB*\n` +
            `🔗 RPC Status: *Connected*\n` +
            `🤖 Bot Status: *Running*\n` +
            `📊 Database: *Connected*\n\n` +
            `_System is operating normally_`;
            
        const keyboard = [
            [{ text: "🔄 Refresh", callback_data: "admin_system_health" }],
            [{ text: "🔙 Back to Admin Panel", callback_data: "admin_panel" }]
        ];
        await this.sendOrEditMessage(chatId, message, { reply_markup: { inline_keyboard: keyboard } });
    }

    async showGlobalSettings(chatId) {
        const message = `⚙️ *Global Settings*\n\n` +
            `Configure bot-wide settings and parameters:\n\n` +
            `🔧 *Current Settings:*\n` +
            `• Min Trade Amount: *${config.MIN_SOL_AMOUNT_PER_TRADE} SOL*\n` +
            `• Default Trade Amount: *${config.DEFAULT_SOL_TRADE_AMOUNT} SOL*\n` +
            `• Transaction Timeout: *${config.TRANSACTION_TIMEOUT / 1000}s*\n\n` +
            `_Settings management coming soon_`;
            
        const keyboard = [
            [{ text: "🔙 Back to Admin Panel", callback_data: "admin_panel" }]
        ];
        await this.sendOrEditMessage(chatId, message, { reply_markup: { inline_keyboard: keyboard } });
    }

    async showAdminManagement(chatId) {
        const admins = await this.dataManager.getAllAdmins();
        
        let message = `👑 *Admin Management*\n\n`;
        
        if (admins.length === 0) {
            message += `_No admins found\\._`;
        } else {
            message += `Current admins:\n\n`;
            for (const admin of admins) {
                message += `👑 *${escapeMarkdownV2(admin.username || admin.chat_id)}*\n`;
                message += `   ID: \`${escapeMarkdownV2(admin.chat_id)}\`\n\n`;
            }
        }
        
        const keyboard = [
            [{ text: "➕ Promote User to Admin", callback_data: "admin_promote_user" }],
            [{ text: "➖ Demote Admin", callback_data: "admin_demote_user" }],
            [{ text: "🔙 Back to User Management", callback_data: "admin_manage_users" }]
        ];
        await this.sendOrEditMessage(chatId, message, { reply_markup: { inline_keyboard: keyboard } });
    }

    async showAllUsers(chatId) {
        const users = await this.dataManager.loadUsers();
        const admins = await this.dataManager.getAllAdmins();
        const adminIds = new Set(admins.map(a => a.chat_id));
        
        let message = `📋 *All Users*\n\n`;
        
        if (Object.keys(users).length === 0) {
            message += `_No users found\\._`;
        } else {
            for (const [userId, username] of Object.entries(users)) {
                const isAdmin = adminIds.has(userId);
                const icon = isAdmin ? '👑' : '👤';
                const role = isAdmin ? ' \\(Admin\\)' : '';
                message += `${icon} *${escapeMarkdownV2(username)}*${role}\n`;
                message += `   ID: \`${escapeMarkdownV2(userId)}\`\n\n`;
            }
        }
        
        const keyboard = [
            [{ text: "🔄 Refresh", callback_data: "admin_list_users" }],
            [{ text: "🔙 Back to User Management", callback_data: "admin_manage_users" }]
        ];
        await this.sendOrEditMessage(chatId, message, { reply_markup: { inline_keyboard: keyboard } });
    }

    async requestUserToPromote(chatId) {
        const users = await this.dataManager.loadUsers();
        const admins = await this.dataManager.getAllAdmins();
        const adminIds = new Set(admins.map(a => a.chat_id));
        
        // Filter out users who are already admins
        const nonAdminUsers = Object.entries(users).filter(([userId]) => !adminIds.has(userId));
        
        let message = `👑 *Promote User to Admin*\n\nSelect a user to promote to admin:`;
        
        const buttons = [];
        if (nonAdminUsers.length === 0) {
            message += `\n\n_All users are already admins\\._`;
        } else {
            nonAdminUsers.forEach(([userId, username]) => {
                buttons.push([{ text: `👤 ${username}`, callback_data: `admin_promote_execute_${userId}` }]);
            });
        }
        
        buttons.push([{ text: "🔙 Back to Admin Management", callback_data: "admin_manage_admins" }]);
        await this.sendOrEditMessage(chatId, message, { reply_markup: { inline_keyboard: buttons } });
    }

    async requestUserToDemote(chatId) {
        const admins = await this.dataManager.getAllAdmins();
        
        // Filter out the main admin (ADMIN_CHAT_ID) to prevent demoting them
        const demotableAdmins = admins.filter(admin => String(admin.chat_id) !== String(config.ADMIN_CHAT_ID));
        
        let message = `➖ *Demote Admin*\n\nSelect an admin to demote:`;
        
        const buttons = [];
        if (demotableAdmins.length === 0) {
            message += `\n\n_No admins can be demoted\\._`;
        } else {
            demotableAdmins.forEach(admin => {
                buttons.push([{ text: `👑 ${admin.username || admin.chat_id}`, callback_data: `admin_demote_execute_${admin.chat_id}` }]);
            });
        }
        
        buttons.push([{ text: "🔙 Back to Admin Management", callback_data: "admin_manage_admins" }]);
        await this.sendOrEditMessage(chatId, message, { reply_markup: { inline_keyboard: buttons } });
    }

    async showUserSelectionForActivity(chatId) {
        const users = await this.dataManager.loadUsers();
        const userList = Object.entries(users);

        let message = "*📊 View User Activity*\n\nSelect a user to inspect their setup.";
        const buttons = [];

        if (userList.length === 0) {
            message += "\n\n_No users have been whitelisted yet._";
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
    const userTraders = await this.dataManager.loadTraders(chatId);
    const traderEntries = Object.entries(userTraders);

    let message = "📋 Your Configured Traders";

    if (traderEntries.length === 0) {
        message += "\n\n🤷 You haven't added any traders yet.";
    } else {
        const userSolAmounts = await this.dataManager.loadSolAmounts();
        const solAmt = userSolAmounts[String(chatId)] || config.DEFAULT_SOL_TRADE_AMOUNT;
        const solAmtStr = `${parseFloat(solAmt).toFixed(4)} SOL`;

        const traderBlocks = traderEntries
            .sort((a, b) => a[0].localeCompare(b[0]))
            .map(([name, trader]) => {
                const statusIcon = trader.active ? "🟢" : "⚪️";
                const statusText = trader.active ? "Active" : "Inactive";

                const mainLine = `${statusIcon} ${name} - ${statusText}`;
                const amountLine = `• Amount: ${solAmtStr}`;

                return `${mainLine}\n${amountLine}`;
            });

        message += "\n\n" + traderBlocks.join("\n\n");
    }

    await this.sendOrEditMessage(chatId, message, {
        reply_markup: {
            inline_keyboard: [[{ text: "🔙 Back to Main Menu", callback_data: "main_menu" }]],
        },
        disable_web_page_preview: true,
    });
}



async showTradersMenu(chatId, action) {
    const userTraders = await this.dataManager.loadTraders(chatId);
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
    
    // Create user-friendly message
    let message = `${title}\n\n${header}`;

    // Add status icons to buttons for professional look
    const buttons = filteredTraders.map(([name, trader]) => {
        const icon = trader.active ? '🟢' : '⚪️';
        return [{ text: `${icon} ${name}`, callback_data: `${cbPrefix}${name}` }];
    });

    if (filteredTraders.length === 0) {
        message += `\n\n${emptyMsg}`;
    }

    buttons.push([{ text: "🔙 Back to Main Menu", callback_data: "main_menu" }]);

    await this.sendOrEditMessage(chatId, message, {
        reply_markup: { inline_keyboard: buttons }
        // We don't need to specify parse_mode here because sendOrEditMessage does it for us.
    });
}
 
    async displayWalletManagerMenu(chatId) {
        const message = `💼 *Wallet Manager*\n\nManage wallets used for copy trading.`;
        const keyboard = [
            [{ text: "👁️ List/Delete Wallets", callback_data: "wm_view" }, { text: "💰 Check Balances", callback_data: "balance" }],
            [{ text: "➕ Add New Wallet", callback_data: "wm_add" }],
            [{ text: "⭐ Select Primary Copy Wallet", callback_data: "select_primary_wallet_menu" }],
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
            await this.walletManager.updateAllBalances(true); // Trigger refresh for ALL wallets (correct now)
            
            // Get *this user's* wallets for display on *their* balance screen.
            const { tradingWallets } = this.walletManager.getAllWallets(chatId); 
            
            const botBalance = await this.solanaManager.getSOLBalance(config.USER_WALLET_PUBKEY); 

            // Escape "n" properly if you have it in string literals.
            let message = `*💰 Wallet Balances*\n\n`;
            let totalSol = 0;

            const botBalStr = botBalance !== null ? `*${escapeMarkdownV2(botBalance.toFixed(4))} SOL*` : '_N/A_';
            message += `🤖 *Bot Wallet*: ${botBalStr}\n\n*Your Trading Wallets:*\n`;

            if (tradingWallets.length === 0) {
                message += "_No trading wallets configured\\._";
            } else {
                tradingWallets.forEach(w => {
                    const balStr = escapeMarkdownV2((w.balance || 0).toFixed(4));
                    // Fix newlines and address escaping
                    message += `\n📈 *${escapeMarkdownV2(w.label)}*\n` + 
                               `   Addr: \`${escapeMarkdownV2(w.publicKey)}\`\n` +
                               `   Balance: *${balStr} SOL*\n`;
                    totalSol += (w.balance || 0);
                });
                message += `\n💎 *Total Trading Balance:* ${escapeMarkdownV2(totalSol.toFixed(4))} SOL`; // Final sum message
            }

            const keyboard = [[{ text: "🔄 Refresh", callback_data: "balance" }, { text: "🔙 Main Menu", callback_data: "main_menu" }]];
            await this.sendOrEditMessage(chatId, message, { reply_markup: { inline_keyboard: keyboard }, disable_web_page_preview: true });
        } catch (error) {
            console.error("[Balance Display] Error fetching balances:", error);
            await this.sendErrorMessage(chatId, "Failed to fetch balances. Please check logs and try again.");
        }
    }

    async handleWithdraw(chatId) {
        this.activeFlows.set(chatId, { type: 'withdraw_address' });
        const message = `💸 *Withdraw SOL from Bot Wallet*\n\n` +
            `Please enter the destination Solana address\\.`;
        await this.sendOrEditMessage(chatId, message, {
            reply_markup: { inline_keyboard: [[{ text: "❌ Cancel", callback_data: "main_menu" }]] }
        });
    }

   async displayWalletList(chatId) {
        await this.walletManager.updateAllBalances(true); // Ensures all wallets are fresh in memory

        // Correctly get *this user's* wallets, already filtered for this chatId.
        const { tradingWallets } = this.walletManager.getAllWallets(chatId); 

        let message = `*💼 Your Trading Wallets*\n\n`; // Add extra newline for spacing
        let buttons = [];

        if (tradingWallets.length === 0) { // Check the length of YOUR user's wallets
            message += "_You have no trading wallets\\. Use the 'Add' button to create one\\._";
        } else {
            tradingWallets.sort((a, b) => a.label.localeCompare(b.label)).forEach(w => {
                const balStr = escapeMarkdownV2((w.balance || 0).toFixed(4));
                message += `📈 *${escapeMarkdownV2(w.label)}*\n` + // Newline after label
                           `   Addr: \`${escapeMarkdownV2(w.publicKey)}\`\n` + // Properly escaped address, and consistent newline
                           `   Balance: *${balStr} SOL*\n\n`; // Extra newline for spacing between wallets
                buttons.push([{ text: `🗑️ Delete ${w.label}`, callback_data: `delete_wallet_${w.label}` }]);
            });
        }
        buttons.push([{ text: "🔙 Back", callback_data: "wallets_menu" }]);
        await this.sendOrEditMessage(chatId, message, { reply_markup: { inline_keyboard: buttons }, disable_web_page_preview: true });
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

    async displayPrimaryWalletSelection(chatId, infoMsg = '') {
        // Get this user's specific setting
        const settings = await this.dataManager.loadSettings();
        const userSettings = settings.userSettings?.[String(chatId)] || {};
        const primaryCopyWalletLabel = userSettings.primaryCopyWalletLabel;

        // Get this user's specific wallets
        const { tradingWallets } = this.walletManager.getAllWallets(chatId);
        const userWallets = tradingWallets.filter(w => String(w.ownerChatId) === String(chatId));

        let message = infoMsg ? `_${escapeMarkdownV2(infoMsg)}_\n\n` : '';
        message += `*⭐ Select Your Primary Copy Wallet*\n\nThis wallet will be used for all your copy trades\\.\n\n`;
        message += `Current: *${primaryCopyWalletLabel ? escapeMarkdownV2(primaryCopyWalletLabel) : "None Set"}*\n\n`;

        let buttons;
        if (userWallets.length === 0) {
            message += "_You have no wallets to select from\\. Please add one first\\._";
            buttons = [];
        } else {
            buttons = userWallets.map(wallet => {
                const isCurrent = wallet.label === primaryCopyWalletLabel;
                return [{ text: `${isCurrent ? '✅' : '🔘'} ${wallet.label}`, callback_data: `set_primary_wallet_${wallet.label}` }];
            });
        }

        buttons.push([{ text: "🔙 Back", callback_data: "wallets_menu" }]);

        await this.sendOrEditMessage(chatId, message, { reply_markup: { inline_keyboard: buttons } });
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
        const amounts = await this.dataManager.loadSolAmounts();
        const currentAmount = amounts[String(chatId)] || amounts.default;
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
                if (!traderName) throw new Error("Trader name cannot be empty.");
                const traders = await this.dataManager.loadTraders();
                if (traders[traderName]) {
                    throw new Error(`Trader name "${traderName}" already exists.`);
                }
                this.activeFlows.set(chatId, { type: 'add_trader_wallet', name: traderName });
                await this.sendOrEditMessage(chatId, `✅ Name set to *${escapeMarkdownV2(traderName)}*\\.\n\nNow, enter the Solana WALLET ADDRESS for this trader\\.`, {});
                break;

            case 'add_trader_wallet':
                const walletAddress = text.trim();
                try {
                    new PublicKey(walletAddress); // Validate address
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
                if (isNaN(amount) || amount < MIN_SOL_AMOUNT_PER_TRADE) throw new Error(`Invalid amount. Must be >= ${MIN_SOL_AMOUNT_PER_TRADE}`);

                // --- UPGRADED SAVE LOGIC ---
                const amounts = await this.dataManager.loadSolAmounts();
                amounts[String(chatId)] = amount; // Save the amount against the user's specific chat ID
                await this.dataManager.saveSolAmounts(amounts);
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
                    await this.bot.sendMessage(chatId, "Reset cancelled. Phrase did not match.");
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
                    await this.sendOrEditMessage(chatId, `🔑 Now paste the Base58 *PRIVATE KEY* for wallet "${escapeMarkdownV2(label)}":`);
                } else if (flow.action === 'generate') {
                    await this.actionHandlers.onGenerateWallet(chatId, label);
                    this.activeFlows.delete(chatId);
                    // --- NEW: Delete the user's typed message ---
                    try {
                        await this.bot.deleteMessage(chatId, msg.message_id);
                    } catch (e) {
                        console.warn(`[TelegramUI] Could not delete user message: ${e.message}`);
                    }
                }
                break;

            case 'add_wallet_privatekey':
                await this.actionHandlers.onImportWallet(chatId, flow.label, text.trim());
                this.activeFlows.delete(chatId);
                // --- NEW: Delete the user's typed message ---
                try {
                    await this.bot.deleteMessage(chatId, msg.message_id);
                } catch (e) {
                    console.warn(`[TelegramUI] Could not delete user message: ${e.message}`);
                }
                break;

            case 'withdraw_address':
                await this.bot.sendMessage(chatId, `Withdrawal to address ${text.trim()} is not implemented yet.`);
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
                await this.sendOrEditMessage(chatId, `➡️ *Step 2/2: Set Username*\n\n` +
                    `Chat ID set to \`${escapeMarkdownV2(userId)}\`. Now, enter a unique username for this person (e.g., 'Rahul').`);
                break;

            case 'admin_add_user_username':
                const username = text.trim();
                if (!username) throw new Error("Username cannot be empty.");

                const users = await this.dataManager.loadUsers();
                users[flow.userId] = username; // Use the userId we saved in the flow
                await this.dataManager.saveUsers(users);

                this.activeFlows.delete(chatId); // End the flow
                // --- NEW: Delete the user's typed message ---
                try {
                    await this.bot.deleteMessage(chatId, msg.message_id);
                } catch (e) {
                    console.warn(`[TelegramUI] Could not delete user message: ${e.message}`);
                }

                await this.sendOrEditMessage(chatId, `✅ *User Whitelisted!*\n` +
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
        const users = await this.dataManager.loadUsers();
        const userList = Object.entries(users);

        let message = "🗑️ *Select a User to Remove*\n\nTap a user's name to remove them from the whitelist.";
        const buttons = [];

        if (userList.length === 0) {
            message += "\n\n_No users have been whitelisted yet._";
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
        const users = await this.dataManager.loadUsers();
        const username = users[userIdToRemove];

        if (username) {
            delete users[userIdToRemove];
            await this.dataManager.saveUsers(users);
            await this.sendOrEditMessage(chatId, `✅ User *${escapeMarkdownV2(username)}* has been removed.`);
        } else {
            await this.sendOrEditMessage(chatId, `⚠️ User with ID \`${escapeMarkdownV2(userIdToRemove)}\` not found.`);
        }

        // Show the updated list
        await this.showUserRemovalList(chatId);
    }

    async handlePromoteUser(chatId, userIdToPromote) {
        try {
            const users = await this.dataManager.loadUsers();
            const username = users[userIdToPromote];
            
            if (!username) {
                await this.sendOrEditMessage(chatId, `⚠️ User with ID \`${escapeMarkdownV2(userIdToPromote)}\` not found.`);
                return;
            }

            // Promote the user to admin
            await this.dataManager.setUserAdmin(userIdToPromote, true);
            
            await this.sendOrEditMessage(chatId, `✅ User *${escapeMarkdownV2(username)}* has been promoted to admin!`);
            
            // Show the updated admin management menu
            await this.showAdminManagement(chatId);
        } catch (error) {
            console.error('Error promoting user:', error);
            await this.sendErrorMessage(chatId, `Failed to promote user: ${error.message}`);
        }
    }

    async handleDemoteUser(chatId, userIdToDemote) {
        try {
            const users = await this.dataManager.loadUsers();
            const username = users[userIdToDemote];
            
            if (!username) {
                await this.sendOrEditMessage(chatId, `⚠️ User with ID \`${escapeMarkdownV2(userIdToDemote)}\` not found.`);
                return;
            }

            // Prevent demoting the main admin
            if (String(userIdToDemote) === String(config.ADMIN_CHAT_ID)) {
                await this.sendOrEditMessage(chatId, `⚠️ Cannot demote the main admin.`);
                return;
            }

            // Demote the user from admin
            await this.dataManager.setUserAdmin(userIdToDemote, false);
            
            await this.sendOrEditMessage(chatId, `✅ User *${escapeMarkdownV2(username)}* has been demoted from admin.`);
            
            // Show the updated admin management menu
            await this.showAdminManagement(chatId);
        } catch (error) {
            console.error('Error demoting user:', error);
            await this.sendErrorMessage(chatId, `Failed to demote user: ${error.message}`);
        }
    }


    async sendOrEditMessage(chatId, text, options = {}, messageId = null) {
        messageId = messageId || this.latestMessageIds.get(chatId);
        const finalOptions = { parse_mode: 'MarkdownV2', disable_web_page_preview: true, ...options };

        try {
            if (messageId) {
                const editedMessage = await this.bot.editMessageText(text, { ...finalOptions, chat_id: chatId, message_id: messageId });
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
                const newMessage = await this.bot.sendMessage(chatId, text, finalOptions);
                this.latestMessageIds.set(chatId, newMessage.message_id);
                return newMessage;
            } catch (sendError) {
                console.error(`CRITICAL: Failed to SEND message after edit failed:`, sendError.message);
                
                // Try to send without MarkdownV2 if parsing failed
                if (sendError.message?.includes("can't parse entities")) {
                    try {
                        console.log('Attempting to send message without MarkdownV2 formatting...');
                        const plainOptions = { ...options, disable_web_page_preview: true };
                        const plainMessage = await this.bot.sendMessage(chatId, text, plainOptions);
                        this.latestMessageIds.set(chatId, plainMessage.message_id);
                        return plainMessage;
                    } catch (plainError) {
                        console.error(`CRITICAL: Failed to send plain message:`, plainError.message);
                        
                        // Final fallback: try to send user-friendly message
                        try {
                            console.log('Attempting to send user-friendly message...');
                            const userFriendlyText = createUserFriendlyMessage(text);
                            
                            if (userFriendlyText.length > 0) {
                                const userFriendlyMessage = await this.bot.sendMessage(chatId, userFriendlyText, { disable_web_page_preview: true });
                                this.latestMessageIds.set(chatId, userFriendlyMessage.message_id);
                                return userFriendlyMessage;
                            } else {
                                console.error('Message was completely sanitized away');
                                // Send a generic message
                                const genericMessage = await this.bot.sendMessage(chatId, "✅ Operation completed successfully!", { disable_web_page_preview: true });
                                this.latestMessageIds.set(chatId, genericMessage.message_id);
                                return genericMessage;
                            }
                        } catch (userFriendlyError) {
                            console.error(`CRITICAL: Failed to send user-friendly message:`, userFriendlyError.message);
                            // Last resort: send a simple message
                            try {
                                const simpleMessage = await this.bot.sendMessage(chatId, "✅ Success!", { disable_web_page_preview: true });
                                this.latestMessageIds.set(chatId, simpleMessage.message_id);
                                return simpleMessage;
                            } catch (finalError) {
                                console.error(`CRITICAL: Failed to send even simple message:`, finalError.message);
                                // Ultimate fallback - try with just emoji
                                try {
                                    const emojiMessage = await this.bot.sendMessage(chatId, "✅", { disable_web_page_preview: true });
                                    this.latestMessageIds.set(chatId, emojiMessage.message_id);
                                    return emojiMessage;
                                } catch (ultimateError) {
                                    console.error(`CRITICAL: Failed to send even emoji message:`, ultimateError.message);
                                }
                            }
                        }
                    }
                }
                
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
            // Fallback to user-friendly error message
            try {
                const userFriendlyError = createUserFriendlyMessage(`❌ Error\n\n${text}`);
                await this.bot.sendMessage(chatId, userFriendlyError || "❌ An error occurred", { disable_web_page_preview: true });
            } catch (fallbackError) {
                console.error(`Failed to send fallback error message:`, fallbackError);
            }
        }
    }

    stop() {
        if (this.bot && this.bot.isPolling()) this.bot.stopPolling({ cancel: true });
        console.log("TelegramUI stopped.");
    }

}

module.exports = TelegramUI;