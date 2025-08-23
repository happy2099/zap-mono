// ==========================================
// ========== ZapBot DatabaseManager ==========
// ==========================================
// File: database/databaseManager.js
// Description: Lightweight SQLite database manager for ZapBot

import sqlite3 from 'sqlite3';
import path from 'path';
import { promises as fs } from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class DatabaseManager {
    constructor() {
        this.dbPath = path.join(__dirname, 'zapbot.db');
        this.db = null;
        this.isInitialized = false;
    }

    async initialize() {
        try {
            // Ensure database directory exists
            await fs.mkdir(path.dirname(this.dbPath), { recursive: true });
            
            // Initialize database connection
            this.db = new sqlite3.Database(this.dbPath);
            
            // Enable foreign keys
            await this.run('PRAGMA foreign_keys = ON');
            
            // Create tables
            await this.createTables();
            
            this.isInitialized = true;
            console.log('✅ DatabaseManager initialized successfully');
            
        } catch (error) {
            console.error('❌ DatabaseManager initialization failed:', error);
            throw error;
        }
    }

    async createTables() {
        const schemaPath = path.join(__dirname, 'schema.sql');
        const schema = await fs.readFile(schemaPath, 'utf8');
        
        // Split schema into individual statements
        const statements = schema.split(';').filter(stmt => stmt.trim());
        
        for (const statement of statements) {
            if (statement.trim()) {
                await this.run(statement);
            }
        }
        
        console.log('✅ Database tables created successfully');
    }

    // Generic query methods
    async run(sql, params = []) {
        return new Promise((resolve, reject) => {
            this.db.run(sql, params, function(err) {
                if (err) reject(err);
                else resolve({ id: this.lastID, changes: this.changes });
            });
        });
    }

    async get(sql, params = []) {
        return new Promise((resolve, reject) => {
            this.db.get(sql, params, (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });
    }

    async all(sql, params = []) {
        return new Promise((resolve, reject) => {
            this.db.all(sql, params, (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
    }

    // User management
    async createUser(chatId, settings = {}) {
        const result = await this.run(
            'INSERT OR REPLACE INTO users (chat_id, settings, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)',
            [chatId, JSON.stringify(settings)]
        );
        return result.id;
    }

    async getUser(chatId) {
        return await this.get('SELECT * FROM users WHERE chat_id = ?', [chatId]);
    }

    async updateUser(chatId, userData) {
        const setClause = Object.keys(userData).map(key => `${key} = ?`).join(', ');
        const values = [...Object.values(userData), chatId];
        return this.run(
            `UPDATE users SET ${setClause}, updated_at = CURRENT_TIMESTAMP WHERE chat_id = ?`,
            values
        );
    }

    async updateUserSettings(chatId, settings) {
        await this.run(
            'UPDATE users SET settings = ?, updated_at = CURRENT_TIMESTAMP WHERE chat_id = ?',
            [JSON.stringify(settings), chatId]
        );
    }

    // Trader management
    async addTrader(userId, name, wallet, active = true) {
        return await this.run(
            'INSERT OR REPLACE INTO traders (user_id, name, wallet, active, updated_at) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)',
            [userId, name, wallet, active ? 1 : 0]
        );
    }

    async getTraders(userId) {
        return await this.all('SELECT * FROM traders WHERE user_id = ?', [userId]);
    }

    async updateTraderStatus(userId, wallet, active) {
        await this.run(
            'UPDATE traders SET active = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ? AND wallet = ?',
            [active ? 1 : 0, userId, wallet]
        );
    }

    async deleteTrader(userId, wallet) {
        await this.run('DELETE FROM traders WHERE user_id = ? AND wallet = ?', [userId, wallet]);
    }

    // Trade management
    async recordTrade(userId, traderId, signature, platform, tokenMint, amountRaw, solSpent, status = 'pending') {
        return await this.run(
            'INSERT INTO trades (user_id, trader_id, signature, platform, token_mint, amount_raw, sol_spent, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [userId, traderId, signature, platform, tokenMint, amountRaw, solSpent, status]
        );
    }

    async updateTradeStatus(signature, status) {
        await this.run(
            'UPDATE trades SET status = ? WHERE signature = ?',
            [status, signature]
        );
    }

    async getTradeHistory(userId, limit = 50) {
        return await this.all(
            `SELECT t.*, tr.name as trader_name 
             FROM trades t 
             LEFT JOIN traders tr ON t.trader_id = tr.id 
             WHERE t.user_id = ? 
             ORDER BY t.executed_at DESC 
             LIMIT ?`,
            [userId, limit]
        );
    }

    // Statistics management
    async updateTradeStats(userId, stats) {
        await this.run(
            `INSERT OR REPLACE INTO trade_stats 
             (user_id, total_trades, successful_copies, failed_copies, trades_under_10secs, percentage_under_10secs, updated_at) 
             VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
            [userId, stats.totalTrades, stats.successfulCopies, stats.failedCopies, stats.tradesUnder10Secs, stats.percentageUnder10Secs]
        );
    }

    async getTradeStats(userId) {
        return await this.get('SELECT * FROM trade_stats WHERE user_id = ?', [userId]);
    }

    // Withdrawal management
    async recordWithdrawal(userId, amount, signature = null) {
        return await this.run(
            'INSERT INTO withdrawals (user_id, amount, signature) VALUES (?, ?, ?)',
            [userId, amount, signature]
        );
    }

    async getWithdrawalHistory(userId, limit = 20) {
        return await this.all(
            'SELECT * FROM withdrawals WHERE user_id = ? ORDER BY created_at DESC LIMIT ?',
            [userId, limit]
        );
    }

    // Enhanced user creation with all fields
    async createUserComplete(chatId, userData) {
        return this.run(
            `INSERT OR REPLACE INTO users (chat_id, username, settings, sol_amount, is_admin) 
             VALUES (?, ?, ?, ?, ?)`,
            [chatId, userData.username, userData.settings, userData.sol_amount, userData.is_admin || 0]
        );
    }

    // Admin management
    async setUserAdmin(chatId, isAdmin = true) {
        return this.run(
            'UPDATE users SET is_admin = ?, updated_at = CURRENT_TIMESTAMP WHERE chat_id = ?',
            [isAdmin ? 1 : 0, chatId]
        );
    }

    async isUserAdmin(chatId) {
        const user = await this.get('SELECT is_admin FROM users WHERE chat_id = ?', [chatId]);
        return user ? Boolean(user.is_admin) : false;
    }

    async getAllAdmins() {
        return this.all('SELECT * FROM users WHERE is_admin = 1');
    }

    // Position management
    async createPosition(userId, tokenMint, positionData) {
        return this.run(
            `INSERT OR REPLACE INTO positions 
             (user_id, token_mint, amount_raw, sol_spent, sold_amount_raw, buy_timestamp, sell_timestamp, status) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                userId, 
                tokenMint, 
                positionData.amountRaw || '0', 
                positionData.solSpent || 0,
                positionData.soldAmountRaw || '0',
                positionData.buyTimestamp || null,
                positionData.sellTimestamp || null,
                positionData.amountRaw === '0n' ? 'sold' : 'active'
            ]
        );
    }

    async getPositions(userId) {
        return this.all('SELECT * FROM positions WHERE user_id = ?', [userId]);
    }

    async updatePosition(userId, tokenMint, updates) {
        const setClause = Object.keys(updates).map(key => `${key} = ?`).join(', ');
        const values = [...Object.values(updates), userId, tokenMint];
        return this.run(
            `UPDATE positions SET ${setClause}, updated_at = CURRENT_TIMESTAMP WHERE user_id = ? AND token_mint = ?`,
            values
        );
    }

    // Trade statistics
    async createTradeStats(userId, stats) {
        return this.run(
            `INSERT OR REPLACE INTO trade_stats 
             (user_id, total_trades, successful_copies, failed_copies, trades_under_10secs, percentage_under_10secs) 
             VALUES (?, ?, ?, ?, ?, ?)`,
            [
                userId,
                stats.totalTrades || 0,
                stats.successfulCopies || 0,
                stats.failedCopies || 0,
                stats.tradesUnder10Secs || 0,
                parseFloat(stats.percentageUnder10Secs) || 0.0
            ]
        );
    }

    async getTradeStats(userId) {
        return this.get('SELECT * FROM trade_stats WHERE user_id = ?', [userId]);
    }

    // Withdrawal management
    async createWithdrawal(userId, withdrawalData) {
        return this.run(
            'INSERT INTO withdrawals (user_id, amount, signature, status) VALUES (?, ?, ?, ?)',
            [userId, withdrawalData.amount, withdrawalData.signature, withdrawalData.status || 'pending']
        );
    }

    // Processed pools
    async addProcessedPool(poolAddress) {
        return this.run(
            'INSERT OR IGNORE INTO processed_pools (pool_address) VALUES (?)',
            [poolAddress]
        );
    }

    async isPoolProcessed(poolAddress) {
        const result = await this.get('SELECT 1 FROM processed_pools WHERE pool_address = ?', [poolAddress]);
        return !!result;
    }

    // Wallet management methods
    async createWallet(userId, walletData) {
        return this.run(
            `INSERT OR REPLACE INTO wallets 
             (user_id, label, address, private_key, wallet_type, is_primary, balance) 
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [
                userId,
                walletData.label,
                walletData.address,
                walletData.privateKey || null,
                walletData.walletType || 'trading',
                walletData.isPrimary ? 1 : 0,
                walletData.balance || 0.0
            ]
        );
    }

    async getWallets(userId) {
        return this.all('SELECT * FROM wallets WHERE user_id = ? ORDER BY is_primary DESC, created_at ASC', [userId]);
    }

    async getPrimaryWallet(userId) {
        return this.get('SELECT * FROM wallets WHERE user_id = ? AND is_primary = 1', [userId]);
    }

    async setPrimaryWallet(userId, walletLabel) {
        // First, unset all primary wallets for this user
        await this.run('UPDATE wallets SET is_primary = 0 WHERE user_id = ?', [userId]);
        // Then set the specified wallet as primary
        return this.run('UPDATE wallets SET is_primary = 1 WHERE user_id = ? AND label = ?', [userId, walletLabel]);
    }

    async updateWalletBalance(userId, walletLabel, balance) {
        return this.run(
            'UPDATE wallets SET balance = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ? AND label = ?',
            [balance, userId, walletLabel]
        );
    }

    async deleteWallet(userId, walletLabel) {
        return this.run('DELETE FROM wallets WHERE user_id = ? AND label = ?', [userId, walletLabel]);
    }

    // Saved addresses
    async createSavedAddress(userId, label, address) {
        return this.run(
            'INSERT OR REPLACE INTO saved_addresses (user_id, label, address) VALUES (?, ?, ?)',
            [userId, label, address]
        );
    }

    async getSavedAddresses(userId) {
        return this.all('SELECT * FROM saved_addresses WHERE user_id = ?', [userId]);
    }

    // Migration helper - Complete migration from JSON files
    async migrateFromJson(dataManager) {
        console.log('🔄 Starting migration from JSON files...');
        
        try {
            // Temporarily disable foreign key constraints during migration
            await this.run('PRAGMA foreign_keys = OFF');
            // 1. Migrate users with settings and sol amounts
            const users = await dataManager.loadUsers() || {};
            const settings = await dataManager.loadSettings() || {};
            const solAmounts = await dataManager.loadSolAmounts() || {};
            
            // If no users in JSON, create a default user from traders data
            let usersToMigrate = users;
            if (Object.keys(users).length === 0) {
                const allTraders = await dataManager.loadTraders();
                if (allTraders && allTraders.user_traders) {
                    // Extract user IDs from traders data
                    for (const chatId of Object.keys(allTraders.user_traders)) {
                        usersToMigrate[chatId] = `User_${chatId}`;
                    }
                }
            }
            
            for (const [chatId, userData] of Object.entries(usersToMigrate)) {
                const userSettings = settings.userSettings?.[chatId] || {};
                const solAmount = solAmounts[chatId] || 0.001;
                const primaryWalletLabel = userSettings.primaryCopyWalletLabel || settings.primaryCopyWalletLabel || 'zap';
                
                await this.createUserComplete(chatId, {
                    username: userData,
                    settings: JSON.stringify(userSettings),
                    sol_amount: solAmount,
                    primary_wallet_label: primaryWalletLabel
                });
            }

            // 2. Migrate traders
            const allTraders = await dataManager.loadTraders();
            if (allTraders && allTraders.user_traders) {
                for (const [chatId, userTraders] of Object.entries(allTraders.user_traders)) {
                    const user = await this.getUser(chatId);
                    if (user && userTraders) {
                        for (const [name, traderData] of Object.entries(userTraders)) {
                            await this.addTrader(user.id, name, traderData.wallet, traderData.active !== false);
                        }
                    }
                }
            }

            // 3. Migrate positions
            const positions = await dataManager.loadPositions();
            for (const [chatId, userPositions] of Object.entries(positions)) {
                const user = await this.getUser(chatId);
                if (user && userPositions) {
                    for (const [tokenMint, position] of Object.entries(userPositions)) {
                        // Convert BigInt values to strings for database storage
                        const positionData = {
                            amountRaw: typeof position.amountRaw === 'bigint' ? position.amountRaw.toString() : String(position.amountRaw || '0'),
                            solSpent: position.solSpent || 0,
                            soldAmountRaw: typeof position.soldAmountRaw === 'bigint' ? position.soldAmountRaw.toString() : String(position.soldAmountRaw || '0'),
                            buyTimestamp: position.buyTimestamp || null,
                            sellTimestamp: position.sellTimestamp || null
                        };
                        await this.createPosition(user.id, tokenMint, positionData);
                    }
                }
            }

            // 4. Migrate trade stats
            const tradeStats = await dataManager.loadTradeStats();
            if (tradeStats && Object.keys(tradeStats).length > 0) {
                const firstUser = await this.run('SELECT * FROM users ORDER BY id LIMIT 1');
                if (firstUser) {
                    await this.createTradeStats(firstUser.id, tradeStats);
                }
            }

            // 5. Migrate withdrawal history
            const withdrawalHistory = await dataManager.loadWithdrawalHistory();
            if (Array.isArray(withdrawalHistory)) {
                const firstUser = await this.run('SELECT * FROM users ORDER BY id LIMIT 1');
                if (firstUser) {
                    for (const withdrawal of withdrawalHistory) {
                        await this.createWithdrawal(firstUser.id, withdrawal);
                    }
                }
            }

            // 6. Migrate processed pools
            const processedPools = await dataManager.loadProcessedPools();
            if (Array.isArray(processedPools)) {
                for (const poolAddress of processedPools) {
                    await this.addProcessedPool(poolAddress);
                }
            }

            // Re-enable foreign key constraints
            await this.run('PRAGMA foreign_keys = ON');
            
            console.log('✅ Migration completed successfully');
            
        } catch (error) {
            // Re-enable foreign key constraints even on error
            await this.run('PRAGMA foreign_keys = ON');
            console.error('❌ Migration failed:', error);
            throw error;
        }
    }

    async close() {
        if (this.db) {
            return new Promise((resolve) => {
                this.db.close(resolve);
            });
        }
    }
}

export { DatabaseManager };
