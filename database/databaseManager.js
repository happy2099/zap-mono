// ==========================================
// ========== ZapBot DatabaseManager ==========
// ==========================================
// File: database/databaseManager.js
// Description: Lightweight SQLite database manager for ZapBot

const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs/promises');
const BN = require('bn.js');

class DatabaseManager {
    constructor() {
        this.dbPath = path.join(__dirname, 'zapbot.db');
        this.db = null;
        this.isInitialized = false;
        this.logger = {
            info: (msg, data) => console.log(`[DB] ${msg}`, data ? JSON.stringify(data) : ''),
            error: (msg, data) => console.error(`[DB] ${msg}`, data ? JSON.stringify(data) : ''),
            warn: (msg, data) => console.warn(`[DB] ${msg}`, data ? JSON.stringify(data) : ''),
            debug: (msg, data) => console.log(`[DB DEBUG] ${msg}`, data ? JSON.stringify(data) : '')
        };
    }

async initialize() {
    try {
        // Ensure the directory for the database file exists
        await fs.mkdir(path.dirname(this.dbPath), { recursive: true });

        // Step 1: Create a promise-based function to open the database connection
        const openDb = () => new Promise((resolve, reject) => {
            this.db = new sqlite3.Database(this.dbPath, (err) => {
                if (err) {
                    console.error('❌ Database connection failed:', err.message);
                    reject(err);
                } else {
                    this.logger.info(`Database connected successfully at ${this.dbPath}`);
                    resolve(this.db);
                }
            });
        });

        // Step 2: Await the connection itself. The code will NOT proceed until this is done.
        await openDb();

        // Step 3: Now that we have a confirmed connection, run the setup commands.
        await this.run('PRAGMA foreign_keys = ON');
        await this.createTables();
        
        this.isInitialized = true;
        this.logger.info('DatabaseManager initialized successfully');
        
    } catch (error) {
        console.error('❌ DatabaseManager initialization failed:', error);
        throw error; // Re-throw to halt bot startup on DB failure
    }
}

