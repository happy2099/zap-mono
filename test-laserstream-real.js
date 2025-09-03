// File: test-laserstream-real.js
// Description: Real LaserStream test with actual subscription using premium Helius API

const { subscribe, CommitmentLevel, decodeSubscribeUpdate } = require('helius-laserstream');
const config = require('./config.js');

async function testRealLaserStream() {
    console.log('🔌 Testing REAL LaserStream with Premium Helius API...\n');
    console.log(`🔑 API Key: ${config.HELIUS_API_KEY ? '✅ SET' : '❌ MISSING'}`);
    console.log(`🌏 Endpoint: ${config.LASERSTREAM_ENDPOINT}\n`);

    try {
        // Test 1: Direct LaserStream Connection
        console.log('📋 Test 1: Direct LaserStream Connection');
        
        // Use the correct Helius LaserStream endpoint format
        const laserstreamEndpoint = 'wss://mainnet.helius-rpc.com/?api-key=b9a69ad0-d823-429e-8c18-7cbea0e31769';
        
        const request = {
            transactions: {
                "test-account-txns": {
                    accountRequired: ['6UHAWrXYiwJtYNBXSgPgsnNDLR24vVZv3p3WvHRwSkYj'], // Test wallet
                    vote: false,
                    failed: false
                }
            },
            commitment: CommitmentLevel.Confirmed
        };

        console.log('🚀 Establishing LaserStream subscription...');
        console.log('📡 Request:', JSON.stringify(request, null, 2));
        console.log('🔌 Using endpoint:', laserstreamEndpoint);

        // Create real subscription with proper config object
        const laserstreamConfig = {
            apiKey: config.HELIUS_API_KEY,
            endpoint: laserstreamEndpoint
        };
        
        const subscription = await subscribe(
            laserstreamConfig,
            request,
            (update) => {
                console.log('📨 LaserStream Update Received!');
                console.log('🔍 Update Type:', update.type);
                
                if (update.transaction) {
                    console.log('✅ Transaction detected via LaserStream!');
                    console.log('🔑 Signature:', update.transaction.signature || 'N/A');
                    console.log('📊 Slot:', update.transaction.slot || 'N/A');
                }
                
                // Close subscription after first update
                if (typeof subscription.cancel === 'function') {
                    subscription.cancel();
                } else if (typeof subscription.close === 'function') {
                    subscription.close();
                }
                console.log('🔌 Subscription closed after first update');
                process.exit(0);
            }
        );

        console.log('✅ LaserStream subscription established successfully!');
        console.log('⏳ Waiting for updates... (will auto-close after first update)');

        // Set timeout to close if no updates
        setTimeout(() => {
            if (subscription && typeof subscription.cancel === 'function') {
                console.log('⏰ No updates received, closing subscription...');
                subscription.cancel();
            } else if (subscription && typeof subscription.close === 'function') {
                console.log('⏰ No updates received, closing subscription...');
                subscription.close();
            } else {
                console.log('⏰ Timeout reached, exiting...');
                process.exit(0);
            }
        }, 10000);

    } catch (error) {
        console.error('❌ LaserStream test failed:', error.message);
        
        if (error.message.includes('401') || error.message.includes('Unauthorized')) {
            console.error('🔑 API Key issue - check your Helius API key');
        } else if (error.message.includes('ENOTFOUND')) {
            console.error('🌐 Network issue - check endpoint URL');
        } else if (error.message.includes('StringExpected')) {
            console.error('🔧 LaserStream library issue - endpoint format problem');
            console.error('💡 This suggests the Helius LaserStream endpoint format needs adjustment');
        } else {
            console.error('💻 Other error:', error);
        }
    }
}

// Run the test
testRealLaserStream();

module.exports = { testRealLaserStream };
