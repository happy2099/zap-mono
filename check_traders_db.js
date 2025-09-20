const { dataManager } = require('./database/dataManager.js');

async function checkTraders() {
    const db = new dataManager();
    await db.initialize();
    
    try {
        console.log('🔍 Checking traders in database...\n');
        
        // Get all traders
        const allTraders = await db.all('SELECT * FROM traders');
        console.log(`📊 Total traders in database: ${allTraders.length}\n`);
        
        if (allTraders.length > 0) {
            console.log('📋 All traders:');
            allTraders.forEach(trader => {
                console.log(`  ID: ${trader.id}, Name: ${trader.name}, Wallet: ${trader.wallet}, Active: ${trader.active}, User ID: ${trader.user_id}`);
            });
            console.log('');
        }
        
        // Get active traders
        const activeTraders = await db.all('SELECT * FROM traders WHERE active = 1');
        console.log(`✅ Active traders: ${activeTraders.length}\n`);
        
        if (activeTraders.length > 0) {
            console.log('📋 Active traders:');
            activeTraders.forEach(trader => {
                console.log(`  ID: ${trader.id}, Name: ${trader.name}, Wallet: ${trader.wallet}, User ID: ${trader.user_id}`);
            });
        }
        
        // Get users
        const users = await db.all('SELECT * FROM users');
        console.log(`\n👥 Total users: ${users.length}\n`);
        
        if (users.length > 0) {
            console.log('📋 All users:');
            users.forEach(user => {
                console.log(`  ID: ${user.id}, Chat ID: ${user.chat_id}, Name: ${user.first_name} ${user.last_name || ''}, Admin: ${user.is_admin}`);
            });
        }
        
        // Check trader-user relationship
        const traderWithUsers = await db.all(`
            SELECT t.*, u.chat_id, u.first_name, u.last_name 
            FROM traders t 
            JOIN users u ON t.user_id = u.id
        `);
        
        console.log(`\n🔗 Traders with user info: ${traderWithUsers.length}\n`);
        
        if (traderWithUsers.length > 0) {
            console.log('📋 Traders with users:');
            traderWithUsers.forEach(trader => {
                console.log(`  Trader: ${trader.name} (${trader.wallet}) | User: ${trader.first_name} ${trader.last_name || ''} (Chat: ${trader.chat_id}) | Active: ${trader.active}`);
            });
        }
        
    } catch (error) {
        console.error('❌ Error checking traders:', error);
    } finally {
        await db.shutdown();
    }
}

checkTraders();
