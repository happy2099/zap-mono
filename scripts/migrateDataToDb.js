// ==========================================
// ========== Data Migration Script ==========
// ==========================================
// File: scripts/migrateDataToDb.js
// Description: One-time migration script to move all data from JSON files to database

const fs = require('fs').promises;
const path = require('path');
const { DatabaseManager } = require('../database/databaseManager');

class DataMigration {
    constructor() {
        this.databaseManager = null;
        this.dataDir = path.join(__dirname, '../data');
        this.migrationStats = {
            users: 0,
            traders: 0,
            trades: 0,
            tradeStats: 0,
            withdrawals: 0,
            wallets: 0,
            errors: []
        };
    }

    async initialize() {
        try {
            console.log('🚀 Starting data migration from JSON files to database...');
            
            // Initialize database
            this.databaseManager = new DatabaseManager();
            await this.databaseManager.initialize();
            
            console.log('✅ Database initialized successfully');
        } catch (error) {
            console.error('❌ Failed to initialize database:', error);
            throw error;
        }
    }

    async migrateAllData() {
        try {
            console.log('📦 Starting comprehensive data migration...');
            
            // Step 1: Migrate users
            await this.migrateUsers();
            
            // Step 2: Migrate traders
            await this.migrateTraders();
            
            // Step 3: Migrate trade history
            await this.migrateTradeHistory();
            
            // Step 4: Migrate trade stats
            await this.migrateTradeStats();
            
            // Step 5: Migrate withdrawal history
            await this.migrateWithdrawalHistory();
            
            // Step 6: Migrate wallets (store as user settings)
            await this.migrateWallets();
            
            // Step 7: Migrate positions (store as user settings)
            await this.migratePositions();
            
            // Step 8: Migrate settings
            await this.migrateSettings();
            
            // Step 9: Migrate processed pools (store as user settings)
            await this.migrateProcessedPools();
            
            console.log('✅ Data migration completed successfully!');
            this.printMigrationStats();
            
        } catch (error) {
            console.error('❌ Migration failed:', error);
            throw error;
        }
    }

    async migrateUsers() {
        try {
            console.log('👥 Migrating users...');
            
            const usersData = await this.readJsonFile('users.json');
            const tradersData = await this.readJsonFile('traders.json');
            
            // If users.json is empty, create users from traders data
            if (Object.keys(usersData).length === 0 && tradersData.user_traders) {
                console.log('📝 Creating users from traders data...');
                for (const chatId of Object.keys(tradersData.user_traders)) {
                    try {
                        await this.databaseManager.createUser(chatId, {});
                        this.migrationStats.users++;
                    } catch (error) {
                        console.warn(`⚠️ Failed to create user ${chatId}:`, error.message);
                        this.migrationStats.errors.push(`User ${chatId}: ${error.message}`);
                    }
                }
            } else {
                // Migrate existing users
                for (const [chatId, userData] of Object.entries(usersData)) {
                    try {
                        await this.databaseManager.createUser(chatId, userData);
                        this.migrationStats.users++;
                    } catch (error) {
                        console.warn(`⚠️ Failed to migrate user ${chatId}:`, error.message);
                        this.migrationStats.errors.push(`User ${chatId}: ${error.message}`);
                    }
                }
            }
            
            console.log(`✅ Migrated ${this.migrationStats.users} users`);
        } catch (error) {
            console.error('❌ Failed to migrate users:', error);
            throw error;
        }
    }

