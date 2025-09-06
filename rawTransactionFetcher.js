/**
 * Raw Transaction Fetcher
 * 
 * This module fetches transactions using raw RPC calls to bypass ATL parsing issues
 */

// Use built-in fetch or require node-fetch
let fetch;
try {
    fetch = globalThis.fetch;
} catch (e) {
    fetch = require('node-fetch');
}

class RawTransactionFetcher {
    constructor(rpcUrl) {
        this.rpcUrl = rpcUrl;
    }

    /**
     * Fetch transaction using raw RPC call
     * @param {string} signature - Transaction signature
     * @returns {Object} - Raw transaction data
     */
    async getTransaction(signature) {
        try {
            const response = await fetch(this.rpcUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    jsonrpc: '2.0',
                    id: 1,
                    method: 'getTransaction',
                    params: [
                        signature,
                        {
                            encoding: 'json',
                            maxSupportedTransactionVersion: 0
                        }
                    ]
                })
            });

            const data = await response.json();
            
            if (data.error) {
                throw new Error(`RPC Error: ${data.error.message}`);
            }

            return data.result;

        } catch (error) {
            console.error(`[RAW-FETCHER] ❌ Failed to fetch transaction:`, error.message);
            return null;
        }
    }

    /**
     * Parse raw transaction data into a format compatible with the analyzer
     * @param {Object} rawTransaction - Raw transaction data from RPC
     * @returns {Object} - Parsed transaction compatible with analyzer
     */
    parseTransaction(rawTransaction) {
        if (!rawTransaction || !rawTransaction.transaction) {
            return null;
        }

        const transaction = rawTransaction.transaction;
        const message = transaction.message;

        // Extract account keys
        const accountKeys = message.accountKeys || [];

        // Extract instructions
        const instructions = message.instructions || [];

        // Create a transaction response compatible with the analyzer
        const parsedTransaction = {
            ...rawTransaction,
            transaction: {
                ...transaction,
                message: {
                    ...message,
                    accountKeys: accountKeys,
                    instructions: instructions
                }
            }
        };

        return parsedTransaction;
    }

    /**
     * Fetch and parse transaction
     * @param {string} signature - Transaction signature
     * @returns {Object} - Parsed transaction compatible with analyzer
     */
    async fetchAndParseTransaction(signature) {
        try {
            console.log(`[RAW-FETCHER] 🔍 Fetching transaction: ${signature}`);
            
            const rawTransaction = await this.getTransaction(signature);
            if (!rawTransaction) {
                return null;
            }

            const parsedTransaction = this.parseTransaction(rawTransaction);
            if (!parsedTransaction) {
                return null;
            }

            console.log(`[RAW-FETCHER] ✅ Transaction parsed successfully`);
            console.log(`   Instructions: ${parsedTransaction.transaction.message.instructions.length}`);
            console.log(`   Account Keys: ${parsedTransaction.transaction.message.accountKeys.length}`);

            return parsedTransaction;

        } catch (error) {
            console.error(`[RAW-FETCHER] ❌ Failed to fetch and parse transaction:`, error.message);
            return null;
        }
    }
}

module.exports = { RawTransactionFetcher };
