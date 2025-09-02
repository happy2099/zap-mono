// // ==========================================
// // File: pumpFunPrebuilder.js
// // Description: Pump.fun Prebuild & Presign System
// // ==========================================

// const { Connection, PublicKey, Transaction, SystemProgram, SYSVAR_RENT_PUBKEY } = require('@solana/web3.js');
// const { Token, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID } = require('@solana/spl-token');
// const { PumpSdk } = require('@pump-fun/pump-sdk');
// const bs58 = require('bs58');
// const config = require('./config.js');
// const traceLogger = require('./traceLogger.js');

// class PumpFunPrebuilder {
//     constructor(solanaManager, walletManager) {
//         this.solanaManager = solanaManager;
//         this.walletManager = walletManager;
//         // Initialize pumpSdk later when needed, since getPrimaryWallet is async
//         this.pumpSdk = null;
        
//         // Pump.fun program IDs
//         this.PUMP_FUN_PROGRAM = new PublicKey('6EF8rrecthR5DkVaGFKLkma4YkdrkvPPHoqUPLQkwQjR');
//         this.PUMP_FUN_VARIANT = new PublicKey('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P');
//         this.PUMP_FUN_AMM = new PublicKey('pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA');
        
//         console.log('[PUMP.FUN PREBUILDER] Initialized with Pump SDK');
//     }

//     /**
//      * Initialize pumpSdk with the primary wallet
//      */
//     async initializePumpSdk() {
//         if (!this.pumpSdk) {
//             const keypairPacket = await this.walletManager.getPrimaryTradingKeypair();
//             if (!keypairPacket) {
//                 throw new Error('No primary wallet available for Pump SDK');
//             }
//             this.pumpSdk = new PumpSdk({
//                 connection: this.solanaManager.connection,
//                 wallet: keypairPacket.wallet
//             });
//         }
//         return this.pumpSdk;
//     }

//     /**
//      * Prebuild a pump.fun swap transaction
//      */
//     async prebuildSwap(swapDetails) {
//         const { signature, traderWallet, userChatId, tokenMint, amountIn, amountOut, poolId } = swapDetails;
        
//         try {
//             await traceLogger.appendTrace(signature, 'pump_prebuild_start', { 
//                 tokenMint: tokenMint.toBase58(), 
//                 amountIn: amountIn.toString(),
//                 poolId: poolId.toBase58()
//             });

//             // Get pool data
//             const poolData = await this.getPoolData(poolId);
//             if (!poolData) {
//                 throw new Error('Pool data not found');
//             }

//             // Create swap instruction
//             const swapInstruction = await this.createSwapInstruction({
//                 poolId,
//                 tokenMint,
//                 amountIn,
//                 amountOut,
//                 poolData
//             });

//             // Build transaction
//             const transaction = await this.buildTransaction(swapInstruction, userChatId);
            
//             // Presign transaction
//             const presignedTx = await this.presignTransaction(transaction, userChatId);

//             await traceLogger.appendTrace(signature, 'pump_prebuild_success', {
//                 transactionSize: presignedTx.length,
//                 fee: transaction.recentBlockhash
//             });

//             return {
//                 success: true,
//                 presignedTransaction: presignedTx,
//                 transaction: transaction,
//                 poolData: poolData
//             };

//         } catch (error) {
//             await traceLogger.appendTrace(signature, 'pump_prebuild_error', { 
//                 error: error.message 
//             });
//             throw error;
//         }
//     }

//     /**
//      * Get pool data from pump.fun
//      */
//     async getPoolData(poolId) {
//         try {
//             const pumpSdk = await this.initializePumpSdk();
//             const poolInfo = await pumpSdk.getPoolInfo(poolId);
            
//             if (!poolInfo) {
//                 throw new Error('Pool not found');
//             }

//             return {
//                 poolId: poolId,
//                 tokenAMint: poolInfo.tokenAMint,
//                 tokenBMint: poolInfo.tokenBMint,
//                 tokenABalance: poolInfo.tokenABalance,
//                 tokenBBalance: poolInfo.tokenBBalance,
//                 feeRate: poolInfo.feeRate,
//                 poolState: poolInfo.poolState
//             };
//         } catch (error) {
//             console.error('[PUMP.FUN] Error getting pool data:', error);
//             throw error;
//         }
//     }