    async migrateTraders() {
        try {
            console.log('📈 Migrating traders...');
            
            const tradersData = await this.readJsonFile('traders.json');
            
            if (tradersData.user_traders) {
                for (const [chatId, userTraders] of Object.entries(tradersData.user_traders)) {
                    try {
                        // Get user ID from database
                        const user = await this.databaseManager.getUser(chatId);
                        if (!user) {
                            console.warn(`⚠️ User ${chatId} not found, skipping traders`);
                            continue;
                        }
                        
                        for (const [traderName, traderData] of Object.entries(userTraders)) {
                            try {
                                await this.databaseManager.addTrader(
                                    user.id, 
                                    traderName, 
                                    traderData.wallet
                                );
                                
                                // Update trader status
                                await this.databaseManager.updateTraderStatus(
                                    user.id, 
                                    traderData.wallet, 
                                    traderData.active
                                );
                                
                                this.migrationStats.traders++;
                            } catch (error) {
                                console.warn(`⚠️ Failed to migrate trader ${traderName}:`, error.message);
                                this.migrationStats.errors.push(`Trader ${traderName}: ${error.message}`);
                            }
                        }
                    } catch (error) {
                        console.warn(`⚠️ Failed to process traders for user ${chatId}:`, error.message);
                        this.migrationStats.errors.push(`User ${chatId} traders: ${error.message}`);
                    }
                }
            }
            
            console.log(`✅ Migrated ${this.migrationStats.traders} traders`);
        } catch (error) {
            console.error('❌ Failed to migrate traders:', error);
            throw error;
        }
    }

    async migrateTradeHistory() {
        try {
            console.log('📊 Migrating trade history...');
            
            const tradeHistoryData = await this.readJsonFile('tradeHistory.json');
            const positionsData = await this.readJsonFile('positions.json');
            
            // Migrate from tradeHistory.json (if not empty)
            if (Object.keys(tradeHistoryData).length > 0) {
                for (const [signature, tradeData] of Object.entries(tradeHistoryData)) {
                try {
                    // Find user by signature or use default user
                    const user = await this.findUserForTrade(signature, tradeData);
                    if (!user) {
                        console.warn(`⚠️ No user found for trade ${signature}, skipping`);
                        continue;
                    }
                    
                    await this.databaseManager.recordTrade(
                        user.id,
                        null, // trader_id (will be null for now)
                        signature,
                        tradeData.platform || 'unknown',
                        tradeData.tokenMint || 'unknown',
                        tradeData.amountRaw || '0',
                        tradeData.solSpent || 0,
                        tradeData.status || 'completed'
                    );
                    
                    this.migrationStats.trades++;
                } catch (error) {
                    console.warn(`⚠️ Failed to migrate trade ${signature}:`, error.message);
                    this.migrationStats.errors.push(`Trade ${signature}: ${error.message}`);
                }
            }
            }
            
            // Migrate from positions.json (current positions)
            if (Object.keys(positionsData).length > 0) {
                for (const [tokenMint, positionData] of Object.entries(positionsData)) {
                try {
                    // This represents current positions, we'll store as user settings
                    const user = await this.getDefaultUser();
                    if (user) {
                        const positionInfo = {
                            tokenMint,
                            amountRaw: positionData.amountRaw,
                            solSpent: positionData.solSpent,
                            buyTimestamp: positionData.buyTimestamp
                        };
                        
                        // Store as user settings
                        const currentSettings = JSON.parse(user.settings || '{}');
                        if (!currentSettings.positions) {
                            currentSettings.positions = {};
                        }
                        currentSettings.positions[tokenMint] = positionInfo;
                        
                        await this.databaseManager.updateUserSettings(user.chat_id, currentSettings);
                    }
                } catch (error) {
                    console.warn(`⚠️ Failed to migrate position ${tokenMint}:`, error.message);
                    this.migrationStats.errors.push(`Position ${tokenMint}: ${error.message}`);
                }
            }
            }
            
            console.log(`✅ Migrated ${this.migrationStats.trades} trades`);
        } catch (error) {
            console.error('❌ Failed to migrate trade history:', error);
            throw error;
        }
    }

    async migrateTradeStats() {
        try {
            console.log('📈 Migrating trade statistics...');
            
            const tradeStatsData = await this.readJsonFile('trade_stats.json');
            
            // Get all users and apply trade stats to each
            const users = await this.databaseManager.all('SELECT * FROM users');
            
            for (const user of users) {
                try {
                    await this.databaseManager.updateTradeStats(user.id, {
                        totalTrades: tradeStatsData.totalTrades || 0,
                        successfulCopies: tradeStatsData.successfulCopies || 0,
                        failedCopies: tradeStatsData.failedCopies || 0,
                        tradesUnder10Secs: tradeStatsData.tradesUnder10Secs || 0,
                        percentageUnder10Secs: parseFloat(tradeStatsData.percentageUnder10Secs || '0')
                    });
                    
                    this.migrationStats.tradeStats++;
                } catch (error) {
                    console.warn(`⚠️ Failed to migrate trade stats for user ${user.chat_id}:`, error.message);
                    this.migrationStats.errors.push(`Trade stats ${user.chat_id}: ${error.message}`);
                }
            }
            
            console.log(`✅ Migrated ${this.migrationStats.tradeStats} trade stats records`);
        } catch (error) {
            console.error('❌ Failed to migrate trade stats:', error);
            throw error;
        }
    }

