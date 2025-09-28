// ==========================================
// ========== ZapBot JSON DataManager ==========
// ==========================================
// File: dataManager.js
// Description: JSON-based data manager for ZapBot (replaces SQLite)

const fs = require('fs').promises;
const path = require('path');
const BN = require('bn.js');

class DataManager {
    constructor(redisManager = null) {
        this.dataPath = path.join(__dirname, 'data');
        this.isInitialized = false;
        this.redisManager = redisManager; // Redis manager for caching
        this.logger = {
            info: (msg, data) => console.log(`[JSON-DB] ${msg}`, data ? JSON.stringify(data) : ''),
            error: (msg, data) => console.error(`[JSON-DB] ${msg}`, data ? JSON.stringify(data) : ''),
            warn: (msg, data) => console.warn(`[JSON-DB] ${msg}`, data ? JSON.stringify(data) : ''),
            debug: (msg, data) => console.log(`[JSON-DB DEBUG] ${msg}`, data ? JSON.stringify(data) : '')
        };
    }

    async initialize() {
        try {
            // Ensure data directory exists
            await fs.mkdir(this.dataPath, { recursive: true });
            
            // Initialize default files if they don't exist
            await this.initializeDefaultFiles();
            
            this.isInitialized = true;
            this.logger.info('DataManager initialized successfully');
            
        } catch (error) {
            console.error('❌ DataManager initialization failed:', error);
            throw error;
        }
    }

    async initializeDefaultFiles() {
        const defaultFiles = {
            'users.json': { users: {} },
            'traders.json': { traders: {} },
            'trades.json': { trades: [] },
            'trade_stats.json': { trade_stats: {} },
            'withdrawals.json': { withdrawals: [] },
            'positions.json': { positions: {} },
            'wallets.json': { wallets: {} },
            'settings.json': { settings: {} },
            'pnl_history.json': { pnl_history: [] },
            'saved_addresses.json': { addresses: [] },
            'sol_config.json': { sol_config: {} },
            'tradeHistory.json': { tradeHistory: [] },
            'wallets.enc.json': { trading: [], withdrawal: [] },
            'withdrawal_history.json': { withdrawal_history: [] }
        };

        for (const [filename, defaultData] of Object.entries(defaultFiles)) {
            const filePath = path.join(this.dataPath, filename);
            try {
                await fs.access(filePath);
            } catch {
                // File doesn't exist, create it with default data
                await this.writeJsonFile(filename, defaultData);
                this.logger.info(`Created default file: ${filename}`);
            }
        }
    }

    // Generic file operations
    async readJsonFile(filename) {
        const filePath = path.join(this.dataPath, filename);
        try {
            const data = await fs.readFile(filePath, 'utf8');
            return JSON.parse(data);
        } catch (error) {
            this.logger.error(`Error reading ${filename}:`, error.message);
            return null;
        }
    }

    async writeJsonFile(filename, data) {
        const filePath = path.join(this.dataPath, filename);
        try {
            await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
            return true;
        } catch (error) {
            this.logger.error(`Error writing ${filename}:`, error.message);
            return false;
        }
    }

    // User management
    async createUser(chatId, userData = {}) {
        const { firstName, lastName, telegramUsername, isActive = true, isAdmin = false } = userData;
        const users = await this.readJsonFile('users.json');
        
        // Ensure users object exists
        if (!users.users) {
            users.users = {};
        }
        
        const userId = Date.now().toString(); // Simple ID generation
        users.users[chatId] = {
            id: userId,
            chat_id: parseInt(chatId),
            first_name: firstName || null,
            last_name: lastName || null,
            telegram_username: telegramUsername || null,
            is_active: isActive,
            is_admin: isAdmin,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        };
        
        await this.writeJsonFile('users.json', users);
        return userId;
    }

    async getUser(chatId) {
        const users = await this.readJsonFile('users.json');
        return users?.users?.[chatId] || null;
    }

    async updateUserSettings(chatId, settings) {
        const users = await this.readJsonFile('users.json');
        if (!users?.users?.[chatId]) {
            throw new Error(`User with chat_id ${chatId} not found`);
        }
        
        users.users[chatId].settings = settings;
        users.users[chatId].updated_at = new Date().toISOString();
        
        await this.writeJsonFile('users.json', users);
    }

