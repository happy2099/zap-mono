// File: singaporeSenderManager.js
// Description: ULTRA-FAST Singapore regional Helius Sender endpoint manager for sub-200ms trade execution

const { Connection, PublicKey, LAMPORTS_PER_SOL, ComputeBudgetProgram, SystemProgram, VersionedTransaction, TransactionMessage } = require('@solana/web3.js');
const config = require('./config.js');
const { shortenAddress } = require('./utils.js');
const performanceMonitor = require('./performanceMonitor.js');
const leaderTracker = require('./leaderTracker.js');
const bs58 = require('bs58'); // Required for correct Base58 encoding of transactions

class SingaporeSenderManager {
    constructor(connection = null) {
        // MOVED: leaderTracker.startMonitoring() should be called once during bot init, not per instance
        // --- THIS IS THE NEW, DYNAMIC CODE ---
        // This manager will now respect your .env and config.js files completely.
        this.singaporeEndpoints = {
            rpc: config.HELIUS_ENDPOINTS.rpc,
            sender: config.HELIUS_ENDPOINTS.sender,
            laserstream: config.HELIUS_ENDPOINTS.websocket,
            websocket: config.HELIUS_ENDPOINTS.websocket
        };
        this.tipAccounts = config.TIP_ACCOUNTS; // Use the central list of tip accounts

        // Use provided connection or create new one - using 'processed' for speed
        this.connection = connection || new Connection(this.singaporeEndpoints.rpc, {
            commitment: 'processed',
            wsEndpoint: this.singaporeEndpoints.laserstream.replace('wss://', 'ws://')
        });

        this.isHealthy = true;
        this.lastHealthCheck = Date.now();
        this.healthCheckInterval = 120000; // 2 minutes instead of 30 seconds
        
        // PERFORMANCE METRICS
        this.executionStats = {
            totalExecutions: 0,
            successfulExecutions: 0,
            failedExecutions: 0,
            averageExecutionTime: 0,
            lastExecutionTime: 0,
            totalExecutionTime: 0
        };

        console.log('[SINGAPORE-SENDER] 🚀 ULTRA-FAST Manager initialized with Singapore regional endpoints');
        console.log(`[SINGAPORE-SENDER] 🌏 Endpoints: ${JSON.stringify(this.singaporeEndpoints, null, 2)}`);
        console.log(`[SINGAPORE-SENDER] ⚡ Target execution time: <200ms`);
        console.log(`[SINGAPORE-SENDER] 🔧 Jito tip accounts: ${this.tipAccounts.length} configured`);
        
        // Start health monitoring
        this.startHealthMonitoring();
    }

    // Start periodic health monitoring
    startHealthMonitoring() {
        setInterval(async () => {
            await this.healthCheck();
        }, this.healthCheckInterval);
    }