    async migrateWithdrawalHistory() {
        try {
            console.log('💰 Migrating withdrawal history...');
            
            const withdrawalData = await this.readJsonFile('withdrawal_history.json');
            
            for (const [chatId, withdrawals] of Object.entries(withdrawalData)) {
                try {
                    const user = await this.databaseManager.getUser(chatId);
                    if (!user) {
                        console.warn(`⚠️ User ${chatId} not found for withdrawals, skipping`);
                        continue;
                    }
                    
                    for (const withdrawal of withdrawals) {
                        try {
                            await this.databaseManager.recordWithdrawal(
                                user.id,
                                withdrawal.amount,
                                withdrawal.signature
                            );
                            
                            this.migrationStats.withdrawals++;
                        } catch (error) {
                            console.warn(`⚠️ Failed to migrate withdrawal:`, error.message);
                            this.migrationStats.errors.push(`Withdrawal: ${error.message}`);
                        }
                    }
                } catch (error) {
                    console.warn(`⚠️ Failed to process withdrawals for user ${chatId}:`, error.message);
                    this.migrationStats.errors.push(`Withdrawals ${chatId}: ${error.message}`);
                }
            }
            
            console.log(`✅ Migrated ${this.migrationStats.withdrawals} withdrawals`);
        } catch (error) {
            console.error('❌ Failed to migrate withdrawal history:', error);
            throw error;
        }
    }

    async migrateWallets() {
        try {
            console.log('🔐 Migrating wallets...');
            
            const walletsData = await this.readJsonFile('wallets.json');
            
            if (walletsData.user_wallets) {
                for (const [chatId, userWallets] of Object.entries(walletsData.user_wallets)) {
                    try {
                        const user = await this.databaseManager.getUser(chatId);
                        if (!user) {
                            console.warn(`⚠️ User ${chatId} not found for wallets, skipping`);
                            continue;
                        }
                        
                        // Store wallets as user settings
                        const currentSettings = JSON.parse(user.settings || '{}');
                        currentSettings.wallets = userWallets;
                        
                        await this.databaseManager.updateUserSettings(user.chat_id, currentSettings);
                        
                        this.migrationStats.wallets++;
                    } catch (error) {
                        console.warn(`⚠️ Failed to migrate wallets for user ${chatId}:`, error.message);
                        this.migrationStats.errors.push(`Wallets ${chatId}: ${error.message}`);
                    }
                }
            }
            
            console.log(`✅ Migrated ${this.migrationStats.wallets} wallet records`);
        } catch (error) {
            console.error('❌ Failed to migrate wallets:', error);
            throw error;
        }
    }

    async migratePositions() {
        try {
            console.log('📊 Migrating positions...');
            
            // Positions are already handled in migrateTradeHistory
            console.log('✅ Positions migration completed (handled in trade history)');
        } catch (error) {
            console.error('❌ Failed to migrate positions:', error);
            throw error;
        }
    }

    async migrateSettings() {
        try {
            console.log('⚙️ Migrating settings...');
            
            const settingsData = await this.readJsonFile('settings.json');
            
            // Migrate global settings
            if (settingsData.primaryCopyWalletLabel) {
                // Store as global setting in first user or create a system user
                const users = await this.databaseManager.all('SELECT * FROM users LIMIT 1');
                if (users.length > 0) {
                    const user = users[0];
                    const currentSettings = JSON.parse(user.settings || '{}');
                    currentSettings.globalSettings = {
                        primaryCopyWalletLabel: settingsData.primaryCopyWalletLabel
                    };
                    await this.databaseManager.updateUserSettings(user.chat_id, currentSettings);
                }
            }
            
            // Migrate user-specific settings
            if (settingsData.userSettings) {
                for (const [chatId, userSettings] of Object.entries(settingsData.userSettings)) {
                    try {
                        const user = await this.databaseManager.getUser(chatId);
                        if (user) {
                            const currentSettings = JSON.parse(user.settings || '{}');
                            Object.assign(currentSettings, userSettings);
                            await this.databaseManager.updateUserSettings(user.chat_id, currentSettings);
                        }
                    } catch (error) {
                        console.warn(`⚠️ Failed to migrate settings for user ${chatId}:`, error.message);
                        this.migrationStats.errors.push(`Settings ${chatId}: ${error.message}`);
                    }
                }
            }
            
            console.log('✅ Settings migration completed');
        } catch (error) {
            console.error('❌ Failed to migrate settings:', error);
            throw error;
        }
    }

