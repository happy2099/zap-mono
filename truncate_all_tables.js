const { DatabaseManager } = require('./database/databaseManager.js');

async function truncateAllTables() {
    const db = new DatabaseManager();
    await db.initialize();
    
    console.log('🗑️ Truncating all database tables...');
    
    try {
        // Disable foreign key constraints temporarily
        await db.run('PRAGMA foreign_keys = OFF');
        
        // Truncate all tables
        const tables = [
            'users',
            'traders', 
            'trades',
            'trade_stats',
            'withdrawals',
            'positions',
            'saved_addresses',
            'processed_pools',
            'wallets'
        ];
        
        for (const table of tables) {
            await db.run(`DELETE FROM ${table}`);
            console.log(`✅ Truncated table: ${table}`);
        }
        
        // Reset auto-increment counters
        await db.run('DELETE FROM sqlite_sequence');
        console.log('✅ Reset auto-increment counters');
        
        // Re-enable foreign key constraints
        await db.run('PRAGMA foreign_keys = ON');
        
        console.log('🎉 All tables truncated successfully!');
        console.log('📊 Database is now clean and ready for QA testing.');
        
    } catch (error) {
        console.error('❌ Error truncating tables:', error);
    } finally {
        await db.close();
    }
}

truncateAllTables().catch(console.error);
