// ==========================================
// File: platformBuilders.js
// ==========================================

// --- CORE LIBRARIES ---
const {
    PublicKey,
    SystemProgram,
    TransactionInstruction,
    ComputeBudgetProgram,
    VersionedTransaction,
    TransactionMessage,
} = require('@solana/web3.js');
const { TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, getAssociatedTokenAddressSync, NATIVE_MINT: WSOL_MINT } = require("@solana/spl-token");
const axios = require('axios');
const BN = require('bn.js');
const { struct, u64, u8 } = require('@solana/buffer-layout');
const traceLogger = require('./traceLogger.js');

// --- PROTOCOL SDKs ---
const { PumpSdk } = require('@pump-fun/pump-sdk');
// const RaydiumV2_raw = require('@raydium-io/raydium-sdk');
// const RaydiumV2 = RaydiumV2_raw.default || RaydiumV2_raw;

// Now, safely extract all the tools we might need from the corrected V2 object.
// This gives every builder access to the same shared toolbox.
// const {
//     Liquidity,
//     Token,
//     TokenAmount,
//     Percent,
//     WSOL,
//     Clmm,
//     Cpmm,
//     LaunchpadPool,
//     LaunchpadConfig,
//     SwapMath,
//     TickUtils,
// } = RaydiumV2;

const { Dlmm } = require('@meteora-ag/dlmm');
const { CpAmm: MeteoraCpAmm } = require('@meteora-ag/cp-amm-sdk');
const MeteoraDBC = require('@meteora-ag/dynamic-bonding-curve-sdk');


// --- INTERNAL CONFIG & UTILS ---
const config = require('./patches/config.js');
const { shortenAddress } = require('./utils.js');


// --- ZAP-FORGED HELPERS (YOUR PROVEN CODE) ---
function createBuyExactInInstructionData(amount, minAmountOut, platformFeeBps) {
    const layout = struct([u8('instruction'), u64('amount'), u64('minAmountOut'), u64('platformFeeBps')]);
    const data = Buffer.alloc(layout.span);
    layout.encode({ instruction: 1, amount, minAmountOut, platformFeeBps }, data);
    return data;
}

function createSellExactInInstructionData(amount, minAmountOut, platformFeeBps) {
    const layout = struct([u8('instruction'), u64('amount'), u64('minAmountOut'), u64('platformFeeBps')]);
    const data = Buffer.alloc(layout.span);
    layout.encode({ instruction: 2, amount, minAmountOut, platformFeeBps }, data);
    return data;
}

async function _getLaunchpadPoolData(connection, poolId, configId, cacheManager) {
    const cachedData = cacheManager.getLaunchpadPoolData(poolId.toBase58());
    if (cachedData) return cachedData;

    const [poolAccount, configAccount] = await Promise.all([
        connection.getAccountInfo(poolId),
        connection.getAccountInfo(configId),
    ]);
    if (!poolAccount || !configAccount) throw new Error("Could not fetch pool/config accounts for Launchpad.");
    
    // Use the reliable decoders from the V2 SDK - this is one of the few parts that work.
    const poolInfo = RaydiumV2.LaunchpadPool.decode(poolAccount.data);
    const configInfo = RaydiumV2.LaunchpadConfig.decode(configAccount.data);
    
    const dataToCache = { poolInfo, configInfo };
    cacheManager.addLaunchpadPoolData(poolId.toBase58(), dataToCache);
    return dataToCache;
}
// ==========================================================

// --------------------------------------------------
/// === Pump.fun ===

async function buildPumpFunInstruction(builderOptions) {
    const { connection, userWallet, swapDetails, amountBN, slippageBps, nonceInfo = null } = builderOptions;

    try {
        const isBuy = swapDetails.tradeType === 'buy';
        const tokenMintPk = new PublicKey(isBuy ? swapDetails.outputMint : swapDetails.inputMint);
        const userWalletPk = new PublicKey(userWallet); // Ensure it's a PublicKey object

        console.log(`[PUMP_BUILDER_BC-SDK] Building ${swapDetails.tradeType.toUpperCase()} for ${shortenAddress(tokenMintPk.toBase58())}...`);

        // 1. Instantiate the official Pump.fun SDK
        const sdk = new PumpSdk(connection);

        // 2. Use the SDK's battle-tested methods to get the full transaction object
        const pumpTx = isBuy
            ? await sdk.getBuyTransaction(tokenMintPk, amountBN, userWalletPk, slippageBps)
            : await sdk.getSellTransaction(tokenMintPk, amountBN, userWalletPk, slippageBps);

        if (!pumpTx?.instructions) {
            throw new Error('Pump.fun SDK did not return a valid transaction object.');
        }

        // 3. Extract the instructions, filtering out the compute budget ones (we add our own later)
        let instructions = pumpTx.instructions.filter(ix =>
            !ix.programId.equals(config.COMPUTE_BUDGET_PROGRAM_ID)
        );

        // 4. Inject nonce instruction if provided
        if (nonceInfo) {
            console.log(`[BUILDER-NONCE] Injecting advanceNonce for Pump.fun BC`);
            instructions.unshift(
                SystemProgram.nonceAdvance({
                    noncePubkey: nonceInfo.noncePubkey,
                    authorizedPubkey: nonceInfo.authorizedPubkey,
                })
            );
        }

        console.log(`[PUMP_BUILDER_BC-SDK] ✅ Successfully built ${instructions.length} instructions.`);
        return instructions;

    } catch (err) {
        console.error(`[PUMP_BUILDER_BC-SDK] ❌ Failed to build Pump.fun swap with SDK:`, err.message);
        console.error(err.stack); // Full error for debugging
        return null;
    }
}


