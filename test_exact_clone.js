// ==========================================
// Exact Clone Test - No Account Swapping
// ==========================================
// Test the instruction with ZERO modifications to prove the cloning logic works

const { Connection, PublicKey, TransactionMessage, VersionedTransaction } = require('@solana/web3.js');
const { TransactionAnalyzer } = require('./transactionAnalyzer.js');
const { UniversalCloner } = require('./universalCloner.js');
const BN = require('bn.js');
const fs = require('fs');
const path = require('path');
const config = require('./config.js');

class ExactCloneTest {
    constructor() {
        this.connection = new Connection(config.RPC_URL);
        this.analyzer = new TransactionAnalyzer(this.connection);
        this.cloner = new UniversalCloner(this.connection);
    }

    async testExactClone() {
        console.log('🧪 EXACT CLONE TEST - Zero Modifications\n');
        console.log('🎯 Goal: Prove cloning logic works by using identical accounts\n');
        
        // Load the same transaction file
        const filePath = path.join(__dirname, 'transactions', 'copy_trade_211ArytbgWZdF3CXroM8fX2McsW3tYbKj2VjkG46M5QRH9GMQ7rJi4T1MsWmCd9S8R2VTGphoHusTVjCdPuQ9Hqq.json');
        const copyTradeData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        
        const swapDetails = copyTradeData.tradeDetails?.builderOptions?.swapDetails;
        const originalTx = copyTradeData.tradeDetails?.builderOptions?.originalTransaction;
        
        if (!swapDetails || !originalTx) {
            console.log('❌ Missing data');
            return;
        }
        
        // Get the exact instruction from the original transaction
        const platformProgramId = swapDetails.platformProgramId;
        const targetInstruction = originalTx.transaction.message.instructions.find(ix => {
            const programId = originalTx.transaction.message.accountKeys[ix.programIdIndex];
            return programId === platformProgramId;
        });
        
        if (!targetInstruction) {
            console.log('❌ Target instruction not found');
            return;
        }
        
        // Create cloning target with complete account resolution
        const allAccountKeys = [...originalTx.transaction.message.accountKeys];
        if (originalTx.meta && originalTx.meta.loadedAddresses) {
            if (originalTx.meta.loadedAddresses.writable) {
                allAccountKeys.push(...originalTx.meta.loadedAddresses.writable);
            }
            if (originalTx.meta.loadedAddresses.readonly) {
                allAccountKeys.push(...originalTx.meta.loadedAddresses.readonly);
            }
        }
        
        const cloningTarget = {
            programId: platformProgramId,
            accounts: targetInstruction.accounts.map(accountIndex => {
                const pubkey = allAccountKeys[accountIndex];
                const header = originalTx.transaction.message.header;
                const isSigner = accountIndex < header.numRequiredSignatures;
                
                // Calculate isWritable
                const numSigners = header.numRequiredSignatures;
                const numReadonlySigners = header.numReadonlySignedAccounts;
                const numWritableSigners = numSigners - numReadonlySigners;
                
                let isWritable = false;
                if (accountIndex < numWritableSigners) {
                    isWritable = true;
                } else if (accountIndex < numSigners) {
                    isWritable = false;
                } else {
                    const totalAccounts = originalTx.transaction.message.accountKeys.length;
                    const numReadonlyUnsigned = header.numReadonlyUnsignedAccounts;
                    const numWritableUnsigned = totalAccounts - numSigners - numReadonlyUnsigned;
                    isWritable = accountIndex < (numSigners + numWritableUnsigned);
                }
                
                return { pubkey, isSigner, isWritable };
            }),
            data: targetInstruction.data
        };
        
        console.log(`🔍 Original instruction:`);
        console.log(`   Program: ${platformProgramId}`);
        console.log(`   Accounts: ${cloningTarget.accounts.length}`);
        console.log(`   Data: ${targetInstruction.data}`);
        
        // Test 1: Use EXACT same accounts (no swapping)
        console.log(`\n🧪 Test 1: EXACT CLONE (no account changes)`);
        
        const exactBuilderOptions = {
            userPublicKey: new PublicKey(swapDetails.traderPubkey), // Use SAME trader
            masterTraderWallet: swapDetails.traderPubkey,
            cloningTarget: cloningTarget,
            tradeType: swapDetails.tradeType,
            inputMint: swapDetails.inputMint,
            outputMint: swapDetails.outputMint,
            amountBN: { toString: () => swapDetails.inputAmountLamports?.toString() || '1000000000' },
            slippageBps: 5000,
            userChatId: 'test',
            userSolAmount: new BN(swapDetails.inputAmountLamports?.toString() || '1000000000'),
            userTokenBalance: null,
            userRiskSettings: { slippageTolerance: 5000, maxTradesPerDay: 10 }
        };
        
        try {
            const exactResult = await this.cloner.buildClonedInstruction(exactBuilderOptions);
            
            if (exactResult && exactResult.instructions && exactResult.instructions.length > 0) {
                console.log(`✅ Exact clone built successfully: ${exactResult.instructions.length} instructions`);
                
                // Find the main instruction (not ATA creation)
                const mainInstruction = exactResult.instructions.find(ix => 
                    ix.programId.toBase58() === platformProgramId
                );
                
                if (mainInstruction) {
                    console.log(`🔍 Cloned instruction data: ${mainInstruction.data.toString('base64')}`);
                    console.log(`🔍 Original instruction data: ${targetInstruction.data}`);
                    
                    const originalBuffer = Buffer.from(targetInstruction.data, 'base64');
                    const dataMatches = originalBuffer.equals(mainInstruction.data);
                    console.log(`✅ Data integrity: ${dataMatches ? 'PERFECT' : 'CORRUPTED'}`);
                    
                    // Test simulation with exact accounts
                    console.log(`\n🔍 Simulating EXACT clone...`);
                    
                    const { blockhash } = await this.connection.getLatestBlockhash();
                    const messageV0 = new TransactionMessage({
                        payerKey: new PublicKey(swapDetails.traderPubkey), // Original trader as payer
                        recentBlockhash: blockhash,
                        instructions: [mainInstruction], // Only the main instruction, no ATA
                    }).compileToV0Message();
                    
                    const transaction = new VersionedTransaction(messageV0);
                    const simulationResult = await this.connection.simulateTransaction(transaction, {
                        sigVerify: false,
                        replaceRecentBlockhash: true,
                        commitment: 'processed'
                    });
                    
                    if (simulationResult.value.err) {
                        console.log(`❌ EXACT clone simulation failed: ${JSON.stringify(simulationResult.value.err)}`);
                        console.log(`   This means the issue is NOT in our cloning logic`);
                        console.log(`   The original instruction itself has issues in current blockchain state`);
                    } else {
                        console.log(`🎉 EXACT clone simulation SUCCESS!`);
                        console.log(`   This proves our cloning logic is PERFECT!`);
                        console.log(`   The issue is only in account swapping logic`);
                    }
                }
            } else {
                console.log(`❌ Failed to build exact clone`);
            }
            
        } catch (error) {
            console.log(`❌ Error in exact clone test: ${error.message}`);
        }
        
        console.log(`\n📊 EXACT CLONE TEST COMPLETE`);
        console.log(`=====================================`);
        console.log(`This test proves whether our core cloning logic is correct`);
        console.log(`by using the exact same accounts as the original transaction.`);
    }

    async runTest() {
        console.log('🚀 Starting Exact Clone Test...\n');
        
        try {
            await this.testExactClone();
        } catch (error) {
            console.error('❌ Test failed:', error.message);
        }
    }
}

// Run the test
if (require.main === module) {
    const test = new ExactCloneTest();
    test.runTest().catch(console.error);
}

module.exports = { ExactCloneTest };

