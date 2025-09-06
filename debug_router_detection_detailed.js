#!/usr/bin/env node

/**
 * Debug Router Detection - Detailed Analysis
 * 
 * This script debugs the Router detection logic with the actual failing transaction
 */

const { Connection, PublicKey } = require('@solana/web3.js');

async function debugRouterDetectionDetailed() {
    console.log('🔍 Debugging Router Detection - Detailed Analysis...\n');
    
    try {
        // Initialize connection
        const connection = new Connection('https://gilligan-jn1ghl-fast-mainnet.helius-rpc.com');
        
        // The failing transaction signature
        const testSignature = '3fyr2R5CZ7ahyHX4joXsP446cabqKETjAJp5Z9Jm7LkNRaNZUaZqPQgmQz3mwqb1ot88JvcXZNSUBEiHg9oiEojx';
        const traderAddress = '4BdKaxN8G6ka4GYtQQWk4G4dZRUTX2vQH9GcXdBREFUk';
        
        console.log(`📋 Testing transaction: ${testSignature}`);
        console.log(`👤 Trader address: ${traderAddress}\n`);
        
        // Fetch the transaction with proper versioned transaction support
        console.log('🔍 Fetching transaction from Solana...');
        const transactionResponse = await connection.getTransaction(testSignature, {
            maxSupportedTransactionVersion: 0,
            commitment: 'confirmed',
            encoding: 'json'
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
        
        console.log('🔍 Account Keys Analysis:');
        for (let i = 0; i < accountKeys.length; i++) {
            const account = accountKeys[i];
            console.log(`   Account ${i}: ${account}`);
            
            if (account === traderAddress) {
                console.log(`     👤 TRADER FOUND at index ${i}`);
            } else if (account === 'BSfD6SHZigAfDWSjzD5Q41jw8LmKwtmjskPH9XW1mrRW') {
                console.log(`     🎯 PHOTON ROUTER FOUND at index ${i}`);
            } else if (account === 'F5tfvbLog9VdGUPqBDTT8rgXvTTcq7e5UiGnupL1zvBq') {
                console.log(`     🎯 CUSTOM ROUTER FOUND at index ${i}`);
            }
        }
        
        console.log('\n🔍 Instructions Analysis:');
        const routerProgramIds = [
            'F5tfvbLog9VdGUPqBDTT8rgXvTTcq7e5UiGnupL1zvBq', // Custom Router
            'BSfD6SHZigAfDWSjzD5Q41jw8LmKwtmjskPH9XW1mrRW'  // Photon Router
        ];
        
        for (let i = 0; i < instructions.length; i++) {
            const instruction = instructions[i];
            const programId = accountKeys[instruction.programIdIndex];
            
            console.log(`   Instruction ${i}:`);
            console.log(`     Program ID Index: ${instruction.programIdIndex}`);
            console.log(`     Program ID: ${programId}`);
            console.log(`     Accounts: ${instruction.accounts.length}`);
            console.log(`     Data Length: ${instruction.data.length}`);
            
            // Check if this is a Router program
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
        
        // Test the actual Router detection function
        console.log('\n🔍 Testing Router Detection Function:');
        const { TransactionAnalyzer } = require('./transactionAnalyzer.js');
        const analyzer = new TransactionAnalyzer();
        
        const routerDetection = analyzer._detectRouterInstruction(transactionResponse, traderAddress);
        
        if (routerDetection.found) {
            console.log('✅ Router detection SUCCESS!');
            console.log(`   Program ID: ${routerDetection.programId}`);
            console.log(`   Instruction Index: ${routerDetection.instructionIndex}`);
            console.log(`   Has Cloning Target: ${!!routerDetection.cloningTarget}`);
        } else {
            console.log('❌ Router detection FAILED');
            console.log('   This means there is a bug in the detection logic');
        }
        
    } catch (error) {
        console.error('❌ Debug failed:', error.message);
        console.error('Stack:', error.stack);
    }
}

// Run the debug
debugRouterDetectionDetailed().then(() => {
    console.log('\n🏁 Router detection debug completed');
}).catch(error => {
    console.error('💥 Debug crashed:', error);
    process.exit(1);
});
