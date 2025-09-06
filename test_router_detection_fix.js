#!/usr/bin/env node

/**
 * Test Router Detection Fix
 * 
 * This script tests the Router detection fix for the failing transaction
 * that was causing 3012 errors.
 */

const { Connection, PublicKey } = require('@solana/web3.js');
const { TransactionAnalyzer } = require('./transactionAnalyzer.js');

async function testRouterDetectionFix() {
    console.log('🔧 Testing Router Detection Fix...\n');
    
    try {
        // Initialize connection and analyzer
        const connection = new Connection('https://gilligan-jn1ghl-fast-mainnet.helius-rpc.com');
        const analyzer = new TransactionAnalyzer();
        
        // Test with a successful Photon Router transaction
        const testSignature = '3SXXkGdoV7KMCDiHDiJgUjFGiwrhuUS1thsZ5VmQ9U3jd6nKPxuXg8k1seCz26X2Lv26sQPBkRVgr4gTCGmocp2Y';
        const traderAddress = '4BdKaxN8G6ka4GYtQQWk4G4dZRUTX2vQH9GcXdBREFUk';
        
        console.log(`📋 Testing transaction: ${testSignature}`);
        console.log(`👤 Trader address: ${traderAddress}\n`);
        
        // Fetch the transaction
        console.log('🔍 Fetching transaction from Solana...');
        const transactionResponse = await connection.getTransaction(testSignature, {
            maxSupportedTransactionVersion: 0,
            commitment: 'confirmed'
        });
        
        if (!transactionResponse) {
            console.log('❌ Transaction not found or not confirmed');
            return;
        }
        
        console.log('✅ Transaction fetched successfully\n');
        
        // Test Router detection
        console.log('🎯 Testing Router detection...');
        const routerDetection = analyzer._detectRouterInstruction(transactionResponse, traderAddress);
        
        if (routerDetection.found) {
            console.log('✅ Router detection SUCCESS!');
            console.log(`   Program ID: ${routerDetection.programId}`);
            console.log(`   Instruction Index: ${routerDetection.instructionIndex}`);
            console.log(`   Has Cloning Target: ${!!routerDetection.cloningTarget}`);
            
            if (routerDetection.cloningTarget) {
                console.log(`   Accounts Count: ${routerDetection.cloningTarget.accounts.length}`);
                console.log(`   Data Length: ${routerDetection.cloningTarget.data.length}`);
            }
        } else {
            console.log('❌ Router detection FAILED');
            console.log('   This means the fix did not work properly');
        }
        
        // Test full analysis
        console.log('\n🔬 Testing full transaction analysis...');
        const analysisResult = await analyzer.analyzeTransactionForCopy(testSignature, traderAddress);
        
        if (analysisResult.isCopyable) {
            console.log('✅ Transaction analysis SUCCESS!');
            console.log(`   Platform: ${analysisResult.details.dexPlatform}`);
            console.log(`   Trade Type: ${analysisResult.details.tradeType}`);
            console.log(`   Has Cloning Target: ${!!analysisResult.details.cloningTarget}`);
            
            if (analysisResult.details.cloningTarget) {
                console.log('   🎯 Router cloning target found - this should fix the 3012 error!');
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
testRouterDetectionFix().then(() => {
    console.log('\n🏁 Router detection fix test completed');
}).catch(error => {
    console.error('💥 Test crashed:', error);
    process.exit(1);
});
