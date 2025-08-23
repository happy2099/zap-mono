#!/usr/bin/env node

// ==========================================
// ========== Admin Setup Script ==========
// ==========================================
// File: scripts/setup-admin.js
// Description: Sets up admin user in the database

const { DatabaseManager } = require('../database/databaseManager.js');
const config = require('../patches/config.js');

async function setupAdmin() {
    console.log('🔧 Setting up admin user...');
    
    const databaseManager = new DatabaseManager();
    
    try {
        // Initialize database
        await databaseManager.initialize();
        console.log('✅ Database initialized');
        
        const adminChatId = config.ADMIN_CHAT_ID;
        if (!adminChatId) {
            console.error('❌ ADMIN_CHAT_ID not found in config');
            process.exit(1);
        }
        
        console.log(`👤 Admin Chat ID: ${adminChatId}`);
        
        // Check if admin user already exists
        let adminUser = await databaseManager.getUser(adminChatId);
        
        if (adminUser) {
            console.log('👤 Admin user already exists, updating admin status...');
            await databaseManager.setUserAdmin(adminChatId, true);
        } else {
            console.log('👤 Creating new admin user...');
            await databaseManager.createUserComplete(adminChatId, {
                username: 'Admin',
                settings: '{}',
                sol_amount: 0.1,
                primary_wallet_label: 'zap',
                is_admin: 1
            });
        }
        
        // Verify admin status
        const isAdmin = await databaseManager.isUserAdmin(adminChatId);
        console.log(`✅ Admin status verified: ${isAdmin}`);
        
        // List all admins
        const allAdmins = await databaseManager.getAllAdmins();
        console.log(`👥 Total admins: ${allAdmins.length}`);
        for (const admin of allAdmins) {
            console.log(`   - ${admin.username || admin.chat_id} (${admin.chat_id})`);
        }
        
        await databaseManager.close();
        console.log('🎉 Admin setup completed successfully!');
        
    } catch (error) {
        console.error('❌ Admin setup failed:', error);
        process.exit(1);
    }
}

if (require.main === module) {
    setupAdmin();
}

module.exports = { setupAdmin };
