// ==========================================
// Test Router Builder - Simple Test
// ==========================================

const { Connection, Keypair, PublicKey, Transaction } = require('@solana/web3.js');
const { buildRouterInstruction } = require('./platformBuilders');
const fs = require('fs');
const path = require('path');

async function testRouterSimple() {
    console.log('🧪 Testing Router Builder - Simple Test...');
    
    try {
        // Create a test keypair
        const testUser = Keypair.generate();
        console.log(`👤 Using test keypair: ${testUser.publicKey.toString()}`);
        
        // Create connection
        const connection = new Connection('https://api.mainnet-beta.solana.com', 'confirmed');
        
        // Load master transaction
        const masterTxFile = path.join(__dirname, 'transactions', 'copy_trade_2ZjrHrJBBmLSEjBX3RSPeMr8apFULeoPsk4CBbCR6FMvgUfamprqNuGLGjxHA16or5Ey5v54ccgcn4rDPWuBopbZ.json');
        const masterTxData = JSON.parse(fs.readFileSync(masterTxFile, 'utf8'));
        
        console.log('✅ Loaded master transaction data');
        
        // Prepare builder options
        const builderOptions = {
            connection,
            userPublicKey: testUser.publicKey,
            swapDetails: {
                platform: 'Router',
                platformProgramId: 'F5tfvbLog9VdGUPqBDTT8rgXvTTcq7e5UiGnupL1zvBq',
                originalTransaction: masterTxData.tradeDetails.builderOptions.originalTransaction
            },
            amountBN: { toString: () => '1000000', toNumber: () => 1000000 }, // 0.001 SOL
            slippageBps: 5000,
            originalTransaction: masterTxData.tradeDetails.builderOptions.originalTransaction
        };
        
        console.log('🔧 Building router instruction with perfect cloning...');
        
        // Build the router instruction
        const result = await buildRouterInstruction(builderOptions);
        
        console.log('✅ Router instruction built successfully!');
        console.log('📊 Results:', {
            instructionCount: result.instructions.length,
            platform: result.platform,
            method: result.method,
            success: result.success
        });
        
        // Create transaction
        const transaction = new Transaction();
        
        // Add the router instruction
        result.instructions.forEach(instruction => {
            transaction.add(instruction);
        });
        
        // Set recent blockhash and fee payer
        const { blockhash } = await connection.getLatestBlockhash();
        transaction.recentBlockhash = blockhash;
        transaction.feePayer = testUser.publicKey;
        
        console.log('🔧 Transaction prepared with router instruction');
        console.log('🚀 Sending transaction to Solana...');
        
        // Sign and send
        transaction.sign(testUser);
        
        const signature = await connection.sendRawTransaction(transaction.serialize());
        console.log('✅ Transaction sent successfully!');
        console.log('📝 Signature:', signature);
        console.log('🔗 Solscan URL:', `https://solscan.io/tx/${signature}`);
        
        // Wait for confirmation
        console.log('⏳ Waiting for confirmation...');
        const confirmation = await connection.confirmTransaction(signature);
        console.log('📊 Confirmation result:', confirmation);
        
        if (confirmation.value.err) {
            console.log('❌ Transaction failed:', confirmation.value.err);
            console.log('🔗 Check Solscan for details:', `https://solscan.io/tx/${signature}`);
        } else {
            console.log('🎉 Transaction confirmed successfully!');
            console.log('🔗 View on Solscan:', `https://solscan.io/tx/${signature}`);
        }
        
        // Save the signature for later checking
        console.log('💾 Transaction signature saved for Solscan verification');
        console.log('🔗 Please check the transaction on Solscan to confirm the router cloning is working');
        
    } catch (error) {
        console.error('❌ Test failed:', error.message);
        if (error.signature) {
            console.log('🔗 Check Solscan:', `https://solscan.io/tx/${error.signature}`);
        }
        console.error('Stack trace:', error.stack);
    }
}

// Run the test
if (require.main === module) {
    testRouterSimple().catch(console.error);
}

module.exports = { testRouterSimple };
