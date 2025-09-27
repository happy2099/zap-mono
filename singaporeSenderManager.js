// File: singaporeSenderManager.js
// Description: ULTRA-FAST Singapore regional Helius Sender endpoint manager for sub-200ms trade execution

const { Connection, PublicKey, LAMPORTS_PER_SOL, ComputeBudgetProgram, SystemProgram, VersionedTransaction, TransactionMessage } = require('@solana/web3.js');
const config = require('./config.js');
const { shortenAddress } = require('./utils.js');
const performanceMonitor = require('./performanceMonitor.js');
const leaderTracker = require('./leaderTracker.js'); // <-- ADD THIS LINE

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

        // Use provided connection or create new one
        this.connection = connection || new Connection(this.singaporeEndpoints.rpc, {
            commitment: 'confirmed',
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
            
            // GET DYNAMIC TIP AMOUNT
            console.log(`[SINGAPORE-SENDER] 🔍 Step 2: Getting tip amount...`);
            const tipAmountSOL = await this.getDynamicTipAmount();
            const tipAccount = new PublicKey(this.tipAccounts[Math.floor(Math.random() * this.tipAccounts.length)]);
            
            console.log(`[SINGAPORE-SENDER] 💰 Using tip amount: ${tipAmountSOL} SOL to ${shortenAddress(tipAccount)}`);
            
            // BUILD OPTIMIZED TRANSACTION
            console.log(`[SINGAPORE-SENDER] 🔍 Step 3: Building optimized transaction...`);
            const optimizedTransaction = await this.buildOptimizedTransaction(
                transaction, 
                keypair, 
                tipAccount, 
                tipAmountSOL,
                options
            );
            console.log(`[SINGAPORE-SENDER] ✅ Optimized transaction built successfully`);
            
            // EXECUTE VIA SENDER ENDPOINT
            console.log(`[SINGAPORE-SENDER] 🔍 Step 4: Sending transaction via Sender endpoint...`);
            const signature = await this.sendViaSender(optimizedTransaction, 3, options.platform || 'UNKNOWN');
            console.log(`[SINGAPORE-SENDER] ✅ Transaction sent! Signature: ${signature}`);
            
            // CONFIRM TRANSACTION
            console.log(`[SINGAPORE-SENDER] 🔍 Step 5: Confirming transaction...`);
            const confirmationTime = await this.confirmTransaction(signature);
            
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
                console.log(`[SINGAPORE-SENDER] ❌ Validation failed: Missing instructions`);
                return false;
            }
            
            // Check if instructions are valid Solana instructions
            for (const instruction of transaction.instructions) {
                if (!instruction.programId || !instruction.keys || !instruction.data) {
                    console.log(`[SINGAPORE-SENDER] ❌ Validation failed: Invalid instruction format`);
                    return false;
                }
            }
            
            console.log(`[SINGAPORE-SENDER] ✅ Transaction validation passed with ${transaction.instructions.length} instructions`);
            return true;
        } catch (error) {
            console.log(`[SINGAPORE-SENDER] ❌ Validation error:`, error.message);
            return false;
        }
    }

    // Build optimized transaction with tip and compute budget
    async buildOptimizedTransaction(originalTransaction, keypair, tipAccount, tipAmountSOL, options = {}) {
        try {
            console.log(`[SINGAPORE-SENDER] 🔧 Building optimized transaction...`);
            console.log(`[SINGAPORE-SENDER] 📊 Original instructions: ${originalTransaction.instructions.length}`);
            
            // Get recent blockhash
            const { value: { blockhash, lastValidBlockHeight } } = await this.connection.getLatestBlockhashAndContext('confirmed');
            
            // Create copy of instructions to avoid modifying the original
            const allInstructions = [...originalTransaction.instructions];

            // Determine compute units (from options or fallback)
            const computeUnits = options.computeUnits || 100_000;
            
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
            
            console.log(`[SINGAPORE-SENDER] 🔧 Total instructions after optimization: ${allInstructions.length}`);
            
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
            
            console.log(`[SINGAPORE-SENDER] ✅ Optimized transaction built with ${allInstructions.length} instructions`);
            console.log(`[SINGAPORE-SENDER] 🔧 Compute units: ${computeUnits}, Priority fee: ${effectiveMicroLamports} microLamports`);
            console.log(`[SINGAPORE-SENDER] 📝 Transaction size: ${optimizedTransaction.serialize().length} bytes`);
            
            return {
                transaction: optimizedTransaction,
                blockhash,
                lastValidBlockHeight
            };
            
        } catch (error) {
            console.error(`[SINGAPORE-SENDER] ❌ Error building optimized transaction:`, error);
            throw error;
        }
    }

    // Send transaction via Helius Singapore Sender endpoint with smart error recovery and leader targeting
    async sendViaSender(transactionData, retries = 3, platform = 'UNKNOWN') {
        let { transaction, blockhash, lastValidBlockHeight } = transactionData;

        // ============================= LEADER TARGETING =============================
        const leader = leaderTracker.getCurrentLeader();
        let targetEndpoint = this.singaporeEndpoints.sender; // Default endpoint

        if (leader) {
            targetEndpoint = `http://sg-sender.helius-rpc.com/fast?leader=${leader}`; 
            console.log(`[SINGAPORE-SENDER] 🎯 Targeting current leader: ${leader} via Singapore on-ramp.`);
        } else {
            console.warn('[SINGAPORE-SENDER] ⚠️ No leader detected. Using default regional endpoint.');
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

                // Send transaction via the targeted endpoint
                const response = await fetch(targetEndpoint, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        jsonrpc: '2.0',
                        id: Date.now().toString(),
                        method: 'sendTransaction',
                        params: [
                            Buffer.from(transaction.serialize()).toString('base64'),
                            {
                                encoding: 'base64',
                                skipPreflight: true, // Required for Sender
                                maxRetries: 0         // Use custom retry logic
                            }
                        ]
                    })
                });

                const result = await response.json();
                if (result.error) {
                    throw new Error(result.error.message);
                }

                console.log(`[SINGAPORE-SENDER] ✅ Transaction sent successfully: ${result.result}`);
                return result.result;

            } catch (error) {
                console.warn(`[SINGAPORE-SENDER] ⚠️ Attempt ${attempt} failed: ${error.message}`);

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

    // Confirm transaction with timeout
    async confirmTransaction(signature, timeout = 15000) {
        const startTime = Date.now();
        const interval = 1000; // Check every 1 second
        
        console.log(`[SINGAPORE-SENDER] 🔍 Confirming transaction: ${signature}...`);
        
        while (Date.now() - startTime < timeout) {
            try {
                const status = await this.connection.getSignatureStatuses([signature]);
                const confirmationStatus = status?.value[0]?.confirmationStatus;
                
                if (confirmationStatus === 'confirmed' || confirmationStatus === 'finalized') {
                    const confirmationTime = Date.now() - startTime;
                    console.log(`[SINGAPORE-SENDER] ✅ Transaction confirmed in ${confirmationTime}ms`);
                    return confirmationTime;
                }
                
                // Log progress
                if (Date.now() - startTime > 5000) { // After 5 seconds
                    console.log(`[SINGAPORE-SENDER] ⏳ Still waiting for confirmation... (${Date.now() - startTime}ms elapsed)`);
                }
                
            } catch (error) {
                console.warn('[SINGAPORE-SENDER] ⚠️ Status check failed:', error.message);
            }
            
            await new Promise(resolve => setTimeout(resolve, interval));
        }
        
        throw new Error(`Transaction confirmation timeout after ${timeout}ms`);
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
            
            console.log(`[PRIORITY_FEE] 🔍 Estimating priority fee for ${accountKeys.size} accounts...`);
            
            // Use Helius API directly
            const response = await fetch(`${this.singaporeEndpoints.rpc}`, {
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

    // Simulate transaction to get compute units
    async simulateTransaction(instructions, keypair, blockhash) {
        try {
            console.log(`[SINGAPORE-SENDER] 🔍 Simulating transaction for compute units...`);
            
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
            const computeUnits = units < 1000 ? 1000 : Math.ceil(units * 1.1); // 10% margin
            
            console.log(`[SINGAPORE-SENDER] 🔧 Simulated compute units: ${units}, Using: ${computeUnits}`);
            return computeUnits;
            
        } catch (error) {
            console.warn('[SINGAPORE-SENDER] ⚠️ Simulation failed, using default compute units:', error.message);
            return 100_000; // Default compute units
        }
    }

    // ULTRA-FAST copy trade execution with Helius Smart Transactions
    async executeCopyTrade(instructions, keypair, options = {}) {
        try {
            console.log(`[SINGAPORE-SENDER] 🚀 Starting ULTRA-FAST copy trade execution...`);
            console.log(`[SINGAPORE-SENDER] 🔬 Black Box: Options received:`, JSON.stringify(options, null, 2));
            
            // Check if Helius Smart Transactions are enabled
            if (options.useSmartTransactions) {
                console.log(`[SINGAPORE-SENDER] 🧠 Helius Smart Transactions enabled - automatic optimization`);
                return await this.executeWithHeliusSmartTransactions(instructions, keypair, options);
            }
            
            // Debug: Log instruction structure
            console.log(`[SINGAPORE-SENDER] 🔍 Instructions received:`, instructions.length);
            if (instructions.length > 0) {
                console.log(`[SINGAPORE-SENDER] 🔍 First instruction keys:`, Object.keys(instructions[0]));
                console.log(`[SINGAPORE-SENDER] 🔍 First instruction programId:`, instructions[0].programId);
                
                // Validate instruction structure
                for (let i = 0; i < instructions.length; i++) {
                    const ix = instructions[i];
                    if (!ix.programId) {
                        console.error(`[SINGAPORE-SENDER] ❌ Instruction ${i} missing programId:`, ix);
                        throw new Error(`Instruction ${i} is missing programId - invalid instruction format`);
                    }
                    if (!ix.programId.equals) {
                        console.error(`[SINGAPORE-SENDER] ❌ Instruction ${i} programId is not a PublicKey:`, ix.programId);
                        throw new Error(`Instruction ${i} programId is not a valid PublicKey object`);
                    }
                }
            }
            
            // Validate user hasn't included compute budget instructions
            const hasComputeBudget = instructions.some(ix => 
                ix.programId && ix.programId.equals && ix.programId.equals(ComputeBudgetProgram.programId)
            );
            if (hasComputeBudget) {
                throw new Error('Do not include compute budget instructions - they are added automatically');
            }
            
            // Get recent blockhash
            console.log(`[SINGAPORE-SENDER] 🔍 Step 1: Getting recent blockhash...`);
            const { value: blockhashInfo } = await this.connection.getLatestBlockhashAndContext('confirmed');
            const { blockhash, lastValidBlockHeight } = blockhashInfo;
            console.log(`[SINGAPORE-SENDER] ✅ Blockhash obtained: ${blockhash.substring(0, 8)}...`);
            
            // Get dynamic compute units
            console.log(`[SINGAPORE-SENDER] 🔍 Step 2: Simulating transaction for compute units...`);
            const computeUnits = await this.simulateTransaction(instructions, keypair, blockhash);
            console.log(`[SINGAPORE-SENDER] ✅ Compute units calculated: ${computeUnits}`);
            
            // Get dynamic priority fee
            console.log(`[SINGAPORE-SENDER] 🔍 Step 3: Getting dynamic priority fee...`);
            const priorityFee = await this.getDynamicPriorityFee(instructions, keypair.publicKey, blockhash);
            console.log(`[SINGAPORE-SENDER] ✅ Priority fee calculated: ${priorityFee} microLamports`);
            
            // Get dynamic tip amount
            console.log(`[SINGAPORE-SENDER] 🔍 Step 4: Getting dynamic tip amount...`);
            const tipAmountSOL = await this.getDynamicTipAmount();
            const tipAccount = new PublicKey(this.tipAccounts[Math.floor(Math.random() * this.tipAccounts.length)]);
            console.log(`[SINGAPORE-SENDER] ✅ Tip amount: ${tipAmountSOL} SOL to ${tipAccount.toBase58().substring(0, 8)}...`);
            
            console.log(`[SINGAPORE-SENDER] 🔧 Copy trade optimization complete:`);
            console.log(`[SINGAPORE-SENDER]   - Compute units: ${computeUnits}`);
            console.log(`[SINGAPORE-SENDER]   - Priority fee: ${priorityFee} microLamports`);
            console.log(`[SINGAPORE-SENDER]   - Tip amount: ${tipAmountSOL} SOL`);
            
            // Execute with optimized parameters
            const masterTxId = options.signature || 'N/A'; // For logging the source
            console.log(`[SINGAPORE-SENDER] 🔍 Master transaction ID for logging: ${masterTxId}`);
            
            const transactionData = await this.buildOptimizedTransaction(
                { instructions },
                keypair,
                tipAccount,
                tipAmountSOL,
                {
                    computeUnits,
                    priorityFee,
                    platform: options.platform || 'UNKNOWN'
                }
            );
            
            const { transaction, blockhash: txBlockhash, lastValidBlockHeight: txLastValidBlockHeight } = transactionData;
            
            // Send transaction
            console.log(`[SINGAPORE-SENDER] ✍️ Signing transaction...`);
            const newTxId = await this.sendViaSender(transactionData, 3, options.platform || 'UNKNOWN');
            console.log(`[SINGAPORE-SENDER] ✅ Transaction sent! NEW signature: ${newTxId}`);
            
            // Confirm transaction
            console.log(`[SINGAPORE-SENDER] ⏳ Awaiting confirmation for NEW signature: ${newTxId}`);
            // ==========================================================
            // ==================== THE FINAL FIX =======================
            // ==========================================================
            const confirmationTime = await this.confirmTransaction(newTxId);
            // ==========================================================
            
            // CALCULATE EXECUTION TIME
            const executionTime = Date.now() - startTime;
            this.updateExecutionStats(executionTime, true);
            
            // RECORD WITH PERFORMANCE MONITOR
            performanceMonitor.recordExecutionLatency(executionTime);
            
            console.log(`[SINGAPORE-SENDER] ✅ Copy trade execution completed in ${executionTime}ms!`);
            console.log(`[SINGAPORE-SENDER] 📝 Signature: ${newTxId}`);
            console.log(`[SINGAPORE-SENDER] ⚡ Execution time: ${executionTime}ms`);
            console.log(`[SINGAPORE-SENDER] 🔍 Confirmation time: ${confirmationTime}ms`);
            
            // Return success result for the executor
            return {
                success: true,
                signature: newTxId,
                executionTime,
                confirmationTime,
                tipAmount: tipAmountSOL,
                tipAccount: tipAccount.toString()
            };
            
        } catch (error) {
            console.error(`[SINGAPORE-SENDER] ❌ CRITICAL FAILURE in executeCopyTrade:`, error.message);
            console.error(`[SINGAPORE-SENDER] 🔬 Full Error:`, error);
            console.error(`[SINGAPORE-SENDER] 🔬 Stack Trace:`, error.stack);
            
            // Return failure result for the executor
            return {
                success: false,
                error: error.message,
                executionTime: Date.now() - Date.now() // 0 since it failed
            };
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
            
            const { Helius } = require('helius-sdk');
            const helius = new Helius(process.env.HELIUS_API_KEY);
            
            console.log(`[HELIUS-SMART] 🔧 Using Helius SDK for automatic optimization...`);
            
            // Send with Helius Smart Transactions
            const transactionSignature = await helius.rpc.sendSmartTransaction(instructions, [keypair]);
            
            console.log(`[HELIUS-SMART] ✅ Smart transaction sent: ${transactionSignature}`);
            
            // CRITICAL FIX: Confirm the NEW transaction signature, not the master's
            console.log(`[HELIUS-SMART] 🔍 Confirming NEW transaction: ${transactionSignature}`);
            const confirmationTime = await this.confirmTransaction(transactionSignature);
            
            const executionTime = Date.now() - startTime;
            
            console.log(`[HELIUS-SMART] ✅ Smart transaction confirmed in ${confirmationTime}ms`);
            
            return {
                signature: transactionSignature, // Use the NEW signature
                executionTime: executionTime,
                confirmationTime: confirmationTime,
                tipAmount: 0, // Handled by Helius
                tipAccount: null,
                smartTransaction: true
            };
            
        } catch (error) {
            console.error(`[HELIUS-SMART] ❌ Smart transaction failed: ${error.message}`);
            throw error;
        }
    }
}

module.exports = { SingaporeSenderManager };