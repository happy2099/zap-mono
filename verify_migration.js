const { dataManager } = require('./database/dataManager');

class MigrationVerifier {
    constructor() {
        this.dbManager = new dataManager();
    }

    async initialize() {
        await this.dbManager.initialize();
        console.log('✅ Database connected for verification');
    }

    async showMigrationSummary() {
        console.log('\n📋 Migration Summary Report');
        console.log('==========================');
        
        // Get counts
        const users = await this.dbManager.all('SELECT COUNT(*) as count FROM users');
        const traders = await this.dbManager.all('SELECT COUNT(*) as count FROM traders');
        const wallets = await this.dbManager.all('SELECT COUNT(*) as count FROM user_wallets');
        const positions = await this.dbManager.all('SELECT COUNT(*) as count FROM user_positions');
        const tradeStats = await this.dbManager.all('SELECT COUNT(*) as count FROM trade_stats');
        const settings = await this.dbManager.all('SELECT COUNT(*) as count FROM user_trading_settings');
        
        console.log(`👤 Users: ${users[0].count}`);
        console.log(`👥 Traders: ${traders[0].count}`);
        console.log(`💰 Wallets: ${wallets[0].count}`);
        console.log(`📈 Positions: ${positions[0].count}`);
        console.log(`📊 Trade Stats: ${tradeStats[0].count}`);
        console.log(`⚙️  Trading Settings: ${settings[0].count}`);
    }

    async showDetailedData() {
        console.log('\n📊 Detailed Data Report');
        console.log('=======================');
        
        // Show users
        console.log('\n👤 Users:');
        const users = await this.dbManager.all('SELECT * FROM users');
        for (const user of users) {
            console.log(`  - Chat ID: ${user.chat_id}, Name: ${user.first_name || 'N/A'} ${user.last_name || ''}, Username: ${user.telegram_username || 'N/A'}, Admin: ${user.is_admin ? 'Yes' : 'No'}`);
        }
        
        // Show traders
        console.log('\n👥 Traders:');
        const traders = await this.dbManager.all(`
            SELECT t.*, u.chat_id 
            FROM traders t 
            JOIN users u ON t.user_id = u.id
        `);
        for (const trader of traders) {
            console.log(`  - User: ${trader.chat_id}, Name: ${trader.name}, Wallet: ${trader.wallet}, Active: ${trader.active ? 'Yes' : 'No'}`);
        }
        
        // Show wallets
        console.log('\n💰 Wallets:');
        const wallets = await this.dbManager.all(`
            SELECT w.*, u.chat_id 
            FROM user_wallets w 
            JOIN users u ON w.user_id = u.id
        `);
        for (const wallet of wallets) {
            console.log(`  - User: ${wallet.chat_id}, Label: ${wallet.label}, Public Key: ${wallet.public_key}, Balance: ${wallet.balance}`);
        }
        
        // Show trade stats
        console.log('\n📊 Trade Statistics:');
        const tradeStats = await this.dbManager.all(`
            SELECT ts.*, u.chat_id 
            FROM trade_stats ts 
            JOIN users u ON ts.user_id = u.id
        `);
        for (const stat of tradeStats) {
            console.log(`  - User: ${stat.chat_id}, Total Trades: ${stat.total_trades}, Successful: ${stat.successful_copies}, Failed: ${stat.failed_copies}, Under 10s: ${stat.trades_under_10secs} (${stat.percentage_under_10secs}%)`);
        }
        
        // Show positions
        console.log('\n📈 Positions:');
        const positions = await this.dbManager.all(`
            SELECT p.*, u.chat_id 
            FROM user_positions p 
            JOIN users u ON p.user_id = u.id
        `);
        for (const position of positions) {
            console.log(`  - User: ${position.chat_id}, Token: ${position.token_mint}, Amount: ${position.amount_raw}, SOL Spent: ${position.sol_spent}`);
        }
    }

    async verifyDataIntegrity() {
        console.log('\n🔍 Data Integrity Check');
        console.log('======================');
        
        // Check for orphaned records
        const orphanedTraders = await this.dbManager.all(`
            SELECT t.* FROM traders t 
            LEFT JOIN users u ON t.user_id = u.id 
            WHERE u.id IS NULL
        `);
        
        const orphanedWallets = await this.dbManager.all(`
            SELECT w.* FROM user_wallets w 
            LEFT JOIN users u ON w.user_id = u.id 
            WHERE u.id IS NULL
        `);
        
        const orphanedPositions = await this.dbManager.all(`
            SELECT p.* FROM user_positions p 
            LEFT JOIN users u ON p.user_id = u.id 
            WHERE u.id IS NULL
        `);
        
        console.log(`Orphaned traders: ${orphanedTraders.length}`);
        console.log(`Orphaned wallets: ${orphanedWallets.length}`);
        console.log(`Orphaned positions: ${orphanedPositions.length}`);
        
        if (orphanedTraders.length === 0 && orphanedWallets.length === 0 && orphanedPositions.length === 0) {
            console.log('✅ All data integrity checks passed!');
        } else {
            console.log('⚠️  Found orphaned records that need attention');
        }
    }

    async runVerification() {
        try {
            await this.initialize();
            await this.showMigrationSummary();
            await this.showDetailedData();
            await this.verifyDataIntegrity();
            
            console.log('\n🎉 Verification completed successfully!');
            
        } catch (error) {
            console.error('❌ Verification failed:', error);
            throw error;
        } finally {
            await this.dbManager.close();
        }
    }
}

// Run verification if this script is executed directly
if (require.main === module) {
    const verifier = new MigrationVerifier();
    verifier.runVerification()
        .then(() => {
            console.log('✅ Verification script completed successfully!');
            process.exit(0);
        })
        .catch((error) => {
            console.error('💥 Verification script failed:', error);
            process.exit(1);
        });
}

module.exports = { MigrationVerifier };
