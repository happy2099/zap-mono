#!/usr/bin/env node

/**
 * Test ATL Resolution
 * 
 * This script tests if we can properly resolve Address Table Lookups (ATLs)
 */

const { Connection, PublicKey, AddressLookupTableProgram } = require('@solana/web3.js');

async function testATLResolution() {
    console.log('🔍 Testing ATL Resolution...\n');
    
    try {
        // Initialize connection
        const connection = new Connection('https://gilligan-jn1ghl-fast-mainnet.helius-rpc.com');
        
        // The failing transaction signature
        const testSignature = '3fyr2R5CZ7ahyHX4joXsP446cabqKETjAJp5Z9Jm7LkNRaNZUaZqPQgmQz3mwqb1ot88JvcXZNSUBEiHg9oiEojx';
        
        console.log(`📋 Testing transaction: ${testSignature}\n`);
        
        // Fetch the transaction with all possible options
        console.log('🔍 Fetching transaction with different options...');
        
        // Try 1: Basic fetch
        console.log('   Trying basic fetch...');
        const tx1 = await connection.getTransaction(testSignature, {
            maxSupportedTransactionVersion: 0
        });
        console.log(`   Result: ${tx1 ? 'Success' : 'Failed'}`);
        if (tx1) {
            console.log(`   Instructions: ${tx1.transaction?.message?.instructions?.length || 0}`);
            console.log(`   Account Keys: ${tx1.transaction?.message?.accountKeys?.length || 0}`);
        }
        
        // Try 2: With encoding
        console.log('   Trying with encoding...');
        const tx2 = await connection.getTransaction(testSignature, {
            maxSupportedTransactionVersion: 0,
            encoding: 'json'
        });
        console.log(`   Result: ${tx2 ? 'Success' : 'Failed'}`);
        if (tx2) {
            console.log(`   Instructions: ${tx2.transaction?.message?.instructions?.length || 0}`);
            console.log(`   Account Keys: ${tx2.transaction?.message?.accountKeys?.length || 0}`);
        }
        
        // Try 3: With commitment
        console.log('   Trying with commitment...');
        const tx3 = await connection.getTransaction(testSignature, {
            maxSupportedTransactionVersion: 0,
            encoding: 'json',
            commitment: 'confirmed'
        });
        console.log(`   Result: ${tx3 ? 'Success' : 'Failed'}`);
        if (tx3) {
            console.log(`   Instructions: ${tx3.transaction?.message?.instructions?.length || 0}`);
            console.log(`   Account Keys: ${tx3.transaction?.message?.accountKeys?.length || 0}`);
        }
        
        // Try 4: Parsed transaction
        console.log('   Trying parsed transaction...');
        const tx4 = await connection.getParsedTransaction(testSignature, {
            maxSupportedTransactionVersion: 0,
            encoding: 'json'
        });
        console.log(`   Result: ${tx4 ? 'Success' : 'Failed'}`);
        if (tx4) {
            console.log(`   Instructions: ${tx4.transaction?.message?.instructions?.length || 0}`);
            console.log(`   Account Keys: ${tx4.transaction?.message?.accountKeys?.length || 0}`);
        }
        
        // Check if any of them have ATL data
        const transactions = [tx1, tx2, tx3, tx4];
        for (let i = 0; i < transactions.length; i++) {
            const tx = transactions[i];
            if (tx && tx.transaction?.message?.addressTableLookups) {
                console.log(`\n🎯 Transaction ${i + 1} has ATL data:`);
                console.log(`   ATL Count: ${tx.transaction.message.addressTableLookups.length}`);
                tx.transaction.message.addressTableLookups.forEach((atl, index) => {
                    console.log(`   ATL ${index}: ${atl.accountKey}`);
                    console.log(`     Readonly: ${atl.readonlyIndexes.length}`);
                    console.log(`     Writable: ${atl.writableIndexes.length}`);
                });
            }
        }
        
    } catch (error) {
        console.error('❌ Test failed:', error.message);
        console.error('Stack:', error.stack);
    }
}

// Run the test
testATLResolution().then(() => {
    console.log('\n🏁 ATL resolution test completed');
}).catch(error => {
    console.error('💥 Test crashed:', error);
    process.exit(1);
});
