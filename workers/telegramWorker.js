// ==========================================
// ========== Telegram Worker Thread ==========
// ==========================================
// File: workers/telegramWorker.js
// Description: Handles Telegram UI operations in a separate thread

const { workerData } = require('worker_threads');
const BaseWorker = require('./templates/baseWorker');
const TelegramUI = require('../telegramUi');
// Dynamic require to avoid module caching issues
const { SolanaManager } = require('../solanaManager');
const WalletManager = require('../walletManager');
const { escapeMarkdownV2 } = require('../utils');

class TelegramWorker extends BaseWorker {
    constructor() {
        super();
        this.telegramUi = null;
        this.dataManager = null;
        this.solanaManager = null;
        this.walletManager = null;
        this.redisManager = null;
        this.actionHandlers = new Map();
    }

    async customInitialize() {
        try {
            // Check if another instance is already running
            if (global.telegramWorkerInstance) {
                this.logWarn('⚠️ Another Telegram worker instance detected! This may cause conflicts.');
                this.logWarn('⚠️ Previous instance:', global.telegramWorkerInstance);
            }
            
            // Mark this as the active instance
            global.telegramWorkerInstance = {
                workerId: this.workerId,
                timestamp: Date.now(),
                pid: process.pid
            };
            
            this.logInfo('✅ This worker marked as active Telegram instance');
            
            // Initialize core managers - dynamic require to avoid caching
            const { DataManager } = require('../dataManager');
            this.dataManager = new DataManager();
            await this.dataManager.initialize();
            
            this.solanaManager = new SolanaManager();
            await this.solanaManager.initialize();
            
            // Initialize RedisManager for active trader sync
            const { RedisManager } = require('../redis/redisManager');
            this.redisManager = new RedisManager();
            await this.redisManager.initialize();
            
            this.walletManager = new WalletManager(this.dataManager);
            this.walletManager.setSolanaManager(this.solanaManager);
            this.walletManager.setConnection(this.solanaManager.connection);
            await this.walletManager.initialize();

            // Initialize Telegram UI
            this.telegramUi = new TelegramUI(
                this.dataManager,
                this.solanaManager,
                this.walletManager
            );

            const initResult = this.telegramUi.initialize();
            if (initResult && initResult.mode === 'headless') {
                this.logWarn('Running in headless mode (no bot token)');
            } else if (!this.telegramUi.bot) {
                throw new Error("TelegramUI failed to initialize TelegramBot instance");
            } else {
                this.setupActionHandlers();
                
                // Register message handlers with the base class
                this.registerHandler('SEND_MESSAGE', this.handleSendMessage.bind(this));
                this.registerHandler('send_message', this.handleSendMessage.bind(this));
                this.registerHandler('PIN_MESSAGE', this.handlePinMessage.bind(this));
                
                // Start polling for local development
                const botReady = this.telegramUi.startPolling();
                if (botReady) {
                    this.logInfo('Telegram UI initialized successfully in polling mode');
                    
                    // Sync existing active traders to Redis on startup
                    await this.syncAllActiveTradersOnStartup();
                } else {
                    this.logWarn('Telegram UI initialization failed');
                }
            }

        } catch (error) {
            this.logError('Failed to initialize Telegram worker', { error: error.message });
            throw error;
        }
    }