    async updateUserData(chatId, userData) {
        const users = await this.readJsonFile('users.json');
        if (!users?.users?.[chatId]) {
            throw new Error(`User with chat_id ${chatId} not found`);
        }
        
        const user = users.users[chatId];
        if (userData.firstName !== undefined) user.first_name = userData.firstName;
        if (userData.lastName !== undefined) user.last_name = userData.lastName;
        if (userData.telegramUsername !== undefined) user.telegram_username = userData.telegramUsername;
        if (userData.isActive !== undefined) user.is_active = userData.isActive;
        if (userData.isAdmin !== undefined) user.is_admin = userData.isAdmin;
        
        user.updated_at = new Date().toISOString();
        await this.writeJsonFile('users.json', users);
    }

    // Trader management
    async addTrader(userId, name, wallet) {
        const traders = await this.readJsonFile('traders.json');
        const traderId = Date.now().toString();
        
        // Ensure traders object exists
        if (!traders.traders) {
            traders.traders = {};
        }
        
        if (!traders.traders[userId]) {
            traders.traders[userId] = {};
        }
        
        traders.traders[userId][name] = {
            id: traderId,
            user_id: userId,
            name: name,
            wallet: wallet,
            active: false, // New traders are inactive by default - user must manually activate them
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        };
        
        await this.writeJsonFile('traders.json', traders);
        return { id: traderId, changes: 1 };
    }

    async getTraders(userIdOrChatId) {
        const traders = await this.readJsonFile('traders.json');
        const idStr = userIdOrChatId.toString();
        
        // First, try to find traders directly by the ID (in case it's a user ID)
        if (traders.traders[idStr]) {
            const userTraders = traders.traders[idStr] || {};
            return Object.values(userTraders);
        }
        
        // If not found, treat it as a chat ID and get the user first
        const user = await this.getUser(idStr);
        if (!user) return [];
        
        const userTraders = traders.traders[user.id] || {};
        return Object.values(userTraders);
    }

    async updateTraderStatus(chatId, traderName, active) {
        const user = await this.getUser(chatId);
        if (!user) {
            throw new Error(`User with chat_id ${chatId} not found`);
        }
        
        const traders = await this.readJsonFile('traders.json');
        if (!traders.traders[user.id] || !traders.traders[user.id][traderName]) {
            throw new Error(`Trader ${traderName} not found for user ${user.id}`);
        }
        
        traders.traders[user.id][traderName].active = active;
        traders.traders[user.id][traderName].updated_at = new Date().toISOString();
        
        await this.writeJsonFile('traders.json', traders);
        return { changes: 1 };
    }

    async deleteTrader(userId, traderName) {
        const traders = await this.readJsonFile('traders.json');
        if (traders.traders[userId] && traders.traders[userId][traderName]) {
            delete traders.traders[userId][traderName];
            await this.writeJsonFile('traders.json', traders);
        }
    }

    // Wallet management
    async createWallet(userId, label, publicKey, privateKeyEncrypted, nonceAccountPubkey = null, encryptedNoncePrivateKey = null) {
        const wallets = await this.readJsonFile('wallets.json');
        
        if (!wallets.wallets[userId]) {
            wallets.wallets[userId] = {};
        }
        
        // Check if wallet with this label already exists
        if (wallets.wallets[userId][label]) {
            throw new Error(`Wallet label "${label}" already exists for you.`);
        }
        
        const walletId = Date.now().toString();
        wallets.wallets[userId][label] = {
            id: walletId,
            user_id: userId,
            label: label,
            public_key: publicKey,
            private_key_encrypted: privateKeyEncrypted,
            nonce_account_pubkey: nonceAccountPubkey,
            encrypted_nonce_private_key: encryptedNoncePrivateKey,
            balance: 0.0,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        };
        
        await this.writeJsonFile('wallets.json', wallets);
        return { id: walletId, changes: 1 };
    }

    async getUserWallets(chatId) {
        const user = await this.getUser(chatId);
        if (!user) return [];
        
        const wallets = await this.readJsonFile('wallets.json');
        const userWallets = wallets.wallets[user.id] || {};
        return Object.values(userWallets);
    }

