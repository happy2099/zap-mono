const { dataManager } = require('./database/dataManager.js');

async function addAdminUser() {
    const db = new dataManager();
    await db.initialize();
    
    try {
        console.log('👤 Adding admin user...\n');
        
        const adminChatId = '6032767351';
        
        // Check if admin user already exists
        const existingUser = await db.get('SELECT * FROM users WHERE chat_id = ?', [adminChatId]);
        
        if (existingUser) {
            console.log(`✅ Admin user already exists:`);
            console.log(`  ID: ${existingUser.id}`);
            console.log(`  Chat ID: ${existingUser.chat_id}`);
            console.log(`  Name: ${existingUser.first_name} ${existingUser.last_name || ''}`);
            console.log(`  Admin: ${existingUser.is_admin ? 'Yes' : 'No'}`);
            
            // Make sure they're set as admin
            if (!existingUser.is_admin) {
                await db.run('UPDATE users SET is_admin = 1 WHERE chat_id = ?', [adminChatId]);
                console.log('✅ Updated user to admin status');
            }
        } else {
            // Create new admin user
            const result = await db.run(`
                INSERT INTO users (chat_id, first_name, last_name, telegram_username, is_active, is_admin)
                VALUES (?, ?, ?, ?, ?, ?)
            `, [
                adminChatId,
                'Admin',
                'User',
                'admin',
                1,
                1
            ]);
            
            console.log(`✅ Created new admin user with ID: ${result.id}`);
        }
        
        // Verify
        const adminUser = await db.get('SELECT * FROM users WHERE chat_id = ?', [adminChatId]);
        console.log(`\n📋 Admin user verified:`);
        console.log(`  ID: ${adminUser.id}`);
        console.log(`  Chat ID: ${adminUser.chat_id}`);
        console.log(`  Admin: ${adminUser.is_admin ? 'Yes' : 'No'}`);
        
    } catch (error) {
        console.error('❌ Error adding admin user:', error);
    } finally {
        await db.shutdown();
    }
}

addAdminUser();