    setupActionHandlers() {
        this.actionHandlers.set('START_COPY', this.handleStartCopy.bind(this));
        this.actionHandlers.set('STOP_COPY', this.handleStopCopy.bind(this));
        this.actionHandlers.set('ADD_TRADER', this.handleAddTrader.bind(this));
        this.actionHandlers.set('REMOVE_TRADER', this.handleRemoveTrader.bind(this));
        this.actionHandlers.set('SET_SOL_AMOUNT', this.handleSetSolAmount.bind(this));
        this.actionHandlers.set('GENERATE_WALLET', this.handleGenerateWallet.bind(this));
        this.actionHandlers.set('IMPORT_WALLET', this.handleImportWallet.bind(this));

        this.actionHandlers.set('DELETE_WALLET', this.handleDeleteWallet.bind(this));
        this.actionHandlers.set('WITHDRAW', this.handleWithdraw.bind(this));
        this.actionHandlers.set('CONFIRM_WITHDRAW', this.handleConfirmWithdraw.bind(this));
        this.actionHandlers.set('RESET_DATA', this.handleResetData.bind(this));
        this.actionHandlers.set('MANUAL_COPY', this.handleManualCopy.bind(this));

        // Bind action handlers to TelegramUI
        this.telegramUi.bindActionHandlers({
            onStartCopy: this.handleStartCopy.bind(this),
            onStopCopy: this.handleStopCopy.bind(this),
            onRemoveTrader: this.handleRemoveTrader.bind(this),
            onAddTrader: this.handleAddTrader.bind(this),
            onSetSolAmount: this.handleSetSolAmount.bind(this),
            onGenerateWallet: this.handleGenerateWallet.bind(this),
            onImportWallet: this.handleImportWallet.bind(this),
            onResetData: this.handleResetData.bind(this),

            onDeleteWallet: this.handleDeleteWallet.bind(this),
            onWithdraw: this.handleWithdraw.bind(this),
            onConfirmWithdraw: this.handleConfirmWithdraw.bind(this),
            onManualCopy: this.handleManualCopy.bind(this),
        });
    }

    async handleSendMessage(message) {
        const { chatId, text, options } = message.payload;
        try {
            // Use the internal TelegramUI instance to send the message
            await this.telegramUi.sendOrEditMessage(chatId, text, options);
            this.logInfo('Sent message via worker', { chatId });
        } catch (error) {
            this.logError('Failed to send message via worker', { chatId, error: error.message });
        }
    }

    async handlePinMessage(message) {
        const { chatId, messageId, disable_notification } = message.payload;
        try {
            if (this.telegramUi && this.telegramUi.bot) {
                await this.telegramUi.bot.pinChatMessage(chatId, messageId, { disable_notification });
                this.logInfo('Message pinned via worker', { chatId, messageId });
            }
        } catch (error) {
            this.logError('Failed to pin message via worker', { chatId, error: error.message });
        }
    }


    async sendMessage(chatId, text, options = {}) {
        try {
            if (this.telegramUi && this.telegramUi.bot) {
                await this.telegramUi.sendOrEditMessage(chatId, text, options);
            } else {
                this.logWarn('Telegram bot not available for sending message');
            }
        } catch (error) {
            this.logError('Failed to send Telegram message', { error: error.message });
        }
    }

    async showMenu(chatId, menuType) {
        try {
            if (this.telegramUi) {
                switch (menuType) {
                    case 'main':
                        await this.telegramUi.showMainMenu(chatId);
                        break;
                    case 'traders':
                        await this.telegramUi.showTradersMenu(chatId);
                        break;
                    case 'wallets':
                        await this.telegramUi.displayWalletList(chatId);
                        break;
                    default:
                        this.logWarn('Unknown menu type', { menuType });
                }
            }
        } catch (error) {
            this.logError('Failed to show menu', { error: error.message, menuType });
        }
    }

    // Helper function to get user info from Telegram
    async getUserInfoFromTelegram(chatId) {
        try {
            const chatMember = await this.telegramUi.bot.getChatMember(chatId, chatId);
            const user = chatMember.user;
            
            // Build username from available information
            let username = user.username ? `@${user.username}` : '';
            if (user.first_name) {
                username = user.first_name + (user.last_name ? ` ${user.last_name}` : '');
            }
            if (!username) {
                username = `User_${chatId}`;
            }
            
            return {
                username: username,
                firstName: user.first_name || '',
                lastName: user.last_name || '',
                telegramUsername: user.username || ''
            };
        } catch (error) {
            this.logError('Failed to get user info from Telegram', { chatId, error: error.message });
            return {
                username: `User_${chatId}`,
                firstName: '',
                lastName: '',
                telegramUsername: ''
            };
        }
    }

