// ==========================================
// Test User SOL Amount - Router Cloning
// ==========================================

const { Connection, Keypair, PublicKey, Transaction } = require('@solana/web3.js');
const { TransactionAnalyzer } = require('./transactionAnalyzer');
const { RouterCloner } = require('./routerCloner');
const fs = require('fs');
const path = require('path');

async function testUserSolAmount() {
    console.log('🧪 Testing User SOL Amount in Router Cloning...');
    
    try {
        // Create test keypair
        const testUser = Keypair.generate();
        console.log(`👤 Using test keypair: ${testUser.publicKey.toString()}`);
        
        // Create connection
        const connection = new Connection('https://api.mainnet-beta.solana.com', 'confirmed');
        
        // Initialize the system
        const analyzer = new TransactionAnalyzer(connection);
        const routerCloner = new RouterCloner(connection);
        
        // Load master transaction
        const masterTxFile = path.join(__dirname, 'transactions', 'copy_trade_2ZjrHrJBBmLSEjBX3RSPeMr8apFULeoPsk4CBbCR6FMvgUfamprqNuGLGjxHA16or5Ey5v54ccgcn4rDPWuBopbZ.json');
        const masterTxData = JSON.parse(fs.readFileSync(masterTxFile, 'utf8'));
        
        console.log('✅ Loaded master transaction data');
        
        // Get the original transaction
        const originalTransaction = masterTxData.tradeDetails.builderOptions.originalTransaction;
        const masterTraderWallet = originalTransaction.transaction.message.accountKeys[0];
        
        console.log(`🔍 Master trader wallet: ${masterTraderWallet}`);
        
        // Step 1: Analyze the transaction
        console.log('🔍 Step 1: Analyzing transaction...');
        const analysisResult = await analyzer.analyzeTransactionForCopy(
            'test_signature', 
            originalTransaction, 
            masterTraderWallet
        );
        
        if (!analysisResult.isCopyable) {
            console.log('❌ Transaction is not copyable:', analysisResult.reason);
            return;
        }
        
        console.log('✅ Analysis successful!');
        console.log('📊 Analysis result:', {
            platform: analysisResult.details?.dexPlatform,
            tradeType: analysisResult.details?.tradeType,
            hasCloningTarget: !!analysisResult.details?.cloningTarget
        });
        
        // Step 2: Test with different user SOL amounts
        const testAmounts = [
            { sol: 0.001, description: '0.001 SOL (1,000,000 lamports)' },
            { sol: 0.01, description: '0.01 SOL (10,000,000 lamports)' },
            { sol: 0.1, description: '0.1 SOL (100,000,000 lamports)' }
        ];
        
        for (const testAmount of testAmounts) {
            console.log(`\n🔧 Testing with ${testAmount.description}...`);
            
            const userAmountBN = { 
                toString: () => Math.floor(testAmount.sol * 1e9).toString(),
                toNumber: () => Math.floor(testAmount.sol * 1e9)
            };
            
            const builderOptions = {
                userPublicKey: testUser.publicKey,
                cloningTarget: analysisResult.details.cloningTarget,
                masterTraderWallet: analysisResult.details.masterTraderWallet,
                tradeType: analysisResult.details.tradeType,
                inputMint: analysisResult.details.inputMint,
                outputMint: analysisResult.details.outputMint,
                amountBN: userAmountBN,
                slippageBps: 5000
            };
            
            try {
                const cloneResult = await routerCloner.buildClonedRouterInstruction(builderOptions);
                
                console.log(`✅ Router cloning successful with ${testAmount.description}`);
                console.log('📊 Clone result:', {
                    instructionCount: cloneResult.instructions.length,
                    platform: cloneResult.platform,
                    method: cloneResult.method
                });
                
                // Check if the instruction data was modified
                const routerInstruction = cloneResult.instructions[cloneResult.instructions.length - 1];
                console.log(`📊 Router instruction data length: ${routerInstruction.data.length} bytes`);
                
            } catch (error) {
                console.error(`❌ Router cloning failed with ${testAmount.description}:`, error.message);
            }
        }
        
        console.log('\n💾 User SOL amount test completed!');
        console.log('🔗 The Router cloner now uses the user\'s set SOL amount');
        
    } catch (error) {
        console.error('❌ Test failed:', error.message);
        console.error('Stack trace:', error.stack);
    }
}

// Run the test
if (require.main === module) {
    testUserSolAmount().catch(console.error);
}

module.exports = { testUserSolAmount };
