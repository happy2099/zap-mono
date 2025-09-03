// ==========================================
// Database Schema Migration Script
// ==========================================
// Migrates from current schema to improved normalized schema

const { DatabaseManager } = require('../database/databaseManager');
const fs = require('fs');
const path = require('path');

class SchemaMigration {
    constructor() {
        this.db = new DatabaseManager();
    }

    async initialize() {
        await this.db.initialize();
        console.log('✅ Database connection established for migration');
    }

    async backupCurrentData() {
        console.log('📦 Creating backup of current data...');
        
        const backup = {
            users: await this.db.all('SELECT * FROM users'),
            traders: await this.db.all('SELECT * FROM traders'),
            trades: await this.db.all('SELECT * FROM trades'),
            trade_stats: await this.db.all('SELECT * FROM trade_stats'),
            withdrawals: await this.db.all('SELECT * FROM withdrawals')
        };

        const backupPath = path.join(__dirname, `../database/backup_${Date.now()}.json`);
        await fs.promises.writeFile(backupPath, JSON.stringify(backup, null, 2));
        console.log(`✅ Backup created at: ${backupPath}`);
        
        return backup;
    }

    async migrateToImprovedSchema() {
        console.log('🔄 Starting schema migration...');

        // Step 1: Backup current data
        const backup = await this.backupCurrentData();

        // Step 2: Create new tables (only the new ones)
        console.log('📋 Creating new normalized tables...');
        await this.createNewTablesOnly();

        // Step 3: Migrate data from settings JSON to new tables
        console.log('🔄 Migrating data from settings JSON to new tables...');
        await this.migrateSettingsToNewTables(backup);

        console.log('✅ Schema migration completed successfully!');
    }

    async createNewTablesOnly() {
        // Create only the new normalized tables
        const newTables = [
            `CREATE TABLE IF NOT EXISTS user_wallets (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                label TEXT NOT NULL,
                public_key TEXT NOT NULL,
                private_key_encrypted TEXT,

                balance REAL DEFAULT 0.0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                UNIQUE(user_id, public_key)
            )`,
            
            `CREATE TABLE IF NOT EXISTS user_trading_settings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                sol_amount REAL DEFAULT 0.1,
                max_trades_per_day INTEGER DEFAULT 10,
                risk_level TEXT DEFAULT 'medium',
                auto_stop_loss REAL DEFAULT 0.0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                UNIQUE(user_id)
            )`,
            
            `CREATE TABLE IF NOT EXISTS user_positions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                token_mint TEXT NOT NULL,
                token_symbol TEXT,
                amount_raw TEXT NOT NULL,
                sol_spent REAL NOT NULL,
                current_value REAL DEFAULT 0.0,
                entry_price REAL,
                current_price REAL DEFAULT 0.0,
                pnl REAL DEFAULT 0.0,
                is_active BOOLEAN DEFAULT 1,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                UNIQUE(user_id, token_mint)
            )`
        ];

        for (const tableSQL of newTables) {
            await this.db.run(tableSQL);
        }

        // Create indexes
        const indexes = [
            'CREATE INDEX IF NOT EXISTS idx_user_wallets_user_id ON user_wallets(user_id)',

            'CREATE INDEX IF NOT EXISTS idx_user_trading_settings_user_id ON user_trading_settings(user_id)',
            'CREATE INDEX IF NOT EXISTS idx_user_positions_user_id ON user_positions(user_id)',
            'CREATE INDEX IF NOT EXISTS idx_user_positions_active ON user_positions(user_id, is_active)'
        ];

        for (const indexSQL of indexes) {
            await this.db.run(indexSQL);
        }
    }

    async createImprovedTables() {
        const improvedSchemaPath = path.join(__dirname, '../database/improved_schema.sql');
        const schema = await fs.promises.readFile(improvedSchemaPath, 'utf8');
        
        // Split by semicolon and execute each statement
        const statements = schema.split(';').filter(stmt => stmt.trim());
        
        for (const statement of statements) {
            if (statement.trim()) {
                await this.db.run(statement.trim());
            }
        }
    }