    async updateWalletBalance(walletId, balance) {
        const wallets = await this.readJsonFile('wallets.json');
        
        for (const userId in wallets.wallets) {
            for (const label in wallets.wallets[userId]) {
                if (wallets.wallets[userId][label].id === walletId) {
                    wallets.wallets[userId][label].balance = balance;
                    wallets.wallets[userId][label].updated_at = new Date().toISOString();
                    await this.writeJsonFile('wallets.json', wallets);
                    return;
                }
            }
        }
    }

    async deleteWallet(userId, walletId) {
        const wallets = await this.readJsonFile('wallets.json');
        if (wallets.wallets[userId]) {
            for (const label in wallets.wallets[userId]) {
                if (wallets.wallets[userId][label].id === walletId) {
                    delete wallets.wallets[userId][label];
                    await this.writeJsonFile('wallets.json', wallets);
                    return { changes: 1 };
                }
            }
        }
        throw new Error('Wallet not found or could not be deleted');
    }

    async deleteWalletByLabel(userId, label) {
        const wallets = await this.readJsonFile('wallets.json');
        if (wallets.wallets[userId] && wallets.wallets[userId][label]) {
            delete wallets.wallets[userId][label];
            await this.writeJsonFile('wallets.json', wallets);
            return { changes: 1 };
        }
        throw new Error(`Wallet with label "${label}" not found or could not be deleted`);
    }

    // Trade management
    async recordTrade(userId, traderId, signature, platform, tokenMint, amountRaw, solSpent, status = 'pending') {
        const trades = await this.readJsonFile('trades.json');
        
        const trade = {
            id: Date.now().toString(),
            user_id: userId,
            trader_id: traderId,
            signature: signature,
            platform: platform,
            token_mint: tokenMint,
            amount_raw: amountRaw,
            sol_spent: solSpent,
            status: status,
            executed_at: new Date().toISOString()
        };
        
        trades.trades.push(trade);
        await this.writeJsonFile('trades.json', trades);
        return { id: trade.id, changes: 1 };
    }

    async updateTradeStatus(signature, status) {
        const trades = await this.readJsonFile('trades.json');
        const trade = trades.trades.find(t => t.signature === signature);
        if (trade) {
            trade.status = status;
            await this.writeJsonFile('trades.json', trades);
        }
    }

    async getTradeHistory(userId, limit = 50) {
        const trades = await this.readJsonFile('trades.json');
        const userTrades = trades.trades
            .filter(t => t.user_id === userId)
            .sort((a, b) => new Date(b.executed_at) - new Date(a.executed_at))
            .slice(0, limit);
        
        return userTrades;
    }

    // Statistics management
    async updateTradeStats(userId, stats) {
        const tradeStats = await this.readJsonFile('trade_stats.json');
        
        tradeStats.trade_stats[userId] = {
            user_id: userId,
            total_trades: stats.totalTrades,
            successful_copies: stats.successfulCopies,
            failed_copies: stats.failedCopies,
            trades_under_10secs: stats.tradesUnder10Secs,
            percentage_under_10secs: stats.percentageUnder10Secs,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        };
        
        await this.writeJsonFile('trade_stats.json', tradeStats);
    }

    async getTradeStats(userId) {
        const tradeStats = await this.readJsonFile('trade_stats.json');
        return tradeStats.trade_stats[userId] || null;
    }

    // Withdrawal management
    async recordWithdrawal(userId, amount, signature = null) {
        const withdrawals = await this.readJsonFile('withdrawals.json');
        
        const withdrawal = {
            id: Date.now().toString(),
            user_id: userId,
            amount: amount,
            signature: signature,
            status: 'pending',
            created_at: new Date().toISOString()
        };
        
        withdrawals.withdrawals.push(withdrawal);
        await this.writeJsonFile('withdrawals.json', withdrawals);
        return { id: withdrawal.id, changes: 1 };
    }

    async getWithdrawalHistory(userId, limit = 20) {
        const withdrawals = await this.readJsonFile('withdrawals.json');
        const userWithdrawals = withdrawals.withdrawals
            .filter(w => w.user_id === userId)
            .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
            .slice(0, limit);
        
        return userWithdrawals;
    }