    async createTables() {
        const schemaPath = path.join(__dirname, 'schema.sql');
        const schema = await fs.readFile(schemaPath, 'utf8');
        
        // Split schema into individual statements and filter out comments and empty statements
        const statements = schema
            .split(';')
            .map(stmt => stmt.trim())
            .filter(stmt => stmt && !stmt.startsWith('--') && stmt.length > 0);
        
        for (const statement of statements) {
            try {
                await this.run(statement);
            } catch (error) {
                console.error(`[DB] Error executing statement: ${statement.substring(0, 100)}...`);
                throw error;
            }
        }
        
        this.logger.info('Database tables created successfully');
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

    // Enhanced logging methods
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

    // User management
    async createUser(chatId, userData = {}) {
        const { firstName, lastName, telegramUsername, isActive = true, isAdmin = false } = userData;
        const result = await this.run(
            'INSERT OR REPLACE INTO users (chat_id, first_name, last_name, telegram_username, is_active, is_admin, updated_at) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)',
            [parseInt(chatId), firstName || null, lastName || null, telegramUsername || null, isActive ? 1 : 0, isAdmin ? 1 : 0]
        );
        return result.id;
    }

    async getUser(chatId) {
        return await this.get('SELECT * FROM users WHERE chat_id = ?', [parseInt(chatId)]);
    }

    async updateUserSettings(chatId, settings) {
        // For backward compatibility, we'll store settings in user_trading_settings table
        // First get the user to get the internal user ID
        const user = await this.getUser(chatId);
        if (!user) {
            throw new Error(`User with chat_id ${chatId} not found`);
        }
        
        // Update or insert into user_trading_settings table
        await this.run(
            'INSERT OR REPLACE INTO user_trading_settings (user_id, sol_amount_per_trade, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)',
            [user.id, settings.solAmount || 0.1]
        );
    }

    async updateUserData(chatId, userData) {
        const { firstName, lastName, telegramUsername, isActive, isAdmin } = userData;
        const updates = [];
        const params = [];
        
        if (firstName !== undefined) {
            updates.push('first_name = ?');
            params.push(firstName);
        }
        if (lastName !== undefined) {
            updates.push('last_name = ?');
            params.push(lastName);
        }
        if (telegramUsername !== undefined) {
            updates.push('telegram_username = ?');
            params.push(telegramUsername);
        }
        if (isActive !== undefined) {
            updates.push('is_active = ?');
            params.push(isActive ? 1 : 0);
        }
        if (isAdmin !== undefined) {
            updates.push('is_admin = ?');
            params.push(isAdmin ? 1 : 0);
        }
        
        if (updates.length === 0) {
            return; // No updates to make
        }
        
        updates.push('updated_at = CURRENT_TIMESTAMP');
        params.push(parseInt(chatId));
        
        await this.run(
            `UPDATE users SET ${updates.join(', ')} WHERE chat_id = ?`,
            params
        );
    }

    // Trader management
    async addTrader(userId, name, wallet) {
        return await this.run(
            'INSERT OR REPLACE INTO traders (user_id, name, wallet, active, updated_at) VALUES (?, ?, ?, 1, CURRENT_TIMESTAMP)',
            [userId, name, wallet]
        );
    }

    async getTraders(userIdOrChatId) {
        this.logger.debug(`getTraders called with: ${userIdOrChatId} (type: ${typeof userIdOrChatId})`);
        
        // Convert to string for consistent handling
        const idStr = userIdOrChatId.toString();
        this.logger.debug(`Converted to string: ${idStr} (length: ${idStr.length})`);
        
        // Handle both user ID and chat ID
        // Chat IDs are typically long numbers (10+ digits), user IDs are small integers (1, 2, 3, etc.)
        if (idStr.length >= 10) {
            // It's a chat ID, get user first
            this.logger.debug(`Processing as chatId: ${idStr}`);
            const user = await this.getUser(idStr);
            if (!user) {
                this.logger.debug(`No user found for chatId: ${idStr}`);
                return [];
            }
            this.logger.debug(`Found user ${user.id} for chatId: ${idStr}`);
            const traders = await this.all('SELECT * FROM traders WHERE user_id = ?', [user.id]);
            this.logger.debug(`Found ${traders.length} traders for user ${user.id}`);
            return traders;
        } else {
            // It's a user ID
            this.logger.debug(`Processing as userId: ${idStr}`);
            return await this.all('SELECT * FROM traders WHERE user_id = ?', [userIdOrChatId]);
        }
    }

    async updateTraderStatus(chatId, traderName, active) {
        this.logger.debug(`updateTraderStatus called: chatId=${chatId}, traderName=${traderName}, active=${active}`);
        
        // First get the user to get the internal user ID
        const user = await this.getUser(chatId);
        if (!user) {
            throw new Error(`User with chat_id ${chatId} not found`);
        }
        
        const result = await this.run(
            'UPDATE traders SET active = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ? AND name = ?',
            [active ? 1 : 0, user.id, traderName]
        );
        
        this.logger.debug(`updateTraderStatus result: changes=${result.changes}, lastID=${result.lastID}`);
        
        if (result.changes === 0) {
            this.logger.warn(`No trader found with userId=${user.id} and name=${traderName}`);
        } else {
            this.logger.info(`Successfully updated trader ${traderName} to active=${active} for user ${user.id}`);
        }
        
        return result;
    }

    async deleteTrader(userId, traderName) {
        await this.run('DELETE FROM traders WHERE user_id = ? AND name = ?', [userId, traderName]);
    }

    // Wallet management methods
    async createWallet(userId, label, publicKey, privateKeyEncrypted) {
        // Check if wallet with this label already exists for this user
        const existingWallet = await this.get('SELECT id FROM user_wallets WHERE user_id = ? AND label = ?', [userId, label]);
        if (existingWallet) {
            throw new Error(`Wallet label "${label}" already exists for you.`);
        }
        
        return await this.run(
            'INSERT INTO user_wallets (user_id, label, public_key, private_key_encrypted) VALUES (?, ?, ?, ?)',
            [userId, label, publicKey, privateKeyEncrypted]
        );
    }

    async getUserWallets(chatId) {
        const user = await this.getUser(chatId);
        if (!user) return [];
        
        return await this.all('SELECT * FROM user_wallets WHERE user_id = ?', [user.id]);
    }

    async updateWalletBalance(walletId, balance) {
        await this.run('UPDATE user_wallets SET balance = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [balance, walletId]);
    }

    async deleteWallet(userId, walletId) {
        const result = await this.run('DELETE FROM user_wallets WHERE id = ? AND user_id = ?', [walletId, userId]);
        if (result.changes === 0) {
            throw new Error('Wallet not found or could not be deleted');
        }
        return result;
    }
    
    async deleteWalletByLabel(userId, label) {
        const result = await this.run('DELETE FROM user_wallets WHERE user_id = ? AND label = ?', [userId, label]);
        if (result.changes === 0) {
            throw new Error(`Wallet with label "${label}" not found or could not be deleted`);
        }
        return result;
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
        this.logger.info('Starting migration from JSON files...');
        
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

            this.logger.info('Migration completed successfully');
            
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

    // ==========================================
    // ========== Trading Engine Methods ==========
    // ==========================================

    async getTradersGroupedByUser() {
        const traders = await this.all(`
            SELECT u.chat_id, t.name, t.wallet, t.active
            FROM users u
            JOIN traders t ON u.id = t.user_id
            WHERE t.active = 1
        `);
        
        const grouped = {};
        for (const trader of traders) {
            if (!grouped[trader.chat_id]) {
                grouped[trader.chat_id] = [];
            }
            grouped[trader.chat_id].push({
                name: trader.name,
                wallet_address: trader.wallet,
                active: trader.active
            });
        }
        return grouped;
    }

    async loadTraders() {
        const traders = await this.all(`
            SELECT u.chat_id, t.name, t.wallet, t.active
            FROM users u
            JOIN traders t ON u.id = t.user_id
        `);
        
        const result = { user_traders: {} };
        for (const trader of traders) {
            if (!result.user_traders[trader.chat_id]) {
                result.user_traders[trader.chat_id] = {};
            }
            result.user_traders[trader.chat_id][trader.name] = {
                wallet: trader.wallet,
                active: trader.active
            };
        }
        return result;
    }

    async getUserSellDetails(chatId, tokenMint) {
        const user = await this.getUser(chatId);
        if (!user) return null;

        const position = await this.get(`
            SELECT * FROM user_positions 
            WHERE user_id = ? AND token_mint = ? AND amount_raw > 0
        `, [user.id, tokenMint]);

        if (!position) return null;

        return {
            amountToSellBN: new BN(position.amount_raw),
            originalSolSpent: position.sol_spent || 0
        };
    }

    async getUserPositions(chatId) {
        const user = await this.getUser(chatId);
        if (!user) return new Map();

        const positions = await this.all(`
            SELECT * FROM user_positions 
            WHERE user_id = ? AND amount_raw > 0
        `, [user.id]);

        const positionMap = new Map();
        for (const pos of positions) {
            positionMap.set(pos.token_mint, {
                amountRaw: BigInt(pos.amount_raw),
                solSpent: pos.sol_spent || 0
            });
        }
        return positionMap;
    }

    async loadSolAmounts() {
        const settings = await this.all(`
            SELECT u.chat_id, uts.sol_amount_per_trade
            FROM users u
            LEFT JOIN user_trading_settings uts ON u.id = uts.user_id
        `);
        
        const result = {};
        for (const setting of settings) {
            result[setting.chat_id] = setting.sol_amount_per_trade || 0.01;
        }
        return result;
    }

    async saveSolAmounts(amounts) {
        for (const [chatId, amount] of Object.entries(amounts)) {
            try {
                const user = await this.getUser(chatId);
                if (user) {
                    await this.run(`
                        INSERT OR REPLACE INTO user_trading_settings (user_id, sol_amount_per_trade, updated_at) 
                        VALUES (?, ?, CURRENT_TIMESTAMP)
                    `, [user.id, amount]);
                }
            } catch (error) {
                console.error(`Error saving SOL amount for user ${chatId}:`, error);
            }
        }
    }

    async recordBuyPosition(chatId, tokenMint, amountRaw, solSpent) {
        const user = await this.getUser(chatId);
        if (!user) throw new Error(`User with chat_id ${chatId} not found`);

        // Check if position already exists
        const existing = await this.get(`
            SELECT * FROM user_positions 
            WHERE user_id = ? AND token_mint = ?
        `, [user.id, tokenMint]);

        if (existing) {
            // Update existing position
            await this.run(`
                UPDATE user_positions 
                SET amount_raw = ?, sol_spent = ?, updated_at = CURRENT_TIMESTAMP
                WHERE user_id = ? AND token_mint = ?
            `, [amountRaw, solSpent, user.id, tokenMint]);
        } else {
            // Create new position
            await this.run(`
                INSERT INTO user_positions (user_id, token_mint, amount_raw, sol_spent, created_at, updated_at)
                VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            `, [user.id, tokenMint, amountRaw, solSpent]);
        }
    }

    async updatePositionAfterSell(chatId, tokenMint, amountSold, solFee, solReceived) {
        const user = await this.getUser(chatId);
        if (!user) throw new Error(`User with chat_id ${chatId} not found`);

        const position = await this.get(`
            SELECT * FROM user_positions 
            WHERE user_id = ? AND token_mint = ?
        `, [user.id, tokenMint]);

        if (!position) return;

        const newAmount = BigInt(position.amount_raw) - BigInt(amountSold);
        
        if (newAmount <= 0) {
            // Position fully sold, delete it
            await this.run(`
                DELETE FROM user_positions 
                WHERE user_id = ? AND token_mint = ?
            `, [user.id, tokenMint]);
        } else {
            // Update remaining amount
            await this.run(`
                UPDATE user_positions 
                SET amount_raw = ?, updated_at = CURRENT_TIMESTAMP
                WHERE user_id = ? AND token_mint = ?
            `, [newAmount.toString(), user.id, tokenMint]);
        }
    }

    async loadPositions() {
        const positions = await this.all(`
            SELECT u.chat_id, up.token_mint, up.amount_raw, up.sol_spent
            FROM users u
            JOIN user_positions up ON u.id = up.user_id
            WHERE up.amount_raw > 0
        `);
        
        const result = { user_positions: {} };
        for (const pos of positions) {
            if (!result.user_positions[pos.chat_id]) {
                result.user_positions[pos.chat_id] = {};
            }
            result.user_positions[pos.chat_id][pos.token_mint] = {
                amountRaw: BigInt(pos.amount_raw),
                solSpent: pos.sol_spent || 0
            };
        }
        return result;
    }

    async shutdown() {
        console.log('[DB] Shutting down database manager...');
        await this.close();
        console.log('[DB] Database manager shutdown complete');
    }
}

module.exports = { DatabaseManager };