    // Action handlers (simplified versions)
    async handleStartCopy(chatId, traderName) {
        this.logInfo('Starting copy for trader', { chatId, traderName });
        try {
            // Get or create user first
            let user = await this.dataManager.getUser(chatId);
            if (!user) {
                // Get user info from Telegram and create user with real username
                const userInfo = await this.getUserInfoFromTelegram(chatId);
                const userId = await this.dataManager.createUser(chatId, {
                    username: userInfo.username,
                    firstName: userInfo.firstName,
                    lastName: userInfo.lastName,
                    telegramUsername: userInfo.telegramUsername,
                    active: true
                });
                user = await this.dataManager.getUser(chatId);
                this.logInfo('Created new user with Telegram info', { chatId, userId, username: userInfo.username });
            }

            // Check if user has trading wallets
            const wallets = await this.dataManager.getUserWallets(String(chatId));
            console.log(`[DEBUG] Wallet check for user ${chatId}: found ${wallets.length} wallets`);
            if (wallets.length === 0) {
                const message = `❌ *Cannot start copying*\n\nYou need to add a trading wallet first.\n\nPlease go to "Manage Wallets" to import or generate a wallet.`;
                await this.telegramUi.sendOrEditMessage(chatId, message, {
                    reply_markup: { 
                        inline_keyboard: [
                            [{ text: "🔧 Manage Wallets", callback_data: "wallet_list" }],
                            [{ text: "🔙 Back to Main Menu", callback_data: "main_menu" }]
                        ] 
                    },
                    parse_mode: 'Markdown'
                });
                return;
            }

            // Update trader status to active
            await this.dataManager.updateTraderStatus(chatId, traderName, true);
            
            // Sync active traders to Redis for LaserStream monitoring
            await this.syncActiveTradersToRedis(chatId);
            
            // Show success message and redirect to main menu to refresh the UI
            await this.telegramUi.showMainMenu(chatId, null, `✅ Started copying trader *${traderName}*! Your wallet is ready for trading.`);
            
            // Signal that trader was started
            this.signalMessage('TRADER_STARTED', { chatId, traderName });
            
            // Signal monitor to refresh subscriptions with new trader
            this.signalMessage('TRADER_ADDED', { chatId, traderName });
        } catch (error) {
            this.logError('Failed to start copy', { chatId, traderName, error: error.message });
            await this.telegramUi.sendErrorMessage(chatId, `Failed to start copying: ${error.message}`);
        }
    }

    async handleStopCopy(chatId, traderName) {
        this.logInfo('Stopping copy for trader', { chatId, traderName });
        try {
            // Get or create user first
            let user = await this.dataManager.getUser(chatId);
            if (!user) {
                // Get user info from Telegram and create user with real username
                const userInfo = await this.getUserInfoFromTelegram(chatId);
                const userId = await this.dataManager.createUser(chatId, {
                    firstName: userInfo.firstName,
                    lastName: userInfo.lastName,
                    telegramUsername: userInfo.telegramUsername,
                    isActive: true,
                    isAdmin: false
                });
                user = await this.dataManager.getUser(chatId);
                this.logInfo('Created new user with Telegram info', { chatId, userId, username: userInfo.username });
            }

            // Update trader status to inactive
            await this.dataManager.updateTraderStatus(chatId, traderName, false);
            
            // Sync active traders to Redis for LaserStream monitoring
            await this.syncActiveTradersToRedis(chatId);
            
            // Show success message and redirect to main menu to refresh the UI
            await this.telegramUi.showMainMenu(chatId, null, `⛔ Stopped copying trader *${traderName}*`);
            
            // Signal that trader was stopped
            this.signalMessage('TRADER_STOPPED', { chatId, traderName });
            
            // Signal monitor to refresh subscriptions (remove trader from monitoring)
            this.signalMessage('TRADER_REMOVED', { chatId, traderName });
        } catch (error) {
            this.logError('Failed to stop copy', { chatId, traderName, error: error.message });
            await this.telegramUi.sendErrorMessage(chatId, `Failed to stop copying: ${error.message}`);
        }
    }

    async handleAddTrader(chatId, traderName, walletAddress) {
        this.logInfo('Adding trader', { chatId, traderName, walletAddress });
        try {
            // Get user to get internal user ID
            const user = await this.dataManager.getUser(chatId);
            if (!user) {
                throw new Error('User not found');
            }
            
            // Add trader to database
            await this.dataManager.addTrader(user.id, traderName, walletAddress);
            
            this.logInfo('Trader added successfully to database', { chatId, traderName, userId: user.id });
            
            // 🔧 FIX: Sync active traders to Redis after adding new trader
            await this.syncActiveTradersToRedis(chatId);
            
            // Notify monitor worker to refresh LaserStream subscriptions
            this.sendMessage('TRADER_ADDED', { chatId, traderName, walletAddress }, 'monitor');
            
            // Also signal main thread
            this.signalMessage('TRADER_ADDED', { chatId, traderName });
        } catch (error) {
            this.logError('Failed to add trader to database', { chatId, traderName, error: error.message });
            throw error; // Re-throw to let the UI handle the error
        }
    }

