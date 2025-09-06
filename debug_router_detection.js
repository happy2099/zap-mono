#!/usr/bin/env node

/**
 * Debug Router Detection
 * 
 * This script debugs the Router detection logic to see why it's not working
 */

const { Connection, PublicKey } = require('@solana/web3.js');

async function debugRouterDetection() {
    console.log('🔍 Debugging Router Detection...\n');
    
    try {
        // Initialize connection
        const connection = new Connection('https://gilligan-jn1ghl-fast-mainnet.helius-rpc.com');
        
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
        
        // Debug the transaction structure
        console.log('🔍 Transaction Structure:');
        console.log(`   Version: ${transactionResponse.version}`);
        console.log(`   Has Meta: ${!!transactionResponse.meta}`);
        console.log(`   Has Error: ${!!transactionResponse.meta?.err}`);
        console.log(`   Instructions Count: ${transactionResponse.transaction?.message?.instructions?.length || 0}`);
        console.log(`   Account Keys Count: ${transactionResponse.transaction?.message?.accountKeys?.length || 0}\n`);
        
        // Debug instructions
        const instructions = transactionResponse.transaction?.message?.instructions || [];
        const accountKeys = transactionResponse.transaction?.message?.accountKeys || [];
        
        console.log('🔍 Instructions Analysis:');
        for (let i = 0; i < instructions.length; i++) {
            const instruction = instructions[i];
            const programId = accountKeys[instruction.programIdIndex];
            
            console.log(`   Instruction ${i}:`);
            console.log(`     Program ID: ${programId}`);
            console.log(`     Accounts: ${instruction.accounts.length}`);
            console.log(`     Data Length: ${instruction.data.length}`);
            
            // Check if this is a Router program
            const routerProgramIds = [
                'F5tfvbLog9VdGUPqBDTT8rgXvTTcq7e5UiGnupL1zvBq', // Custom Router
                'BSfD6SHZigAfDWSjzD5Q41jw8LmKwtmjskPH9XW1mrRW'  // Photon Router
            ];
            
            if (routerProgramIds.includes(programId)) {
                console.log(`     🎯 ROUTER DETECTED!`);
                
                // Check if trader is a signer
                const isSigner = instruction.accounts.some(accountIndex => {
                    const account = accountKeys[accountIndex];
                    return account === traderAddress;
                });
                
                console.log(`     Trader is signer: ${isSigner}`);
                
                if (isSigner) {
                    console.log(`     ✅ This should be detected as Router!`);
                } else {
                    console.log(`     ❌ Trader is not a signer - this might be why detection fails`);
                }
            }
        }
        
        // Debug account keys
        console.log('\n🔍 Account Keys Analysis:');
        for (let i = 0; i < accountKeys.length; i++) {
            const account = accountKeys[i];
            if (account === traderAddress) {
                console.log(`   Account ${i}: ${account} (TRADER)`);
            } else if (account === 'BSfD6SHZigAfDWSjzD5Q41jw8LmKwtmjskPH9XW1mrRW') {
                console.log(`   Account ${i}: ${account} (PHOTON ROUTER)`);
            } else if (account === 'F5tfvbLog9VdGUPqBDTT8rgXvTTcq7e5UiGnupL1zvBq') {
                console.log(`   Account ${i}: ${account} (CUSTOM ROUTER)`);
            }
        }
        
    } catch (error) {
        console.error('❌ Debug failed:', error.message);
        console.error('Stack:', error.stack);
    }
}

// Run the debug
debugRouterDetection().then(() => {
    console.log('\n🏁 Router detection debug completed');
}).catch(error => {
    console.error('💥 Debug crashed:', error);
    process.exit(1);
});
