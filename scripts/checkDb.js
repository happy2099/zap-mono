// ==========================================
// ========== Database Check Script ==========
// ==========================================
// File: scripts/checkDb.js
// Description: Check database contents after migration

const { dataManager } = require('../database/dataManager');

async function checkDatabase() {
    const db = new dataManager();
    await db.initialize();
    
    console.log('📊 Database Contents:');
    console.log('====================');
    
    try {
        // Check users
        const users = await db.all('SELECT * FROM users');
        console.log(`\n👥 Users (${users.length}):`);
        users.forEach(user => {
            console.log(`  - ID: ${user.id}, Chat ID: ${user.chat_id}, Settings: ${user.settings}`);
        });
        
        // Check traders
        const traders = await db.all('SELECT * FROM traders');
        console.log(`\n📈 Traders (${traders.length}):`);
        traders.forEach(trader => {
            console.log(`  - ID: ${trader.id}, User ID: ${trader.user_id}, Name: ${trader.name}, Wallet: ${trader.wallet}, Active: ${trader.active}`);
        });
        
        // Check trades
        const trades = await db.all('SELECT * FROM trades');
        console.log(`\n📊 Trades (${trades.length}):`);
        trades.forEach(trade => {
            console.log(`  - ID: ${trade.id}, User ID: ${trade.user_id}, Signature: ${trade.signature}, Platform: ${trade.platform}`);
        });
        
        // Check trade stats
        const tradeStats = await db.all('SELECT * FROM trade_stats');
        console.log(`\n📈 Trade Stats (${tradeStats.length}):`);
        tradeStats.forEach(stat => {
            console.log(`  - User ID: ${stat.user_id}, Total Trades: ${stat.total_trades}, Successful: ${stat.successful_copies}`);
        });
        
        // Check withdrawals
        const withdrawals = await db.all('SELECT * FROM withdrawals');
        console.log(`\n💰 Withdrawals (${withdrawals.length}):`);
        withdrawals.forEach(withdrawal => {
            console.log(`  - ID: ${withdrawal.id}, User ID: ${withdrawal.user_id}, Amount: ${withdrawal.amount}`);
        });
        
    } catch (error) {
        console.error('❌ Error checking database:', error);
    } finally {
        await db.close();
    }
}

checkDatabase().catch(console.error);

