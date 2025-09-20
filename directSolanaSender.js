// File: directSolanaSender.js
// Description: Direct Solana transaction injection using leader targeting and Helius RPC
// Replaces Singapore Sender with native @solana/web3.js for better control and reliability

const { Connection, VersionedTransaction, TransactionMessage, ComputeBudgetProgram, PublicKey } = require('@solana/web3.js');
const config = require('./config.js');
const leaderTracker = require('./leaderTracker.js');

class DirectSolanaSender {
    constructor() {
        // Primary connection (Helius Business-tier)
        this.primaryConnection = new Connection(config.HELIUS_ENDPOINTS.rpc);
        
        // Leader-specific connections (fallback)
        this.leaderConnections = new Map();
        
        // Performance tracking
        this.stats = {
            totalSends: 0,
            successfulSends: 0,
            leaderTargets: 0,
            fallbackSends: 0,
            averageLatency: 0
        };
        
        console.log('[DIRECT-SOLANA-SENDER] 🚀 Initialized with direct Solana injection');
    }

    /**
     * Execute copy trade directly to Solana using leader targeting
     */
    async executeCopyTrade(originalTransaction, keypair, options = {}) {
        const startTime = Date.now();
        this.stats.totalSends++;
        
        try {
            console.log(`[DIRECT-SOLANA-SENDER] 🎯 Starting direct copy trade execution`);
            
            // 🎯 USE CLONED INSTRUCTIONS IF PROVIDED, OTHERWISE USE ORIGINAL
            const instructionsToUse = options.clonedInstructions || originalTransaction.instructions;
            console.log(`[DIRECT-SOLANA-SENDER] 🔍 Using ${options.clonedInstructions ? 'cloned' : 'original'} instructions (${instructionsToUse.length} total)`);
            
            // 🎯 EXTRACT TRADER'S COMPUTE BUDGET (for exact replication)
            const traderComputeBudget = this._extractTraderComputeBudget(instructionsToUse);
            
            // 🎯 HARDCODED FEE STRATEGY (15% of SOL amount, max 1M microLamports)
            let computeUnits, effectiveMicroLamports;
            
            // Use trader's compute units if available, otherwise default
            if (traderComputeBudget.units) {
                computeUnits = traderComputeBudget.units;
                console.log(`[DIRECT-SOLANA-SENDER] 🎯 Using trader's compute units: ${computeUnits}`);
            } else {
                computeUnits = options.computeUnits || 1_200_000; // Higher default for Pump.fun
                console.log(`[DIRECT-SOLANA-SENDER] ⚠️ No trader compute units found, using default: ${computeUnits}`);
            }
            
            // 🚀 HARDCODED PRIORITY FEE: 15% of SOL amount, capped at 1M microLamports
            const userSolAmount = options.userSolAmount || 5_000_000; // Default 0.005 SOL in lamports
            const calculatedFee = Math.floor(userSolAmount * 0.15); // 15% of SOL amount
            effectiveMicroLamports = Math.min(calculatedFee, 1_000_000); // Cap at 1M microLamports
            
            console.log(`[DIRECT-SOLANA-SENDER] 🎯 Hardcoded fee strategy:`);
            console.log(`[DIRECT-SOLANA-SENDER]   User SOL amount: ${userSolAmount / 1_000_000_000} SOL`);
            console.log(`[DIRECT-SOLANA-SENDER]   15% fee: ${calculatedFee} microLamports`);
            console.log(`[DIRECT-SOLANA-SENDER]   Final fee: ${effectiveMicroLamports} microLamports (capped)`);

            // Get recent blockhash or use nonce if available
            let blockhash, lastValidBlockHeight;
            if (options.nonceInfo) {
                // Use nonce as blockhash for durable transactions (never expires)
                blockhash = options.nonceInfo.nonce;
                lastValidBlockHeight = 0; // Nonce transactions don't expire
                console.log(`[DIRECT-SOLANA-SENDER] 🔐 Using durable nonce as blockhash: ${blockhash.substring(0, 8)}... (transaction will NEVER expire)`);
            } else {
                // Get fresh blockhash for regular transactions
                const { value: blockhashData } = await this.primaryConnection.getLatestBlockhashAndContext('confirmed');
                blockhash = blockhashData.blockhash;
                lastValidBlockHeight = blockhashData.lastValidBlockHeight;
                console.log(`[DIRECT-SOLANA-SENDER] 🔍 Fresh blockhash: ${blockhash.substring(0, 8)}... (valid until block ${lastValidBlockHeight})`);
            }
            
            // Create copy of instructions to avoid modifying the original
            const allInstructions = [...instructionsToUse];

            // 🎯 CREATE NEW TRANSACTION (Universal Cloner handles account mapping)
            console.log(`[DIRECT-SOLANA-SENDER] 🎯 Creating new transaction - Universal Cloner handles account mapping`);
            
            // Debug: Log all instruction accounts
            console.log(`[DIRECT-SOLANA-SENDER] 🔍 DEBUG: Analyzing ${allInstructions.length} instructions:`);
            allInstructions.forEach((instruction, index) => {
                console.log(`[DIRECT-SOLANA-SENDER] 🔍 Instruction ${index}: ${instruction.programId.toString()} with ${instruction.keys.length} accounts`);
                instruction.keys.forEach((key, keyIndex) => {
                    console.log(`[DIRECT-SOLANA-SENDER] 🔍   Account ${keyIndex}: ${key.pubkey.toString()} (signer: ${key.isSigner}, writable: ${key.isWritable})`);
                });
            });
            
            // Create new VersionedTransaction with cloned instructions
            // The Universal Cloner has already mapped all accounts correctly
            const optimizedTransaction = new VersionedTransaction(
                new TransactionMessage({
                    instructions: allInstructions,
                    payerKey: keypair.publicKey,
                    recentBlockhash: blockhash,
                }).compileToV0Message()
            );
            
            // Sign transaction
            optimizedTransaction.sign([keypair]);
            
            console.log(`[DIRECT-SOLANA-SENDER] ✅ Optimized transaction built with ${allInstructions.length} instructions`);
            console.log(`[DIRECT-SOLANA-SENDER] 🔧 Compute units: ${computeUnits}, Priority fee: ${effectiveMicroLamports} microLamports`);
            console.log(`[DIRECT-SOLANA-SENDER] 📝 Transaction size: ${optimizedTransaction.serialize().length} bytes`);

            // 🚀 DIRECT TO CHAIN: No simulation - fire directly for maximum speed
            console.log(`[DIRECT-SOLANA-SENDER] 🚀 Skipping simulation - firing directly to chain for maximum speed`);

            // 🎯 TARGET CURRENT LEADER (for faster confirmation)
            const currentLeader = leaderTracker.getCurrentLeader();
            const isHealthy = leaderTracker.isHealthy();
            let targetConnection = this.primaryConnection;
            let targetDescription = 'Helius RPC (primary)';
            
            // Debug leader tracker status
            console.log(`[DIRECT-SOLANA-SENDER] 🔍 Leader tracker status: isMonitoring=${leaderTracker.isMonitoring}, isHealthy=${isHealthy}, currentLeader=${currentLeader ? currentLeader.substring(0, 8) + '...' : 'null'}`);
            
            if (currentLeader && isHealthy) {
                console.log(`[DIRECT-SOLANA-SENDER] 🎯 Current leader: ${currentLeader}`);
                
                // Try to use leader-specific connection if available
                const leaderRpcUrl = this._getLeaderRpcUrl(currentLeader);
                if (leaderRpcUrl) {
                    targetConnection = this._getLeaderConnection(currentLeader, leaderRpcUrl);
                    targetDescription = `Leader ${currentLeader.substring(0, 8)}...`;
                    this.stats.leaderTargets++;
                } else {
                    console.log(`[DIRECT-SOLANA-SENDER] ⚠️ No RPC available for leader, using primary connection`);
                    this.stats.fallbackSends++;
                }
            } else {
                console.log(`[DIRECT-SOLANA-SENDER] ⚠️ No leader available or tracker unhealthy, using primary connection`);
                this.stats.fallbackSends++;
            }

            // 🎯 SEND TRANSACTION DIRECTLY
            console.log(`[DIRECT-SOLANA-SENDER] 📤 Sending transaction via ${targetDescription}...`);
            
            const signature = await targetConnection.sendTransaction(optimizedTransaction, {
                skipPreflight: true,
                maxRetries: 0 // We handle retries ourselves
            });
            
            console.log(`[DIRECT-SOLANA-SENDER] ✅ Transaction sent successfully!`);
            console.log(`[DIRECT-SOLANA-SENDER] 📝 Signature: ${signature}`);

            // 🎯 CONFIRM TRANSACTION WITH TIMEOUT
            console.log(`[DIRECT-SOLANA-SENDER] ⏳ Confirming transaction...`);
            
            // Add timeout to prevent hanging
            let confirmationPromise;
            if (options.nonceInfo) {
                // For nonce transactions, use custom confirmation without block height check
                console.log(`[DIRECT-SOLANA-SENDER] 🔐 Confirming nonce transaction (custom polling method)`);
                confirmationPromise = this._confirmNonceTransaction(targetConnection, signature);
            } else {
                // For regular transactions, use block height check
                confirmationPromise = targetConnection.confirmTransaction({
                    signature,
                    lastValidBlockHeight,
                    commitment: 'confirmed'
                });
            }
            
            // Add a race condition with a timeout to prevent hanging
            const timeoutPromise = new Promise((_, reject) => {
                setTimeout(() => {
                    reject(new Error('Transaction confirmation timeout - proceeding without confirmation'));
                }, 1500); // 1.5 second timeout for ultra-fast copy trading
            });
            
            // Ultra-fast mode: Skip confirmation entirely if requested
            if (options.skipConfirmation) {
                console.log(`[DIRECT-SOLANA-SENDER] ⚡ Ultra-fast mode: Skipping confirmation, transaction sent successfully`);
                return {
                    signature,
                    success: true,
                    confirmation: { value: { err: null, slot: null, confirmations: null } }
                };
            }
            
            const confirmation = await Promise.race([confirmationPromise, timeoutPromise]);
            
            console.log(`[DIRECT-SOLANA-SENDER] 🔍 Confirmation result:`, {
                signature,
                err: confirmation.value.err,
                slot: confirmation.value.slot,
                confirmations: confirmation.value.confirmations
            });
            
            if (confirmation.value.err) {
                console.error(`[DIRECT-SOLANA-SENDER] ❌ Transaction failed on-chain:`, confirmation.value.err);
                throw new Error(`Confirmation failed: ${JSON.stringify(confirmation.value.err)}`);
            }
            
            const latency = Date.now() - startTime;
            this.stats.successfulSends++;
            this.stats.averageLatency = (this.stats.averageLatency + latency) / 2;
            
            console.log(`[DIRECT-SOLANA-SENDER] 🎉 Transaction confirmed in ${latency}ms!`);
            console.log(`[DIRECT-SOLANA-SENDER] 📊 Stats: ${this.stats.successfulSends}/${this.stats.totalSends} successful, avg latency: ${Math.round(this.stats.averageLatency)}ms`);

            return {
                success: true,
                signature,
                executionTime: latency,
                confirmationTime: latency, // Same as execution time for now
                latency,
                target: targetDescription,
                confirmation
            };

        } catch (error) {
            const latency = Date.now() - startTime;
            const errorMessage = error?.message || error?.toString() || 'Unknown error';
            console.error(`[DIRECT-SOLANA-SENDER] ❌ Execution failed after ${latency}ms:`, errorMessage);
            console.error(`[DIRECT-SOLANA-SENDER] 🔍 Full error object:`, error);
            
            // Handle specific error types
            if (errorMessage && errorMessage.includes('Confirmation timeout')) {
                console.error(`[DIRECT-SOLANA-SENDER] ⏰ Transaction confirmation timed out - transaction may still be processing`);
                console.error(`[DIRECT-SOLANA-SENDER] 🔍 Check signature manually: ${signature || 'unknown'}`);
            } else if (errorMessage && errorMessage.includes('Confirmation failed')) {
                console.error(`[DIRECT-SOLANA-SENDER] ❌ Transaction confirmed but failed on-chain`);
            } else {
                console.error(`[DIRECT-SOLANA-SENDER] ❌ Unexpected error during execution`);
            }
            
            return {
                success: false,
                error: errorMessage,
                executionTime: latency,
                confirmationTime: 0,
                latency
            };
        }
    }

