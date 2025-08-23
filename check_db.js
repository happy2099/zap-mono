const { DatabaseManager } = require('./database/databaseManager.js');

async function checkDatabase() {
    const db = new DatabaseManager();
    await db.initialize();
    
    console.log('=== DATABASE STATE ===');
    
    // Check users
    const users = await db.all('SELECT * FROM users');
    console.log('Users:', users.length);
    
    // Check traders
    const traders = await db.all('SELECT * FROM traders');
    console.log('Traders:', traders.length);
    
    // Check wallets
    const wallets = await db.all('SELECT * FROM wallets');
    console.log('Wallets:', wallets.length);
    
    // Check other tables
    const trades = await db.all('SELECT * FROM trades');
    console.log('Trades:', trades.length);
    
    const positions = await db.all('SELECT * FROM positions');
    console.log('Positions:', positions.length);
    
    await db.close();
}

checkDatabase().catch(console.error);
