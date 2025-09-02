const { DatabaseManager } = require('./database/databaseManager.js');

async function checkBlackbox() {
    const db = new DatabaseManager();
    await db.initialize();
    
    try {
        console.log('🔍 Checking blackbox logs...\n');
        
        // Get recent logs
        const logs = await db.getBlackboxLogs(null, null, 50);
        
        if (logs.length === 0) {
            console.log('📭 No blackbox logs found');
            return;
        }
        
        console.log(`📊 Found ${logs.length} recent blackbox logs:\n`);
        
        // Group by component
        const byComponent = {};
        logs.forEach(log => {
            if (!byComponent[log.component]) {
                byComponent[log.component] = [];
            }
            byComponent[log.component].push(log);
        });
        
        // Display by component
        for (const [component, componentLogs] of Object.entries(byComponent)) {
            console.log(`🔧 ${component.toUpperCase()} (${componentLogs.length} logs):`);
            
            componentLogs.forEach(log => {
                const timestamp = new Date(log.timestamp).toLocaleTimeString();
                const level = log.level.padEnd(7);
                const message = log.message.substring(0, 80);
                const data = log.data ? ` | ${log.data.substring(0, 50)}...` : '';
                
                console.log(`  ${timestamp} [${level}] ${message}${data}`);
            });
            console.log('');
        }
        
        // Show error logs specifically
        const errorLogs = await db.getBlackboxLogs(null, 'ERROR', 10);
        if (errorLogs.length > 0) {
            console.log('❌ ERROR LOGS:');
            errorLogs.forEach(log => {
                const timestamp = new Date(log.timestamp).toLocaleTimeString();
                console.log(`  ${timestamp} [${log.component}] ${log.message}`);
                if (log.data) {
                    console.log(`    Data: ${log.data}`);
                }
            });
            console.log('');
        }
        
        // Show monitoring status
        const monitorLogs = await db.getBlackboxLogs('TRADER_MONITOR', null, 10);
        if (monitorLogs.length > 0) {
            console.log('🎯 TRADER MONITOR STATUS:');
            monitorLogs.forEach(log => {
                const timestamp = new Date(log.timestamp).toLocaleTimeString();
                console.log(`  ${timestamp} [${log.level}] ${log.message}`);
                if (log.data) {
                    console.log(`    Data: ${log.data}`);
                }
            });
        }
        
    } catch (error) {
        console.error('❌ Error checking blackbox logs:', error);
    } finally {
        await db.shutdown();
    }
}

checkBlackbox();