    // Position management
    async recordBuyPosition(chatId, tokenMint, amountRaw, solSpent) {
        const user = await this.getUser(chatId);
        if (!user) throw new Error(`User with chat_id ${chatId} not found`);

        // Handle both string formats: "0n" and "1000000000n"
        const amountStr = amountRaw.toString().replace('n', '');
        if (!amountRaw || amountRaw === "0" || amountRaw === "0n" || BigInt(amountStr) <= 0n) {
            console.warn(`[JSON-DB-VALIDATION] Skipping position recording: Invalid amount (${amountRaw}) for token ${tokenMint}`);
            return;
        }

        const positions = await this.readJsonFile('positions.json');
        
        if (!positions.user_positions) {
            positions.user_positions = {};
        }
        
        if (!positions.user_positions[chatId]) {
            positions.user_positions[chatId] = {};
        }
        
        positions.user_positions[chatId][tokenMint] = {
            amountRaw: amountRaw,
            solSpent: solSpent,
            buyTimestamp: Date.now(),
            sellTimestamp: null
        };
        
        await this.writeJsonFile('positions.json', positions);
    }

    async updatePositionAfterSell(chatId, tokenMint, amountSold, solFee, solReceived) {
        const user = await this.getUser(chatId);
        if (!user) throw new Error(`User with chat_id ${chatId} not found`);

        const positions = await this.readJsonFile('positions.json');
        const position = positions.user_positions?.[chatId]?.[tokenMint];
        
        if (!position) return;

        // Handle both string formats: "0n" and "1000000000n"
        const positionAmountStr = position.amountRaw.toString().replace('n', '');
        const newAmount = BigInt(positionAmountStr) - BigInt(amountSold);
        
        if (newAmount <= 0) {
            // Position fully sold, delete it
            delete positions.user_positions[chatId][tokenMint];
        } else {
            // Update remaining amount
            positions.user_positions[chatId][tokenMint].amountRaw = newAmount.toString();
            positions.user_positions[chatId][tokenMint].sellTimestamp = Date.now();
        }
        
        await this.writeJsonFile('positions.json', positions);
    }

    async getUserPositions(chatId) {
        const user = await this.getUser(chatId);
        if (!user) {
            console.log(`[DataManager] ⚠️ User not found for chatId: ${chatId}`);
            return new Map();
        }

        const positions = await this.readJsonFile('positions.json');
        console.log(`[DataManager] 🔍 Positions file structure:`, {
            hasPositions: !!positions,
            hasPositionsProperty: !!(positions && positions.user_positions),
            userExists: !!(positions && positions.user_positions && positions.user_positions[chatId])
        });
        
        // Check if positions file exists and has proper structure
        if (!positions || !positions.user_positions) {
            console.log(`[DataManager] ⚠️ Positions file missing or invalid structure for user ${chatId}`);
            return new Map();
        }
        
        const userPositions = positions.user_positions[chatId] || {};
        console.log(`[DataManager] 🔍 User positions for ${chatId}:`, Object.keys(userPositions));

        const positionMap = new Map();
        for (const [tokenMint, pos] of Object.entries(userPositions)) {
            // Handle both string formats: "0n" and "1000000000n"
            const amountStr = pos.amountRaw.toString().replace('n', '');
            const amountBigInt = BigInt(amountStr);
            
            if (amountBigInt > 0) {
                positionMap.set(tokenMint, {
                    amountRaw: amountBigInt,
                    solSpent: pos.solSpent || 0
                });
            }
        }
        return positionMap;
    }

    async getUserSellDetails(chatId, tokenMint) {
        const user = await this.getUser(chatId);
        if (!user) {
            console.log(`[DataManager DEBUG] No user found for chatId: ${chatId}`);
            return null;
        }

        const positions = await this.readJsonFile('positions.json');
        
        // DEFENSIVE CHECK: Handle cases where the file is new, empty, or malformed
        if (!positions || !positions.user_positions || !positions.user_positions[chatId]) {
            console.log(`[DataManager DEBUG] No position data found for user ${chatId}.`);
            return null;
        }
        
        const position = positions.user_positions[chatId][tokenMint];

        // Handle both string formats: "0n" and "1000000000n"
        const amountStr = position.amountRaw.toString().replace('n', '');
        const amountBigInt = BigInt(amountStr);
        
        if (!position || amountBigInt <= 0) return null;

        return {
            amountToSellBN: new BN(amountStr),
            originalSolSpent: position.solSpent || 0
        };
    }

