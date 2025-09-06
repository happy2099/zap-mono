// ==========================================
// Test Crash Fix - Platform Name Issue
// ==========================================

const { Connection } = require('@solana/web3.js');
const { TransactionAnalyzer } = require('./transactionAnalyzer');
const fs = require('fs');
const path = require('path');

async function testCrashFix() {
    console.log('🧪 Testing Crash Fix - Platform Name Issue...');
    
    try {
        // Create connection
        const connection = new Connection('https://api.mainnet-beta.solana.com', 'confirmed');
        
        // Initialize the analyzer
        const analyzer = new TransactionAnalyzer(connection);
        
        // Load master transaction
        const masterTxFile = path.join(__dirname, 'transactions', 'copy_trade_2ZjrHrJBBmLSEjBX3RSPeMr8apFULeoPsk4CBbCR6FMvgUfamprqNuGLGjxHA16or5Ey5v54ccgcn4rDPWuBopbZ.json');
        const masterTxData = JSON.parse(fs.readFileSync(masterTxFile, 'utf8'));
        
        console.log('✅ Loaded master transaction data');
        
        // Get the original transaction
        const originalTransaction = masterTxData.tradeDetails.builderOptions.originalTransaction;
        const masterTraderWallet = originalTransaction.transaction.message.accountKeys[0];
        
        console.log(`🔍 Master trader wallet: ${masterTraderWallet}`);
        
        // Test the analyzer
        console.log('🔍 Testing analyzer with crash fix...');
        const analysisResult = await analyzer.analyzeTransactionForCopy(
            'test_signature', 
            originalTransaction, 
            masterTraderWallet
        );
        
        console.log('✅ Analysis completed without crash!');
        console.log('📊 Analysis result:', {
            isCopyable: analysisResult.isCopyable,
            reason: analysisResult.reason,
            platform: analysisResult.details?.dexPlatform,
            tradeType: analysisResult.details?.tradeType
        });
        
        if (analysisResult.details?.dexPlatform) {
            console.log('🎯 ✅ Platform name is defined:', analysisResult.details.dexPlatform);
        } else {
            console.log('❌ Platform name is still undefined');
        }
        
        console.log('💾 Crash fix test completed!');
        
    } catch (error) {
        console.error('❌ Test failed:', error.message);
        console.error('Stack trace:', error.stack);
    }
}

// Run the test
if (require.main === module) {
    testCrashFix().catch(console.error);
}

module.exports = { testCrashFix };