//     /**
//      * Create swap instruction for pump.fun
//      */
//     async createSwapInstruction(swapParams) {
//         const { poolId, tokenMint, amountIn, amountOut, poolData } = swapParams;
        
//         try {
//             // Determine if this is a buy or sell
//             const isBuy = tokenMint.equals(poolData.tokenAMint);
//             const tokenInMint = isBuy ? poolData.tokenBMint : poolData.tokenAMint;
//             const tokenOutMint = isBuy ? poolData.tokenAMint : poolData.tokenBMint;

//             // Get user's token accounts
//             const keypairPacket = await this.walletManager.getPrimaryTradingKeypair();
//             const userWallet = keypairPacket.wallet;
//             const pumpSdk = await this.initializePumpSdk();
            
//             const tokenInAccount = await this.getOrCreateAssociatedTokenAccount(
//                 userWallet.publicKey,
//                 tokenInMint
//             );
//             const tokenOutAccount = await this.getOrCreateAssociatedTokenAccount(
//                 userWallet.publicKey,
//                 tokenOutMint
//             );

//             // Create swap instruction
//             const swapInstruction = await pumpSdk.createSwapInstruction({
//                 poolId: poolId,
//                 userWallet: userWallet.publicKey,
//                 tokenInAccount: tokenInAccount,
//                 tokenOutAccount: tokenOutAccount,
//                 amountIn: amountIn,
//                 minAmountOut: amountOut,
//                 feeRate: poolData.feeRate
//             });

//             return swapInstruction;

//         } catch (error) {
//             console.error('[PUMP.FUN] Error creating swap instruction:', error);
//             throw error;
//         }
//     }

//     /**
//      * Build transaction with proper setup
//      */
//     async buildTransaction(swapInstruction, userChatId) {
//         try {
//             const keypairPacket = await this.walletManager.getPrimaryTradingKeypair();
//             const userWallet = keypairPacket.wallet;
            
//             // Create new transaction
//             const transaction = new Transaction();
            
//             // Add compute budget instruction for priority fee
//             const computeBudgetIx = this.createComputeBudgetInstruction();
//             transaction.add(computeBudgetIx);
            
//             // Add swap instruction
//             transaction.add(swapInstruction);
            
//             // Get recent blockhash
//             const { blockhash } = await this.solanaManager.connection.getLatestBlockhash();
//             transaction.recentBlockhash = blockhash;
//             transaction.feePayer = userWallet.publicKey;

//             return transaction;

//         } catch (error) {
//             console.error('[PUMP.FUN] Error building transaction:', error);
//             throw error;
//         }
//     }

//     /**
//      * Presign transaction for fast execution
//      */
//     async presignTransaction(transaction, userChatId) {
//         try {
//             const keypairPacket = await this.walletManager.getPrimaryTradingKeypair();
//             const userWallet = keypairPacket.wallet;
            
//             // Sign transaction
//             transaction.sign(userWallet);
            
//             // Serialize transaction
//             const serializedTx = transaction.serialize({
//                 requireAllSignatures: false,
//                 verifySignatures: false
//             });

//             return bs58.encode(serializedTx);

//         } catch (error) {
//             console.error('[PUMP.FUN] Error presigning transaction:', error);
//             throw error;
//         }
//     }

//     /**
//      * Get or create associated token account
//      */
//     async getOrCreateAssociatedTokenAccount(owner, mint) {
//         try {
//             const associatedTokenAddress = await Token.getAssociatedTokenAddress(
//                 ASSOCIATED_TOKEN_PROGRAM_ID,
//                 TOKEN_PROGRAM_ID,
//                 mint,
//                 owner
//             );

//             // Check if account exists
//             const accountInfo = await this.solanaManager.connection.getAccountInfo(associatedTokenAddress);
            
//             if (accountInfo) {
//                 return associatedTokenAddress;
//             }

//             // Get primary wallet for fee payer
//             const keypairPacket = await this.walletManager.getPrimaryTradingKeypair();
            
//             // Create associated token account instruction
//             const createAtaIx = Token.createAssociatedTokenAccountInstruction(
//                 ASSOCIATED_TOKEN_PROGRAM_ID,
//                 TOKEN_PROGRAM_ID,
//                 mint,
//                 associatedTokenAddress,
//                 owner,
//                 keypairPacket.wallet.publicKey
//             );

//             return associatedTokenAddress;

//         } catch (error) {
//             console.error('[PUMP.FUN] Error getting/creating token account:', error);
//             throw error;
//         }
//     }

