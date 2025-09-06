#!/usr/bin/env node

/**
 * Test Integrated Fix
 * 
 * This script tests the integrated fix with the failing transaction
 */

const { Connection } = require('@solana/web3.js');
const { TransactionAnalyzer } = require('./transactionAnalyzer.js');

async function testIntegratedFix() {
    console.log('🔧 Testing Integrated Fix...\n');
    
    try {
        // Initialize connection and analyzer
        const connection = new Connection('https://gilligan-jn1ghl-fast-mainnet.helius-rpc.com');
        const analyzer = new TransactionAnalyzer(connection);
        
        // The failing transaction signature
        const testSignature = '3fyr2R5CZ7ahyHX4joXsP446cabqKETjAJp5Z9Jm7LkNRaNZUaZqPQgmQz3mwqb1ot88JvcXZNSUBEiHg9oiEojx';
        const traderAddress = '4BdKaxN8G6ka4GYtQQWk4G4dZRUTX2vQH9GcXdBREFUk';
        
        console.log(`📋 Testing transaction: ${testSignature}`);
        console.log(`👤 Trader address: ${traderAddress}\n`);
        
        // Test full transaction analysis (force RPC fetch by not providing pre-fetched data)
        console.log('🔬 Testing full transaction analysis...');
        const analysisResult = await analyzer.analyzeTransactionForCopy(testSignature, null, traderAddress);
        
        if (analysisResult.isCopyable) {
            console.log('✅ Transaction analysis SUCCESS!');
            console.log(`   Platform: ${analysisResult.details.dexPlatform}`);
            console.log(`   Trade Type: ${analysisResult.details.tradeType}`);
            console.log(`   Has Cloning Target: ${!!analysisResult.details.cloningTarget}`);
            
            if (analysisResult.details.cloningTarget) {
                console.log('   🎯 Router cloning target found - this should fix the 3012 error!');
                console.log(`   Cloning Target Program ID: ${analysisResult.details.cloningTarget.programId}`);
                console.log(`   Cloning Target Accounts: ${analysisResult.details.cloningTarget.accounts.length}`);
                console.log(`   Cloning Target Data Length: ${analysisResult.details.cloningTarget.data.length}`);
            } else {
                console.log('   ⚠️ No cloning target - this will still cause 3012 errors');
            }
        } else {
            console.log('❌ Transaction analysis FAILED');
            console.log(`   Reason: ${analysisResult.reason}`);
        }
        
    } catch (error) {
        console.error('❌ Test failed:', error.message);
        console.error('Stack:', error.stack);
    }
}

// Run the test
testIntegratedFix().then(() => {
    console.log('\n🏁 Integrated fix test completed');
}).catch(error => {
    console.error('💥 Test crashed:', error);
    process.exit(1);
});
