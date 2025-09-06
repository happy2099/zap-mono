#!/usr/bin/env node

/**
 * Test Router Detection - Simple Test
 * 
 * This script tests the Router detection with a mock transaction structure
 */

const { TransactionAnalyzer } = require('./transactionAnalyzer.js');

function testRouterDetectionSimple() {
    console.log('🔧 Testing Router Detection - Simple Test...\n');
    
    try {
        const analyzer = new TransactionAnalyzer();
        
        // Mock transaction structure based on the curl output
        const mockTransactionResponse = {
            transaction: {
                message: {
                    instructions: [
                        {
                            accounts: [1, 15, 0],
                            data: "6vx8P",
                            programIdIndex: 7
                        },
                        {
                            accounts: [16],
                            data: "LEJDE7",
                            programIdIndex: 8
                        },
                        {
                            accounts: [],
                            data: "3Towjo2HBAqm",
                            programIdIndex: 8
                        },
                        {
                            accounts: [17, 13, 18, 10, 2, 3, 4, 0, 14, 19, 7, 20, 21, 22, 5, 11, 12],
                            data: "5e1SU32LVWyU6PVgHv3fBRhu5AUmPVPM1tBoa85UpwTeEqqwPsLfqiP",
                            programIdIndex: 9  // This should be the Photon Router
                        },
                        {
                            accounts: [0, 6],
                            data: "3Bxs3zsiAaXLi9bM",
                            programIdIndex: 7
                        }
                    ],
                    accountKeys: [
                        "4BdKaxN8G6ka4GYtQQWk4G4dZRUTX2vQH9GcXdBREFUk", // 0 - Trader
                        "Cbnwre7wmWzHLXAJfUCSuotnAAKkVAsNayR2dzyU26Lr", // 1
                        "59KDxKvb28s8gJn31MSs7qchgRdzi4MQe8rWjKVMjVxt", // 2
                        "5TQGdmpGYmPqKNivd3WRAAfcjERU2QUJNVRZQxL3r2G", // 3
                        "7nu7aKHh4c4kvFoHe7hjaYcD1fscGCebuXJA5yafnh6U", // 4
                        "AUwANHHMR5fVPp1Vcz5yW4P6EUNbJeMiNznq6MhBWK3E", // 5
                        "6AUXdaeod2NRTPpKFLcxMesTKtxAATaK8QTdUuyE7ixt", // 6
                        "11111111111111111111111111111111", // 7 - System Program
                        "ComputeBudget111111111111111111111111111111", // 8 - Compute Budget
                        "BSfD6SHZigAfDWSjzD5Q41jw8LmKwtmjskPH9XW1mrRW", // 9 - Photon Router
                        "G8pdSTBgZZYwHL1rDigNmjYGxV7MT5wHBUR278qqpump", // 10
                        "8Wf5TiAheLUqBrKXeYg2JtAFFMWtKdG2BSFgqUcPVwTt", // 11
                        "pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ"  // 12
                    ]
                }
            }
        };
        
        const traderAddress = '4BdKaxN8G6ka4GYtQQWk4G4dZRUTX2vQH9GcXdBREFUk';
        
        console.log('📋 Testing with mock transaction structure');
        console.log(`👤 Trader address: ${traderAddress}\n`);
        
        // Test Router detection
        console.log('🎯 Testing Router detection...');
        const routerDetection = analyzer._detectRouterInstruction(mockTransactionResponse, traderAddress);
        
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
            console.log('   This means there is a bug in the detection logic');
        }
        
        // Debug the detection process
        console.log('\n🔍 Debug Detection Process:');
        const instructions = mockTransactionResponse.transaction.message.instructions;
        const accountKeys = mockTransactionResponse.transaction.message.accountKeys;
        
        console.log(`   Instructions count: ${instructions.length}`);
        console.log(`   Account keys count: ${accountKeys.length}`);
        
        for (let i = 0; i < instructions.length; i++) {
            const instruction = instructions[i];
            const programId = accountKeys[instruction.programIdIndex];
            
            console.log(`   Instruction ${i}:`);
            console.log(`     Program ID Index: ${instruction.programIdIndex}`);
            console.log(`     Program ID: ${programId}`);
            
            if (programId === 'BSfD6SHZigAfDWSjzD5Q41jw8LmKwtmjskPH9XW1mrRW') {
                console.log(`     🎯 PHOTON ROUTER FOUND!`);
                
                // Check if trader is a signer
                const isSigner = instruction.accounts.some(accountIndex => {
                    const account = accountKeys[accountIndex];
                    return account === traderAddress;
                });
                
                console.log(`     Trader is signer: ${isSigner}`);
            }
        }
        
    } catch (error) {
        console.error('❌ Test failed:', error.message);
        console.error('Stack:', error.stack);
    }
}

// Run the test
testRouterDetectionSimple().then(() => {
    console.log('\n🏁 Router detection simple test completed');
}).catch(error => {
    console.error('💥 Test crashed:', error);
    process.exit(1);
});