    async handleRemoveTrader(chatId, traderName) {
        this.logInfo('Removing trader', { chatId, traderName });
        try {
            // Get user to get internal user ID
            const user = await this.dataManager.getUser(chatId);
            if (!user) {
                throw new Error('User not found');
            }
            
            // Remove trader from database
            await this.dataManager.deleteTrader(user.id, traderName);
            
            const message = `✅ Trader *${escapeMarkdownV2(traderName)}* has been removed successfully`; 
            await this.telegramUi.sendOrEditMessage(chatId, message, {
                reply_markup: { inline_keyboard: [[{ text: "🔙 Back to Traders List", callback_data: "traders_list" }]] }
            });
            
            this.signalMessage('TRADER_REMOVED', { chatId, traderName });
        } catch (error) {
            this.logError('Failed to remove trader', { chatId, traderName, error: error.message });
            await this.telegramUi.sendErrorMessage(chatId, `Failed to remove trader: ${error.message}`);
        }
    }

    async handleSetSolAmount(chatId, amount) {
        this.logInfo('Setting SOL amount', { chatId, amount });
        try {
            // Get or create user first
            let user = await this.dataManager.getUser(chatId);
            if (!user) {
                // Get user info from Telegram and create user with real username
                const userInfo = await this.getUserInfoFromTelegram(chatId);
                const userId = await this.dataManager.createUser(chatId, {
                    firstName: userInfo.firstName,
                    lastName: userInfo.lastName,
                    telegramUsername: userInfo.telegramUsername,
                    isActive: true,
                    isAdmin: false
                });
                user = await this.dataManager.getUser(chatId);
                this.logInfo('Created new user with Telegram info', { chatId, userId, username: userInfo.username });
            }

            const userSettings = JSON.parse(user.settings || '{}');
            userSettings.solAmount = amount;
            await this.dataManager.updateUserSettings(chatId, userSettings);
            this.logInfo('SOL amount updated successfully', { chatId, amount });
            
            // Show success message and refresh main menu
            const message = `✅ SOL amount set to *${amount}* SOL`;
            await this.telegramUi.sendOrEditMessage(chatId, message, {
                reply_markup: { inline_keyboard: [[{ text: "🔙 Back to Main Menu", callback_data: "main_menu" }]] }
            });
            
            this.signalMessage('SOL_AMOUNT_SET', { chatId, amount });
        } catch (error) {
            this.logError('Failed to set SOL amount', { chatId, amount, error: error.message });
            await this.telegramUi.sendErrorMessage(chatId, `Failed to set SOL amount: ${error.message}`);
        }
    }

    async handleGenerateWallet(chatId, label) {
        this.logInfo('Generating wallet', { chatId, label });
        try {
            const { walletInfo, privateKey } = await this.walletManager.generateAndAddWallet(label, 'trading', chatId);
            
            // Store wallet in database
            const user = await this.dataManager.getUser(chatId);
            if (!user) {
                throw new Error('User not found in database');
            }

            await this.dataManager.createWallet(
                user.id, 
                label, 
                walletInfo.publicKey.toBase58(), 
                walletInfo.encryptedPrivateKey,
                walletInfo.nonceAccountPubkey ? walletInfo.nonceAccountPubkey.toBase58() : null,
                walletInfo.encryptedNonceAccountPrivateKey || null
            );

            this.logInfo('Generated wallet stored in database', { chatId, label, userId: user.id });
            
            const message = `✅ Wallet *${label}* Generated!\n` +
                `Address: \`${walletInfo.publicKey.toBase58()}\`\n\n` +
                `🚨 *SAVE THIS PRIVATE KEY SECURELY* 🚨\n\n` +
                `\`${privateKey}\``;

            await this.telegramUi.sendOrEditMessage(chatId, message, {
                reply_markup: { inline_keyboard: [[{ text: "🔙 Back to Wallet Menu", callback_data: "wallets_menu" }]] }
            });
            
            this.signalMessage('WALLET_GENERATED', { chatId, label, address: walletInfo.publicKey.toBase58() });
        } catch (error) {
            this.logError('Failed to generate wallet', { chatId, label, error: error.message });
            await this.telegramUi.sendErrorMessage(chatId, `Failed to generate wallet: ${error.message}`);
        }
    }