    // Health check for Singapore endpoints
    async healthCheck() {
        try {
            const response = await fetch(this.singaporeEndpoints.rpc, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    jsonrpc: '2.0',
                    id: 1,
                    method: 'getHealth'
                })
            });
            
            const result = await response.json();
            this.isHealthy = result.result === 'ok';
            this.lastHealthCheck = Date.now();
            
            if (this.isHealthy) {
                console.log(`[SINGAPORE-SENDER] ✅ Health check passed at ${new Date().toISOString()}`);
            } else {
                console.warn(`[SINGAPORE-SENDER] ⚠️ Health check failed at ${new Date().toISOString()}`);
            }
            
        } catch (error) {
            console.error('[SINGAPORE-SENDER] ❌ Health check error:', error);
            this.isHealthy = false;
        }
    }
    

    // Get dynamic tip amount from Jito API (75th percentile) for maximum MEV protection
    async getDynamicTipAmount() {
        try {
            const response = await fetch('https://bundles.jito.wtf/api/v1/bundles/tip_floor');
            const data = await response.json();
            
            if (data && data[0] && typeof data[0].landed_tips_75th_percentile === 'number') {
                const tip75th = data[0].landed_tips_75th_percentile;
                // Use 75th percentile but minimum 0.001 SOL for maximum MEV protection
                const dynamicTip = Math.max(tip75th, 0.001);
                console.log(`[SINGAPORE-SENDER] 💰 Dynamic tip calculated: ${dynamicTip} SOL (75th percentile)`);
                return dynamicTip;
            }
            
            // Fallback if API fails or data is invalid
            console.warn('[SINGAPORE-SENDER] ⚠️ Using fallback tip amount: 0.001 SOL');
            return 0.001;
        } catch (error) {
            console.warn('[SINGAPORE-SENDER] ⚠️ Failed to fetch dynamic tip amount, using fallback:', error);
            return 0.001; // Fallback to minimum
        }
    }

    // ULTRA-FAST transaction execution with Helius Sender
    async executeTransactionWithSender(transaction, keypair, options = {}) {
        const startTime = Date.now();
        
        try {
            console.log(`[SINGAPORE-SENDER] 🚀 Starting ULTRA-FAST execution...`);
            console.log(`[SINGAPORE-SENDER] 🔍 Options received:`, JSON.stringify(options, null, 2));
            
            // VALIDATE TRANSACTION
            console.log(`[SINGAPORE-SENDER] 🔍 Step 1: Validating transaction...`);
            if (!this.validateTransaction(transaction)) {
                throw new Error('Invalid transaction format');
            }
            console.log(`[SINGAPORE-SENDER] ✅ Transaction validation passed`);
            
            // COMMENTED OUT: Tip logic to reduce fees
            // console.log(`[SINGAPORE-SENDER] 🔍 Step 2: Getting tip amount...`);
            // const tipAmountSOL = await this.getDynamicTipAmount();
            // const tipAccount = new PublicKey(this.tipAccounts[Math.floor(Math.random() * this.tipAccounts.length)]);
            // 
            // console.log(`[SINGAPORE-SENDER] 💰 Using tip amount: ${tipAmountSOL} SOL to ${shortenAddress(tipAccount)}`);
            
            // BUILD OPTIMIZED TRANSACTION (without tip)
            console.log(`[SINGAPORE-SENDER] 🔍 Step 3: Building optimized transaction...`);
            const optimizedTransaction = await this.buildOptimizedTransaction(
                transaction, 
                keypair, 
                null, // No tip account
                0,    // No tip amount
                options
            );
            console.log(`[SINGAPORE-SENDER] ✅ Optimized transaction built successfully`);
            
            // EXECUTE VIA SENDER ENDPOINT
            console.log(`[SINGAPORE-SENDER] 🔍 Step 4: Sending transaction via Sender endpoint...`);
            const signature = await this.sendViaSender(optimizedTransaction, 3, options.platform || 'UNKNOWN');
            console.log(`[SINGAPORE-SENDER] ✅ Transaction sent! Signature: ${signature}`);
            
            // CONFIRM TRANSACTION
            console.log(`[SINGAPORE-SENDER] 🔍 Step 5: Confirming transaction...`);
            let confirmationTime;
            try {
                confirmationTime = await this.confirmTransaction(signature);
            } catch (confirmError) {
                console.error(`[SINGAPORE-SENDER] ❌ CONFIRMATION FAILED: ${confirmError.message}`);
                console.log(`[SINGAPORE-SENDER] 🔍 Transaction was sent but confirmation failed. Check Solscan: https://solscan.io/tx/${signature}`);
                
                // Return partial success - transaction was sent but not confirmed
                return {
                    signature,
                    executionTime: Date.now() - startTime,
                    confirmationTime: null,
                    tipAmount: tipAmountSOL,
                    tipAccount: tipAccount.toString(),
                    warning: `Transaction sent but confirmation failed: ${confirmError.message}`
                };
            }
            
            // CALCULATE EXECUTION TIME
            const executionTime = Date.now() - startTime;
            this.updateExecutionStats(executionTime, true);
            
            // RECORD WITH PERFORMANCE MONITOR
            performanceMonitor.recordExecutionLatency(executionTime);
            
            console.log(`[SINGAPORE-SENDER] ✅ ULTRA-FAST execution completed in ${executionTime}ms!`);
            console.log(`[SINGAPORE-SENDER] 📝 Signature: ${signature}`);
            console.log(`[SINGAPORE-SENDER] ⚡ Execution time: ${executionTime}ms`);
            console.log(`[SINGAPORE-SENDER] 🔍 Confirmation time: ${confirmationTime}ms`);
            
            // Check if execution meets ultra-fast targets
            if (executionTime < 200) {
                console.log(`[SINGAPORE-SENDER] ⚡ ULTRA-FAST TARGET ACHIEVED: ${executionTime}ms execution!`);
            } else if (executionTime < 400) {
                console.log(`[SINGAPORE-SENDER] 🚀 FAST TARGET ACHIEVED: ${executionTime}ms execution`);
            } else {
                console.log(`[SINGAPORE-SENDER] ⚠️ Execution time: ${executionTime}ms (above target)`);
            }
            
            return {
                signature,
                executionTime,
                confirmationTime,
                tipAmount: tipAmountSOL,
                tipAccount: tipAccount.toString()
            };
            
        } catch (error) {
            const executionTime = Date.now() - startTime;
            this.updateExecutionStats(executionTime, false);
            
            console.error(`[SINGAPORE-SENDER] ❌ Execution failed after ${executionTime}ms:`, error.message);
            throw error;
        }
    }

    // Validate transaction before execution
    validateTransaction(transaction) {
        try {
            // Check if transaction has required fields
            if (!transaction || !transaction.instructions || transaction.instructions.length === 0) {
                // console.log(`[SINGAPORE-SENDER] ❌ Validation failed: Missing instructions`); // SILENCED FOR CLEAN TERMINAL
                return false;
            }
            
            // Check if instructions are valid Solana instructions
            for (const instruction of transaction.instructions) {
                if (!instruction.programId || !instruction.keys || !instruction.data) {
                    console.log(`[SINGAPORE-SENDER] ❌ Validation failed: Invalid instruction format`);
                    return false;
                }
            }
            
            // console.log(`[SINGAPORE-SENDER] ✅ Transaction validation passed with ${transaction.instructions.length} instructions`); // SILENCED FOR CLEAN TERMINAL
            return true;
        } catch (error) {
            console.log(`[SINGAPORE-SENDER] ❌ Validation error:`, error.message);
            return false;
        }
    }

    // Build optimized transaction with tip and compute budget
    async buildOptimizedTransaction(originalTransaction, keypair, tipAccount, tipAmountSOL, options = {}) {
        try {
            // console.log(`[SINGAPORE-SENDER] 🔧 Building optimized transaction...`); // SILENCED FOR CLEAN TERMINAL
            // console.log(`[SINGAPORE-SENDER] 📊 Original instructions: ${originalTransaction.instructions.length}`); // SILENCED FOR CLEAN TERMINAL
            
            // Get recent blockhash
            const { value: { blockhash, lastValidBlockHeight } } = await this.connection.getLatestBlockhashAndContext('confirmed');
            
            // Create copy of instructions to avoid modifying the original
            const allInstructions = [...originalTransaction.instructions];

            // Determine compute units (from options or fallback)
            let computeUnits = options.computeUnits || 100_000;
            
            // 🔬 OPTIMIZE COMPUTE UNITS: Simulate to get accurate compute unit requirements
            try {
                console.log(`[SINGAPORE-SENDER] 🔬 Simulating transaction for compute unit optimization...`);
                
                // Use the existing simulateTransaction method with correct parameters
                const actualUnits = await this._getComputeUnits(allInstructions, keypair, blockhash);
                
                // 🔧 CRITICAL FIX: Validate actualUnits is a valid number
                if (typeof actualUnits === 'number' && !isNaN(actualUnits) && actualUnits > 0) {
                    // Set compute units with 10% margin for safety
                    computeUnits = Math.max(Math.ceil(actualUnits * 1.1), 1000); // Minimum 1000 CU
                    console.log(`[SINGAPORE-SENDER] 🎯 Optimized compute units: ${actualUnits} → ${computeUnits} (10% margin)`);
                } else {
                    console.warn(`[SINGAPORE-SENDER] ⚠️ Invalid simulation result: ${actualUnits}, using default`);
                    computeUnits = 100_000; // Fallback to default
                }
                
            } catch (simError) {
                console.warn(`[SINGAPORE-SENDER] ⚠️ Simulation failed, using default compute units: ${simError.message}`);
                computeUnits = 100_000; // Fallback to default
            }
            
            // --- CRITICAL FIX START: Prioritize priorityFee from options ---
            let effectiveMicroLamports;
            if (options.priorityFee !== undefined && options.priorityFee !== null) {
                effectiveMicroLamports = options.priorityFee; // Use the explicitly passed priority fee (which is already a number)
                console.log(`[SINGAPORE-SENDER] 💰 Using explicit priority fee: ${effectiveMicroLamports} microLamports (from executeCopyTrade)`);
            } else {
                // Fallback to dynamic priority fee calculation
                effectiveMicroLamports = await this.getDynamicPriorityFee(allInstructions, keypair.publicKey, blockhash);
                console.log(`[SINGAPORE-SENDER] 🚦 Dynamic priority fee calculated: ${effectiveMicroLamports} microLamports`);
            }
            // --- CRITICAL FIX END ---

            // 🔧 CRITICAL SAFETY CHECK: Ensure compute units is valid
            if (!computeUnits || isNaN(computeUnits) || computeUnits <= 0) {
                console.error(`[SINGAPORE-SENDER] ❌ Invalid compute units: ${computeUnits}, using emergency fallback`);
                computeUnits = 200_000; // Emergency fallback
            }
            
            console.log(`[SINGAPORE-SENDER] 🔧 Final compute units: ${computeUnits} (type: ${typeof computeUnits})`);

            // ADD COMPUTE BUDGET INSTRUCTIONS (must be first in allInstructions array)
            allInstructions.unshift(
                ComputeBudgetProgram.setComputeUnitLimit({ units: computeUnits }),
                ComputeBudgetProgram.setComputeUnitPrice({ microLamports: effectiveMicroLamports }) // Use the determined effective fee
            );
            
            // ADD TIP TRANSFER INSTRUCTION
            allInstructions.push(
                SystemProgram.transfer({
                    fromPubkey: keypair.publicKey,
                    toPubkey: tipAccount,
                    lamports: tipAmountSOL * LAMPORTS_PER_SOL,
                })
            );
            
            // console.log(`[SINGAPORE-SENDER] 🔧 Total instructions after optimization: ${allInstructions.length}`); // SILENCED FOR CLEAN TERMINAL
            
            // BUILD FINAL TRANSACTION
            const optimizedTransaction = new VersionedTransaction(
                new TransactionMessage({
                    instructions: allInstructions,
                    payerKey: keypair.publicKey,
                    recentBlockhash: blockhash,
                }).compileToV0Message()
            );
            
            // Sign transaction
            optimizedTransaction.sign([keypair]);
            
            // console.log(`[SINGAPORE-SENDER] ✅ Optimized transaction built with ${allInstructions.length} instructions`); // SILENCED FOR CLEAN TERMINAL
            // console.log(`[SINGAPORE-SENDER] 🔧 Compute units: ${computeUnits}, Priority fee: ${effectiveMicroLamports} microLamports`); // SILENCED FOR CLEAN TERMINAL
            
            // 🔧 CRITICAL FIX: Serialize once and store the result
            const serializedTransaction = optimizedTransaction.serialize();
            console.log(`[SINGAPORE-SENDER] 📝 Transaction size: ${serializedTransaction.length} bytes`);
            
            return {
                transaction: optimizedTransaction,
                serializedTransaction, // 🔧 Pass the pre-serialized transaction
                blockhash,
                lastValidBlockHeight
            };
            
        } catch (error) {
            console.error(`[SINGAPORE-SENDER] ❌ Error building optimized transaction:`, error);
            throw error;
        }
    }

    // ULTRA-ACCURATE simulation for PumpFun atomic transactions and manual builds
    async simulateTransaction(transaction) {
        try {
            console.log(`[SINGAPORE-SENDER] 🔬 Simulating transaction for compute units...`);
            
            const serializedTx = bs58.encode(transaction.serialize());
            
            const response = await fetch(`${this.singaporeEndpoints.rpc}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    jsonrpc: '2.0',
                    id: 'simulate-tx',
                    method: 'simulateTransaction',
                    params: [
                        serializedTx,
                        {
                            encoding: 'base64',
                            commitment: 'processed',
                            replaceRecentBlockhash: true,
                            sigVerify: false
                        }
                    ]
                })
            });
            
            const result = await response.json();
            
            if (result.error) {
                throw new Error(`Simulation failed: ${result.error.message}`);
            }
            
            const simulation = result.result?.value;
            if (!simulation) {
                throw new Error('No simulation result received');
            }
            
            // Check for simulation errors
            if (simulation.err) {
                console.error(`[SINGAPORE-SENDER] ❌ Simulation error: ${JSON.stringify(simulation.err)}`);
                throw new Error(`Transaction simulation failed: ${JSON.stringify(simulation.err)}`);
            }
            
            const unitsConsumed = simulation.unitsConsumed || 0;
            const logs = simulation.logs || [];
            
            console.log(`[SINGAPORE-SENDER] ✅ Simulation successful: ${unitsConsumed} compute units`);
            console.log(`[SINGAPORE-SENDER] 📊 Simulation logs: ${logs.length} log entries`);
            
            return {
                unitsConsumed,
                logs,
                success: true
            };
            
        } catch (error) {
            console.error(`[SINGAPORE-SENDER] ❌ Simulation failed: ${error.message}`);
            throw error;
        }
    }


    // Send transaction via Helius Singapore Sender endpoint with smart error recovery and leader targeting
async sendViaSender(transactionData, retries = 3, platform = 'UNKNOWN') {
    let { transaction, serializedTransaction, blockhash, lastValidBlockHeight } = transactionData;

    // ============================= LEADER TARGETING =============================
    const leader = leaderTracker.getCurrentLeader();
    let targetEndpoint = this.singaporeEndpoints.sender; // Default endpoint

    if (leader) {
            targetEndpoint = `http://sg-sender.helius-rpc.com/fast?leader=${leader}`; 
            console.log(`[SINGAPORE-SENDER] 🎯 Targeting current leader: ${leader} via Singapore endpoint.`);
    } else {
            targetEndpoint = `http://sg-sender.helius-rpc.com/fast`;
            console.log(`[SINGAPORE-SENDER] 🌏 Using Singapore regional endpoint: ${targetEndpoint}`);
    }
    // ==========================================================================

    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            console.log(`[SINGAPORE-SENDER] 📤 Sending via endpoint (attempt ${attempt}/${retries}): ${targetEndpoint}`);

            // Validate blockhash expiry before sending
            const currentHeight = await this.connection.getBlockHeight('confirmed');
            if (currentHeight > lastValidBlockHeight) {
                throw new Error('Blockhash expired before send attempt');
            }

                // 🔬 SIMULATE TRANSACTION FIRST to avoid unnecessary gas fees
                // 🎯 CRITICAL FIX: Skip simulation for Pump.fun atomic transactions
                const config = require('./config.js');
                const pumpFunProgramId = config.PLATFORM_IDS.PUMP_FUN.toString();
                const isPumpFunAtomic = transaction.instructions.length === 2 && 
                    transaction.instructions.some(ix => ix.programId && ix.programId.toString() === pumpFunProgramId);
                
                if (isPumpFunAtomic) {
                    console.log(`[SINGAPORE-SENDER] 🎯 Pump.fun atomic transaction detected - skipping simulation`);
                } else {
                    try {
                        const simulation = await this.simulateTransaction(transaction);
                        console.log(`[SINGAPORE-SENDER] ✅ Simulation passed: ${simulation.unitsConsumed} compute units consumed`);
                    } catch (simError) {
                        console.error(`[SINGAPORE-SENDER] ❌ Simulation failed, skipping send: ${simError.message}`);
                        throw new Error(`Transaction simulation failed: ${simError.message}`);
                    }
                }

                // Send transaction via the targeted endpoint with timeout
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout
                
                // ========================= THE BATTLE-HARDENED FIX ========================
                // STEP 1: Use the pre-serialized transaction (already done in buildOptimizedTransaction)
                if (!serializedTransaction) {
                    throw new Error("CRITICAL: Pre-serialized transaction is missing!");
                }

                // STEP 2: Encode the byte buffer into a Base58 string, as required by the JSON-RPC API.
                const encodedTx = bs58.encode(serializedTransaction);

                if (!encodedTx || encodedTx.length === 0) {
                    throw new Error("CRITICAL: Transaction serialization resulted in an empty string.");
                }
                // ============================================================================

                console.log(`[SINGAPORE-SENDER] 🔧 Transaction serialized successfully: ${encodedTx.length} characters`);
                
            const response = await fetch(targetEndpoint, {
                method: 'POST',
                    headers: { 
                        'Content-Type': 'application/json',
                        'User-Agent': 'ZapBot-SingaporeSender/1.0'
                    },
                body: JSON.stringify({
                    jsonrpc: '2.0',
                    id: 'zapbot-sender',
                    method: 'sendTransaction',
                    params: [
                        encodedTx,
                        {
                            skipPreflight: true, // We already simulated; this is for maximum speed.
                            preflightCommitment: "processed",
                            maxRetries: 0 // We handle retries in our own loop.
                        }
                    ]
                    }),
                    signal: controller.signal
            });
                
                clearTimeout(timeoutId);

            const jsonResponse = await response.json();

            if (jsonResponse.error) {
                // This is an error from the RPC node itself.
                throw new Error(`Helius RPC error: ${jsonResponse.error.message} (Code: ${jsonResponse.error.code})`);
            }
            
            const signature = jsonResponse.result;
            if (!signature) {
                throw new Error("Transaction sent but no signature was returned from Helius.");
            }
            
            console.log(`[SINGAPORE-SENDER] ✅ Transaction sent successfully! Signature: ${signature}`);
            return signature;

        } catch (error) {
            console.warn(`[SINGAPORE-SENDER] ⚠️ Attempt ${attempt} failed: ${error.message}`);

                // Enhanced error logging for debugging
                if (error.name === 'AbortError') {
                    console.warn(`[SINGAPORE-SENDER] ⏰ Request timeout after 10 seconds`);
                } else if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
                    console.warn(`[SINGAPORE-SENDER] 🌐 Network connectivity issue: ${error.code}`);
                } else if (error.message.includes('fetch failed')) {
                    console.warn(`[SINGAPORE-SENDER] 🔌 Fetch failed - possible network/DNS issue`);
                }

                if (attempt < retries) {
                    // Simple error recovery without external manager
                    const delay = Math.min(1000 * Math.pow(2, attempt), 5000); // Exponential backoff, max 5s
                    console.log(`[SINGAPORE-SENDER] 🔄 Retrying in ${delay}ms... (attempt ${attempt + 1}/${retries})`);
                    await new Promise(resolve => setTimeout(resolve, delay));

                    // Simple retry logic
                    console.log(`[SINGAPORE-SENDER] 🔄 Retrying transaction...`);
                    continue; // Retry with adjusted context
            }
        }
    }

    throw new Error('All retry attempts failed');
}

    // Confirm transaction with enhanced timeout and fallback methods
    async confirmTransaction(signature, timeout = 30000) {
        const startTime = Date.now();
        const interval = 500; // Check every 500ms for faster response
        let lastStatus = null;
        let consecutiveErrors = 0;
        const maxConsecutiveErrors = 5;
        
        console.log(`[SINGAPORE-SENDER] 🔍 Confirming transaction: ${signature}...`);
        
        while (Date.now() - startTime < timeout) {
            try {
                // ========================= ENHANCED CONFIRMATION ========================
                // Method 1: Try getSignatureStatuses first (most reliable)
                const status = await this.connection.getSignatureStatuses([signature], {
                    searchTransactionHistory: true,
                    commitment: 'confirmed'
                });
                
                const confirmationStatus = status?.value[0]?.confirmationStatus;
                const err = status?.value[0]?.err;
                const confirmations = status?.value[0]?.confirmations;
                const slot = status?.value[0]?.slot;
                
                lastStatus = { confirmationStatus, err, confirmations, slot };
                
                // Reset error counter on successful status check
                consecutiveErrors = 0;
                
                if (confirmationStatus === 'confirmed' || confirmationStatus === 'finalized') {
                    const confirmationTime = Date.now() - startTime;
                    
                // Check if transaction actually succeeded (not just confirmed)
                if (err) {
                    console.error(`[SINGAPORE-SENDER] ❌ TRANSACTION FAILED ON-CHAIN:`, {
                        error: err,
                        errorType: typeof err,
                        errorString: JSON.stringify(err),
                        signature: signature
                    });
                    throw new Error(`Transaction failed on-chain: ${JSON.stringify(err)}`);
                }
                    
                    console.log(`[SINGAPORE-SENDER] ✅ Transaction confirmed and SUCCEEDED in ${confirmationTime}ms (confirmations: ${confirmations}, slot: ${slot})`);
                    return confirmationTime;
                }
                
                // Enhanced progress logging with confirmation details
                const elapsed = Date.now() - startTime;
                if (elapsed > 3000 && elapsed % 3000 < 500) { // Every 3 seconds
                    console.log(`[SINGAPORE-SENDER] ⏳ Confirmation progress: ${elapsed}ms elapsed, status: ${confirmationStatus || 'pending'}, confirmations: ${confirmations || 0}`);
                }
                
            } catch (error) {
                consecutiveErrors++;
                console.warn(`[SINGAPORE-SENDER] ⚠️ Status check failed (${consecutiveErrors}/${maxConsecutiveErrors}):`, error.message);
                
                // If too many consecutive errors, try fallback method
                if (consecutiveErrors >= maxConsecutiveErrors) {
                    console.log(`[SINGAPORE-SENDER] 🔄 Trying fallback confirmation method...`);
                    try {
                        // Fallback: Try direct confirmation
                        const fallbackResult = await this.connection.confirmTransaction(signature, 'confirmed');
                        if (fallbackResult.value.err) {
                            throw new Error(`Fallback confirmation failed: ${JSON.stringify(fallbackResult.value.err)}`);
                        }
                        const confirmationTime = Date.now() - startTime;
                        console.log(`[SINGAPORE-SENDER] ✅ Fallback confirmation SUCCESS in ${confirmationTime}ms`);
                        return confirmationTime;
                    } catch (fallbackError) {
                        console.warn(`[SINGAPORE-SENDER] ⚠️ Fallback confirmation also failed:`, fallbackError.message);
                        consecutiveErrors = 0; // Reset counter for next attempt
                    }
                }
            }
            
            await new Promise(resolve => setTimeout(resolve, interval));
        }
        
        // Final attempt with different commitment level
        console.log(`[SINGAPORE-SENDER] 🔄 Final attempt with 'processed' commitment...`);
        try {
            const finalStatus = await this.connection.getSignatureStatuses([signature], {
                searchTransactionHistory: true,
                commitment: 'processed'
            });
            
            const finalConfirmationStatus = finalStatus?.value[0]?.confirmationStatus;
            const finalErr = finalStatus?.value[0]?.err;
            
            if (finalConfirmationStatus === 'processed' || finalConfirmationStatus === 'confirmed' || finalConfirmationStatus === 'finalized') {
                if (finalErr) {
                    throw new Error(`Transaction failed on-chain: ${JSON.stringify(finalErr)}`);
                }
                const confirmationTime = Date.now() - startTime;
                console.log(`[SINGAPORE-SENDER] ✅ Final attempt SUCCESS in ${confirmationTime}ms (status: ${finalConfirmationStatus})`);
                return confirmationTime;
            }
        } catch (finalError) {
            console.warn(`[SINGAPORE-SENDER] ⚠️ Final attempt failed:`, finalError.message);
        }
        
        // If we get here, all methods failed
        const elapsed = Date.now() - startTime;
        console.error(`[SINGAPORE-SENDER] ❌ All confirmation methods failed after ${elapsed}ms`);
        console.error(`[SINGAPORE-SENDER] 🔍 Last known status:`, lastStatus);
        console.error(`[SINGAPORE-SENDER] 🔍 Signature: ${signature}`);
        console.error(`[SINGAPORE-SENDER] 🔍 Check transaction on Solscan: https://solscan.io/tx/${signature}`);
        throw new Error(`Transaction confirmation timeout after ${timeout}ms - signature: ${signature}`);
    }

    // Update execution statistics
    updateExecutionStats(executionTime, success) {
        this.executionStats.totalExecutions++;
        this.executionStats.totalExecutionTime += executionTime;
        this.executionStats.lastExecutionTime = executionTime;
        
        if (success) {
            this.executionStats.successfulExecutions++;
        } else {
            this.executionStats.failedExecutions++;
        }
        
        // Calculate average execution time
        this.executionStats.averageExecutionTime = this.executionStats.totalExecutionTime / this.executionStats.totalExecutions;
    }

    // Get execution statistics
    getExecutionStats() {
        return {
            ...this.executionStats,
            successRate: this.executionStats.totalExecutions > 0 ? 
                (this.executionStats.successfulExecutions / this.executionStats.totalExecutions) * 100 : 0,
            healthStatus: this.isHealthy,
            lastHealthCheck: this.lastHealthCheck
        };
    }

    /**
     * Get ULTRA-ACCURATE priority fee using Helius API
     * This is the FASTEST and MOST ACCURATE method for production applications
     */
    async getDynamicPriorityFee(instructions, payerKey, blockhash) {
        try {
            console.log(`[PRIORITY_FEE] 🚀 Using Helius API for ULTRA-ACCURATE priority fee estimation...`);
            
            const heliusApiKey = process.env.HELIUS_API_KEY;
            if (!heliusApiKey) {
                console.warn('[PRIORITY_FEE] ⚠️ HELIUS_API_KEY not found, using fallback priority fee');
                return 1000000; // Fallback
            }

            // Extract account keys from instructions for better estimation
            const accountKeys = new Set([payerKey.toString()]);
            for (const instruction of instructions) {
                if (instruction.keys) {
                    for (const key of instruction.keys) {
                        if (key.pubkey) {
                            accountKeys.add(key.pubkey.toString());
                        }
                    }
                }
            }
            
            // console.log(`[PRIORITY_FEE] 🔍 Estimating priority fee for ${accountKeys.size} accounts...`); // SILENCED FOR CLEAN TERMINAL
            
            // Use Helius API directly
            const response = await fetch(this.singaporeEndpoints.rpc, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    jsonrpc: "2.0",
                    id: "1",
                    method: "getPriorityFeeEstimate",
                    params: [{
                        accountKeys: Array.from(accountKeys),
                        options: { 
                            includeAllPriorityFeeLevels: true
                        }
                    }]
                })
            });
            
            const data = await response.json();
            if (data.error) {
                throw new Error(`Helius Priority Fee API error: ${data.error.message}`);
            }
            
            // Use high priority for speed, but with a reasonable cap
            const priorityFee = data.result?.priorityFeeLevels?.high || 1000000;
            const cappedFee = Math.min(priorityFee, 5000000); // Cap at 0.005 SOL
            
            console.log(`[PRIORITY_FEE] ✅ Helius API fee calculated: ${cappedFee} microLamports/CU`);
            console.log(`[PRIORITY_FEE] 📊 All fee levels:`, data.result?.priorityFeeLevels);
            
            return cappedFee;
            
        } catch (error) {
            console.error(`[PRIORITY_FEE] ❌ Helius API method failed: ${error.message}`);
            console.warn('[PRIORITY_FEE] ⚠️ Falling back to default priority fee');
            return 1000000; // Fallback
        }
    }

    // ULTRA-FAST priority fee estimation using account keys (RPC Method)
    async getPriorityFeeByAccountKeys(accountKeys) {
        try {
            console.log(`[SENDER-V9-RPC] ⚡ Getting priority fee via RPC for ${accountKeys.length} keys...`);
            
            const response = await fetch(config.HELIUS_ENDPOINTS.rpc, { // Use your main RPC URL from config
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    jsonrpc: "2.0",
                    id: "1",
                    method: "getPriorityFeeEstimate",
                    params: [{
                        accountKeys: accountKeys.slice(0, 15),
                        options: { includeAllPriorityFeeLevels: true }
                    }]
                })
            });
            
            const data = await response.json();
            if (data.error) throw new Error(data.error.message);
            
            const priorityFee = data.result?.priorityFeeLevels?.high || 1000000;
            console.log(`[SENDER-V9-RPC] ⚡ ULTRA-FAST priority fee: ${priorityFee} microLamports`);
            return priorityFee;

        } catch (error) {
            console.warn(`[SENDER-V9-RPC] ⚠️ Account keys method failed, using fallback:`, error.message);
            return 1000000; // Fallback
        }
    }

    // Simulate transaction to get compute units
    async _getComputeUnits(instructions, keypair, blockhash) { 
        try {
            console.log(`[SINGAPORE-SENDER] 🔍 Simulating transaction for compute units...`);
            
            // 🔧 FIX: Ensure instructions is an array
            if (!Array.isArray(instructions)) {
                throw new Error('Instructions must be an array');
            }
            
            // 🎯 ENHANCED: Detect Pump.fun atomic transactions for special handling
            const config = require('./config.js');
            const pumpFunProgramId = config.PLATFORM_IDS.PUMP_FUN.toString();
            const isPumpFunAtomic = instructions.some(ix => 
                ix.programId && ix.programId.toString() === pumpFunProgramId &&
                ix.data && ix.data.toString('hex').startsWith('66063d1201daebea') // Buy instruction discriminator
            );
            
            console.log(`[SINGAPORE-SENDER] 🔍 Checking for Pump.fun atomic transaction:`, {
                instructionCount: instructions.length,
                hasPumpFunProgram: instructions.some(ix => ix.programId && ix.programId.toString() === pumpFunProgramId),
                isPumpFunAtomic: isPumpFunAtomic
            });
            
            if (isPumpFunAtomic) {
                console.log(`[SINGAPORE-SENDER] 🎯 Pump.fun atomic transaction detected - using high CU estimate`);
                // Use high estimate for Pump.fun atomic transactions (ATA creation + buy)
                const estimatedUnits = 200000; // Higher estimate for atomic complexity
                console.log(`[SINGAPORE-SENDER] 🔧 Estimated compute units for PumpFun atomic: ${estimatedUnits}`);
                return estimatedUnits;
            }
            
            const testInstructions = [
                ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }),
                ...instructions,
            ];

            const testTransaction = new VersionedTransaction(
                new TransactionMessage({
                    instructions: testInstructions,
                    payerKey: keypair.publicKey,
                    recentBlockhash: blockhash,
                }).compileToV0Message()
            );
            testTransaction.sign([keypair]);

            const simulation = await this.connection.simulateTransaction(testTransaction, {
                replaceRecentBlockhash: true,
                sigVerify: false,
            });

            if (!simulation.value.unitsConsumed) {
                throw new Error('Simulation failed to return compute units');
            }

            const units = simulation.value.unitsConsumed;
            
            // 🔧 CRITICAL FIX: Validate units is a valid number
            if (typeof units !== 'number' || isNaN(units) || units <= 0) {
                throw new Error(`Invalid simulation result: units=${units} (type: ${typeof units})`);
            }
            
            const computeUnits = units < 1000 ? 1000 : Math.ceil(units * 1.1); // 10% margin
            
            console.log(`[SINGAPORE-SENDER] 🔧 Simulated compute units: ${units}, Using: ${computeUnits}`);
            return computeUnits;
            
        } catch (error) {
            console.warn('[SINGAPORE-SENDER] ⚠️ Simulation failed, using default compute units:', error.message);
            return 100_000; // Default compute units
        }
    }

    // ULTRA-FAST copy trade execution with FINAL RUNWAY logic
    async executeCopyTrade(instructions, keypair, options = {}) {
        const startTime = Date.now();
        let signature = null;

        try {
            console.log(`[SENDER-V14-DIRECT-INJECTION] 🚀 Bypassing Helius Sender. Using direct @solana/web3.js...`);
            
            // ========== STEP 1: GET BLOCKHASH & FEES (Same as before) ==========
            const { value: { blockhash, lastValidBlockHeight } } = await this.connection.getLatestBlockhashAndContext('confirmed');
            
            const allInstructions = [...instructions];
            const uniqueAccountKeys = [...new Set(allInstructions.flatMap(ix => ix.keys.map(key => key.pubkey.toString()))), keypair.publicKey.toString()];
            
            let priorityFee = 2000000;
            try {
                const response = await fetch(this.singaporeEndpoints.rpc, {
                    method: 'POST', 
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ 
                        jsonrpc: "2.0", 
                        id: "1", 
                        method: "getPriorityFeeEstimate", 
                        params: [{ 
                            accountKeys: uniqueAccountKeys, 
                            options: { includeAllPriorityFeeLevels: true } 
                        }] 
                    })
                });
                const data = await response.json();
                if (data.error) throw new Error(data.error.message);
                priorityFee = data.result?.priorityFeeLevels?.high || 2000000;
            } catch (error) {
                console.warn(`[SENDER-V14] ⚠️ Fee estimation failed: ${error.message}. Using fallback.`);
            }
            console.log(`[SENDER-V14] ✅ Priority fee set to: ${priorityFee} microLamports`);
            
            // ========== STEP 2: SIMULATION FOR PUMPFUN ATOMIC TRANSACTIONS ==========
            let computeUnits = 200000; // Default fallback
            
            // ========== PUMP.FUN ATOMIC TRANSACTION SIMULATION ==========
            const hasPumpFunAtomic = allInstructions.some(ix => 
                ix.programId.toString() === '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P' &&
                ix.data && ix.data.toString('hex').startsWith('66063d1201daebea') // Buy instruction discriminator
            );
            
            // ========== UNIFIED SIMULATION FOR ALL TRANSACTIONS ==========
            // Use the robust _getComputeUnits method for ALL transactions (including PumpFun)
            console.log(`[SENDER-V14] 🔬 Running unified simulation for accurate CU calculation...`);
            
            try {
                computeUnits = await this._getComputeUnits(allInstructions, keypair, blockhash);
                console.log(`[SENDER-V14] ✅ Simulation successful: ${computeUnits} CU`);
            } catch (simError) {
                console.warn(`[SENDER-V14] ⚠️ Simulation failed: ${simError.message}, using high fallback`);
                computeUnits = 1_000_000; // High fallback for simulation errors
            }
            // ===================================================================================
            // COMMENTED OUT: Hardcoded Helius tip to reduce fees
            // const heliusTipAccount = new PublicKey('2q5pghRs6arqVjRvT5gfgWfWcHWmw1ZuCzphgd5KfWGJ');
            // const tipAmountSOL = 0.0001;

            allInstructions.unshift(
                ComputeBudgetProgram.setComputeUnitLimit({ units: computeUnits }),
                ComputeBudgetProgram.setComputeUnitPrice({ microLamports: priorityFee })
            );
            // COMMENTED OUT: Helius tip transfer to reduce fees
            // allInstructions.push(
            //     SystemProgram.transfer({ 
            //         fromPubkey: keypair.publicKey, 
            //         toPubkey: heliusTipAccount, 
            //         lamports: Math.floor(tipAmountSOL * LAMPORTS_PER_SOL) 
            //     })
            // );

            console.log(`[SENDER-V14] 🔍 FINAL TRANSACTION STRUCTURE:`, {
                totalInstructions: allInstructions.length,
                instructionDetails: allInstructions.map((ix, index) => ({
                    index,
                    programId: ix.programId.toString(),
                    keys: ix.keys.map(key => ({
                        pubkey: key.pubkey.toString(),
                        isSigner: key.isSigner,
                        isWritable: key.isWritable
                    })),
                    dataLength: ix.data ? ix.data.length : 0
                }))
            });

            const transactionMessage = new TransactionMessage({
                instructions: allInstructions,
                payerKey: keypair.publicKey,
                recentBlockhash: blockhash,
            }).compileToV0Message();

            const transaction = new VersionedTransaction(transactionMessage);
            transaction.sign([keypair]);
            console.log(`[SENDER-V14] ✅ Transaction built and signed, ready for direct injection.`);
            
            // ========== STEP 3: TRANSACTION READY FOR INJECTION ==========
            // Simulation already completed above, no need for final check
            
            // ========== STEP 4: DIRECT INJECTION & CONFIRMATION ==========
            console.log(`[SENDER-V14] 💉 Injecting transaction directly into RPC node: ${this.connection.rpcEndpoint}`);

            // This is the direct call, bypassing the Helius fast-sender API.
            try {
                signature = await this.connection.sendTransaction(
                    transaction, 
                    { skipPreflight: true, maxRetries: 2 }
                );
                console.log(`[SENDER-V14] ✅ Transaction INJECTED! Signature: ${signature}`);
            } catch (sendError) {
                console.error(`[SENDER-V14] ❌ SEND FAILED: ${sendError.message}`);
                throw new Error(`Transaction send failed: ${sendError.message}`);
            }
            
            // ========== ENHANCED CONFIRMATION WITH DETAILED ERROR LOGGING ==========
            try {
                console.log(`[SENDER-V14] 🔍 Confirming transaction: ${signature}...`);
                const confirmationResult = await this.connection.confirmTransaction({
                    signature,
                    blockhash,
                    lastValidBlockHeight
                }, 'confirmed');
                
                console.log(`[SENDER-V14] 🔍 Confirmation Result:`, {
                    signature,
                    err: confirmationResult.value.err,
                    slot: confirmationResult.value.slot,
                    confirmations: confirmationResult.value.confirmations
                });
                
                if (confirmationResult.value.err) {
                    const onChainError = JSON.stringify(confirmationResult.value.err);
                    
                    // Abort immediately on Pump.fun 3012 to avoid pointless retries
                    if (confirmationResult.value.err.InstructionError && confirmationResult.value.err.InstructionError[1].Custom === 3012) {
                        console.warn(`[SENDER-V14] ⚠️ Pump.fun bonding curve constraint violation (3012) - aborting (likely migrated to AMM)`);
                        return { success: false, error: `PumpFun-3012`, signature, executionTime: Date.now() - startTime };
                    }
                    
                    // Handle ATA already initialized as success
                    if (confirmationResult.value.err.InstructionError && confirmationResult.value.err.InstructionError[1].Custom === 0) {
                        console.log(`[SENDER-V14] ✅ Transaction failed with 'Account Already Initialized', treating as success for ATA creation`);
                        const executionTime = Date.now() - startTime;
                        return { success: true, signature, executionTime, confirmationTime: executionTime };
                    }
                    
                    console.error(`[SENDER-V14] ❌ TRANSACTION FAILED ON-CHAIN: ${onChainError}`);
                    console.error(`[SENDER-V14] 🔍 Full Error Details:`, confirmationResult.value.err);
                    return { success: false, error: onChainError, signature, executionTime: Date.now() - startTime };
                }

                const executionTime = Date.now() - startTime;
                console.log(`[SENDER-V14] ✅✅✅ SUCCESS! INJECTED & CONFIRMED in ${executionTime}ms!`);
                
                return { success: true, signature, executionTime, confirmationTime: executionTime };
                
            } catch (confirmError) {
                console.error(`[SENDER-V14] ❌ CONFIRMATION FAILED:`, {
                    message: confirmError.message,
                    error: confirmError,
                    stack: confirmError.stack,
                    signature: signature
                });
                // Return the signature even if confirmation fails, so we can check it on Solscan
                return { success: false, error: confirmError.message || 'Confirmation failed with unknown error', signature, executionTime: Date.now() - startTime };
            }
            
        } catch (error) {
            console.error(`[SENDER-V14] ❌ DIRECT INJECTION FAILED: ${error.message}`, { stack: error.stack, signature });
            // Return the signature even if confirmation fails, so we can check it on Solscan
            return { success: false, error: error.message, signature };
        }
    }

    // HELIUS SMART TRANSACTIONS: Automatic optimization
    async executeWithHeliusSmartTransactions(instructions, keypair, options = {}) {
        const startTime = Date.now();
        
        try {
            console.log(`[HELIUS-SMART] 🧠 Executing with Helius Smart Transactions...`);
            
            // Helius Smart Transactions handle everything automatically:
            // 1. Fetch latest blockhash
            // 2. Build initial transaction
            // 3. Simulate transaction to get compute units
            // 4. Set compute unit limit with margin
            // 5. Get Helius recommended priority fee
            // 6. Add safety buffer fee
            // 7. Handle PDA/ATA creation automatically
            // 8. Build and send optimized transaction
            
            console.log(`[HELIUS-SMART] 🔧 Using fallback smart transaction approach...`);
            
            // Use the regular executeCopyTrade method as fallback
            const result = await this.executeCopyTrade(instructions, keypair, options);
            
            const executionTime = Date.now() - startTime;
            this.updateExecutionStats(executionTime, true);
            
            // RECORD WITH PERFORMANCE MONITOR
            performanceMonitor.recordExecutionLatency(executionTime);
            
            console.log(`[HELIUS-SMART] ✅ Smart transaction completed in ${executionTime}ms`);
            
            return {
                success: true,
                signature: result?.signature,
                executionTime,
                confirmationTime: executionTime,
                tipAmount: result?.tipAmount || 0,
                tipAccount: result?.tipAccount || 'auto'
            };
            
        } catch (error) {
            console.error(`[HELIUS-SMART] ❌ Smart transaction failed: ${error.message}`);
            throw error;
        }
    }
}

module.exports = { SingaporeSenderManager };