    /**
     * Extract trader's compute budget from original transaction
     */
    _extractTraderComputeBudget(instructions) {
        const computeBudgetProgram = 'ComputeBudget111111111111111111111111111111';
        let units = null;
        let priorityFee = null;
        
        console.log(`[DIRECT-SOLANA-SENDER] 🔍 Extracting trader's compute budget from ${instructions.length} instructions`);
        
        for (let i = 0; i < instructions.length; i++) {
            const instruction = instructions[i];
            if (instruction.programId.toString() === computeBudgetProgram) {
                try {
                    const data = Buffer.from(instruction.data);
                    const discriminator = data[0];
                    
                    console.log(`[DIRECT-SOLANA-SENDER] 🔍 Found compute budget instruction ${i}: discriminator=${discriminator}`);
                    
                    if (discriminator === 2) { // SetComputeUnitLimit
                        units = data.readUInt32LE(1);
                        console.log(`[DIRECT-SOLANA-SENDER] 🎯 Trader's compute units: ${units}`);
                    } else if (discriminator === 3) { // SetComputeUnitPrice
                        priorityFee = data.readBigUInt64LE(1);
                        console.log(`[DIRECT-SOLANA-SENDER] 🎯 Trader's priority fee: ${priorityFee} microLamports`);
                    }
                } catch (error) {
                    console.warn(`[DIRECT-SOLANA-SENDER] ⚠️ Failed to parse compute budget instruction ${i}:`, error.message);
                }
            }
        }
        
        const result = { 
            units: units ? Number(units) : null, 
            priorityFee: priorityFee ? Number(priorityFee) : null 
        };
        
        console.log(`[DIRECT-SOLANA-SENDER] 🎯 Extracted compute budget:`, result);
        return result;
    }