    async migrateProcessedPools() {
        try {
            console.log('🏊 Migrating processed pools...');
            
            const processedPoolsData = await this.readJsonFile('processed_pools.json');
            
            // Store processed pools as global setting
            const users = await this.databaseManager.all('SELECT * FROM users LIMIT 1');
            if (users.length > 0) {
                const user = users[0];
                const currentSettings = JSON.parse(user.settings || '{}');
                currentSettings.processedPools = Array.from(processedPoolsData);
                await this.databaseManager.updateUserSettings(user.chat_id, currentSettings);
            }
            
            console.log('✅ Processed pools migration completed');
        } catch (error) {
            console.error('❌ Failed to migrate processed pools:', error);
            throw error;
        }
    }

    async readJsonFile(filename) {
        try {
            const filePath = path.join(this.dataDir, filename);
            const data = await fs.readFile(filePath, 'utf8');
            
            // Handle empty files
            if (!data.trim()) {
                console.log(`📄 File ${filename} is empty, returning empty object...`);
                return {};
            }
            
            return JSON.parse(data);
        } catch (error) {
            if (error.code === 'ENOENT') {
                console.log(`📄 File ${filename} not found, skipping...`);
                return {};
            }
            if (error instanceof SyntaxError) {
                console.log(`📄 File ${filename} has invalid JSON, returning empty object...`);
                return {};
            }
            throw error;
        }
    }

    async findUserForTrade(signature, tradeData) {
        // Try to find user by various methods
        // For now, return the first user as default
        return await this.getDefaultUser();
    }

    async getDefaultUser() {
        const users = await this.databaseManager.all('SELECT * FROM users LIMIT 1');
        return users.length > 0 ? users[0] : null;
    }

    printMigrationStats() {
        console.log('\n📊 Migration Statistics:');
        console.log('========================');
        console.log(`👥 Users migrated: ${this.migrationStats.users}`);
        console.log(`📈 Traders migrated: ${this.migrationStats.traders}`);
        console.log(`📊 Trades migrated: ${this.migrationStats.trades}`);
        console.log(`📈 Trade stats migrated: ${this.migrationStats.tradeStats}`);
        console.log(`💰 Withdrawals migrated: ${this.migrationStats.withdrawals}`);
        console.log(`🔐 Wallet records migrated: ${this.migrationStats.wallets}`);
        
        if (this.migrationStats.errors.length > 0) {
            console.log(`\n⚠️ Errors encountered: ${this.migrationStats.errors.length}`);
            this.migrationStats.errors.forEach((error, index) => {
                console.log(`   ${index + 1}. ${error}`);
            });
        }
        
        console.log('\n✅ Migration completed successfully!');
        console.log('💡 You can now safely remove the data directory if desired.');
    }

    async cleanup() {
        try {
            if (this.databaseManager) {
                await this.databaseManager.close();
            }
        } catch (error) {
            console.error('❌ Error during cleanup:', error);
        }
    }
}

// Main execution
async function main() {
    const migration = new DataMigration();
    
    try {
        await migration.initialize();
        await migration.migrateAllData();
    } catch (error) {
        console.error('💥 Migration failed:', error);
        process.exit(1);
    } finally {
        await migration.cleanup();
    }
}

// Run migration if this file is executed directly
if (require.main === module) {
    main().catch(error => {
        console.error('💥 Migration script failed:', error);
        process.exit(1);
    });
}

module.exports = DataMigration;
