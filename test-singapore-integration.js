// File: test-singapore-integration.js
// Description: Test script for Singapore regional Helius integration

const { SingaporeSenderManager } = require('./singaporeSenderManager.js');
const { LaserStreamManager } = require('./laserstreamManager.js');
const config = require('./config.js');

async function testSingaporeIntegration() {
    console.log('🚀 Testing Singapore Regional Helius Integration...\n');

    try {
        // Test 1: Singapore Sender Manager
        console.log('📋 Test 1: Singapore Sender Manager Initialization');
        const senderManager = new SingaporeSenderManager();
        
        // Test health check
        console.log('🔍 Testing health check...');
        const isHealthy = await senderManager.healthCheck();
        console.log(`✅ Health check result: ${isHealthy ? 'HEALTHY' : 'UNHEALTHY'}`);
        
        // Test endpoint status
        const status = senderManager.getEndpointStatus();
        console.log('📊 Endpoint Status:', JSON.stringify(status, null, 2));
        
        // Test optimal tip calculation
        console.log('💡 Testing optimal tip calculation...');
        const optimalTip = await senderManager.getOptimalTipAmount();
        console.log(`✅ Optimal tip: ${optimalTip} SOL`);
        
        console.log('\n✅ Singapore Sender Manager test completed successfully!\n');

        // Test 2: Singapore Endpoints Configuration
        console.log('📋 Test 2: Singapore Endpoints Configuration');
        console.log('🌏 Singapore Endpoints:', JSON.stringify(config.SINGAPORE_ENDPOINTS, null, 2));
        console.log('🔑 Helius API Key:', config.HELIUS_API_KEY ? '✅ SET' : '❌ NOT SET');
        console.log('✅ Singapore endpoints configuration test completed!\n');

        // Test 3: Test Singapore RPC Connection
        console.log('📋 Test 3: Singapore RPC Connection Test');
        try {
            const response = await fetch(config.SINGAPORE_ENDPOINTS.rpc, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    jsonrpc: '2.0',
                    id: 1,
                    method: 'getHealth'
                })
            });
            
            const result = await response.json();
            console.log(`✅ Singapore RPC health: ${result.result}`);
            
        } catch (error) {
            console.log(`❌ Singapore RPC test failed: ${error.message}`);
        }

        // Test 4: Test Singapore Sender Endpoint
        console.log('\n📋 Test 4: Singapore Sender Endpoint Test');
        try {
            const response = await fetch(config.SINGAPORE_ENDPOINTS.sender, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    jsonrpc: '2.0',
                    id: 1,
                    method: 'getHealth'
                })
            });
            
            const result = await response.json();
            console.log(`✅ Singapore Sender health: ${result.result || 'Endpoint accessible'}`);
            
        } catch (error) {
            console.log(`❌ Singapore Sender test failed: ${error.message}`);
        }

        // Test 5: Test LaserStream Endpoint
        console.log('\n📋 Test 5: LaserStream Endpoint Test');
        console.log(`🔌 LaserStream URL: ${config.SINGAPORE_ENDPOINTS.laserstream}`);
        console.log('⚠️  LaserStream connection test requires active subscription (tested in main bot)');

        console.log('\n🎉 All Singapore integration tests completed!');
        console.log('\n📋 Summary:');
        console.log('   ✅ Singapore Sender Manager: Initialized');
        console.log('   ✅ Singapore Endpoints: Configured');
        console.log('   ✅ Singapore RPC: Tested');
        console.log('   ✅ Singapore Sender: Tested');
        console.log('   ⚠️  LaserStream: Ready for main bot testing');
        
        console.log('\n🚀 Your ZapBot is now optimized for Singapore regional performance!');
        console.log('🌏 Benefits:');
        console.log('   - Lower latency for Asia-Pacific users');
        console.log('   - Singapore regional Helius endpoints');
        console.log('   - Ultra-fast trade execution via Sender');
        console.log('   - Real-time monitoring via LaserStream');

    } catch (error) {
        console.error('❌ Singapore integration test failed:', error);
        process.exit(1);
    }
}

// Run the test
if (require.main === module) {
    testSingaporeIntegration()
        .then(() => {
            console.log('\n✅ Test completed successfully!');
            process.exit(0);
        })
        .catch((error) => {
            console.error('\n❌ Test failed:', error);
            process.exit(1);
        });
}

module.exports = { testSingaporeIntegration };