    async handleImportWallet(chatId, label, privateKey) {
        this.logInfo('Importing wallet', { chatId, label });
        try {
            const wallet = await this.walletManager.importWalletFromPrivateKey(privateKey, label, 'trading', chatId);
            this.logInfo('Wallet import result', { wallet });
            
            if (!wallet || !wallet.publicKey) {
                throw new Error('Wallet import failed - no wallet info returned');
            }

            // Store wallet in database
            const user = await this.dataManager.getUser(chatId);
            if (!user) {
                throw new Error('User not found in database');
            }

            console.log(`[DEBUG] Creating wallet in database:`, {
                userId: user.id,
                label: label,
                publicKey: wallet.publicKey.toBase58(),
                hasEncryptedKey: !!wallet.encryptedPrivateKey
            });

            try {
                const result = await this.dataManager.createWallet(
                    user.id, 
                    label, 
                    wallet.publicKey.toBase58(), 
                    wallet.encryptedPrivateKey,
                    wallet.nonceAccountPubkey ? wallet.nonceAccountPubkey.toBase58() : null,
                    wallet.encryptedNonceAccountPrivateKey || null
                );
                console.log(`[DEBUG] createWallet result:`, result);
            } catch (createError) {
                console.error(`[DEBUG] Error creating wallet:`, createError);
                throw createError;
            }

            // Verify wallet was created
            const createdWallet = await this.dataManager.getWalletByLabel(chatId, label);
            console.log(`[DEBUG] Wallet created in database:`, createdWallet);

            this.logInfo('Wallet stored in database', { chatId, label, userId: user.id });
            
            const message = `✅ Wallet *${escapeMarkdownV2(label)}* Imported Successfully\\!\n` +
                `Address: \`${escapeMarkdownV2(wallet.publicKey.toBase58())}\`\n\n` +
                `🔐 Wallet is now ready for trading\\.`;

            await this.telegramUi.sendOrEditMessage(chatId, message, {
                reply_markup: { inline_keyboard: [[{ text: "🔙 Back to Wallet Menu", callback_data: "wallets_menu" }]] }
            });
            
            this.signalMessage('WALLET_IMPORTED', { chatId, label, address: wallet.publicKey.toBase58() });
        } catch (error) {
            this.logError('Failed to import wallet', { chatId, label, error: error.message });
            await this.telegramUi.sendErrorMessage(chatId, `Failed to import wallet: ${error.message}`);
        }
    }





    async handleDeleteWallet(chatId, walletLabel) {
        this.logInfo('Deleting wallet', { chatId, walletLabel });
        try {
            const success = await this.walletManager.deleteWalletByLabel(chatId, walletLabel);
            if (success) {
                const message = `✅ Wallet *${walletLabel}* deleted successfully!`;
                await this.telegramUi.sendOrEditMessage(chatId, message, {
                    reply_markup: { inline_keyboard: [[{ text: "🔙 Back to Wallet Menu", callback_data: "wallets_menu" }]] }
                });
                this.signalMessage('WALLET_DELETED', { chatId, walletLabel });
            } else {
                await this.telegramUi.sendErrorMessage(chatId, `Wallet "${walletLabel}" not found or could not be deleted.`);
            }
        } catch (error) {
            this.logError('Failed to delete wallet', { chatId, walletLabel, error: error.message });
            await this.telegramUi.sendErrorMessage(chatId, `Failed to delete wallet: ${error.message}`);
        }
    }

    async handleWithdraw(chatId, toAddress, amount) {
        this.logInfo('Processing withdrawal', { chatId, toAddress, amount });
        // Implementation would go here
        this.signalMessage('WITHDRAWAL_INITIATED', { chatId, toAddress, amount });
    }