//     /**
//      * Create compute budget instruction for priority fees
//      */
//     createComputeBudgetInstruction() {
//         const COMPUTE_BUDGET_PROGRAM_ID = new PublicKey('ComputeBudget111111111111111111111111111111');
        
//         // Priority fee instruction (5000 micro-lamports per compute unit)
//         const priorityFeeIx = {
//             programId: COMPUTE_BUDGET_PROGRAM_ID,
//             keys: [],
//             data: Buffer.from([
//                 3, // Instruction index for set_compute_unit_price
//                 ...new Uint8Array(new Uint32Array([5000]).buffer) // Priority fee in micro-lamports
//             ])
//         };

//         return priorityFeeIx;
//     }

//     /**
//      * Execute presigned transaction
//      */
//     async executePresignedTransaction(presignedTx, signature) {
//         try {
//             await traceLogger.appendTrace(signature, 'pump_execute_start', { 
//                 transactionSize: presignedTx.length 
//             });

//             // Deserialize transaction
//             const transaction = Transaction.from(bs58.decode(presignedTx));
            
//             // Send transaction
//             const txSignature = await this.solanaManager.connection.sendRawTransaction(
//                 transaction.serialize(),
//                 {
//                     skipPreflight: false,
//                     preflightCommitment: 'confirmed',
//                     maxRetries: 3
//                 }
//             );

//             // Wait for confirmation
//             const confirmation = await this.solanaManager.connection.confirmTransaction(
//                 txSignature,
//                 'confirmed'
//             );

//             if (confirmation.value.err) {
//                 throw new Error(`Transaction failed: ${confirmation.value.err}`);
//             }

//             await traceLogger.appendTrace(signature, 'pump_execute_success', { 
//                 txSignature: txSignature 
//             });

//             return {
//                 success: true,
//                 signature: txSignature,
//                 confirmation: confirmation
//             };

//         } catch (error) {
//             await traceLogger.appendTrace(signature, 'pump_execute_error', { 
//                 error: error.message 
//             });
//             throw error;
//         }
//     }

//     /**
//      * Simulate transaction before execution
//      */
//     async simulateTransaction(presignedTx, signature) {
//         try {
//             const transaction = Transaction.from(bs58.decode(presignedTx));
            
//             const simulation = await this.solanaManager.connection.simulateTransaction(transaction, {
//                 commitment: 'confirmed',
//                 sigVerify: false
//             });

//             if (simulation.value.err) {
//                 throw new Error(`Simulation failed: ${simulation.value.err}`);
//             }

//             await traceLogger.appendTrace(signature, 'pump_simulation_success', {
//                 computeUnits: simulation.value.unitsConsumed,
//                 logs: simulation.value.logs?.slice(0, 5) // First 5 logs
//             });

//             return {
//                 success: true,
//                 simulation: simulation.value
//             };

//         } catch (error) {
//             await traceLogger.appendTrace(signature, 'pump_simulation_error', { 
//                 error: error.message 
//             });
//             throw error;
//         }
//     }

//     /**
//      * Get pool liquidity and price impact
//      */
//     async getPoolMetrics(poolId) {
//         try {
//             const poolData = await this.getPoolData(poolId);
            
//             // Calculate liquidity
//             const liquidity = poolData.tokenABalance.add(poolData.tokenBBalance);
            
//             // Calculate price impact (simplified)
//             const priceImpact = this.calculatePriceImpact(poolData);
            
//             return {
//                 poolId: poolId,
//                 liquidity: liquidity.toString(),
//                 priceImpact: priceImpact,
//                 feeRate: poolData.feeRate,
//                 tokenABalance: poolData.tokenABalance.toString(),
//                 tokenBBalance: poolData.tokenBBalance.toString()
//             };

//         } catch (error) {
//             console.error('[PUMP.FUN] Error getting pool metrics:', error);
//             throw error;
//         }
//     }

//     /**
//      * Calculate price impact for a trade
//      */
//     calculatePriceImpact(poolData) {
//         // Simplified price impact calculation
//         const totalLiquidity = poolData.tokenABalance.add(poolData.tokenBBalance);
//         const impact = totalLiquidity.gt(0) ? 
//             poolData.feeRate.mul(10000).div(totalLiquidity) : 0;
        
//         return impact.toNumber() / 10000; // Convert to percentage
//     }
// }

// module.exports = PumpFunPrebuilder;