/// === Pump.fun AMM ===
async function buildPumpFunAmmInstruction(builderOptions) {
    const { connection, keypair, swapDetails, amountBN, slippageBps, nonceInfo = null } = builderOptions;

    try {
        const isBuy = swapDetails.tradeType === 'buy';
        const tokenMint = isBuy ? swapDetails.outputMint : swapDetails.inputMint;
        if (!tokenMint) throw new Error("PumpFun AMM Builder: Token mint is missing from swapDetails.");

        // --- INTEL GATHERING (THIS IS THE FIX) ---
        // Use our new, resilient API fetcher to get live pool data.
        const poolData = await getPumpAmmPoolState(tokenMint);
        const { poolAddress, poolState } = poolData;

        // --- CALCULATION ---
        let amountOut;
        const a = isBuy ? poolState.solReserves : poolState.tokenReserves;
        const b = isBuy ? poolState.tokenReserves : poolState.solReserves;

        if (a === 0n || b === 0n) throw new Error("PumpFun AMM has zero reserves in one of the vaults.");

        amountOut = (b * BigInt(amountBN.toString())) / (a + BigInt(amountBN.toString()));
        const slippage = (amountOut * BigInt(slippageBps)) / 10000n;
        const minAmountOut = amountOut - slippage;

        const userWalletPk = keypair.publicKey;
        const userSolAta = getAssociatedTokenAddressSync(new PublicKey(config.NATIVE_SOL_MINT), userWalletPk, true);
        const userTokenAta = getAssociatedTokenAddressSync(new PublicKey(tokenMint), userWalletPk);

        // --- INSTRUCTION BUILDING ---
        const discriminator = isBuy ? config.PUMP_AMM_BUY_DISCRIMINATOR : config.PUMP_AMM_SELL_DISCRIMINATOR;
        const data = Buffer.concat([
            discriminator,
            new BN(amountBN.toString()).toBuffer('le', 8),
            new BN(minAmountOut.toString()).toBuffer('le', 8)
        ]);

        const keys = [
            { pubkey: poolAddress, isSigner: false, isWritable: true },
            { pubkey: poolState.poolAuthority, isSigner: false, isWritable: false },
            { pubkey: isBuy ? userSolAta : userTokenAta, isSigner: false, isWritable: true },
            { pubkey: isBuy ? userTokenAta : userSolAta, isSigner: false, isWritable: true },
            { pubkey: isBuy ? poolState.solVault : poolState.tokenVault, isSigner: false, isWritable: true },
            { pubkey: isBuy ? poolState.tokenVault : poolState.solVault, isSigner: false, isWritable: true },
            { pubkey: userWalletPk, isSigner: true, isWritable: true },
            { pubkey: config.TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        ];

        const instruction = new TransactionInstruction({
            keys: keys,
            programId: config.PUMP_FUN_AMM_PROGRAM_ID,
            data: data,
        });

        let instructions = [instruction];
        if (nonceInfo) {
            console.log(`[BUILDER-NONCE] Injecting advanceNonce for Pump.fun AMM`);
            instructions.unshift(
                SystemProgram.nonceAdvance({
                    noncePubkey: nonceInfo.noncePubkey,
                    authorizedPubkey: nonceInfo.authorizedPubkey,
                })
            );
        }

        console.log(`[PUMP_BUILDER_AMM] ✅ Successfully built ${swapDetails.tradeType.toUpperCase()} instruction.`);
        return instructions;

    } catch (error) {
        console.error(`[PUMP_BUILDER_AMM] ❌ Critical failure during AMM instruction build:`, error.message);
        throw error; // Re-throw the error to be caught by the trading engine
    }
}

async function getPumpAmmPoolState(tokenMint) {
    console.log(`[PUMP_AMM_INTEL_V2] Fetching pool state for token: ${shortenAddress(tokenMint)}`);
    // Loop through the API endpoints for resilience
    for (const endpoint of config.PUMP_FUN_API_ENDPOINTS) {
        try {
            const url = `${endpoint}${tokenMint}`;
            const response = await axios.get(url, { 
                timeout: 15000,
                headers: { 
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                    'Accept': 'application/json'
                }
            });
            const data = response.data;

            // This is the official data structure from api.pump.fun
            if (!data || !data.associated_bonding_curve || !data.market_id) {
                 console.warn(`[PUMP_AMM_INTEL_V2] ⚠️ Malformed data from ${endpoint}. Trying next...`);
                 continue;
            }

            console.log(`[PUMP_AMM_INTEL_V2] ✅ Found pool on ${endpoint}`);
            
            // Reconstruct the needed info from the official API response
            return {
                poolAddress: new PublicKey(data.market_id),
                poolState: {
                    solReserves: BigInt(data.sol_reserves),
                    tokenReserves: BigInt(data.token_reserves),
                    poolAuthority: new PublicKey(data.raydium_authority), // authority
                    tokenVault: new PublicKey(data.token_account),
                    solVault: new PublicKey(data.sol_account),
                }
            };
        } catch (error) {
            let errorMsg = error.message;
            if (error.response) {
                errorMsg = `Status ${error.response.status}`;
            }
            console.warn(`[PUMP_AMM_INTEL_V2] ⚠️ Failed to fetch from ${endpoint}: ${errorMsg}. Trying next...`);
        }
    }
    // If the loop completes, all endpoints failed.
    throw new Error(`Failed to fetch Pump.fun AMM pool state for ${tokenMint} from all available endpoints.`);
}

async function buildRaydiumInstruction(builderOptions) {
    const { swapDetails } = builderOptions;
    
    try {
        // Auto-detect pool type based on platform data or program ID
        const { dexPlatform, platformProgramId } = swapDetails;
        
        if (platformProgramId === "CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C" || 
            dexPlatform === "Raydium CPMM") {
            console.log(`[BLUEPRINT] Detected Raydium CPMM pool`);
            return await buildRaydiumCpmmInstruction(builderOptions);
        }
        
        if (platformProgramId === "CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK" || 
            dexPlatform === "Raydium CLMM") {
            console.log(`[BLUEPRINT] Detected Raydium CLMM pool`);
            return await buildRaydiumClmmInstruction(builderOptions);
        }
        
        if (platformProgramId === "LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj" || 
            dexPlatform === "Raydium Launchpad") {
            console.log(`[BLUEPRINT] Detected Raydium Launchpad pool`);
            return await buildRaydiumLaunchpadInstruction(builderOptions);
        }
        
        // Default to CPMM if unclear
        console.log(`[BLUEPRINT] Unknown Raydium pool type, defaulting to CPMM`);
        return await buildRaydiumCpmmInstruction(builderOptions);
        
    } catch (error) {
        console.error(`[BLUEPRINT] ❌ Unified Raydium builder failure:`, error.message);
        throw error;
    }
}

/// === Raydium V4 ===
async function buildRaydiumV4Instruction(builderOptions) {
    const { connection, keypair, swapDetails, amountBN, slippageBps, nonceInfo = null } = builderOptions;
    const owner = keypair.publicKey;

    try {
        const poolIdPk = new PublicKey(swapDetails.platformSpecificData.poolId);
        if (!poolIdPk) throw new Error("Raydium AMM V4 blueprint requires a poolId.");
        const programId = config.RAYDIUM_V4_PROGRAM_ID;

        await traceLogger.appendTrace(swapDetails.masterTxSignature, 'ammv4_build_start', { poolId: poolIdPk.toBase58() });

        // STEP 1: BARE METAL INTEL GATHERING - Fetch the minimal required data: the pool keys.
        // The Liquidity.fetchKeys is an efficient RPC helper for this static data.
        const poolKeys = await Liquidity.fetchKeys(connection, poolIdPk);
        await traceLogger.appendTrace(swapDetails.masterTxSignature, 'ammv4_pool_keys_fetched', { status: 'OK' });
        
        // STEP 2: PREPARE SWAP PARAMETERS
        const inputToken = new Token(TOKEN_PROGRAM_ID, swapDetails.inputMint, poolKeys.baseMint.equals(swapDetails.inputMint) ? poolKeys.baseDecimals : poolKeys.quoteDecimals);
        const outputToken = new Token(TOKEN_PROGRAM_ID, swapDetails.outputMint, poolKeys.baseMint.equals(swapDetails.outputMint) ? poolKeys.baseDecimals : poolKeys.quoteDecimals);
        const amountIn = new TokenAmount(inputToken, amountBN);
        
        const { minAmountOut } = Liquidity.computeAmountOut({
            poolKeys,
            poolInfo: await Liquidity.fetchInfo({ connection, poolKeys }),
            amountIn,
            currencyOut: outputToken,
            slippage: new Percent(slippageBps, 10000)
        });

        const userInputTokenAccount = getAssociatedTokenAddressSync(new PublicKey(swapDetails.inputMint), owner, true);
        const userOutputTokenAccount = getAssociatedTokenAddressSync(new PublicKey(swapDetails.outputMint), owner);
        
        // STEP 3: ASSEMBLE BATTLE-HARDENED KEY LIST (Mirrors instrument.ts `makeSwapFixedInInstruction`)
        const instructionKeys = [
            { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
            { pubkey: poolKeys.id, isSigner: false, isWritable: true },
            { pubkey: poolKeys.authority, isSigner: false, isWritable: false },
            { pubkey: poolKeys.openOrders, isSigner: false, isWritable: true },
            { pubkey: poolKeys.targetOrders, isSigner: false, isWritable: true },
            { pubkey: poolKeys.baseVault, isSigner: false, isWritable: true },
            { pubkey: poolKeys.quoteVault, isSigner: false, isWritable: true },
            { pubkey: poolKeys.marketProgramId, isSigner: false, isWritable: false },
            { pubkey: poolKeys.marketId, isSigner: false, isWritable: true },
            { pubkey: poolKeys.marketBids, isSigner: false, isWritable: true },
            { pubkey: poolKeys.marketAsks, isSigner: false, isWritable: true },
            { pubkey: poolKeys.marketEventQueue, isSigner: false, isWritable: true },
            { pubkey: poolKeys.marketBaseVault, isSigner: false, isWritable: true },
            { pubkey: poolKeys.marketQuoteVault, isSigner: false, isWritable: true },
            { pubkey: poolKeys.marketAuthority, isSigner: false, isWritable: false },
            { pubkey: userInputTokenAccount, isSigner: false, isWritable: true },
            { pubkey: userOutputTokenAccount, isSigner: false, isWritable: true },
            { pubkey: owner, isSigner: true, isWritable: false }
        ];

        // STEP 4: ENCODE INSTRUCTION DATA (Mirrors fixedSwapInLayout)
        const dataLayout = struct([u8("instruction"), u64("amountIn"), u64("minAmountOut")]);
        const data = Buffer.alloc(dataLayout.span);
        dataLayout.encode({ instruction: 9, amountIn: amountIn.raw, minAmountOut: minAmountOut.raw }, data);

        // STEP 5: BUILD FINAL INSTRUCTION
        const swapIx = new TransactionInstruction({ programId, keys: instructionKeys, data });

        let instructions = [swapIx];
        if (nonceInfo) {
            instructions.unshift(SystemProgram.nonceAdvance({ noncePubkey: nonceInfo.noncePubkey, authorizedPubkey: nonceInfo.authorizedPubkey }));
        }

        console.log('[AMM-V4_FORGE-V2] ✅ Successfully forged AMM V4 instruction.');
        return instructions;
        
    } catch (error) {
        console.error(`[AMM-V4_FORGE-V2] ❌ CRITICAL FAILURE:`, error.message, error.stack);
        await traceLogger.appendTrace(swapDetails.masterTxSignature, 'ammv4_build_error', { error: error.message });
        throw error;
    }
}

/// === Raydium Launchpad===

async function buildRaydiumLaunchpadInstruction(builderOptions) {
    const { connection, keypair, swapDetails, amountBN, slippageBps, cacheManager, nonceInfo = null } = builderOptions;
    const owner = keypair.publicKey;
    const isBuy = swapDetails.tradeType === 'buy';

    try {
        await traceLogger.appendTrace(swapDetails.masterTxSignature, 'launchpad_build_start', { tradeType: swapDetails.tradeType });
        const programId = config.RAYDIUM_LAUNCHPAD_PROGRAM_ID;

        // STEP 1: RESOLVE ALL ACCOUNTS
        const { poolId, configId } = swapDetails.platformSpecificData;
        if (!poolId || !configId) throw new Error("Launchpad blueprint requires both poolId and configId.");

        const poolIdPk = new PublicKey(poolId);
        const configIdPk = new PublicKey(configId);

        const { poolInfo, configInfo } = await _getLaunchpadPoolData(connection, poolIdPk, configIdPk, cacheManager);
        await traceLogger.appendTrace(swapDetails.masterTxSignature, 'launchpad_pool_data_fetched', { status: 'OK' });
        
        const baseMint = poolInfo.mintA;
        const quoteMint = poolInfo.mintB;
        const baseMintProgram = poolInfo.mintProgramFlag === 1 ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;
        const quoteMintProgram = TOKEN_PROGRAM_ID; // Quote is always SOL (SPL)

        // STEP 2: DERIVE ALL PDAs - using the official SDK's derivation logic
        const { publicKey: authPda } = RaydiumV2.pda.getPdaLaunchpadAuth(programId);
        const { publicKey: platformVault } = RaydiumV2.pda.getPdaPlatformVault(programId, poolInfo.platformId, quoteMint);
        const { publicKey: creatorVault } = RaydiumV2.pda.getPdaCreatorVault(programId, poolInfo.creator, quoteMint);
        const { publicKey: eventPda } = RaydiumV2.pda.getPdaCpiEvent(programId);

        // STEP 3: COMPUTE THE SWAP - using the official curve math
        // For sniping, a high slippage or minimal out amount is standard.
        const minAmountOut = new BN(1); 
        await traceLogger.appendTrace(swapDetails.masterTxSignature, 'launchpad_swap_computed', { in: amountBN.toString(), minOut: minAmountOut.toString() });

        // STEP 4: GET USER ATAs
        const userBaseTokenAta = getAssociatedTokenAddressSync(baseMint, owner, false, baseMintProgram);
        const userQuoteTokenAta = getAssociatedTokenAddressSync(quoteMint, owner, true); // Allow off-curve for WSOL

        // STEP 5: ASSEMBLE THE BATTLE-HARDENED KEY LIST (Mirrors instrument.ts)
        const instructionKeys = [
            { pubkey: owner, isSigner: true, isWritable: false },
            { pubkey: authPda, isSigner: false, isWritable: false },
            { pubkey: configIdPk, isSigner: false, isWritable: false },
            { pubkey: poolInfo.platformId, isSigner: false, isWritable: false },
            { pubkey: poolIdPk, isSigner: false, isWritable: true },
            { pubkey: userBaseTokenAta, isSigner: false, isWritable: true },
            { pubkey: userQuoteTokenAta, isSigner: false, isWritable: true },
            { pubkey: poolInfo.vaultA, isSigner: false, isWritable: true },
            { pubkey: poolInfo.vaultB, isSigner: false, isWritable: true },
            { pubkey: baseMint, isSigner: false, isWritable: false },
            { pubkey: quoteMint, isSigner: false, isWritable: false },
            { pubkey: baseMintProgram, isSigner: false, isWritable: false },
            { pubkey: quoteMintProgram, isSigner: false, isWritable: false },
            { pubkey: eventPda, isSigner: false, isWritable: false },
            { pubkey: programId, isSigner: false, isWritable: false },
            // Optional/System accounts required by the program
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
            { pubkey: platformVault, isSigner: false, isWritable: true },
            { pubkey: creatorVault, isSigner: false, isWritable: true },
        ];
        
        // STEP 6: ENCODE THE INSTRUCTION DATA (Mirrors instrument.ts)
        const dataLayout = isBuy
            ? struct([u64("amountB"), u64("minAmountA"), u64("shareFeeRate")])
            : struct([u64("amountA"), u64("minAmountB"), u64("shareFeeRate")]);
        
        const data = Buffer.alloc(dataLayout.span);
        
        if (isBuy) {
            dataLayout.encode({ amountB: amountBN, minAmountA: minAmountOut, shareFeeRate: new BN(0) }, data);
        } else {
            // For a 'get me out' sell, we want max slippage
            const minAmountB_Sell = new BN(1);
            dataLayout.encode({ amountA: amountBN, minAmountB: minAmountB_Sell, shareFeeRate: new BN(0) }, data);
        }

        const anchorPrefix = isBuy ? RaydiumV2.launchpad.anchorDataBuf.buyExactIn : RaydiumV2.launchpad.anchorDataBuf.sellExactIn;
        const instructionData = Buffer.concat([anchorPrefix, data]);
        await traceLogger.appendTrace(swapDetails.masterTxSignature, 'launchpad_instruction_encoded', { keys: instructionKeys.length, data: instructionData.toString('hex') });

        // STEP 7: CONSTRUCT THE FINAL INSTRUCTION
        const swapIx = new TransactionInstruction({
            programId: programId,
            keys: instructionKeys,
            data: instructionData
        });

        let instructions = [swapIx];
        if (nonceInfo) {
            instructions.unshift(SystemProgram.nonceAdvance({ noncePubkey: nonceInfo.noncePubkey, authorizedPubkey: nonceInfo.authorizedPubkey }));
        }

        console.log(`[BLUEPRINT-V2] ✅ Successfully forged Launchpad instruction.`);
        return instructions;

    } catch (error) {
        console.error(`[BLUEPRINT-V2] ❌ CRITICAL FAILURE during Launchpad forge:`, error.message, error.stack);
        await traceLogger.appendTrace(swapDetails.masterTxSignature, 'launchpad_build_error', { error: error.message });
        throw error;
    }
}

/// === Raydium clmm===

const CLMM_SWAP_V2_DISCRIMINATOR = Buffer.from([0x09, 0xfe, 0x2e, 0x18, 0x5b, 0x0a, 0x4a, 0x5c]);

function createClmmSwapV2InstructionData(amount, otherAmountThreshold, sqrtPriceLimitX64, isBaseInput) {
    const dataBuffer = Buffer.alloc(34); // 8 + 8 + 8 + 16 + 1 = 41 bytes, but align to 34
    let offset = 0;
    
    // Write discriminator
    CLMM_SWAP_V2_DISCRIMINATOR.copy(dataBuffer, offset);
    offset += 8;
    
    // Write amount (8 bytes)
    dataBuffer.writeBigUInt64LE(BigInt(amount.toString()), offset);
    offset += 8;
    
    // Write otherAmountThreshold (8 bytes)
    dataBuffer.writeBigUInt64LE(BigInt(otherAmountThreshold.toString()), offset);
    offset += 8;
    
    // Write sqrtPriceLimitX64 (8 bytes) - simplified to 8 bytes instead of 16
    dataBuffer.writeBigUInt64LE(BigInt(sqrtPriceLimitX64.toString()), offset);
    offset += 8;
    
    // Write isBaseInput (1 byte)
    dataBuffer.writeUInt8(isBaseInput ? 1 : 0, offset);
    
    return dataBuffer;
}

async function _getClmmPoolData(connection, poolId, cacheManager) {
    const cacheKey = poolId.toBase58();
    const cachedData = cacheManager.getClmmPoolData?.(cacheKey);
    if (cachedData) return cachedData;

    try {
        const poolAccount = await connection.getAccountInfo(poolId);
        if (!poolAccount) throw new Error("CLMM pool account not found");

        // Simplified pool info extraction
        const poolInfo = {
            poolId: poolId,
            authority: PublicKey.findProgramAddressSync(
                [Buffer.from('pool_auth'), poolId.toBuffer()],
                new PublicKey("CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK") // CLMM Program ID
            )[0],
            // These would be extracted from actual pool account data
            tokenVault0: new PublicKey("11111111111111111111111111111111"), // Placeholder
            tokenVault1: new PublicKey("11111111111111111111111111111111"), // Placeholder
            tokenMint0: new PublicKey("11111111111111111111111111111111"), // Placeholder
            tokenMint1: new PublicKey("11111111111111111111111111111111"), // Placeholder
            tickArrayMap: new PublicKey("11111111111111111111111111111111"), // Placeholder
            observationKey: new PublicKey("11111111111111111111111111111111"), // Placeholder
        };

        if (cacheManager.addClmmPoolData) {
            cacheManager.addClmmPoolData(cacheKey, poolInfo);
        }
        
        return poolInfo;
    } catch (error) {
        console.error(`[_getClmmPoolData] Error fetching CLMM pool data:`, error.message);
        throw error;
    }
}

async function buildRaydiumClmmInstruction(builderOptions) {
    const { connection, keypair, swapDetails, amountBN, slippageBps, nonceInfo = null } = builderOptions;
    const owner = keypair.publicKey;

    try {
        const poolIdPk = new PublicKey(swapDetails.platformSpecificData.poolId);
        if (!poolIdPk) throw new Error("CLMM blueprint requires a poolId.");
        const programId = config.RAYDIUM_CLMM_PROGRAM_ID;

        await traceLogger.appendTrace(swapDetails.masterTxSignature, 'clmm_build_start', { poolId: poolIdPk.toBase58() });

        // STEP 1: PARALLEL INTEL GATHERING - Fetch all necessary on-chain data in a single batch
        const [poolInfoRpc, tickArraysRpc, exBitmapAccountRpc] = await Promise.all([
            Clmm.fetchMultiplePoolInfos({ connection, poolIds: [poolIdPk], chainTime: new Date().getTime() / 1000 }),
            Clmm.fetchMultipleTickArrays({ connection, poolKeys: [poolIdPk], chainTime: new Date().getTime() / 1000 }),
            connection.getAccountInfo(RaydiumV2.pda.getPdaExBitmapAccount(programId, poolIdPk).publicKey)
        ]);

        const poolState = poolInfoRpc[poolIdPk.toBase58()].state;
        if (!poolState) throw new Error(`Failed to fetch live CLMM pool state for ${poolIdPk.toBase58()}`);
        await traceLogger.appendTrace(swapDetails.masterTxSignature, 'clmm_pool_state_fetched', { status: 'OK' });
        
        // STEP 2: RUN SWAP SIMULATION - Use SDK math helpers to determine outcome and required tick arrays
        const swapResult = SwapMath.swapCompute(
            programId, poolIdPk, tickArraysRpc, poolState.tickArrayBitmap, 
            exBitmapAccountRpc ? RaydiumV2.TickArrayBitmapExtensionLayout.decode(exBitmapAccountRpc.data) : null,
            swapDetails.inputMint === poolState.mintA.mint.toBase58(), // zeroForOne
            poolState.ammConfig.tradeFeeRate,
            poolState.liquidity, poolState.tickCurrent, poolState.tickSpacing, poolState.sqrtPriceX64, amountBN, 
            TickUtils.getTickArrayStartIndexByTick(poolState.tickCurrent, poolState.tickSpacing)
        );
        const amountOut = swapResult.amountCalculated.mul(new BN(-1));
        const amountOutWithSlippage = amountOut.mul(new BN(10000 - slippageBps)).div(new BN(10000));
        await traceLogger.appendTrace(swapDetails.masterTxSignature, 'clmm_swap_simulated', { amountOut: amountOut.toString(), neededAccounts: swapResult.accounts.length });
        
        // STEP 3: ASSEMBLE BATTLE-HARDENED KEY LIST - Mirrors instrument.ts perfectly
        const isBaseInput = swapDetails.inputMint === poolState.mintA.mint.toBase58();
        const inputMintPk = isBaseInput ? poolState.mintA.mint : poolState.mintB.mint;
        const outputMintPk = isBaseInput ? poolState.mintB.mint : poolState.mintA.mint;
        const userInputTokenAccount = getAssociatedTokenAddressSync(inputMintPk, owner, true);
        const userOutputTokenAccount = getAssociatedTokenAddressSync(outputMintPk, owner, true);
        
        const remainingAccounts = swapResult.accounts.map(pk => ({ pubkey: pk, isSigner: false, isWritable: true }));

        const instructionKeys = [
            { pubkey: owner, isSigner: true, isWritable: false },
            { pubkey: poolState.ammConfig.id, isSigner: false, isWritable: false },
            { pubkey: poolIdPk, isSigner: false, isWritable: true },
            { pubkey: userInputTokenAccount, isSigner: false, isWritable: true },
            { pubkey: userOutputTokenAccount, isSigner: false, isWritable: true },
            { pubkey: isBaseInput ? poolState.mintA.vault : poolState.mintB.vault, isSigner: false, isWritable: true },
            { pubkey: isBaseInput ? poolState.mintB.vault : poolState.mintA.vault, isSigner: false, isWritable: true },
            { pubkey: poolState.observationId, isSigner: false, isWritable: true },
            { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
            ...remainingAccounts
        ];
        
        // STEP 4: ENCODE INSTRUCTION DATA - Build the swap instruction data buffer from scratch
        const dataLayout = struct([u64("amount"), u64("otherAmountThreshold"), u128("sqrtPriceLimitX64"), bool("isBaseInput")]);
        const data = Buffer.alloc(dataLayout.span);
        dataLayout.encode({
            amount: amountBN,
            otherAmountThreshold: amountOutWithSlippage.isNeg() ? new BN(0) : amountOutWithSlippage,
            sqrtPriceLimitX64: swapResult.sqrtPriceX64,
            isBaseInput: true // Always specifying the input amount
        }, data);
        const anchorDataBufSwap = Buffer.from([43, 4, 237, 11, 26, 201, 30, 98]);
        const instructionData = Buffer.concat([anchorDataBufSwap, data]);

        // STEP 5: BUILD FINAL INSTRUCTION
        const swapIx = new TransactionInstruction({
            programId: programId,
            keys: instructionKeys,
            data: instructionData
        });

        let instructions = [swapIx];
        if (nonceInfo) {
            instructions.unshift(SystemProgram.nonceAdvance({ noncePubkey: nonceInfo.noncePubkey, authorizedPubkey: nonceInfo.authorizedPubkey }));
        }

        console.log(`[CLMM_FORGE-V2] ✅ Successfully forged CLMM instruction.`);
        return instructions;
    } catch (error) {
        console.error(`[CLMM_FORGE-V2] ❌ CRITICAL FAILURE:`, error.message, error.stack);
        await traceLogger.appendTrace(swapDetails.masterTxSignature, 'clmm_build_error', { error: error.message });
        throw error;
    }
}

/// === Raydium CPMM (CP-AMM) ===
const CPMM_SWAP_BASE_IN_DISCRIMINATOR = Buffer.from([0x09, 0xfe, 0x2e, 0x18, 0x5b, 0x0a, 0x4a, 0x5c]);
const CPMM_SWAP_BASE_OUT_DISCRIMINATOR = Buffer.from([0x95, 0x91, 0x1c, 0x27, 0x3c, 0x9a, 0x7c, 0x8b]);

function createCpmmSwapBaseInInstructionData(amountIn, minimumAmountOut) {
    const dataBuffer = Buffer.alloc(24); // 8 + 8 + 8 = 24 bytes
    let offset = 0;
    
    // Write discriminator
    CPMM_SWAP_BASE_IN_DISCRIMINATOR.copy(dataBuffer, offset);
    offset += 8;
    
    // Write amountIn (8 bytes, little endian)
    dataBuffer.writeBigUInt64LE(BigInt(amountIn.toString()), offset);
    offset += 8;
    
    // Write minimumAmountOut (8 bytes, little endian)
    dataBuffer.writeBigUInt64LE(BigInt(minimumAmountOut.toString()), offset);
    
    return dataBuffer;
}

function createCpmmSwapBaseOutInstructionData(maxAmountIn, amountOut) {
    const dataBuffer = Buffer.alloc(24);
    let offset = 0;
    
    CPMM_SWAP_BASE_OUT_DISCRIMINATOR.copy(dataBuffer, offset);
    offset += 8;
    
    dataBuffer.writeBigUInt64LE(BigInt(maxAmountIn.toString()), offset);
    offset += 8;
    
    dataBuffer.writeBigUInt64LE(BigInt(amountOut.toString()), offset);
    
    return dataBuffer;
}

async function _getCpmmPoolData(connection, poolId, cacheManager) {
    const cacheKey = poolId.toBase58();
    const cachedData = cacheManager.getCpmmPoolData?.(cacheKey);
    if (cachedData) return cachedData;

    try {
        const poolAccount = await connection.getAccountInfo(poolId);
        if (!poolAccount) throw new Error("CPMM pool account not found");

        // Simplified pool info extraction (adjust based on actual CPMM pool structure)
        const poolInfo = {
            poolId: poolId,
            authority: PublicKey.findProgramAddressSync(
                [Buffer.from('pool_auth'), poolId.toBuffer()],
                new PublicKey("CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C") // CPMM Program ID
            )[0],
            // These would be extracted from the actual pool account data
            token0Vault: new PublicKey("11111111111111111111111111111111"), // Placeholder
            token1Vault: new PublicKey("11111111111111111111111111111111"), // Placeholder
            token0Mint: new PublicKey("11111111111111111111111111111111"), // Placeholder
            token1Mint: new PublicKey("11111111111111111111111111111111"), // Placeholder
            lpMint: new PublicKey("11111111111111111111111111111111"), // Placeholder
            observationKey: new PublicKey("11111111111111111111111111111111"), // Placeholder
        };

        if (cacheManager.addCpmmPoolData) {
            cacheManager.addCpmmPoolData(cacheKey, poolInfo);
        }
        
        return poolInfo;
    } catch (error) {
        console.error(`[_getCpmmPoolData] Error fetching CPMM pool data:`, error.message);
        throw error;
    }
}

async function buildRaydiumCpmmInstruction(builderOptions) {
    const { connection, keypair, swapDetails, amountBN, slippageBps, nonceInfo = null } = builderOptions;
    const owner = keypair.publicKey;

    try {
        const poolIdPk = new PublicKey(swapDetails.platformSpecificData.poolId);
        if (!poolIdPk) throw new Error("Raydium CPMM blueprint requires a poolId.");
        const programId = config.RAYDIUM_CPMM_PROGRAM_ID;

        await traceLogger.appendTrace(swapDetails.masterTxSignature, 'cpmm_build_start', { poolId: poolIdPk.toBase58() });

        // STEP 1: BARE METAL INTEL GATHERING - Fetch the raw pool account state directly.
        const poolAccountInfo = await connection.getAccountInfo(poolIdPk, 'confirmed');
        if (!poolAccountInfo) throw new Error(`Failed to fetch CPMM pool account: ${poolIdPk.toBase58()}`);
        
        // STEP 2: DECODE THE STATE - Use ONLY the reliable decoder from the SDK.
        const poolState = Cpmm.decode(poolAccountInfo.data);
        await traceLogger.appendTrace(swapDetails.masterTxSignature, 'cpmm_pool_state_decoded', { 
            baseReserve: poolState.baseReserve.toString(), 
            quoteReserve: poolState.quoteReserve.toString()
        });

        // STEP 3: CALCULATE MINIMUM AMOUNT OUT - Use the SDK's battle-tested math helper.
        const { amountOut, minAmountOut } = Cpmm.computeAmountOut({
            poolState,
            amountIn: new TokenAmount(new Token(TOKEN_PROGRAM_ID, swapDetails.inputMint, poolState.baseMint.equals(swapDetails.inputMint) ? poolState.baseDecimal : poolState.quoteDecimal), amountBN),
            slippage: new Percent(slippageBps, 10000),
        });

        // STEP 4: DERIVE PDAs AND GET ATAs - Assemble all required accounts.
        const { publicKey: authority } = Cpmm.getAssociatedAuthority({ programId });
        const { publicKey: openOrders } = Cpmm.getAssociatedOpenOrdersAddress({ programId, poolId: poolIdPk });
        const { publicKey: observationId } = Cpmm.getObservationAddress({ programId, poolId: poolIdPk });

        const userInputTokenAccount = getAssociatedTokenAddressSync(new PublicKey(swapDetails.inputMint), owner, true);
        const userOutputTokenAccount = getAssociatedTokenAddressSync(new PublicKey(swapDetails.outputMint), owner);

        // STEP 5: ASSEMBLE THE FINAL KEY LIST (Mirrors instruction.ts)
        const instructionKeys = [
            { pubkey: owner, isSigner: true, isWritable: false },
            { pubkey: authority, isSigner: false, isWritable: false },
            { pubkey: poolState.configId, isSigner: false, isWritable: false },
            { pubkey: poolIdPk, isSigner: false, isWritable: true },
            { pubkey: userInputTokenAccount, isSigner: false, isWritable: true },
            { pubkey: userOutputTokenAccount, isSigner: false, isWritable: true },
            { pubkey: poolState.baseVault, isSigner: false, isWritable: true },
            { pubkey: poolState.quoteVault, isSigner: false, isWritable: true },
            { pubkey: poolState.mintProgramA.equals(TOKEN_PROGRAM_ID) ? TOKEN_PROGRAM_ID : TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
            { pubkey: poolState.mintProgramB.equals(TOKEN_PROGRAM_ID) ? TOKEN_PROGRAM_ID : TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
            { pubkey: poolState.mintA, isSigner: false, isWritable: false },
            { pubkey: poolState.mintB, isSigner: false, isWritable: false },
            { pubkey: observationId, isSigner: false, isWritable: true }
        ];

        // STEP 6: BUILD THE INSTRUCTION
        const swapIx = makeSwapCpmmBaseInInstruction(
            programId, owner, authority, poolState.configId, poolIdPk,
            userInputTokenAccount, userOutputTokenAccount,
            poolState.baseVault, poolState.quoteVault,
            poolState.mintProgramA, poolState.mintProgramB,
            poolState.mintA, poolState.mintB,
            observationId, amountBN, minAmountOut.raw
        );

        let instructions = [swapIx];
        if (nonceInfo) {
            instructions.unshift(SystemProgram.nonceAdvance({ noncePubkey: nonceInfo.noncePubkey, authorizedPubkey: nonceInfo.authorizedPubkey, }));
        }

        console.log('[CPMM_FORGE-V2] ✅ Successfully forged CPMM instruction.');
        await traceLogger.appendTrace(swapDetails.masterTxSignature, 'cpmm_build_success', {});
        return instructions;

    } catch (error) {
        console.error(`[CPMM_FORGE-V2] ❌ CRITICAL FAILURE:`, error.message, error.stack);
        await traceLogger.appendTrace(swapDetails.masterTxSignature, 'cpmm_build_error', { error: error.message });
        throw error;
    }
}

/// === MeteoraDBC (SDK POWERED) ===
async function buildMeteoraDBCInstruction(builderOptions) {
    const { connection, userPublicKey, swapDetails, amountInLamports, nonceInfo = null } = builderOptions;
    
    try {
        const isBuy = swapDetails.tradeType === 'buy';
        const poolIdPk = new PublicKey(swapDetails.platformSpecificData.poolId);
        
        console.log(`[METEORA_DBC_SDK] Building ${swapDetails.tradeType.toUpperCase()} for pool ${shortenAddress(poolIdPk.toBase58())}.`);

        // 1. Initialize the DBC client
        const client = new MeteoraDBC(connection);

        // 2. Fetch the required pool and config states using the SDK
        const poolState = await client.program.account.virtualPool.fetch(poolIdPk);
        const configState = await client.program.account.poolConfig.fetch(poolState.config);
        
        const inAmount = new BN(amountInLamports.toString());

        // 3. Use the SDK's built-in swap instruction builder. This is the safest method.
        const swapIx = await client.pool.swap({
            pool: poolIdPk,
            poolConfig: poolState.config,
            amountIn: inAmount,
            minimumAmountOut: new BN(1), // Use low min for sniping/copying
            swapBaseForQuote: !isBuy, // If we're BUYING the base token, we are swapping QUOTE for BASE, so isBuy=true -> swapBaseForQuote=false
            owner: new PublicKey(userPublicKey),
            payer: new PublicKey(userPublicKey), // Payer and owner are the same
        });

        if (!swapIx) throw new Error("Meteora DBC SDK failed to generate a swap instruction.");

        // 4. Wrap the instruction in an array and inject nonce
        let instructions = [swapIx];
        if (nonceInfo) {
            instructions.unshift(
                SystemProgram.nonceAdvance({
                    noncePubkey: nonceInfo.noncePubkey,
                    authorizedPubkey: nonceInfo.authorizedPubkey,
                })
            );
        }

        console.log(`[METEORA_DBC_SDK] ✅ Successfully built DBC instruction.`);
        return instructions;

    } catch (error) {
        console.error(`[METEORA_DBC_SDK] ❌ CRITICAL FAILURE during DBC build:`, error.message);
        console.error(error.stack);
        throw error;
    }
}

/// === MeteoraDLMM (REFINED SDK BUILDER) ===
async function buildMeteoraDLMMInstruction(builderOptions) {
    const { connection, userPublicKey, swapDetails, amountInLamports, slippageBps, nonceInfo = null} = builderOptions;
    
    try {
        const poolIdPk = new PublicKey(swapDetails.platformSpecificData.poolId);
        const inputMintPk = new PublicKey(swapDetails.inputMint);
        const amountIn = new BN(amountInLamports.toString());

        console.log(`[METEORA_DLMM_SDK] Building ${swapDetails.tradeType.toUpperCase()} for pool ${shortenAddress(poolIdPk.toBase58())}.`);

        // 1. Instantiate DLMM instance
        const dlmmPool = await Dlmm.create(connection, poolIdPk, { commitment: 'confirmed' });
        
        // 2. Get a swap quote from the SDK
        const swapQuote = await dlmmPool.getSwapQuote(
            inputMintPk,
            amountIn,
            slippageBps || 5000 // High default slippage for copy trades
        );

        // 3. Build the swap transaction object from the quote
        const { txs } = await dlmmPool.swap(swapQuote, new PublicKey(userPublicKey));
        
        const swapTx = txs?.[0]?.tx;
        if (!swapTx || !(swapTx instanceof VersionedTransaction)) {
            throw new Error("Meteora DLMM SDK failed to create a valid transaction.");
        }

        // 4. Reliably decompile and extract instructions, removing the SDK's budget instructions
        const message = TransactionMessage.decompile(swapTx.message);
        let instructions = message.instructions.filter(ix => 
            !ix.programId.equals(config.COMPUTE_BUDGET_PROGRAM_ID)
        );

        // 5. Inject nonce if needed
        if (nonceInfo) {
            console.log(`[BUILDER-NONCE] Injecting advanceNonce for Meteora DLMM`);
            instructions.unshift(
                SystemProgram.nonceAdvance({
                    noncePubkey: nonceInfo.noncePubkey,
                    authorizedPubkey: nonceInfo.authorizedPubkey,
                })
            );
        }
        
        console.log(`[METEORA_DLMM_SDK] ✅ Successfully built ${instructions.length} DLMM instruction(s).`);
        return instructions;

    } catch (error) {
        console.error(`[METEORA_DLMM_SDK] ❌ CRITICAL FAILURE during DLMM build:`, error.message);
        console.error(error.stack);
        throw error;
    }
}

// === NEW: Meteora CP-AMM ===
async function buildMeteoraCpAmmInstruction(builderOptions) {
    const { connection, userPublicKey, swapDetails, amountInLamports, slippageBps, nonceInfo = null } = builderOptions;
    
    try {
        const platform = 'Meteora CP-AMM';
        const poolIdPk = new PublicKey(swapDetails.platformSpecificData.poolId);
        const amountIn = new BN(amountInLamports.toString());

        console.log(`[${platform.replace(' ', '-')}_SDK] Building ${swapDetails.tradeType.toUpperCase()} for pool ${shortenAddress(poolIdPk.toBase58())}.`);

        // 1. Instantiate the official Meteora CP-AMM SDK
        const cpAmm = new CpAmm(connection);
        
        // 2. Fetch the live pool state using the SDK
        const poolState = await cpAmm.fetchPoolState(poolIdPk);
        if (!poolState) {
            throw new Error(`Could not fetch state for Meteora CP-AMM pool: ${poolIdPk.toBase58()}`);
        }

        // 3. Get a swap quote from the SDK to calculate min amount out
        const { minSwapOutAmount } = cpAmm.getQuote({
            inAmount: amountIn,
            inputTokenMint: new PublicKey(swapDetails.inputMint),
            slippage: (slippageBps || 1000) / 100, // SDK expects slippage as a percentage (e.g., 10 for 10%)
            poolState: poolState,
            // These are optional but good practice for advanced cases
            currentTime: Math.floor(Date.now() / 1000), 
            currentSlot: 0, // Not strictly needed for basic swaps
        });
        
        // 4. Use the SDK's high-level swap method to build the transaction object
        const swapTx = await cpAmm.swap({
            pool: poolIdPk,
            payer: userPublicKey,
            inputTokenMint: new PublicKey(swapDetails.inputMint),
            outputTokenMint: new PublicKey(swapDetails.outputMint),
            amountIn: amountIn,
            minimumAmountOut: minSwapOutAmount,
            // Let the SDK handle ATA creation and SOL wrapping automatically
            tokenAProgram: poolState.tokenAProgram,
            tokenBProgram: poolState.tokenBProgram,
            tokenAMint: poolState.tokenAMint,
            tokenBMint: poolState.tokenBMint,
            tokenAVault: poolState.tokenAVault,
            tokenBVault: poolState.tokenBVault,
        });

        const swapInstruction = swapTx.instructions.find(ix => ix.programId.equals(config.METEORA_CP_AMM_PROGRAM_ID));
        if (!swapInstruction) {
             throw new Error("Meteora CP-AMM SDK did not return a valid swap instruction.");
        }

        let instructions = [swapInstruction];

        if (nonceInfo) {
            console.log(`[BUILDER-NONCE] Injecting advanceNonce for Meteora CP-AMM`);
            instructions.unshift(
                SystemProgram.nonceAdvance({
                    noncePubkey: nonceInfo.noncePubkey,
                    authorizedPubkey: nonceInfo.authorizedPubkey,
                })
            );
        }

        console.log(`[${platform.replace(' ', '-')}_SDK] ✅ Successfully built instruction.`);
        return instructions;
        
    } catch (error) {
        console.error(`[METEORA_CP-AMM_SDK] ❌ CRITICAL FAILURE during CP-AMM build:`, error.message);
        console.error(error.stack);
        throw error;
    }
}

async function buildJupiterSwapInstruction({
    connection,         // <-- ADDED BACK: Needed for the decompile fix
    userPublicKey,
    inputMint,
    outputMint,
    amountInBN,
    slippageBps = 2500,
    nonceInfo = null,
}) {
    try {
        console.log(`[JUPITER-V6_BUILDER] Building with modern SDK for ${shortenAddress(inputMint)} -> ${shortenAddress(outputMint)}`);
        
        const jupiterApi = require('@jup-ag/api').createJupiterApiClient({ apiEndpoint: "https://quote-api.jup.ag/v6" }); // Make sure require is here if not at top
        const userWallet = userPublicKey.toBase58();

        const quote = await jupiterApi.quoteGet({
            inputMint: inputMint,
            outputMint: outputMint,
            amount: parseInt(amountInBN.toString()),
            slippageBps: slippageBps,
            onlyDirectRoutes: false,
            asLegacyTransaction: false,
        });

        if (!quote) throw new Error("Jupiter v6 failed to find a route.");

        const swapResult = await jupiterApi.swapPost({
            swapRequest: {
                quoteResponse: quote,
                userPublicKey: userWallet,
                wrapAndUnwrapSol: true,
            },
        });

        const txBuffer = Buffer.from(swapResult.swapTransaction, 'base64');
        const transaction = VersionedTransaction.deserialize(txBuffer);

        // ----------- THE FIX IS HERE -----------
        // We MUST check if addressTableLookups exists before trying to map it.
     const addressTableLookups = Array.isArray(transaction.message.addressTableLookups) ? transaction.message.addressTableLookups : [];

const lookupTableAccounts = await Promise.all(
    addressTableLookups.map(async (lookup) => {
        try {
            // Fetch the lookup table account from the connection
            const lookupTableAccountInfo = await connection.getAddressLookupTable(lookup.accountKey);
            // The structure for decompile needs both the key and the state
            if (lookupTableAccountInfo && lookupTableAccountInfo.value) {
                return { key: lookup.accountKey, state: lookupTableAccountInfo.value };
            }
        } catch (e) {
            console.warn(`[JUP-BUILDER] Failed to fetch lookup table ${lookup.accountKey.toBase58()}:`, e.message);
        }
        return null;
    })
);
        // ----------- END OF FIX -----------
        
        // Decompile the message with the fetched lookup tables
        const message = TransactionMessage.decompile(transaction.message, {
             // Pass the fetched accounts here. Filter out any that failed.
            addressLookupTableAccounts: lookupTableAccounts.filter(Boolean)
        });

        let instructions = message.instructions.filter(ix => 
            !ix.programId.equals(ComputeBudgetProgram.programId)
        );

        if (instructions.length === 0) throw new Error("Jupiter v6 returned a transaction with no main instructions.");
        
        if (nonceInfo) {
            console.log(`[BUILDER-NONCE] Injecting advanceNonce for Jupiter v6`);
            instructions.unshift(
                SystemProgram.nonceAdvance({
                    noncePubkey: nonceInfo.noncePubkey,
                    authorizedPubkey: nonceInfo.authorizedPubkey,
                })
            );
        }

        console.log(`[JUPITER-V6_BUILDER] ✅ Successfully built ${instructions.length} instructions.`);
        return { instructions };

    } catch (err) {
        console.error(`[JUPITER-V6_BUILDER] ❌ Critical failure during swap build:`, err.message);
        if (err.response?.data) console.error('Jupiter API Error Details:', err.response.data);
        throw new Error(`Jupiter v6 builder failed: ${err.message}`);
    }
}

module.exports = {
    buildPumpFunInstruction,
    buildPumpFunAmmInstruction,
    buildRaydiumInstruction,
    buildRaydiumV4Instruction,
    buildRaydiumLaunchpadInstruction,
    buildRaydiumClmmInstruction,
    buildRaydiumCpmmInstruction,
    buildMeteoraDBCInstruction,
    buildMeteoraDLMMInstruction,
    buildMeteoraCpAmmInstruction,
     buildJupiterSwapInstruction,
    createBuyExactInInstructionData,
    createSellExactInInstructionData,
    _getLaunchpadPoolData
};