    // Settings management
    async getUserSettings(chatId) {
        const user = await this.getUser(chatId);
        if (!user) {
            throw new Error(`User with chat_id ${chatId} not found or inactive`);
        }
        
        const settings = await this.readJsonFile('settings.json');
        const userSettings = settings?.settings?.[chatId] || {};
        
        return {
            userId: user.id,
            chatId: user.chat_id,
            solAmount: userSettings.solAmount || 0.01,
            slippageBps: userSettings.slippageBps || 5000
        };
    }

    async getSettings() {
        // We need access to Redis here. We assume it's initialized.
        if (!this.redisManager) {
            // Lazy-initialize RedisManager if it hasn't been done
            const { RedisManager } = require('./redis/redisManager');
            this.redisManager = new RedisManager();
            await this.redisManager.initialize();
        }

        const configKey = 'app:settings';

        try {
            // 1. Try to fetch from Redis ONLY (no file fallback)
            const redisSettings = await this.redisManager.getObject(configKey);
            if (redisSettings) {
                this.logger.debug(`[SETTINGS] ⚡ Redis HIT for settings.`);
                return redisSettings;
            }

            // 2. If not in Redis, return null (let caller handle it)
            this.logger.warn(`[SETTINGS] ❌ No settings found in Redis. Config not initialized.`);
            return null;

        } catch (error) {
            this.logger.error('Error loading settings from Redis:', error);
            return null;
        }
    }

    // ========================= REDIS-ONLY CONFIG MANAGEMENT ========================
    
    async setSettings(settings) {
        if (!this.redisManager) {
            const { RedisManager } = require('./redis/redisManager');
            this.redisManager = new RedisManager();
            await this.redisManager.initialize();
        }

        const configKey = 'app:settings';
        try {
            await this.redisManager.setObject(configKey, settings, 86400); // 24 hours TTL
            this.logger.info(`[SETTINGS] ✅ Settings saved to Redis.`);
            return true;
        } catch (error) {
            this.logger.error('Error saving settings to Redis:', error);
            return false;
        }
    }

    async updateScaleFactor(scaleFactor) {
        const currentSettings = await this.getSettings();
        if (!currentSettings) {
            this.logger.error(`[SETTINGS] ❌ Cannot update scale factor: No settings found in Redis.`);
            return false;
        }

        currentSettings.botSettings.scaleFactor = scaleFactor;
        return await this.setSettings(currentSettings);
    }

    async updateSlippage(slippage) {
        const currentSettings = await this.getSettings();
        if (!currentSettings) {
            this.logger.error(`[SETTINGS] ❌ Cannot update slippage: No settings found in Redis.`);
            return false;
        }

        currentSettings.botSettings.maxSlippage = slippage;
        return await this.setSettings(currentSettings);
    }

    async initializeDefaultSettings() {
        if (!this.redisManager) {
            const { RedisManager } = require('./redis/redisManager');
            this.redisManager = new RedisManager();
            await this.redisManager.initialize();
        }

        const configKey = 'app:settings';
        
        // Check if settings already exist
        const existingSettings = await this.redisManager.getObject(configKey);
        if (existingSettings) {
            this.logger.info(`[SETTINGS] ✅ Settings already exist in Redis.`);
            return existingSettings;
        }

        // Initialize default settings in Redis
        const defaultSettings = {
                botSettings: {
                copyTrading: true, // Pure copy trading bot
                maxSlippage: 0.15,
                minSolAmount: 0.001,
                maxSolAmount: 50.0,
                enableNotifications: true,
                enableLogging: true,
                scaleFactor: 1.0, // 100% - exact copy by default
                    enableATASlicing: true,
                    ataSliceOffset: 64,
                    ataSliceLength: 8,
                supportedPlatforms: ["PumpFun", "Raydium", "Jupiter", "Meteora", "Orca"],
                    enableRouterDetection: true,
                computeBudgetUnits: 500000,
                    computeBudgetFee: 0
            },
            tradingSettings: {
                defaultSolAmount: 0.1,
                maxPositions: 100,
                stopLoss: 0.0,
                takeProfit: 0.0
            },
            settings: {}
        };

        await this.redisManager.setObject(configKey, defaultSettings, 86400); // 24 hours TTL
        this.logger.info(`[SETTINGS] ✅ Default settings initialized in Redis.`);
        return defaultSettings;
    }