    async migrateSettingsToNewTables(backup) {
        // Migrate data from settings JSON to new normalized tables
        for (const user of backup.users) {
            const settings = JSON.parse(user.settings || '{}');
            
            console.log(`   Migrating user ${user.chat_id}...`);

            // Migrate trading settings
            if (settings.solAmount !== undefined) {
                try {
                    await this.db.run(
                        'INSERT OR REPLACE INTO user_trading_settings (user_id, sol_amount, created_at, updated_at) VALUES (?, ?, ?, ?)',
                        [user.id, settings.solAmount, user.created_at, user.updated_at]
                    );
                    console.log(`     ✅ Migrated trading settings for user ${user.chat_id}`);
                } catch (error) {
                    console.log(`     ⚠️ Could not migrate trading settings for user ${user.chat_id}: ${error.message}`);
                }
            }

            // Migrate wallets (if any in settings)
            if (settings.wallets) {
                for (const [label, walletData] of Object.entries(settings.wallets)) {
                    try {
                        await this.db.run(
                            'INSERT OR REPLACE INTO user_wallets (user_id, label, public_key, private_key_encrypted, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
                            [
                                user.id, 
                                label, 
                                walletData.publicKey, 
                                walletData.privateKey || null,
                                user.created_at, 
                                user.updated_at
                            ]
                        );
                        console.log(`     ✅ Migrated wallet ${label} for user ${user.chat_id}`);
                    } catch (error) {
                        console.log(`     ⚠️ Could not migrate wallet ${label} for user ${user.chat_id}: ${error.message}`);
                    }
                }
            }

            // Migrate positions (if any in settings)
            if (settings.positions) {
                for (const [mint, position] of Object.entries(settings.positions)) {
                    try {
                        await this.db.run(
                            'INSERT OR REPLACE INTO user_positions (user_id, token_mint, token_symbol, amount_raw, sol_spent, current_value, entry_price, current_price, pnl, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                            [
                                user.id,
                                mint,
                                position.symbol || null,
                                position.amountRaw || '0',
                                position.solSpent || 0,
                                position.currentValue || 0,
                                position.entryPrice || 0,
                                position.currentPrice || 0,
                                position.pnl || 0,
                                1, // is_active
                                user.created_at,
                                user.updated_at
                            ]
                        );
                        console.log(`     ✅ Migrated position ${mint} for user ${user.chat_id}`);
                    } catch (error) {
                        console.log(`     ⚠️ Could not migrate position ${mint} for user ${user.chat_id}: ${error.message}`);
                    }
                }
            }
        }
    }

    async verifyMigration() {
        console.log('🔍 Verifying migration...');
        
        const userCount = await this.db.get('SELECT COUNT(*) as count FROM users');
        const traderCount = await this.db.get('SELECT COUNT(*) as count FROM traders');
        const walletCount = await this.db.get('SELECT COUNT(*) as count FROM user_wallets');
        const settingsCount = await this.db.get('SELECT COUNT(*) as count FROM user_trading_settings');
        const positionCount = await this.db.get('SELECT COUNT(*) as count FROM user_positions');

        console.log('📊 Migration Results:');
        console.log(`   Users: ${userCount.count}`);
        console.log(`   Traders: ${traderCount.count}`);
        console.log(`   Wallets: ${walletCount.count}`);
        console.log(`   Trading Settings: ${settingsCount.count}`);
        console.log(`   Positions: ${positionCount.count}`);

        // Test a sample query
        const sampleUser = await this.db.get(`
            SELECT 
                u.chat_id,
                uts.sol_amount,
                uw.label as wallet
            FROM users u
            LEFT JOIN user_trading_settings uts ON u.id = uts.user_id
            LEFT JOIN user_wallets uw ON u.id = uw.user_id ORDER BY uw.id ASC LIMIT 1
            LIMIT 1
        `);

        if (sampleUser) {
            console.log('✅ Sample query successful:', sampleUser);
        }
    }

    async cleanup() {
        await this.db.close();
        console.log('✅ Database connection closed');
    }
}

// Run migration if called directly
if (require.main === module) {
    const migration = new SchemaMigration();
    
    migration.initialize()
        .then(() => migration.migrateToImprovedSchema())
        .then(() => migration.verifyMigration())
        .then(() => migration.cleanup())
        .catch(error => {
            console.error('❌ Migration failed:', error);
            process.exit(1);
        });
}

module.exports = SchemaMigration;
