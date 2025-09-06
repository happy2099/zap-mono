/**
 * ATL Resolver
 * 
 * This module handles Address Table Lookup (ATL) resolution for versioned transactions
 */

const { Connection, PublicKey } = require('@solana/web3.js');

class ATLResolver {
    constructor(connection) {
        this.connection = connection;
    }

    /**
     * Resolve Address Table Lookups in a versioned transaction
     * @param {Object} transactionResponse - The raw transaction response from RPC
     * @returns {Object} - Resolved transaction with expanded account keys and instructions
     */
    async resolveATLs(transactionResponse) {
        try {
            if (!transactionResponse || !transactionResponse.transaction) {
                return transactionResponse;
            }

            const transaction = transactionResponse.transaction;
            const message = transaction.message;

            // Check if this transaction has ATLs
            if (!message.addressTableLookups || message.addressTableLookups.length === 0) {
                return transactionResponse;
            }

            console.log(`[ATL-RESOLVER] 🔍 Resolving ${message.addressTableLookups.length} ATL(s)...`);

            // Resolve all ATLs
            const resolvedAccounts = new Map();
            let accountIndex = message.accountKeys.length;

            for (const atl of message.addressTableLookups) {
                try {
                    // Fetch the lookup table
                    const lookupTable = await this.connection.getAddressLookupTable(new PublicKey(atl.accountKey));
                    
                    if (!lookupTable || !lookupTable.value) {
                        console.warn(`[ATL-RESOLVER] ⚠️ Could not fetch lookup table: ${atl.accountKey}`);
                        continue;
                    }

                    const addresses = lookupTable.value.state.addresses;

                    // Map readonly indexes
                    for (const index of atl.readonlyIndexes) {
                        if (index < addresses.length) {
                            resolvedAccounts.set(accountIndex, addresses[index]);
                            accountIndex++;
                        }
                    }

                    // Map writable indexes
                    for (const index of atl.writableIndexes) {
                        if (index < addresses.length) {
                            resolvedAccounts.set(accountIndex, addresses[index]);
                            accountIndex++;
                        }
                    }

                    console.log(`[ATL-RESOLVER] ✅ Resolved ATL ${atl.accountKey}: ${atl.readonlyIndexes.length + atl.writableIndexes.length} accounts`);

                } catch (error) {
                    console.warn(`[ATL-RESOLVER] ⚠️ Failed to resolve ATL ${atl.accountKey}:`, error.message);
                }
            }

            // Create expanded account keys array
            const expandedAccountKeys = [...message.accountKeys];
            for (let i = message.accountKeys.length; i < accountIndex; i++) {
                if (resolvedAccounts.has(i)) {
                    expandedAccountKeys.push(resolvedAccounts.get(i));
                }
            }

            // Create resolved transaction
            const resolvedTransaction = {
                ...transactionResponse,
                transaction: {
                    ...transaction,
                    message: {
                        ...message,
                        accountKeys: expandedAccountKeys,
                        // Remove ATLs since they're now resolved
                        addressTableLookups: []
                    }
                }
            };

            console.log(`[ATL-RESOLVER] ✅ ATL resolution complete: ${expandedAccountKeys.length} total accounts`);

            return resolvedTransaction;

        } catch (error) {
            console.error(`[ATL-RESOLVER] ❌ ATL resolution failed:`, error.message);
            return transactionResponse;
        }
    }

    /**
     * Fetch and resolve a transaction with ATLs
     * @param {string} signature - Transaction signature
     * @param {Object} options - Fetch options
     * @returns {Object} - Resolved transaction
     */
    async getResolvedTransaction(signature, options = {}) {
        try {
            // Fetch the raw transaction
            const transactionResponse = await this.connection.getTransaction(signature, {
                maxSupportedTransactionVersion: 0,
                encoding: 'json',
                ...options
            });

            if (!transactionResponse) {
                return null;
            }

            // Resolve ATLs if present
            return await this.resolveATLs(transactionResponse);

        } catch (error) {
            console.error(`[ATL-RESOLVER] ❌ Failed to fetch and resolve transaction:`, error.message);
            return null;
        }
    }
}

module.exports = { ATLResolver };
