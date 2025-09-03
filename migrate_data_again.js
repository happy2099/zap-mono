const { DatabaseManager } = require('./database/databaseManager.js');
const fs = require('fs').promises;
const path = require('path');

async function migrateData() {
    const db = new DatabaseManager();
    await db.initialize();
    
    const dataPath = '/mnt/c/Users/sanjay/zap-mono/data';
    
    try {
        console.log('🔄 Starting data migration...\n');
        
        // Migrate users
        try {
            const usersData = await fs.readFile(path.join(dataPath, 'users.json'), 'utf8');
            const users = JSON.parse(usersData);
            
            console.log(`📥 Found ${users.length} users to migrate`);
            
            for (const user of users) {
                await db.run(`
                    INSERT OR REPLACE INTO users (chat_id, first_name, last_name, telegram_username, is_active, is_admin)
                    VALUES (?, ?, ?, ?, ?, ?)
                `, [
                    user.chat_id,
                    user.first_name || null,
                    user.last_name || null,
                    user.telegram_username || null,
                    user.is_active ? 1 : 0,
                    user.is_admin ? 1 : 0
                ]);
            }
            console.log('✅ Users migrated successfully');
        } catch (error) {
            console.log('⚠️  No users.json found or error:', error.message);
        }
        
        // Migrate traders
        try {
            const tradersData = await fs.readFile(path.join(dataPath, 'traders.json'), 'utf8');
            const traders = JSON.parse(tradersData);
            
            console.log(`📥 Found traders data to migrate`);
            
            for (const [chatId, userTraders] of Object.entries(traders)) {
                // Get user ID for this chat_id
                const user = await db.get('SELECT id FROM users WHERE chat_id = ?', [chatId]);
                if (!user) {
                    console.log(`⚠️  User not found for chat_id ${chatId}, skipping traders`);
                    continue;
                }
                
                for (const [traderName, traderConfig] of Object.entries(userTraders)) {
                    await db.run(`
                        INSERT OR REPLACE INTO traders (user_id, name, wallet, active)
                        VALUES (?, ?, ?, ?)
                    `, [
                        user.id,
                        traderName,
                        traderConfig.wallet,
                        traderConfig.active ? 1 : 0
                    ]);
                }
            }
            console.log('✅ Traders migrated successfully');
        } catch (error) {
            console.log('⚠️  No traders.json found or error:', error.message);
        }
        
        // Migrate wallets
        try {
            const walletsData = await fs.readFile(path.join(dataPath, 'wallets.json'), 'utf8');
            const wallets = JSON.parse(walletsData);
            
            console.log(`📥 Found wallets data to migrate`);
            
            for (const [chatId, userWallets] of Object.entries(wallets)) {
                // Get user ID for this chat_id
                const user = await db.get('SELECT id FROM users WHERE chat_id = ?', [chatId]);
                if (!user) {
                    console.log(`⚠️  User not found for chat_id ${chatId}, skipping wallets`);
                    continue;
                }
                
                for (const wallet of userWallets) {
                    await db.run(`
                        INSERT OR REPLACE INTO user_wallets (user_id, label, public_key, private_key_encrypted, balance)
                        VALUES (?, ?, ?, ?, ?)
                    `, [
                        user.id,
                        wallet.label,
                        wallet.publicKey,
                        wallet.privateKeyEncrypted,
                        wallet.balance || 0.0
                    ]);
                }
            }
            console.log('✅ Wallets migrated successfully');
        } catch (error) {
            console.log('⚠️  No wallets.json found or error:', error.message);
        }
        
        // Migrate settings
        try {
            const settingsData = await fs.readFile(path.join(dataPath, 'settings.json'), 'utf8');
            const settings = JSON.parse(settingsData);
            
            console.log(`📥 Found settings data to migrate`);
            
            for (const [chatId, userSettings] of Object.entries(settings)) {
                // Get user ID for this chat_id
                const user = await db.get('SELECT id FROM users WHERE chat_id = ?', [chatId]);
                if (!user) {
                    console.log(`⚠️  User not found for chat_id ${chatId}, skipping settings`);
                    continue;
                }
                
                await db.run(`
                                    INSERT OR REPLACE INTO user_trading_settings (user_id, sol_amount_per_trade)
                VALUES (?, ?)
                `, [
                    user.id,
                    userSettings.solAmount || 0.25
                ]);
            }
            console.log('✅ Settings migrated successfully');
        } catch (error) {
            console.log('⚠️  No settings.json found or error:', error.message);
        }
        
        // Set admin user
        const adminChatId = '6032767351';
        await db.run('UPDATE users SET is_admin = 1 WHERE chat_id = ?', [adminChatId]);
        console.log(`✅ Set user ${adminChatId} as admin`);
        
        console.log('\n🎉 Data migration completed!');
        
        // Verify migration
        const userCount = await db.get('SELECT COUNT(*) as count FROM users');
        const traderCount = await db.get('SELECT COUNT(*) as count FROM traders');
        const walletCount = await db.get('SELECT COUNT(*) as count FROM user_wallets');
        
        console.log(`\n📊 Migration Summary:`);
        console.log(`  Users: ${userCount.count}`);
        console.log(`  Traders: ${traderCount.count}`);
        console.log(`  Wallets: ${walletCount.count}`);
        
    } catch (error) {
        console.error('❌ Migration failed:', error);
    } finally {
        await db.shutdown();
    }
}

migrateData();
