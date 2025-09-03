// File: singaporeSenderManager.js
// Description: Singapore regional Helius Sender endpoint manager for ultra-fast trade execution

const { Connection, PublicKey, LAMPORTS_PER_SOL, ComputeBudgetProgram, SystemProgram, VersionedTransaction, TransactionMessage } = require('@solana/web3.js');
const config = require('./config.js');
const { shortenAddress } = require('./utils.js');

class SingaporeSenderManager {
    constructor() {
        // Singapore regional endpoints (corrected Helius URLs)
        this.singaporeEndpoints = {
            rpc: 'https://mainnet.helius-rpc.com/?api-key=b9a69ad0-d823-429e-8c18-7cbea0e31769',
            sender: 'https://mainnet.helius-rpc.com/?api-key=b9a69ad0-d823-429e-8c18-7cbea0e31769',
            laserstream: 'wss://mainnet.helius-rpc.com/?api-key=b9a69ad0-d823-429e-8c18-7cbea0e31769'
        };

        // Jito tip accounts for Singapore region
        this.tipAccounts = [
            "4ACfpUFoaSD9bfPdeu6DBt89gB6ENTeHBXCAi87KhDEE",
            "D2L6yPZ2FmmmTKPgzaMKdhu6EWZcTpLy1Vhx8uvZe7NZ", 
            "9bnz4RShgq1hAnLnZbP8kbgBg1kEmcJBYQq3gQbmnSta",
            "5VY91ws6B2hMmBFRsXkoAAdsPHBJwRfBht4DXox3xkwn",
            "2nyhqdwKcJZR2vcqCyrYsaPVdAnFoJjiksCXJ7hfEYgD",
            "2q5pghRs6arqVjRvT5gfgWfWcHWmw1ZuCzphgd5KfWGJ",
            "wyvPkWjVZz1M8fHQnMMCDTQDbkManefNNhweYk5WkcF",
            "3KCKozbAaF75qEU33jtzozcJ29yJuaLJTy2jFdzUY8bT",
            "4vieeGHPYPG2MmyPRcYjdiDmmhN3ww7hsFNap8pVN3Ey",
            "4TQLFNWK8AovT1gFvda5jfw2oJeRMKEmw7aH6MGBJ3or"
        ];

        this.connection = new Connection(this.singaporeEndpoints.rpc, {
            commitment: 'confirmed',
            wsEndpoint: this.singaporeEndpoints.laserstream.replace('wss://', 'ws://')
        });

        this.isHealthy = true;
        this.lastHealthCheck = Date.now();
        this.healthCheckInterval = 30000; // 30 seconds

        console.log('[SINGAPORE-SENDER] 🚀 Manager initialized with Singapore regional endpoints');
        console.log(`[SINGAPORE-SENDER] 🌏 Endpoints: ${JSON.stringify(this.singaporeEndpoints, null, 2)}`);
        
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

    // Get dynamic tip amount from Jito API (75th percentile)
    async getDynamicTipAmount() {
        try {
            const response = await fetch('https://bundles.jito.wtf/api/v1/bundles/tip_floor');
            const data = await response.json();
            
            if (data && data[0] && typeof data[0].landed_tips_75th_percentile === 'number') {
                const tip75th = data[0].landed_tips_75th_percentile;
                // Use 75th percentile but minimum 0.001 SOL
                return Math.max(tip75th, 0.001);
            }
            
            // Fallback if API fails or data is invalid
            return 0.001;
        } catch (error) {
            console.warn('[SINGAPORE-SENDER] ⚠️ Failed to fetch dynamic tip amount, using fallback:', error);
            return 0.001; // Fallback to minimum
        }
    }

    // Execute copy trade with Singapore Sender endpoint
    async executeCopyTrade(instructions, keypair, tradeDetails) {
        try {
            if (!this.isHealthy) {
                throw new Error('Singapore Sender endpoint is not healthy. Please wait for recovery.');
            }

            console.log(`[SINGAPORE-SENDER] 🚀 Executing copy trade for ${shortenAddress(tradeDetails.tokenMint)}`);
            console.log(`[SINGAPORE-SENDER] 📍 Platform: ${tradeDetails.dexPlatform}`);
            console.log(`[SINGAPORE-SENDER] 💰 Trade Size: ${tradeDetails.tradeSize || 'Standard'}`);

            // Validate instructions don't include compute budget (we'll add them)
            const hasComputeBudget = instructions.some(ix => 
                ix.programId.equals(ComputeBudgetProgram.programId)
            );
            if (hasComputeBudget) {
                throw new Error('Do not include compute budget instructions - they are added automatically');
            }

            // Create copy of instructions to avoid modifying the original array
            const allInstructions = [...instructions];

            // Get dynamic tip amount from Jito API
            const tipAmountSOL = await this.getDynamicTipAmount();
            const tipAccount = new PublicKey(this.tipAccounts[Math.floor(Math.random() * this.tipAccounts.length)]);
            
            console.log(`[SINGAPORE-SENDER] 💸 Using dynamic tip amount: ${tipAmountSOL} SOL`);
            console.log(`[SINGAPORE-SENDER] 🎯 Tip account: ${shortenAddress(tipAccount.toBase58())}`);

            // Add tip transfer instruction
            allInstructions.push(
                SystemProgram.transfer({
                    fromPubkey: keypair.publicKey,
                    toPubkey: tipAccount,
                    lamports: tipAmountSOL * LAMPORTS_PER_SOL,
                })
            );

            // Get recent blockhash with context
            const { value: blockhashInfo } = await this.connection.getLatestBlockhashAndContext('confirmed');
            const { blockhash, lastValidBlockHeight } = blockhashInfo;

            // Simulate transaction to get compute units
            const testInstructions = [
                ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }),
                ...allInstructions,
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

            // Set compute unit limit with minimum 1000 CUs and 10% margin
            const units = simulation.value.unitsConsumed;
            const computeUnits = units < 1000 ? 1000 : Math.ceil(units * 1.1);

            // Build final transaction with optimizations
            const finalInstructions = [
                ComputeBudgetProgram.setComputeUnitLimit({ units: computeUnits }),
                ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 200_000 }), // 0.0002 SOL per CU
                ...allInstructions,
            ];