    /**
     * Get leader-specific RPC URL (if available)
     */
    _getLeaderRpcUrl(leaderPublicKey) {
        // Most leaders don't expose public RPCs, but some do
        // You can add known leader RPCs here
        const knownLeaderRpcs = {
            // Add known leader RPCs here if you have them
            // 'leaderPublicKey': 'https://leader-rpc.example.com'
        };
        
        return knownLeaderRpcs[leaderPublicKey] || null;
    }

    /**
     * Get or create leader-specific connection
     */
    _getLeaderConnection(leaderPublicKey, rpcUrl) {
        if (!this.leaderConnections.has(leaderPublicKey)) {
            console.log(`[DIRECT-SOLANA-SENDER] 🔗 Creating connection for leader ${leaderPublicKey.substring(0, 8)}...`);
            this.leaderConnections.set(leaderPublicKey, new Connection(rpcUrl));
        }
        
        return this.leaderConnections.get(leaderPublicKey);
    }

    /**
     * Custom confirmation method for nonce transactions (no block height check)
     * @private
     */
    async _confirmNonceTransaction(connection, signature) {
        console.log(`[DIRECT-SOLANA-SENDER] 🔐 Starting custom nonce transaction confirmation for ${signature.substring(0, 8)}...`);
        
        const startTime = Date.now();
        const maxWaitTime = 1000; // 1 second max for ultra-fast copy trading
        const pollInterval = 50; // Poll every 50ms for ultra-fast response
        
        let lastStatus = null;
        let consecutiveNotFound = 0;
        
        while (Date.now() - startTime < maxWaitTime) {
            try {
                // Try multiple confirmation methods
                const status = await connection.getSignatureStatus(signature, {
                    searchTransactionHistory: true
                });
                
                if (status && status.value) {
                    const { confirmationStatus, err, slot } = status.value;
                    lastStatus = status.value;
                    
                    if (err) {
                        console.error(`[DIRECT-SOLANA-SENDER] ❌ Nonce transaction failed:`, err);
                        throw new Error(`Transaction failed: ${JSON.stringify(err)}`);
                    }
                    
                    if (confirmationStatus === 'confirmed' || confirmationStatus === 'finalized') {
                        const confirmationTime = Date.now() - startTime;
                        console.log(`[DIRECT-SOLANA-SENDER] ✅ Nonce transaction confirmed in ${confirmationTime}ms (status: ${confirmationStatus}, slot: ${slot})`);
                        return {
                            value: {
                                err: null,
                                slot: slot,
                                confirmations: status.value.confirmations || 1,
                                confirmationStatus
                            }
                        };
                    }
                    
                    console.log(`[DIRECT-SOLANA-SENDER] 🔄 Nonce transaction status: ${confirmationStatus}, waiting...`);
                    consecutiveNotFound = 0; // Reset counter when we find the transaction
                } else {
                    consecutiveNotFound++;
                    if (consecutiveNotFound <= 3) {
                        console.log(`[DIRECT-SOLANA-SENDER] 🔄 Nonce transaction not found yet (attempt ${consecutiveNotFound}), waiting...`);
                    } else if (consecutiveNotFound % 5 === 0) {
                        console.log(`[DIRECT-SOLANA-SENDER] 🔄 Nonce transaction still not found after ${consecutiveNotFound} attempts...`);
                    }
                }
                
                // Wait before next poll
                await new Promise(resolve => setTimeout(resolve, pollInterval));
                
            } catch (error) {
                console.error(`[DIRECT-SOLANA-SENDER] ❌ Error polling nonce transaction status:`, error.message);
                consecutiveNotFound++;
                
                // If we get too many errors, give up
                if (consecutiveNotFound > 10) {
                    console.error(`[DIRECT-SOLANA-SENDER] ❌ Too many polling errors, giving up on nonce confirmation`);
                    break;
                }
                
                await new Promise(resolve => setTimeout(resolve, pollInterval));
            }
        }
        
        // If we have a last status, return it even if not fully confirmed
        if (lastStatus) {
            console.log(`[DIRECT-SOLANA-SENDER] ⚠️ Nonce transaction confirmation timeout, but transaction exists. Returning last known status.`);
            return {
                value: {
                    err: lastStatus.err,
                    slot: lastStatus.slot,
                    confirmations: lastStatus.confirmations || 0,
                    confirmationStatus: lastStatus.confirmationStatus || 'unknown'
                }
            };
        }
        
        throw new Error(`Nonce transaction confirmation timed out after ${maxWaitTime/1000} seconds - transaction may not have been sent successfully`);
    }

    /**
     * Get performance statistics
     */
    getStats() {
        return {
            ...this.stats,
            successRate: this.stats.totalSends > 0 ? 
                (this.stats.successfulSends / this.stats.totalSends) * 100 : 0
        };
    }

    /**
     * Health check
     */
    isHealthy() {
        return this.primaryConnection && leaderTracker.isHealthy();
    }
}

module.exports = DirectSolanaSender;
