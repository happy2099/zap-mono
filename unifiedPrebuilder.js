// ==========================================
// File: unifiedPrebuilder.js - UNIFIED & OPTIMIZED
// Description: Universal prebuilder system for all DEX platforms
// ==========================================

const { PublicKey, BN, SystemProgram, Transaction } = require('@solana/web3.js');
const { 
    getAssociatedTokenAddressSync, 
    createAssociatedTokenAccountIdempotentInstruction,
    createSyncNativeInstruction,
    TOKEN_PROGRAM_ID,
    NATIVE_MINT
} = require('@solana/spl-token');
const { PumpSdk } = require('@pump-fun/pump-sdk');
const config = require('./patches/config.js');
// const traceLogger = require('./traceLogger.js'); // COMMENTED OUT FOR QA TESTING

// Optimization config
const OPTIMIZATION_CONFIG = {
    priorityFee: 50000,
    computeUnits: 200000,
    retries: 3,
    timeout: 5000,
};

class UnifiedPrebuilder {
    constructor(solanaManager, walletManager) {
        this.solanaManager = solanaManager;
        this.walletManager = walletManager;
        this.connection = solanaManager.connection;
        this.pumpSdk = null;
        console.log('[UNIFIED PREBUILDER] Initialized with lazy SDK loading');
    }

    async initializePumpSdk() {
        if (!this.pumpSdk) {
            const keypairPacket = await this.walletManager.getPrimaryTradingKeypair();
            if (!keypairPacket) {
                throw new Error('No primary wallet available for Pump SDK');
            }
            this.pumpSdk = new PumpSdk({
                connection: this.connection,
                wallet: keypairPacket.wallet
            });
        }
        return this.pumpSdk;
    }

    async checkATAs(owner, mint) {
        try {
            const ata = getAssociatedTokenAddressSync(mint, owner);
            const ataInfo = await this.connection.getAccountInfo(ata);
            return {
                ata,
                ataExists: !!ataInfo,
                createInstruction: createAssociatedTokenAccountIdempotentInstruction(
                    owner, ata, owner, mint
                ),
            };
        } catch (error) {
            throw new Error(`ATA check failed for mint ${mint.toBase58()}: ${error.message}`);
        }
    }

    async prebuildTrade(platform, poolId, amountLamports, owner, slippageBps = 50) {
        try {
            console.log(`[UNIFIED PREBUILDER] Building ${platform} trade for pool ${poolId.toBase58()}`);

            const [inputAtaCheck, outputAtaCheck, platformSdk] = await Promise.all([
                this.checkATAs(owner, NATIVE_MINT),
                this.checkATAs(owner, new PublicKey('11111111111111111111111111111111')),
                this.initializePlatformSdk(platform)
            ]);

            const instructions = [];
            
            if (!inputAtaCheck.ataExists) instructions.push(inputAtaCheck.createInstruction);
            if (!outputAtaCheck.ataExists) instructions.push(outputAtaCheck.createInstruction);

            if (NATIVE_MINT.equals(NATIVE_MINT)) {
                const wsolAccount = getAssociatedTokenAddressSync(NATIVE_MINT, owner, true);
                instructions.push(
                    createAssociatedTokenAccountIdempotentInstruction(owner, wsolAccount, owner, NATIVE_MINT),
                    SystemProgram.transfer({ fromPubkey: owner, toPubkey: wsolAccount, lamports: amountLamports }),
                    createSyncNativeInstruction(wsolAccount)
                );
            }

            const platformInstructions = await this.buildPlatformInstructions(
                platform, poolId, amountLamports, owner, slippageBps,
                inputAtaCheck.ata, outputAtaCheck.ata, platformSdk
            );

            instructions.push(...platformInstructions);

            return {
                instructions,
                cacheKey: `${platform}:${poolId.toBase58()}:swap`,
                metadata: {
                    platform,
                    poolId: poolId.toBase58(),
                    amountIn: amountLamports.toString(),
                    slippageBps,
                    timestamp: Date.now()
                },
            };

        } catch (error) {
            console.error(`[UNIFIED PREBUILDER] Error building ${platform} trade:`, error);
            throw error;
        }
    }

    async initializePlatformSdk(platform) {
        switch (platform.toLowerCase()) {
            case 'pump.fun':
            case 'pumpfun':
                return await this.initializePumpSdk();
            default:
                throw new Error(`Unsupported platform: ${platform}`);
        }
    }

    async buildPlatformInstructions(platform, poolId, amountLamports, owner, slippageBps, inputAta, outputAta, sdk) {
        switch (platform.toLowerCase()) {
            case 'pump.fun':
            case 'pumpfun':
                return await this.buildPumpFunInstructions(poolId, amountLamports, owner, slippageBps, inputAta, outputAta, sdk);
            default:
                throw new Error(`Unsupported platform: ${platform}`);
        }
    }

    async buildPumpFunInstructions(poolId, amountLamports, owner, slippageBps, inputAta, outputAta, sdk) {
        try {
            const poolInfo = await sdk.getPoolInfo(poolId);
            if (!poolInfo) {
                throw new Error('Pool not found');
            }

            const swapInstruction = await sdk.createSwapInstruction({
                poolId: poolId,
                userWallet: owner,
                tokenInAccount: inputAta,
                tokenOutAccount: outputAta,
                amountIn: new BN(amountLamports),
                minAmountOut: new BN(0),
                feeRate: poolInfo.feeRate
            });

            return [swapInstruction];

        } catch (error) {
            console.error('[UNIFIED PREBUILDER] Pump.fun instruction build failed:', error);
            throw error;
        }
    }

    async executeWithRetry(instructions, owner, metadata, attempt = 1) {
        try {
            const transaction = new Transaction().add(...instructions);
            transaction.recentBlockhash = (await this.connection.getLatestBlockhash()).blockhash;
            transaction.feePayer = owner.publicKey;

            const signedTx = await owner.signTransaction(transaction);
            const txid = await this.connection.sendRawTransaction(signedTx.serialize(), {
                skipPreflight: false,
                preflightCommitment: 'confirmed',
            });

            const confirmation = await this.connection.confirmTransaction({
                signature: txid,
                blockhash: transaction.recentBlockhash,
                lastValidBlockHeight: (await this.connection.getBlockHeight()) + 150,
            }, 'confirmed');

            if (confirmation.value.err) {
                throw new Error(`Transaction failed on-chain: ${JSON.stringify(confirmation.value.err)}`);
            }

            return { txid, confirmation, metadata };

        } catch (error) {
            console.warn(`[UNIFIED PREBUILDER] Attempt ${attempt} failed: ${error.message}`);
            if (attempt >= OPTIMIZATION_CONFIG.retries) {
                console.error(`[UNIFIED PREBUILDER] Transaction failed after ${OPTIMIZATION_CONFIG.retries} attempts.`);
                throw error;
            }
            
            await new Promise(resolve => 
                setTimeout(resolve, Math.pow(2, attempt) * 100)
            );
            return this.executeWithRetry(instructions, owner, metadata, attempt + 1);
        }
    }
}

module.exports = UnifiedPrebuilder;