            const transaction = new VersionedTransaction(
                new TransactionMessage({
                    instructions: finalInstructions,
                    payerKey: keypair.publicKey,
                    recentBlockhash: blockhash,
                }).compileToV0Message()
            );

            // Sign transaction
            transaction.sign([keypair]);

            console.log(`[SINGAPORE-SENDER] 📊 Transaction prepared:`);
            console.log(`   - Compute Units: ${computeUnits}`);
            console.log(`   - Tip Amount: ${tipAmountSOL} SOL`);
            console.log(`   - Total Instructions: ${finalInstructions.length}`);
            console.log(`   - Blockhash: ${shortenAddress(blockhash)}`);

            // Send via Singapore Sender endpoint
            const signature = await this.sendViaSender(transaction);
            
            console.log(`[SINGAPORE-SENDER] ✅ Transaction sent successfully: ${shortenAddress(signature)}`);
            
            // Wait for confirmation
            const confirmedSignature = await this.confirmTransaction(signature, lastValidBlockHeight);
            
            return {
                success: true,
                signature: confirmedSignature,
                tipAmount: tipAmountSOL,
                computeUnits,
                endpoint: 'singapore-sender',
                timestamp: Date.now()
            };

        } catch (error) {
            console.error(`[SINGAPORE-SENDER] ❌ Copy trade execution failed:`, error);
            throw error;
        }
    }

    // Send transaction via Singapore Sender endpoint
    async sendViaSender(transaction) {
        try {
            console.log(`[SINGAPORE-SENDER] 🚀 Sending via Singapore Sender endpoint...`);
            
            const response = await fetch(this.singaporeEndpoints.sender, {
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
                            maxRetries: 0        // Implement your own retry logic
                        }
                    ]
                })
            });

            const result = await response.json();
            if (result.error) {
                throw new Error(`Sender endpoint error: ${result.error.message}`);
            }

            return result.result;

        } catch (error) {
            console.error(`[SINGAPORE-SENDER] ❌ Sender endpoint error:`, error);
            throw error;
        }
    }

    // Confirm transaction with timeout
    async confirmTransaction(signature, lastValidBlockHeight) {
        const timeout = 15000; // 15 seconds
        const interval = 1000;  // 1 second
        const startTime = Date.now();
        
        console.log(`[SINGAPORE-SENDER] ⏳ Waiting for confirmation: ${shortenAddress(signature)}`);
        
        while (Date.now() - startTime < timeout) {
            try {
                const status = await this.connection.getSignatureStatuses([signature]);
                const confirmationStatus = status?.value[0]?.confirmationStatus;
                
                if (confirmationStatus === "confirmed" || confirmationStatus === "finalized") {
                    console.log(`[SINGAPORE-SENDER] ✅ Transaction confirmed: ${shortenAddress(signature)}`);
                    return signature;
                }
                
                // Check if blockhash is still valid
                const currentSlot = await this.connection.getSlot();
                if (currentSlot > lastValidBlockHeight) {
                    throw new Error('Transaction expired - blockhash too old');
                }
                
            } catch (error) {
                console.warn(`[SINGAPORE-SENDER] ⚠️ Status check failed:`, error.message);
            }
            
            await new Promise(resolve => setTimeout(resolve, interval));
        }
        
        throw new Error(`Transaction confirmation timeout: ${shortenAddress(signature)}`);
    }

    // Get Singapore endpoint status
    getEndpointStatus() {
        return {
            isHealthy: this.isHealthy,
            lastHealthCheck: this.lastHealthCheck,
            endpoints: this.singaporeEndpoints,
            uptime: Date.now() - this.lastHealthCheck
        };
    }

    // Force health check
    async forceHealthCheck() {
        console.log(`[SINGAPORE-SENDER] 🔍 Forcing health check...`);
        await this.healthCheck();
        return this.isHealthy;
    }

    // Get optimal tip amount for current network conditions
    async getOptimalTipAmount() {
        try {
            // Get current network congestion
            const slot = await this.connection.getSlot();
            const recentPerformance = await this.connection.getRecentPerformanceSamples(1);
            
            let baseTip = 0.001; // Base tip
            
            if (recentPerformance && recentPerformance[0]) {
                const avgSlotTime = recentPerformance[0].numSlots / recentPerformance[0].numTransactions;
                
                // Adjust tip based on network congestion
                if (avgSlotTime > 0.6) { // Slow network
                    baseTip = 0.002; // 0.002 SOL
                } else if (avgSlotTime < 0.4) { // Fast network
                    baseTip = 0.0005; // 0.0005 SOL
                }
            }
            
            // Get dynamic tip from Jito
            const jitoTip = await this.getDynamicTipAmount();
            
            // Use the higher of base tip or Jito tip
            const optimalTip = Math.max(baseTip, jitoTip);
            
            console.log(`[SINGAPORE-SENDER] 💡 Optimal tip calculated: ${optimalTip} SOL`);
            return optimalTip;
            
        } catch (error) {
            console.warn(`[SINGAPORE-SENDER] ⚠️ Error calculating optimal tip:`, error);
            return 0.001; // Fallback
        }
    }
}

module.exports = { SingaporeSenderManager };
