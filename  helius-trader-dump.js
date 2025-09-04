// ==========================================
// ====== Helius Trader Data Dump Script ======
// ==========================================
// Description: Connects to LaserStream with your bot's exact trader list
// and prints the full, raw JSON data for the first few transactions detected.
// This will reveal the "blueprint" of the pre-fetched data.

const { subscribe } = require('helius-laserstream');
const config = require('./config.js');
const { DatabaseManager } = require('./database/databaseManager.js');

// We need a minimal TradingEngine to get the trader list, just like the real monitor worker.
const { TradingEngine } = require('./tradingEngine.js');

let transactionsReceived = 0;
const MAX_TRANSACTIONS_TO_DUMP = 3;

async function main() {
    console.log('🚀 Starting Helius Trader Data Dump...');

    // --- 1. Validate Configuration ---
    if (!config.HELIUS_API_KEY) {
        console.error('❌ FATAL: HELIUS_API_KEY is not set in config.js/.env');
        process.exit(1);
    }
    console.log('✅ Helius API Key found.');

    // --- 2. Get the Master Trader Wallet List (the exact same way the bot does) ---
    const dbManager = new DatabaseManager();
    await dbManager.initialize();
    
    // Create a temporary, partial engine instance just to use its helper method
    const tempEngine = new TradingEngine({ databaseManager: dbManager }, { partialInit: true });
    const traderWallets = await tempEngine.getMasterTraderWallets();
    await dbManager.close();

    if (!traderWallets || traderWallets.length === 0) {
        console.error('❌ No active master traders found in the database. Cannot monitor.');
        process.exit(1);
    }
    console.log(`🎯 Monitoring ${traderWallets.length} trader wallets:`);
    traderWallets.forEach(w => console.log(`   - ${w}`));

    // --- 3. Define Stream Configuration ---
    const laserstreamConfig = {
        apiKey: config.HELIUS_API_KEY,
        endpoint: config.LASERSTREAM_ENDPOINT, // Using the main endpoint from config
    };

    // --- 4. Define the EXACT Subscription Request the bot uses ---
    const subscriptionRequest = {
        transactions: {
            "master-traders": {
                accountInclude: traderWallets,
                vote: false,
                failed: false,
                // Add enhanced data request options if needed, but Helius often provides it by default
            }
        },
        commitment: 0, // Use 0 for 'processed' (fastest data) - SDK expects number, not string
    };
    
    // --- 5. Data Callback: This is the core of the test ---
    const onData = (update) => {
        if (!update.transaction) return; // We only care about transaction updates

        transactionsReceived++;
        console.log(`\n\n--- 🔥 RAW HELIUS DATA DUMP #${transactionsReceived}/${MAX_TRANSACTIONS_TO_DUMP} ---`);
        
        // This is the most important line: Print the ENTIRE object.
        console.log(JSON.stringify(update, null, 2)); 
        
        console.log('--- ✅ END OF DUMP ---');

        if (transactionsReceived >= MAX_TRANSACTIONS_TO_DUMP) {
            console.log(`\n🏁 Reached max dump count. Shutting down test.`);
            process.exit(0);
        }
    };

    const onError = (error) => {
        console.error('❌ STREAM ERROR:', error);
    };

    // --- 6. Start the Stream ---
    console.log('\nConnecting to Helius LaserStream...');
    console.log('Waiting for real-time activity from your traders...');
    console.log('💡 Tip: Make a trade with one of the monitored wallets to see data...');
    
    try {
        await subscribe(
            laserstreamConfig,
            subscriptionRequest,
            onData,
            onError
        );
    } catch (error) {
        console.error('❌ Failed to start LaserStream subscription:', error.message);
        process.exit(1);
    }

    // Safety timeout in case no transactions happen
    setTimeout(() => {
        console.log('\n⏰ Test timed out after 5 minutes. No new transactions detected.');
        console.log('💡 This is normal if the monitored wallets are not actively trading.');
        console.log('🔍 Check that the wallet addresses are correct and have recent activity.');
        process.exit(0);
    }, 300000); 

    // Add heartbeat indicator every 30 seconds
    const startTime = Date.now();
    const heartbeatInterval = setInterval(() => {
        const elapsed = Math.floor((Date.now() - startTime) / 1000);
        console.log(`💓 Still monitoring... (${elapsed}s elapsed)`);
    }, 30000);

    // Clean up interval on exit
    process.on('SIGINT', () => {
        clearInterval(heartbeatInterval);
        console.log('\n🛑 Monitoring stopped by user.');
        process.exit(0);
    });

    process.on('SIGTERM', () => {
        clearInterval(heartbeatInterval);
        console.log('\n🛑 Monitoring stopped by system.');
        process.exit(0);
    });
}

// --- Run the test ---
main().catch(error => {
    console.error('❌ An unexpected error occurred during startup:', error);
    process.exit(1);
});