    // ========================= REDIS PORTFOLIO MANAGEMENT ========================
    
    async addPosition(chatId, tokenMint, positionData) {
        if (!this.redisManager) {
            const { RedisManager } = require('./redis/redisManager');
            this.redisManager = new RedisManager();
            await this.redisManager.initialize();
        }

        const positionKey = `portfolio:${chatId}:${tokenMint}`;
        try {
            await this.redisManager.setObject(positionKey, positionData, 86400); // 24 hours TTL
            this.logger.info(`[PORTFOLIO] ✅ Position added for user ${chatId}: ${tokenMint} - ${positionData.tokenAmount} tokens`);
            return true;
        } catch (error) {
            this.logger.error(`[PORTFOLIO] ❌ Failed to add position for user ${chatId}, token ${tokenMint}:`, error);
            return false;
        }
    }

    async getPosition(chatId, tokenMint) {
        if (!this.redisManager) {
            const { RedisManager } = require('./redis/redisManager');
            this.redisManager = new RedisManager();
            await this.redisManager.initialize();
        }

        const positionKey = `portfolio:${chatId}:${tokenMint}`;
        try {
            const position = await this.redisManager.getObject(positionKey);
            if (position) {
                this.logger.debug(`[PORTFOLIO] ⚡ Position found for user ${chatId}, token ${tokenMint}: ${position.tokenAmount} tokens`);
            }
            return position;
        } catch (error) {
            this.logger.error(`[PORTFOLIO] ❌ Failed to get position for user ${chatId}, token ${tokenMint}:`, error);
            return null;
        }
    }

    async updatePosition(chatId, tokenMint, newTokenAmount) {
        if (!this.redisManager) {
            const { RedisManager } = require('./redis/redisManager');
            this.redisManager = new RedisManager();
            await this.redisManager.initialize();
        }

        const positionKey = `portfolio:${chatId}:${tokenMint}`;
        try {
            const existingPosition = await this.getPosition(chatId, tokenMint);
            if (!existingPosition) {
                this.logger.warn(`[PORTFOLIO] ⚠️ No position found to update for user ${chatId}, token ${tokenMint}`);
                return false;
            }

            existingPosition.tokenAmount = newTokenAmount;
            existingPosition.lastUpdated = new Date().toISOString();
            
            await this.redisManager.setObject(positionKey, existingPosition, 86400);
            this.logger.info(`[PORTFOLIO] ✅ Position updated for user ${chatId}, token ${tokenMint}: ${newTokenAmount} tokens`);
            return true;
        } catch (error) {
            this.logger.error(`[PORTFOLIO] ❌ Failed to update position for user ${chatId}, token ${tokenMint}:`, error);
            return false;
        }
    }

    async removePosition(chatId, tokenMint) {
        if (!this.redisManager) {
            const { RedisManager } = require('./redis/redisManager');
            this.redisManager = new RedisManager();
            await this.redisManager.initialize();
        }

        const positionKey = `portfolio:${chatId}:${tokenMint}`;
        try {
            await this.redisManager.del(positionKey);
            this.logger.info(`[PORTFOLIO] ✅ Position removed for user ${chatId}, token ${tokenMint}`);
            return true;
        } catch (error) {
            this.logger.error(`[PORTFOLIO] ❌ Failed to remove position for user ${chatId}, token ${tokenMint}:`, error);
            return false;
        }
    }

    async getAllPositions(chatId) {
        if (!this.redisManager) {
            const { RedisManager } = require('./redis/redisManager');
            this.redisManager = new RedisManager();
            await this.redisManager.initialize();
        }

        try {
            const keys = await this.redisManager.keys(`portfolio:${chatId}:*`);
            const positions = {};
            
            for (const key of keys) {
                const tokenMint = key.replace(`portfolio:${chatId}:`, '');
                const position = await this.getPosition(chatId, tokenMint);
                if (position) {
                    positions[tokenMint] = position;
                }
            }
            
            this.logger.info(`[PORTFOLIO] 📊 Found ${Object.keys(positions).length} active positions for user ${chatId}`);
            return positions;
        } catch (error) {
            this.logger.error(`[PORTFOLIO] ❌ Failed to get all positions for user ${chatId}:`, error);
            return {};
        }
    }