    async handleConfirmWithdraw(chatId, amount, toAddress) {
        this.logInfo('Confirming withdrawal', { chatId, amount, toAddress });
        // Implementation would go here
        this.signalMessage('WITHDRAWAL_CONFIRMED', { chatId, amount, toAddress });
    }

    async handleResetData(chatId) {
        this.logInfo('Resetting data', { chatId });
        // Implementation would go here
        this.signalMessage('DATA_RESET', { chatId });
    }

    async handleManualCopy(chatId, signature) {
        this.logInfo('Manual copy requested', { chatId, signature });
        // Implementation would go here
        this.signalMessage('MANUAL_COPY_PROCESSED', { chatId, signature });
    }

    async customCleanup() {
        try {
            if (this.telegramUi && this.telegramUi.bot && this.telegramUi.bot.isPolling()) {
                await this.telegramUi.bot.stopPolling({ cancel: true });
                this.logInfo('Telegram bot polling stopped');
            }
            
            // Close database connection
            if (this.dataManager) {
                await this.dataManager.close();
            }
            
            // Close Redis connection
            if (this.redisManager) {
                await this.redisManager.close();
            }
        } catch (error) {
            this.logError('Error during Telegram cleanup', { error: error.message });
        }
    }

    async customHealthCheck() {
        try {
            if (this.telegramUi && this.telegramUi.bot) {
                return this.telegramUi.bot.isPolling();
            }
            return false;
        } catch (error) {
            this.logError('Health check failed', { error: error.message });
            return false;
        }
    }

    async syncActiveTradersToRedis(chatId) {
        try {
            // Get user first to get internal ID
            const user = await this.dataManager.getUser(chatId);
            if (!user) {
                this.logError('User not found for chatId', { chatId });
                return;
            }
            
            // Get all traders for this user using internal ID
            const traders = await this.dataManager.getTraders(user.id);
            
            // Filter active traders and get their names
            const activeTraderNames = traders
                .filter(trader => trader.active === true || trader.active === 1)
                .map(trader => trader.name);
            
            // Update Redis with active trader names
            await this.redisManager.setActiveTraders(chatId.toString(), activeTraderNames);
            
            this.logInfo(`Synced ${activeTraderNames.length} active traders to Redis`, { 
                chatId, 
                activeTraders: activeTraderNames 
            });
            
            // Signal the monitor worker to refresh its trader list
            this.signalMessage('REFRESH_SUBSCRIPTIONS', { chatId });

        } catch (error) {
            this.logError('Failed to sync active traders to Redis', { 
                chatId, 
                error: error.message 
            });
        }
    }

    async syncAllActiveTradersOnStartup() {
        try {
            this.logInfo('🔄 Syncing all active traders to Redis on startup...');
            
            // Get all users
            const usersData = await this.dataManager.loadUsers();
            const allUsers = Object.values(usersData || {});
            
            let totalSynced = 0;
            
            // Sync active traders for each user
            for (const user of allUsers) {
                const chatId = user.chat_id.toString();
                // 🔧 FIX: Use user.id (internal ID) not chatId for getTraders()
                const traders = await this.dataManager.getTraders(user.id);
                
                const activeTraderNames = traders
                    .filter(trader => trader.active === true || trader.active === 1)
                    .map(trader => trader.name);
                
                if (activeTraderNames.length > 0) {
                    await this.redisManager.setActiveTraders(chatId, activeTraderNames);
                    totalSynced += activeTraderNames.length;
                    this.logInfo(`Synced ${activeTraderNames.length} active traders for user ${chatId}`, { 
                        chatId, 
                        activeTraders: activeTraderNames 
                    });
                }
            }
            
            this.logInfo(`✅ Startup sync completed: ${totalSynced} total active traders synced to Redis`);
            
            // Signal monitor worker to refresh subscriptions
            this.signalMessage('REFRESH_SUBSCRIPTIONS', { chatId: 'all' });

        } catch (error) {
            this.logError('Failed to sync active traders on startup', { 
                error: error.message 
            });
        }
    }
}

// Initialize worker if this file is run directly
if (require.main === module) {
    const worker = new TelegramWorker();
    worker.initialize().catch(error => {
        console.error('Telegram worker failed to initialize:', error);
        process.exit(1);
    });
}

module.exports = TelegramWorker;
