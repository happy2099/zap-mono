// ==========================================
// ========== ZapBot DatabaseManager ==========
// ==========================================
// File: database/databaseManager.js
// Description: Lightweight SQLite database manager for ZapBot

const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs/promises');

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

    async updateUserSettings(chatId, settings) {
        await this.run(
            'UPDATE users SET settings = ?, updated_at = CURRENT_TIMESTAMP WHERE chat_id = ?',
            [JSON.stringify(settings), chatId]
        );
    }

    // Trader management
    async addTrader(userId, name, wallet) {
        return await this.run(
            'INSERT OR REPLACE INTO traders (user_id, name, wallet, active, updated_at) VALUES (?, ?, ?, 1, CURRENT_TIMESTAMP)',
            [userId, name, wallet]
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

    // Migration helper
    async migrateFromJson(dataManager) {
        console.log('🔄 Starting migration from JSON files...');
        
        try {
            // Migrate users
            const users = await dataManager.loadUsers();
            for (const [chatId, userData] of Object.entries(users)) {
                await this.createUser(chatId, userData);
            }

            // Migrate traders
            const allTraders = await dataManager.loadTraders();
            for (const [chatId, userTraders] of Object.entries(allTraders.user_traders || {})) {
                const user = await this.getUser(chatId);
                if (user) {
                    for (const [name, traderData] of Object.entries(userTraders)) {
                        await this.addTrader(user.id, name, traderData.wallet);
                    }
                }
            }

            // Migrate trade stats
            const tradeStats = await dataManager.loadTradeStats();
            // Note: This would need to be mapped to specific users

            console.log('✅ Migration completed successfully');
            
        } catch (error) {
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

module.exports = { DatabaseManager };
