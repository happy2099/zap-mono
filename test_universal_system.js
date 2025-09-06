// ==========================================
// Test Universal Copy-Trading System
// ==========================================

const { Connection, Keypair, PublicKey, Transaction } = require('@solana/web3.js');
const { UniversalAnalyzer } = require('./universalAnalyzer');
const { UniversalCloner } = require('./universalCloner');
const fs = require('fs');
const path = require('path');

async function testUniversalSystem() {
    console.log('🧪 Testing Universal Copy-Trading System...');
    
    try {
        // Create test keypair
        const testUser = Keypair.generate();
        console.log(`👤 Using test keypair: ${testUser.publicKey.toString()}`);
        
        // Create connection
        const connection = new Connection('https://api.mainnet-beta.solana.com', 'confirmed');
        
        // Initialize the universal system
        const analyzer = new UniversalAnalyzer(connection);
        const cloner = new UniversalCloner(connection);
        
        // Load master transaction
        const masterTxFile = path.join(__dirname, 'transactions', 'copy_trade_2ZjrHrJBBmLSEjBX3RSPeMr8apFULeoPsk4CBbCR6FMvgUfamprqNuGLGjxHA16or5Ey5v54ccgcn4rDPWuBopbZ.json');
        const masterTxData = JSON.parse(fs.readFileSync(masterTxFile, 'utf8'));
        
        console.log('✅ Loaded master transaction data');
        
        // Get the original transaction
        const originalTransaction = masterTxData.tradeDetails.builderOptions.originalTransaction;
        const masterTraderWallet = originalTransaction.transaction.message.accountKeys[0];
        
        console.log(`🔍 Master trader wallet: ${masterTraderWallet}`);
        
        // Step 1: Analyze the transaction to find the core swap instruction
        console.log('🔍 Step 1: Analyzing transaction for core swap instruction...');
        const analysisResult = await analyzer.analyzeTransaction(originalTransaction, masterTraderWallet);
        
        if (!analysisResult.isCopyable) {
            console.log('❌ Transaction is not copyable:', analysisResult.reason);
            return;
        }
        
        console.log('✅ Analysis successful!');
        console.log('📊 Analysis result:', {
            tradeType: analysisResult.tradeType,
            inputMint: analysisResult.inputMint,
            outputMint: analysisResult.outputMint,
            programId: analysisResult.cloningTarget.programId,
            accountCount: analysisResult.cloningTarget.accounts.length
        });
        
        // Step 2: Clone the instruction using the universal cloner
        console.log('🔧 Step 2: Cloning instruction using universal cloner...');
        const builderOptions = {
            userPublicKey: testUser.publicKey,
            cloningTarget: analysisResult.cloningTarget,
            masterTraderWallet: masterTraderWallet,
            tradeType: analysisResult.tradeType,
            inputMint: analysisResult.inputMint,
            outputMint: analysisResult.outputMint,
            amountBN: { toString: () => '1000000', toNumber: () => 1000000 }, // 0.001 SOL
            slippageBps: 5000
        };
        
        const cloneResult = await cloner.buildClonedInstruction(builderOptions);
        
        console.log('✅ Cloning successful!');
        console.log('📊 Clone result:', {
            instructionCount: cloneResult.instructions.length,
            platform: cloneResult.platform,
            method: cloneResult.method,
            ataInstructions: cloneResult.ataInstructions,
            clonedInstruction: cloneResult.clonedInstruction
        });
        
        // Step 3: Create and send the transaction
        console.log('🚀 Step 3: Creating and sending transaction...');
        const transaction = new Transaction();
        
        // Add all instructions
        cloneResult.instructions.forEach(instruction => {
            transaction.add(instruction);
        });
        
        // Set recent blockhash and fee payer
        const { blockhash } = await connection.getLatestBlockhash();
        transaction.recentBlockhash = blockhash;
        transaction.feePayer = testUser.publicKey;
        
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
        
        console.log('💾 Universal system test completed!');
        console.log('🔗 Please check the transaction on Solscan to verify the universal cloning is working');
        
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
    testUniversalSystem().catch(console.error);
}

module.exports = { testUniversalSystem };
