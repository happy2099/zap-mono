#!/usr/bin/env node

/**
 * Test ATL Resolver
 * 
 * This script tests the ATL resolver with the failing transaction
 */

const { Connection } = require('@solana/web3.js');
const { ATLResolver } = require('./atlResolver.js');

async function testATLResolver() {
    console.log('🔍 Testing ATL Resolver...\n');
    
    try {
        // Initialize connection and resolver
        const connection = new Connection('https://gilligan-jn1ghl-fast-mainnet.helius-rpc.com');
        const atlResolver = new ATLResolver(connection);
        
        // The failing transaction signature
        const testSignature = '3fyr2R5CZ7ahyHX4joXsP446cabqKETjAJp5Z9Jm7LkNRaNZUaZqPQgmQz3mwqb1ot88JvcXZNSUBEiHg9oiEojx';
        const traderAddress = '4BdKaxN8G6ka4GYtQQWk4G4dZRUTX2vQH9GcXdBREFUk';
        
        console.log(`📋 Testing transaction: ${testSignature}`);
        console.log(`👤 Trader address: ${traderAddress}\n`);
        
        // Fetch and resolve the transaction
        console.log('🔍 Fetching and resolving transaction...');
        const resolvedTransaction = await atlResolver.getResolvedTransaction(testSignature);
        
        if (!resolvedTransaction) {
            console.log('❌ Failed to fetch or resolve transaction');
            return;
        }
        
        console.log('✅ Transaction fetched and resolved successfully\n');
        
        // Debug the resolved transaction structure
        console.log('🔍 Resolved Transaction Structure:');
        console.log(`   Version: ${resolvedTransaction.version}`);
        console.log(`   Has Meta: ${!!resolvedTransaction.meta}`);
        console.log(`   Has Error: ${!!resolvedTransaction.meta?.err}`);
        console.log(`   Instructions Count: ${resolvedTransaction.transaction?.message?.instructions?.length || 0}`);
        console.log(`   Account Keys Count: ${resolvedTransaction.transaction?.message?.accountKeys?.length || 0}\n`);
        
        // Debug instructions
        const instructions = resolvedTransaction.transaction?.message?.instructions || [];
        const accountKeys = resolvedTransaction.transaction?.message?.accountKeys || [];
        
        console.log('🔍 Instructions Analysis:');
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
        
        // Test Router detection with resolved transaction
        console.log('\n🔍 Testing Router Detection with Resolved Transaction:');
        const { TransactionAnalyzer } = require('./transactionAnalyzer.js');
        const analyzer = new TransactionAnalyzer();
        
        const routerDetection = analyzer._detectRouterInstruction(resolvedTransaction, traderAddress);
        
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
            console.log('   This means there is still an issue with the detection logic');
        }
        
    } catch (error) {
        console.error('❌ Test failed:', error.message);
        console.error('Stack:', error.stack);
    }
}

// Run the test
testATLResolver().then(() => {
    console.log('\n🏁 ATL resolver test completed');
}).catch(error => {
    console.error('💥 Test crashed:', error);
    process.exit(1);
});