    async hasPosition(chatId, tokenMint) {
        const position = await this.getPosition(chatId, tokenMint);
        return position !== null && position.tokenAmount > 0;
    }

    async updateUserSlippage(chatId, slippageBps) {
        const settings = await this.readJsonFile('settings.json');
        
        if (!settings.settings[chatId]) {
            settings.settings[chatId] = {};
        }
        
        settings.settings[chatId].slippageBps = slippageBps;
        settings.settings[chatId].updated_at = new Date().toISOString();
        
        await this.writeJsonFile('settings.json', settings);
        console.log(`[JSON-DB] Updated slippage for user ${chatId}: ${slippageBps} BPS`);
    }

    async loadSolAmounts() {
        const settings = await this.readJsonFile('settings.json');
        const result = {};
        
        if (settings && settings.settings) {
            for (const [chatId, userSettings] of Object.entries(settings.settings)) {
                result[chatId] = userSettings.solAmount || 0.01;
            }
        }
        
        return result;
    }

    async saveSolAmounts(amounts) {
        const settings = await this.readJsonFile('settings.json');
        
        if (!settings.settings) {
            settings.settings = {};
        }
        
        for (const [chatId, amount] of Object.entries(amounts)) {
            if (!settings.settings[chatId]) {
                settings.settings[chatId] = {};
            }
            settings.settings[chatId].solAmount = amount;
            settings.settings[chatId].updated_at = new Date().toISOString();
        }
        
        await this.writeJsonFile('settings.json', settings);
    }

    // Legacy compatibility methods
    async loadTraders() {
        const traders = await this.readJsonFile('traders.json');
        const users = await this.readJsonFile('users.json');
        
        const result = { user_traders: {} };
        
        if (traders?.traders && users?.users) {
            for (const [userId, userTraders] of Object.entries(traders.traders)) {
                // Find chat_id for this user_id
                const chatId = Object.keys(users.users).find(id => users.users[id].id === userId);
                if (chatId) {
                    result.user_traders[chatId] = {};
                    for (const [name, trader] of Object.entries(userTraders)) {
                        result.user_traders[chatId][name] = {
                            wallet: trader.wallet,
                            active: trader.active
                        };
                    }
                }
            }
        }
        
        return result;
    }

    async loadUsers() {
        const users = await this.readJsonFile('users.json');
        return users?.users || {};
    }

    async loadPositions() {
        const positions = await this.readJsonFile('positions.json');
        const users = await this.readJsonFile('users.json');
        
        const result = { user_positions: {} };
        
        if (positions?.positions && users?.users) {
            for (const [userId, userPositions] of Object.entries(positions.positions)) {
                // Find chat_id for this user_id
                const chatId = Object.keys(users.users).find(id => users.users[id].id === userId);
                if (chatId) {
                    result.user_positions[chatId] = {};
                    for (const [tokenMint, position] of Object.entries(userPositions)) {
                        result.user_positions[chatId][tokenMint] = {
                            amountRaw: BigInt(position.amount_raw),
                            solSpent: position.sol_spent || 0
                        };
                    }
                }
            }
        }
        
        return result;
    }

    async getTradersGroupedByUser() {
        const traders = await this.loadTraders();
        return traders.user_traders;
    }

    // Logging methods (for compatibility)
    async logInfo(component, message, data = null) {
        console.log(`[${component}] INFO: ${message}`, data ? JSON.stringify(data, null, 2) : '');
    }

    async logError(component, message, data = null) {
        console.error(`[${component}] ERROR: ${message}`, data ? JSON.stringify(data, null, 2) : '');
    }

    async logWarning(component, message, data = null) {
        console.warn(`[${component}] WARNING: ${message}`, data ? JSON.stringify(data, null, 2) : '');
    }

    async logDebug(component, message, data = null) {
        console.debug(`[${component}] DEBUG: ${message}`, data ? JSON.stringify(data, null, 2) : '');
    }

    async shutdown() {
        console.log('[JSON-DB] Shutting down data manager...');
        console.log('[JSON-DB] Data manager shutdown complete');
    }

    // Alias for compatibility with workers
    async close() {
        return await this.shutdown();
    }
}

module.exports = { DataManager };
