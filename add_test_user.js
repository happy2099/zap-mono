// ==========================================
// ========== Add Test User Script ==========
// ==========================================
// File: add_test_user.js
// Description: Add a test user to the JSON database

const { DataManager } = require('./dataManager');

async function addTestUser() {
    try {
        console.log('🚀 Adding test user...');
        
        const dataManager = new DataManager();
        await dataManager.initialize();
        
        // Add the admin user from config
        const chatId = '6032767351';
        const userData = {
            firstName: 'Admin',
            lastName: 'User',
            telegramUsername: 'admin',
            isActive: true,
            isAdmin: true
        };
        
        const userId = await dataManager.createUser(chatId, userData);
        console.log(`✅ Created user with ID: ${userId}`);
        
        // Add some default settings
        await dataManager.updateUserSettings(chatId, {
            solAmount: 0.1,
            slippageBps: 5000
        });
        console.log('✅ Added default settings');
        
        // Note: Traders should be added through Telegram UI or Redis, not hardcoded
        console.log('✅ Test user ready - add traders through Telegram UI');
        
        console.log('🎉 Test user setup completed!');
        
    } catch (error) {
        console.error('❌ Error adding test user:', error);
    }
}

addTestUser();
