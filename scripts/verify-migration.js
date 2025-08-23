#!/usr/bin/env node

const { DatabaseManager } = require('../database/databaseManager.js');

async function verifyMigration() {
    const db = new DatabaseManager();
    
    try {
        await db.initialize();
        
        console.log('🔍 Verifying migration results...\n');
        
        // Check users
        const users = await db.all('SELECT COUNT(*) as count FROM users');
        console.log(`👥 Users: ${users[0].count}`);
        
        // Check traders
        const traders = await db.all('SELECT COUNT(*) as count FROM traders');
        console.log(`📈 Traders: ${traders[0].count}`);
        
        // Check positions
        const positions = await db.all('SELECT COUNT(*) as count FROM positions');
        console.log(`💰 Positions: ${positions[0].count}`);
        
        // Check trades
        const trades = await db.all('SELECT COUNT(*) as count FROM trades');
        console.log(`🔄 Trades: ${trades[0].count}`);
        
        // Check trade stats
        const tradeStats = await db.all('SELECT COUNT(*) as count FROM trade_stats');
        console.log(`📊 Trade Stats: ${tradeStats[0].count}`);
        
        // Check processed pools
        const pools = await db.all('SELECT COUNT(*) as count FROM processed_pools');
        console.log(`🏊 Processed Pools: ${pools[0].count}`);
        
        // Show sample data
        console.log('\n📋 Sample Data:');
        const sampleUser = await db.get('SELECT * FROM users LIMIT 1');
        if (sampleUser) {
            console.log(`   User: ${sampleUser.chat_id} (${sampleUser.username || 'No username'})`);
            console.log(`   SOL Amount: ${sampleUser.sol_amount}`);
            console.log(`   Wallet Label: ${sampleUser.primary_wallet_label}`);
        }
        
        const sampleTraders = await db.all('SELECT * FROM traders LIMIT 3');
        console.log(`   Traders: ${sampleTraders.map(t => t.name).join(', ')}`);
        
        const samplePositions = await db.all('SELECT token_mint, amount_raw, sol_spent FROM positions LIMIT 3');
        console.log(`   Positions: ${samplePositions.map(p => `${p.token_mint.slice(0,8)}... (${p.amount_raw})`).join(', ')}`);
        
    } catch (error) {
        console.error('❌ Verification failed:', error);
    } finally {
        await db.close();
    }
}

if (require.main === module) {
    verifyMigration().catch(console.error);
}
