#!/usr/bin/env node

// Script to execute the copy user data SQL commands
const { DatabaseManager } = require('./database/databaseManager');
const fs = require('fs');
const path = require('path');

async function copyUserData() {
    const dbManager = new DatabaseManager();
    
    try {
        console.log('🔄 Starting copy operation: User 2 → User 3');
        
        // Read the SQL file
        const sqlFilePath = path.join(__dirname, 'copy_user2_to_user3.sql');
        const sqlContent = fs.readFileSync(sqlFilePath, 'utf8');
        
        // Split SQL commands properly
        const sqlCommands = sqlContent
            .split(';')
            .map(cmd => cmd.trim())
            .filter(cmd => cmd.length > 0 && !cmd.startsWith('--') && !cmd.startsWith('SELECT') && !cmd.startsWith('CREATE'));
        
        console.log(`📋 Found ${sqlCommands.length} SQL commands to execute`);
        
        // Execute each SQL command
        for (let i = 0; i < sqlCommands.length; i++) {
            const command = sqlCommands[i];
            if (command.toUpperCase().startsWith('INSERT')) {
                console.log(`🔧 Executing command ${i + 1}...`);
                try {
                    await dbManager.run(command);
                    console.log(`✅ Command ${i + 1} executed successfully`);
                } catch (error) {
                    console.error(`❌ Error executing command ${i + 1}:`, error.message);
                }
            }
        }
        
        // Verification queries
        console.log('\n📊 VERIFICATION RESULTS:');
        
        // Check copied traders
        const traders = await dbManager.all(`
            SELECT name, wallet, active 
            FROM traders 
            WHERE user_id = 3 
            ORDER BY name
        `);
        console.log(`\n🎯 Traders for User 3 (${traders.length} total):`);
        traders.forEach(trader => {
            console.log(`  - ${trader.name}: ${trader.wallet} (${trader.active ? 'ACTIVE' : 'INACTIVE'})`);
        });
        
        // Check copied wallets
        const wallets = await dbManager.all(`
            SELECT label, public_key, balance 
            FROM user_wallets 
            WHERE user_id = 3 
            ORDER BY label
        `);
        console.log(`\n💰 Wallets for User 3 (${wallets.length} total):`);
        wallets.forEach(wallet => {
            console.log(`  - ${wallet.label}: ${wallet.public_key.substring(0, 8)}...${wallet.public_key.slice(-8)} (${wallet.balance} SOL)`);
        });
        
        // Check trading settings
        const settings = await dbManager.get(`
            SELECT sol_amount_per_trade 
            FROM user_trading_settings 
            WHERE user_id = 3
        `);
        console.log(`\n⚙️ Trading Settings for User 3:`);
        if (settings) {
            console.log(`  - SOL per trade: ${settings.sol_amount_per_trade}`);
        } else {
            console.log(`  - No trading settings found`);
        }
        
        console.log('\n✅ Copy operation completed successfully!');
        
    } catch (error) {
        console.error('❌ Error during copy operation:', error);
    } finally {
        await dbManager.close();
    }
}

// Run the script
if (require.main === module) {
    copyUserData().catch(console.error);
}

module.exports = { copyUserData };
