// ==========================================
// File: platformBuilders.js
// ==========================================

// Test function to clone router instruction directly from master transaction
async function testRouterInstructionClone(builderOptions) {
    const { connection, userPublicKey, swapDetails, amountBN, slippageBps, originalTransaction } = builderOptions;
    
    if (!originalTransaction) {
        throw new Error("Router test requires original transaction data");
    }

    console.log(`[ROUTER-TEST] 🧪 Testing direct router instruction clone`);
    console.log(`[ROUTER-TEST] 💰 User amount: ${amountBN.toString()} lamports (${amountBN.toNumber() / 1e9} SOL)`);
    
    try {
        const instructions = originalTransaction.transaction.message.instructions || [];
        const accountKeys = originalTransaction.transaction.message.accountKeys || [];
        
        if (instructions.length === 0) {
            throw new Error("No instructions found in original transaction");
        }

        console.log(`[ROUTER-TEST] 🔍 Found ${instructions.length} instructions`);

        // Find the router instruction (instruction index 4 based on our analysis)
        const routerInstruction = instructions[4]; // The router instruction
        if (!routerInstruction) {
            throw new Error("Router instruction not found at index 4");
        }

        console.log(`[ROUTER-TEST] 🔍 Router instruction:`, {
            programIdIndex: routerInstruction.programIdIndex,
            accountCount: routerInstruction.accounts?.length || 0,
            hasData: !!routerInstruction.data,
            dataLength: routerInstruction.data?.length || 0
        });

        // Get the router program ID
        const routerProgramId = accountKeys[routerInstruction.programIdIndex];
        console.log(`[ROUTER-TEST] 🎯 Router Program: ${shortenAddress(routerProgramId.toString())}`);

        // Clone the instruction data and modify SOL amount
        let clonedData = routerInstruction.data;
        console.log(`[ROUTER-TEST] 📋 Original instruction data: ${clonedData}`);
        
        // Try to modify the SOL amount in the instruction data
        // The master's amount was 10000000 lamports (0.01 SOL)
        // We'll try to replace it with the user's amount
        const masterAmount = 10000000; // From the transaction data
        const userAmount = amountBN.toNumber();
        
        console.log(`[ROUTER-TEST] 💰 Master amount: ${masterAmount} lamports`);
        console.log(`[ROUTER-TEST] 💰 User amount: ${userAmount} lamports`);
        
        // Convert amounts to little-endian byte arrays
        const masterAmountBytes = Buffer.alloc(8);
        masterAmountBytes.writeUInt32LE(masterAmount, 0);
        masterAmountBytes.writeUInt32LE(0, 4); // High 32 bits
        
        const userAmountBytes = Buffer.alloc(8);
        userAmountBytes.writeUInt32LE(userAmount, 0);
        userAmountBytes.writeUInt32LE(0, 4); // High 32 bits
        
        console.log(`[ROUTER-TEST] 🔍 Master amount bytes:`, Array.from(masterAmountBytes));
        console.log(`[ROUTER-TEST] 🔍 User amount bytes:`, Array.from(userAmountBytes));
        
        // Try to find and replace the amount in the instruction data
        const originalDataBuffer = Buffer.from(clonedData, 'base64');
        let modifiedDataBuffer = Buffer.from(originalDataBuffer);
        
        // Look for the master amount in the data and replace with user amount
        const masterAmountIndex = originalDataBuffer.indexOf(masterAmountBytes);
        if (masterAmountIndex !== -1) {
            console.log(`[ROUTER-TEST] 🔄 Found master amount at index ${masterAmountIndex}, replacing with user amount`);
            userAmountBytes.copy(modifiedDataBuffer, masterAmountIndex);
            clonedData = modifiedDataBuffer.toString('base64');
            console.log(`[ROUTER-TEST] 📋 Modified instruction data: ${clonedData}`);
        } else {
            console.log(`[ROUTER-TEST] ⚠️ Could not find master amount in instruction data, using original`);
        }

        // Build new account keys array by cloning the original and swapping user accounts
        const newKeys = [...accountKeys];
        
        console.log(`[ROUTER-TEST] 🔍 Account keys (first 5):`, newKeys.slice(0, 5));
        console.log(`[ROUTER-TEST] 🔍 Account keys (last 5):`, newKeys.slice(-5));
        
        // Find and swap the master trader's public key with user's public key
        const masterTraderPubkey = new PublicKey('suqh5sHtr8HyJ7q8scBimULPkPpA557prMG47xCHQfK');
        const masterTraderIndex = newKeys.findIndex(key => key === masterTraderPubkey.toString());
        
        if (masterTraderIndex !== -1) {
            newKeys[masterTraderIndex] = userPublicKey.toString();
            console.log(`[ROUTER-TEST] 🔄 Swapped master trader (index ${masterTraderIndex}) with user: ${shortenAddress(userPublicKey.toString())}`);
        } else {
            console.log(`[ROUTER-TEST] ⚠️ Master trader not found in account keys, using original structure`);
        }

        // Clone the accounts array exactly
        const clonedAccounts = [...routerInstruction.accounts];
        console.log(`[ROUTER-TEST] 📋 Cloned accounts:`, clonedAccounts);

        // Get ATL data from the original transaction
        const atlData = originalTransaction.transaction.message.addressTableLookups || [];
        console.log(`[ROUTER-TEST] 🔍 ATL data:`, atlData);

        // Try to resolve ATL accounts properly
        let atlAccountMap = {};
        if (atlData.length > 0) {
            const atlInfo = atlData[0];
            const atlAccountKey = new PublicKey(atlInfo.accountKey);
            console.log(`[ROUTER-TEST] 🔍 ATL Account Key: ${atlAccountKey.toString()}`);
            console.log(`[ROUTER-TEST] 🔍 ATL Readonly Indexes: ${atlInfo.readonlyIndexes}`);
            console.log(`[ROUTER-TEST] 🔍 ATL Writable Indexes: ${atlInfo.writableIndexes}`);
            
            try {
                // Fetch the ATL account data
                const atlAccountInfo = await connection.getAccountInfo(atlAccountKey);
                if (atlAccountInfo && atlAccountInfo.data) {
                    console.log(`[ROUTER-TEST] ✅ Found ATL account data, length: ${atlAccountInfo.data.length}`);
                    
                    // Parse the ATL data - Solana ATL format
                    const data = atlAccountInfo.data;
                    
                    // ATL format: 
                    // - First 4 bytes: count (little-endian)
                    // - Next 4 bytes: deactivation slot (little-endian) 
                    // - Then: array of 32-byte addresses
                    const count = data.readUInt32LE(0);
                    const deactivationSlot = data.readUInt32LE(4);
                    console.log(`[ROUTER-TEST] 📊 ATL contains ${count} addresses, deactivation slot: ${deactivationSlot}`);
                    
                    // Extract addresses from ATL data (starting at offset 8)
                    for (let i = 0; i < count; i++) {
                        const offset = 8 + (i * 32);
                        if (offset + 32 <= data.length) {
                            const addressBytes = data.slice(offset, offset + 32);
                            const address = new PublicKey(addressBytes);
                            atlAccountMap[i] = address.toString();
                            console.log(`[ROUTER-TEST] 📍 ATL[${i}]: ${address.toString()}`);
                        }
                    }
                    
                    console.log(`[ROUTER-TEST] ✅ Resolved ${Object.keys(atlAccountMap).length} ATL accounts`);
                    
                    // Also check which indexes are used in the instruction
                    const allIndexes = [...(atlInfo.readonlyIndexes || []), ...(atlInfo.writableIndexes || [])];
                    console.log(`[ROUTER-TEST] 🔍 ATL indexes used in transaction: ${allIndexes}`);
                    
                } else {
                    console.log(`[ROUTER-TEST] ⚠️ ATL account not found, using placeholder`);
                }
            } catch (error) {
                console.log(`[ROUTER-TEST] ⚠️ Error fetching ATL account: ${error.message}`);
            }
        }
        
        // Filter out accounts that are not available in the main account keys (ATL accounts)
        const availableAccounts = clonedAccounts.filter(accountIndex => accountIndex < newKeys.length);
        const atlAccountIndices = clonedAccounts.filter(accountIndex => accountIndex >= newKeys.length);
        
        console.log(`[ROUTER-TEST] 📋 Available accounts (${availableAccounts.length}):`, availableAccounts);
        console.log(`[ROUTER-TEST] 📋 ATL account indices (${atlAccountIndices.length}):`, atlAccountIndices);

        // Create the cloned instruction with properly resolved ATL accounts
        const clonedInstruction = {
            programId: new PublicKey(routerProgramId),
            accounts: clonedAccounts.map((accountIndex, i) => {
                let accountKey;
                let isWritable = true;
                
                if (accountIndex < newKeys.length) {
                    // Use main account keys
                    accountKey = newKeys[accountIndex];
                    console.log(`[ROUTER-TEST] 🔄 Using main account ${accountIndex} for instruction account ${i}: ${accountKey}`);
                } else {
                    // Use resolved ATL accounts
                    const atlIndex = accountIndex - newKeys.length;
                    if (atlAccountMap[atlIndex]) {
                        accountKey = atlAccountMap[atlIndex];
                        console.log(`[ROUTER-TEST] 🔄 Using resolved ATL account ${atlIndex} for instruction account ${i}: ${accountKey}`);
                        
                        // Check if this ATL account is readonly or writable
                        const atlInfo = atlData[0];
                        const isReadonly = atlInfo.readonlyIndexes && atlInfo.readonlyIndexes.includes(atlIndex);
                        const isWritableATL = atlInfo.writableIndexes && atlInfo.writableIndexes.includes(atlIndex);
                        isWritable = isWritableATL || !isReadonly; // Default to writable if not specified
                        
                    } else {
                        // Fallback to placeholder if ATL account not found
                        accountKey = '11111111111111111111111111111111'; // System program as placeholder
                        console.log(`[ROUTER-TEST] ⚠️ ATL account ${atlIndex} not found, using placeholder for instruction account ${i}`);
                    }
                }
                
                if (!accountKey) {
                    throw new Error(`Account key at index ${accountIndex} is undefined`);
                }
                
                return {
                    pubkey: new PublicKey(accountKey),
                    isSigner: accountIndex === masterTraderIndex, // Only the user should be a signer
                    isWritable: isWritable
                };
            }),
            data: Buffer.from(clonedData, 'base64')
        };

        console.log(`[ROUTER-TEST] ✅ Created cloned instruction:`, {
            programId: shortenAddress(clonedInstruction.programId.toString()),
            accountCount: clonedInstruction.accounts.length,
            dataLength: clonedInstruction.data.length
        });

        // Create a test transaction with just the router instruction
        const testTransaction = new Transaction();
        
        // Add the instruction properly
        testTransaction.add({
            keys: clonedInstruction.accounts,
            programId: clonedInstruction.programId,
            data: clonedInstruction.data
        });

        // Set recent blockhash and fee payer
        const { blockhash } = await connection.getLatestBlockhash();
        testTransaction.recentBlockhash = blockhash;
        testTransaction.feePayer = userPublicKey;

        console.log(`[ROUTER-TEST] 🧪 Testing transaction simulation...`);
        
        // Simulate the transaction first
        const simulationResult = await connection.simulateTransaction(testTransaction);
        
        if (simulationResult.value.err) {
            console.log(`[ROUTER-TEST] ⚠️ Simulation failed:`, simulationResult.value.err);
            console.log(`[ROUTER-TEST] 📊 Simulation logs:`, simulationResult.value.logs);
            console.log(`[ROUTER-TEST] 🔄 Continuing anyway - will try to send transaction to see on-chain result...`);
        } else {
            console.log(`[ROUTER-TEST] ✅ Simulation successful!`);
            console.log(`[ROUTER-TEST] 📊 Compute units used: ${simulationResult.value.unitsConsumed}`);
            console.log(`[ROUTER-TEST] 📊 Simulation logs:`, simulationResult.value.logs);
        }

        // If simulation passes, return the instruction for actual sending
        return {
            instructions: [clonedInstruction],
            simulationResult: simulationResult.value,
            transaction: testTransaction
        };

    } catch (error) {
        console.error(`[ROUTER-TEST] ❌ Error:`, error);
        throw error;
    }
}

// Router instruction builder - Perfect cloning of master trader's router instruction
async function buildRouterInstruction(builderOptions) {
    const { connection, userPublicKey, swapDetails, amountBN, slippageBps, originalTransaction, cloningTarget, masterTraderWallet } = builderOptions;
    
    console.log(`[ROUTER-BUILDER] 🔧 Building router instruction for user ${shortenAddress(userPublicKey.toString())}`);
    console.log(`[ROUTER-BUILDER] 💰 Amount: ${amountBN.toString()} lamports`);
    
    try {
        // Use the RouterCloner for perfect cloning
        const routerCloner = new RouterCloner(connection);
        
        const cloneOptions = {
            userPublicKey: userPublicKey,
            cloningTarget: cloningTarget,
            masterTraderWallet: masterTraderWallet,
            tradeType: swapDetails.tradeType,
            inputMint: swapDetails.inputMint,
            outputMint: swapDetails.outputMint,
            amountBN: amountBN,
            slippageBps: slippageBps
        };
        
        const result = await routerCloner.buildClonedRouterInstruction(cloneOptions);
        
        console.log(`[ROUTER-BUILDER] ✅ Router cloning successful:`, {
            instructionCount: result.instructions.length,
            platform: result.platform,
            method: result.method
        });
        
        // Return the instructions array directly (not the result object)
        return result.instructions;
        
    } catch (error) {
        console.error(`[ROUTER-BUILDER] ❌ Router instruction building failed:`, error.message);
        throw error;
    }
}

// Custom DEX Buy instruction builder (F5tf...zvBq platform)
async function buildCustomDexBuyInstruction(builderOptions) {
    const { connection, userPublicKey, swapDetails, amountBN, slippageBps, originalTransaction } = builderOptions;
    
    if (!originalTransaction) {
        throw new Error("Custom DEX Buy builder requires original transaction data");
    }

    console.log(`[CUSTOM-DEX-BUY] 🔧 Building instructions for F5tf...zvBq platform`);
    console.log(`[CUSTOM-DEX-BUY] 💰 User amount: ${amountBN.toString()} lamports (${amountBN.toNumber() / 1e9} SOL)`);
    
    try {
        // Extract instruction data from original transaction
        console.log(`[CUSTOM-DEX-BUY] 🔍 Original transaction structure:`, {
            hasTransaction: !!originalTransaction.transaction,
            hasMessage: !!originalTransaction.transaction?.message,
            hasInstructions: !!originalTransaction.transaction?.message?.instructions,
            instructionCount: originalTransaction.transaction?.message?.instructions?.length || 0,
            hasAccountKeys: !!originalTransaction.transaction?.message?.accountKeys,
            accountKeyCount: originalTransaction.transaction?.message?.accountKeys?.length || 0
        });

        const instructions = originalTransaction.transaction.message.instructions || [];
        const accountKeys = originalTransaction.transaction.message.accountKeys || [];
        
        if (instructions.length === 0) {
            throw new Error("No instructions found in original transaction");
        }

        console.log(`[CUSTOM-DEX-BUY] 🔍 Found ${instructions.length} instructions`);

        // Find the main swap instruction (instruction index 3 based on logs)
        const swapInstruction = instructions[3]; // The main swap instruction
        if (!swapInstruction) {
            throw new Error("Main swap instruction not found at index 3");
        }

        console.log(`[CUSTOM-DEX-BUY] 🔍 Swap instruction:`, {
            programIdIndex: swapInstruction.programIdIndex,
            accountCount: swapInstruction.accounts?.length || 0,
            hasData: !!swapInstruction.data
        });

        // Get the platform program ID
        const programId = accountKeys[swapInstruction.programIdIndex];
        console.log(`[CUSTOM-DEX-BUY] 🎯 Platform: ${shortenAddress(programId.toString())}`);

        // Create user instruction with same structure but user's public key and amounts
        const userInstruction = {
            programId: programId,
            accounts: swapInstruction.accounts.map((accountIndex, idx) => {
                const accountKey = accountKeys[accountIndex];
                
                // Replace the main signer account (usually index 0) with user's public key
                if (idx === 0) {
                    return {
                        pubkey: userPublicKey,
                        isSigner: true,
                        isWritable: true
                    };
                }
                
                // Keep other accounts as they are
                return {
                    pubkey: accountKey,
                    isSigner: false, // User is the only signer
                    isWritable: swapInstruction.accounts[idx]?.isWritable || false
                };
            }),
            data: swapInstruction.data // Use the same instruction data
        };

        console.log(`[CUSTOM-DEX-BUY] ✅ Built instruction for platform ${shortenAddress(programId.toString())}`);
        console.log(`[CUSTOM-DEX-BUY] 📊 Account count: ${userInstruction.accounts.length}`);
        
        return [userInstruction];

    } catch (error) {
        console.error(`[CUSTOM-DEX-BUY] ❌ Failed to build instruction: ${error.message}`);
        throw error;
    }
}

// Universal Builder removed - using dedicated builders for each platform instead

// Smart transaction data extractor for fallback when builders need additional data
function extractTransactionData(originalTransaction, targetProgramId = null) {
    try {
        if (!originalTransaction) {
            return { success: false, error: "No original transaction provided" };
        }

        console.log(`[TX-EXTRACTOR] 🔍 Extracting data from original transaction`);
        
        // Handle different transaction data structures
        let instructions, accountKeys, meta;
        if (originalTransaction.transaction?.message) {
            // Structure: { transaction: { message: { instructions, accountKeys } } }
            instructions = originalTransaction.transaction.message.instructions || [];
            accountKeys = originalTransaction.transaction.message.accountKeys || [];
            meta = originalTransaction.meta;
        } else if (originalTransaction.message) {
            // Structure: { message: { instructions, accountKeys } }
            instructions = originalTransaction.message.instructions || [];
            accountKeys = originalTransaction.message.accountKeys || [];
            meta = originalTransaction.meta;
        } else {
            // Direct structure: { instructions, accountKeys }
            instructions = originalTransaction.instructions || [];
            accountKeys = originalTransaction.accountKeys || [];
            meta = originalTransaction.meta;
        }

        console.log(`[TX-EXTRACTOR] 📊 Found ${instructions.length} instructions and ${accountKeys.length} account keys`);

        if (instructions.length === 0 || accountKeys.length === 0) {
            return { success: false, error: "No instructions or account keys found" };
        }

        // Find target instruction if program ID specified
        // Search both outer instructions and inner instructions (CPIs)
        let targetInstruction = null;
        if (targetProgramId) {
            // First, search outer instructions
            targetInstruction = instructions.find(ix => {
                const programId = accountKeys[ix.programIdIndex];
                return programId && programId.toString() === targetProgramId;
            });
            
            // If not found in outer instructions, search inner instructions
            if (!targetInstruction && meta?.innerInstructions) {
                console.log(`[TX-EXTRACTOR] 🔍 Target not found in outer instructions, searching ${meta.innerInstructions.length} inner instruction groups...`);
                
                for (const innerGroup of meta.innerInstructions) {
                    for (const innerIx of innerGroup.instructions) {
                        const programId = accountKeys[innerIx.programIdIndex];
                        if (programId && programId.toString() === targetProgramId) {
                            targetInstruction = innerIx;
                            console.log(`[TX-EXTRACTOR] ✅ Found target instruction in inner instructions at group ${innerGroup.index}`);
                            break;
                        }
                    }
                    if (targetInstruction) break;
                }
            }
            
            if (targetInstruction) {
                targetInstruction = {
                    instruction: targetInstruction,
                    programId: accountKeys[targetInstruction.programIdIndex]
                };
                console.log(`[TX-EXTRACTOR] ✅ Target instruction found for program: ${targetProgramId}`);
            } else {
                console.log(`[TX-EXTRACTOR] ❌ Target instruction not found for program: ${targetProgramId}`);
            }
        }

        // Extract all program IDs and their instructions (outer + inner)
        const programInstructions = {};
        
        // Process outer instructions
        instructions.forEach((ix, index) => {
            const programId = accountKeys[ix.programIdIndex];
            if (programId) {
                const programIdStr = programId.toString();
                if (!programInstructions[programIdStr]) {
                    programInstructions[programIdStr] = [];
                }
                programInstructions[programIdStr].push({
                    index,
                    instruction: ix,
                    programId: programId,
                    isInner: false
                });
            }
        });
        
        // Process inner instructions (CPIs)
        if (meta?.innerInstructions) {
            meta.innerInstructions.forEach((innerGroup, groupIndex) => {
                innerGroup.instructions.forEach((innerIx, innerIndex) => {
                    const programId = accountKeys[innerIx.programIdIndex];
                    if (programId) {
                        const programIdStr = programId.toString();
                        if (!programInstructions[programIdStr]) {
                            programInstructions[programIdStr] = [];
                        }
                        programInstructions[programIdStr].push({
                            index: `inner-${groupIndex}-${innerIndex}`,
                            instruction: innerIx,
                            programId: programId,
                            isInner: true,
                            outerIndex: innerGroup.index
                        });
                    }
                });
            });
        }

        // Extract account data
        const accountData = accountKeys.map((account, index) => ({
            index,
            pubkey: account,
            pubkeyStr: account.toString()
        }));

        // Extract token balance changes from meta
        const tokenBalanceChanges = {
            pre: meta?.preTokenBalances || [],
            post: meta?.postTokenBalances || []
        };

        // Extract SOL balance changes
        const solBalanceChanges = {
            pre: meta?.preBalances || [],
            post: meta?.postBalances || []
        };

        return {
            success: true,
            data: {
                instructions,
                accountKeys,
                accountData,
                programInstructions,
                targetInstruction,
                tokenBalanceChanges,
                solBalanceChanges,
                meta
            }
        };

    } catch (error) {
        console.error(`[TX-EXTRACTOR] ❌ Failed to extract transaction data: ${error.message}`);
        return { success: false, error: error.message };
    }
}

// Helper function to find accounts by pattern in transaction data
function findAccountsByPattern(txData, patterns) {
    const results = {};
    
    for (const [name, pattern] of Object.entries(patterns)) {
        results[name] = [];
        
        // Search in account data
        for (const account of txData.accountData) {
            if (pattern.test(account.pubkeyStr)) {
                results[name].push(account);
            }
        }
        
        // Search in program instructions
        for (const [programId, instructions] of Object.entries(txData.programInstructions)) {
            if (pattern.test(programId)) {
                results[name].push({ programId, instructions });
            }
        }
    }
    
    return results;
}

// --- CORE LIBRARIES ---
const {
    PublicKey,
    SystemProgram,
    TransactionInstruction,
    ComputeBudgetProgram,
    VersionedTransaction,
    TransactionMessage,
    Transaction,
} = require('@solana/web3.js');
const { TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, getAssociatedTokenAddressSync, NATIVE_MINT: WSOL_MINT } = require("@solana/spl-token");
const axios = require('axios');
const BN = require('bn.js');
const { struct, u64, u8 } = require('@solana/buffer-layout');
const traceLogger = require('./traceLogger.js');
const { RouterCloner } = require('./routerCloner.js');

// --- PROTOCOL SDKs ---
const { PumpSdk, pumpPoolAuthorityPda, canonicalPumpPoolPda, PUMP_AMM_PROGRAM_ID } = require('@pump-fun/pump-sdk');
const RaydiumV2_raw = require('@raydium-io/raydium-sdk');
 const RaydiumV2 = RaydiumV2_raw.default || RaydiumV2_raw;

// Now, safely extract all the tools we might need from the corrected V2 object.
// This gives every builder access to the same shared toolbox.
const {
    Liquidity,
    Token,
    TokenAmount,
    Percent,
    WSOL,
    Clmm,
    Cpmm,
    LaunchpadPool,
    LaunchpadConfig,
    SwapMath,
    TickUtils,
} = RaydiumV2;

const { Dlmm } = require('@meteora-ag/dlmm');
const { CpAmm: MeteoraCpAmm } = require('@meteora-ag/cp-amm-sdk');
const { DynamicBondingCurveClient } = require('@meteora-ag/dynamic-bonding-curve-sdk');


// --- INTERNAL CONFIG & UTILS ---
const config = require('./config.js');
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

// Manual Pump.fun instruction builder to fix seeds constraint violation
async function buildPumpFunBuyInstructionManually({ user, mint, creator, solAmount, feeRecipient, connection }) {
    try {
        console.log(`[PUMP_BUILDER_MANUAL] 🔧 Building manual Pump.fun buy instruction...`);
        
        // Derive the correct PDAs using the same seeds as the program expects
        const PUMP_FUN_PROGRAM_ID = new PublicKey('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P');
        
        // Bonding curve PDA: [b"bonding-curve", mint]
        const bondingCurvePda = PublicKey.findProgramAddressSync(
            [Buffer.from('bonding-curve'), mint.toBuffer()],
            PUMP_FUN_PROGRAM_ID
        )[0];
        
        // Associated bonding curve PDA: [b"associated-bonding-curve", bonding_curve]
        const associatedBondingCurvePda = PublicKey.findProgramAddressSync(
            [Buffer.from('associated-bonding-curve'), bondingCurvePda.toBuffer()],
            PUMP_FUN_PROGRAM_ID
        )[0];
        
        // Associated user PDA: [b"associated-user", bonding_curve, user]
        const associatedUserPda = PublicKey.findProgramAddressSync(
            [Buffer.from('associated-user'), bondingCurvePda.toBuffer(), user.toBuffer()],
            PUMP_FUN_PROGRAM_ID
        )[0];
        
        // User token account (ATA)
        const userTokenAccount = getAssociatedTokenAddressSync(mint, user);
        
        console.log(`[PUMP_BUILDER_MANUAL] 📊 Derived PDAs:`, {
            bondingCurve: bondingCurvePda.toBase58(),
            associatedBondingCurve: associatedBondingCurvePda.toBase58(),
            associatedUser: associatedUserPda.toBase58(),
            userTokenAccount: userTokenAccount.toBase58()
        });
        
        // Build the instruction data with correct structure
        // Discriminator (8 bytes) + amount (8 bytes) + max_sol_cost (8 bytes) = 24 bytes total
        const instructionData = Buffer.alloc(24);
        
        // 1. Copy the correct discriminator (8 bytes)
        config.PUMP_FUN_BUY_DISCRIMINATOR.copy(instructionData, 0);
        
        // 2. Amount field (8 bytes) - for buys, this is typically 0
        instructionData.writeBigUInt64LE(BigInt(0), 8);
        
        // 3. Max SOL cost (8 bytes) - the amount of SOL we're willing to spend
        instructionData.writeBigUInt64LE(BigInt(solAmount.toString()), 16);
        
        console.log(`[PUMP_BUILDER_MANUAL] 📊 Instruction data: discriminator=${config.PUMP_FUN_BUY_DISCRIMINATOR.toString('hex')}, amount=0, maxSolCost=${solAmount.toString()}`);
        
        // Create the instruction with all required accounts
        const instruction = new TransactionInstruction({
            programId: PUMP_FUN_PROGRAM_ID,
            keys: [
                { pubkey: config.PUMP_FUN_GLOBAL, isSigner: false, isWritable: false },
                { pubkey: feeRecipient, isSigner: false, isWritable: true },
                { pubkey: mint, isSigner: false, isWritable: true },
                { pubkey: bondingCurvePda, isSigner: false, isWritable: true },
                { pubkey: associatedBondingCurvePda, isSigner: false, isWritable: true },
                { pubkey: associatedUserPda, isSigner: false, isWritable: true },
                { pubkey: user, isSigner: true, isWritable: true },
                { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
                { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
                { pubkey: creator, isSigner: false, isWritable: true },
                { pubkey: new PublicKey('Ce6TQqeHC9p8KetsN6JsjHK7UTZk7nasjjnr7XxXp9F1'), isSigner: false, isWritable: false }, // Event Authority
                { pubkey: PUMP_FUN_PROGRAM_ID, isSigner: false, isWritable: false },
                { pubkey: new PublicKey('Hq2wp8uJ9jCPsYgNHex8RtqdvMPfVGoYwjvF1ATiwn2Y'), isSigner: false, isWritable: true }, // Global Volume Accumulator
                { pubkey: new PublicKey('GMQhT8QhbTtNeuve1xzJaBqX3D1KefNy9e2td2NWCBSZ'), isSigner: false, isWritable: true }, // User Volume Accumulator
                { pubkey: new PublicKey('8Wf5TiAheLUqBrKXeYg2JtAFFMWtKdG2BSFgqUcPVwTt'), isSigner: false, isWritable: false }, // Fee Config
                { pubkey: userTokenAccount, isSigner: false, isWritable: true } // User Token Account
            ],
            data: instructionData
        });
        
        console.log(`[PUMP_BUILDER_MANUAL] ✅ Built manual buy instruction with ${instruction.keys.length} accounts`);
        return instruction;
        
    } catch (error) {
        console.error(`[PUMP_BUILDER_MANUAL] ❌ Failed to build manual instruction: ${error.message}`);
        throw error;
    }
}

// Manual Pump.fun sell instruction builder to fix seeds constraint violation
async function buildPumpFunSellInstructionManually({ user, mint, creator, tokenAmount, minSolOutput, feeRecipient, connection }) {
    try {
        console.log(`[PUMP_BUILDER_MANUAL] 🔧 Building manual Pump.fun sell instruction...`);
        
        // Derive the correct PDAs using the same seeds as the program expects
        const PUMP_FUN_PROGRAM_ID = new PublicKey('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P');
        
        // Bonding curve PDA: [b"bonding-curve", mint]
        const bondingCurvePda = PublicKey.findProgramAddressSync(
            [Buffer.from('bonding-curve'), mint.toBuffer()],
            PUMP_FUN_PROGRAM_ID
        )[0];
        
        // Associated bonding curve PDA: [b"associated-bonding-curve", bonding_curve]
        const associatedBondingCurvePda = PublicKey.findProgramAddressSync(
            [Buffer.from('associated-bonding-curve'), bondingCurvePda.toBuffer()],
            PUMP_FUN_PROGRAM_ID
        )[0];
        
        // Associated user PDA: [b"associated-user", bonding_curve, user]
        const associatedUserPda = PublicKey.findProgramAddressSync(
            [Buffer.from('associated-user'), bondingCurvePda.toBuffer(), user.toBuffer()],
            PUMP_FUN_PROGRAM_ID
        )[0];
        
        // User token account (ATA)
        const userTokenAccount = getAssociatedTokenAddressSync(mint, user);
        
        console.log(`[PUMP_BUILDER_MANUAL] 📊 Derived PDAs for sell:`, {
            bondingCurve: bondingCurvePda.toBase58(),
            associatedBondingCurve: associatedBondingCurvePda.toBase58(),
            associatedUser: associatedUserPda.toBase58(),
            userTokenAccount: userTokenAccount.toBase58()
        });
        
        // Build the instruction data with correct structure
        // Discriminator (8 bytes) + amount (8 bytes) + min_sol_output (8 bytes) = 24 bytes total
        const instructionData = Buffer.alloc(24);
        
        // 1. Copy the correct discriminator (8 bytes)
        config.PUMP_FUN_SELL_DISCRIMINATOR.copy(instructionData, 0);
        
        // 2. Amount field (8 bytes) - the amount of tokens to sell
        instructionData.writeBigUInt64LE(BigInt(tokenAmount.toString()), 8);
        
        // 3. Min SOL output (8 bytes) - minimum SOL we're willing to accept
        instructionData.writeBigUInt64LE(BigInt(minSolOutput.toString()), 16);
        
        console.log(`[PUMP_BUILDER_MANUAL] 📊 Sell instruction data: discriminator=${config.PUMP_FUN_SELL_DISCRIMINATOR.toString('hex')}, amount=${tokenAmount.toString()}, minSolOutput=${minSolOutput.toString()}`);
        
        // Create the instruction with all required accounts
        const instruction = new TransactionInstruction({
            programId: PUMP_FUN_PROGRAM_ID,
            keys: [
                { pubkey: config.PUMP_FUN_GLOBAL, isSigner: false, isWritable: false },
                { pubkey: feeRecipient, isSigner: false, isWritable: true },
                { pubkey: mint, isSigner: false, isWritable: true },
                { pubkey: bondingCurvePda, isSigner: false, isWritable: true },
                { pubkey: associatedBondingCurvePda, isSigner: false, isWritable: true },
                { pubkey: associatedUserPda, isSigner: false, isWritable: true },
                { pubkey: user, isSigner: true, isWritable: true },
                { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
                { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
                { pubkey: creator, isSigner: false, isWritable: true },
                { pubkey: new PublicKey('Ce6TQqeHC9p8KetsN6JsjHK7UTZk7nasjjnr7XxXp9F1'), isSigner: false, isWritable: false }, // Event Authority
                { pubkey: PUMP_FUN_PROGRAM_ID, isSigner: false, isWritable: false },
                { pubkey: new PublicKey('Hq2wp8uJ9jCPsYgNHex8RtqdvMPfVGoYwjvF1ATiwn2Y'), isSigner: false, isWritable: true }, // Global Volume Accumulator
                { pubkey: new PublicKey('GMQhT8QhbTtNeuve1xzJaBqX3D1KefNy9e2td2NWCBSZ'), isSigner: false, isWritable: true }, // User Volume Accumulator
                { pubkey: new PublicKey('8Wf5TiAheLUqBrKXeYg2JtAFFMWtKdG2BSFgqUcPVwTt'), isSigner: false, isWritable: false }, // Fee Config
                { pubkey: userTokenAccount, isSigner: false, isWritable: true } // User Token Account
            ],
            data: instructionData
        });
        
        console.log(`[PUMP_BUILDER_MANUAL] ✅ Built manual sell instruction with ${instruction.keys.length} accounts`);
        return instruction;
        
    } catch (error) {
        console.error(`[PUMP_BUILDER_MANUAL] ❌ Failed to build manual sell instruction: ${error.message}`);
        throw error;
    }
}

async function buildPumpFunInstruction(builderOptions) {
    // This builder is for BONDING CURVE (BC) trades on Pump.fun
    const { connection, keypair, swapDetails, amountBN, slippageBps, apiManager } = builderOptions;
    const userWalletPk = keypair.publicKey;
    
    // Initialize Pump.fun SDK
    const { PumpSdk } = require('@pump-fun/pump-sdk');
    const sdk = new PumpSdk(connection);

    try {
        const isBuy = swapDetails.tradeType === 'buy';
        if (!isBuy) {
            // =============================================================================
            // HYBRID SELL APPROACH: Use SDK simulation + manual instruction building
            // =============================================================================
            console.log(`[PUMP_BUILDER_BC] 🔄 Engineering HYBRID SELL for ${shortenAddress(swapDetails.inputMint)}...`);
            const tokenMintPk = new PublicKey(swapDetails.inputMint);
            const tokenAmountBN = amountBN;
            
            // TACTIC 1: REAL-TIME RECONNAISSANCE for sell simulation
            console.log(`[PUMP_BUILDER_BC] Querying live bonding curve for sell quote...`);
            
            // Let Singapore Sender handle the calculations and use simple SDK approach
            console.log(`[PUMP_BUILDER_BC] 💰 Using token amount: ${tokenAmountBN.toString()} tokens for SELL trade`);
            console.log(`[PUMP_BUILDER_BC] 🚀 Singapore Sender will handle SOL calculations and leader selection`);
            
            // Use the SDK's simple sell method that handles everything internally
            const sellInstructions = await sdk.getSellInstructionRaw({
                mint: tokenMintPk,
                user: userWalletPk,
                amount: tokenAmountBN,
                slippage: Math.floor((slippageBps || 4000) / 100) // Convert BPS to percentage
            });

            if (!sellInstructions) {
                throw new Error('SDK failed to generate sell instructions.');
            }

            console.log(`[PUMP_BUILDER_BC] ✅ SDK SELL reconnaissance complete`);
            console.log(`[PUMP_BUILDER_BC]   🪙 Token amount: ${tokenAmountBN.toString()}`);
            console.log(`[PUMP_BUILDER_BC]   📋 Instructions generated: ${sellInstructions.length}`);

            console.log(`[PUMP_BUILDER_BC] ✅ Returning SDK-generated SELL instructions. Ready for pre-flight simulation.`);
            return sellInstructions;
        }

        const tokenMintPk = new PublicKey(swapDetails.outputMint);
        const solInLamports = amountBN;
        console.log(`[PUMP_BUILDER_BC] Engineering HYBRID BUY for ${shortenAddress(tokenMintPk.toBase58())}...`);

        // =============================================================================
        // TACTIC 1: REAL-TIME RECONNAISSANCE to solve Error 6002 (TooMuchSolRequired)
        // =============================================================================
        console.log(`[PUMP_BUILDER_BC] Querying live bonding curve for quote...`);
        
        // Let Singapore Sender handle the calculations and use simple SDK approach
        console.log(`[PUMP_BUILDER_BC] 💰 Using SOL amount: ${solInLamports} lamports for BUY trade`);
        console.log(`[PUMP_BUILDER_BC] 🚀 Singapore Sender will handle token calculations and leader selection`);
        
        // Use the SDK's simple buy method that handles everything internally
        const buyInstructions = await sdk.getBuyInstructionRaw({
            mint: tokenMintPk,
            user: userWalletPk,
            solAmount: new BN(solInLamports),
            slippage: Math.floor((slippageBps || 2500) / 100) // Convert BPS to percentage
        });

        if (!buyInstructions) {
            throw new Error('SDK failed to generate buy instructions.');
        }

        console.log(`[PUMP_BUILDER_BC] ✅ SDK Buy Instructions Generated:`);
        console.log(`[PUMP_BUILDER_BC]   📊 SOL amount: ${solInLamports / 1e9} SOL (${solInLamports} lamports)`);
        console.log(`[PUMP_BUILDER_BC]   📋 Instructions generated: ${Array.isArray(buyInstructions) ? buyInstructions.length : 1}`);

        // =============================================================================
        // RETURN SDK-GENERATED INSTRUCTIONS - They are already perfect!
        // =============================================================================
        
        console.log(`[PUMP_BUILDER_BC] ✅ Returning SDK-generated instructions. Ready for pre-flight simulation.`);
        return buyInstructions;

    } catch (err) {
        console.error(`[PUMP_BUILDER_BC] ❌ Engineering process failed:`, err.message);
        throw err; // Pass the error up to the trading engine.
    }
}


// Helper function to get creator from bonding curve
async function getCreatorFromBondingCurve(connection, mint) {
    try {
        // First, try to get the bonding curve PDA
        const bondingCurvePda = PublicKey.findProgramAddressSync(
            [Buffer.from('bonding_curve'), mint.toBuffer()],
            new PublicKey('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P')
        )[0];
        
        console.log(`[PUMP_BUILDER_BC-SDK] Looking for bonding curve at: ${bondingCurvePda.toBase58()}`);
        
        // Get account info
        let accountInfo = await connection.getAccountInfo(bondingCurvePda);
        if (!accountInfo) {
            // Try alternative PDA derivation
            const altBondingCurvePda = PublicKey.findProgramAddressSync(
                [Buffer.from('bonding_curve_v2'), mint.toBuffer()],
                new PublicKey('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P')
            )[0];
            
            console.log(`[PUMP_BUILDER_BC-SDK] Trying alternative PDA: ${altBondingCurvePda.toBase58()}`);
            
            const altAccountInfo = await connection.getAccountInfo(altBondingCurvePda);
            if (!altAccountInfo) {
                // If still not found, try to get from token metadata
                console.log(`[PUMP_BUILDER_BC-SDK] Bonding curve not found, trying token metadata...`);
                
                // For now, return a default creator or try to derive from mint
                // This is a fallback for tokens that might not have bonding curves yet
                return mint; // Use mint as creator for now
            }
            
            // Use alternative account info
            accountInfo = altAccountInfo;
        }
        
        // Try to decode the bonding curve account
        try {
            // The creator is typically at offset 8 (after discriminator)
            const creatorBytes = accountInfo.data.slice(8, 40);
            const creator = new PublicKey(creatorBytes);
            
            console.log(`[PUMP_BUILDER_BC-SDK] Found creator: ${creator.toBase58()}`);
            return creator;
            
        } catch (decodeError) {
            console.log(`[PUMP_BUILDER_BC-SDK] Could not decode creator from bonding curve, using mint as fallback`);
            return mint; // Use mint as creator if decoding fails
        }
        
    } catch (error) {
        console.error(`[PUMP_BUILDER_BC-SDK] Error getting creator:`, error.message);
        // Return mint as fallback creator
        return mint;
    }
}

// Helper function to calculate expected SOL output for sell
async function calculateExpectedSolOut(connection, mint, amount) {
    try {
        console.log(`[PUMP_BUILDER_BC-SDK] Calculating expected SOL output for ${amount.toString()} tokens`);
        
        // Try to get bonding curve data for more accurate calculation
        try {
            const bondingCurvePda = PublicKey.findProgramAddressSync(
                [Buffer.from('bonding_curve'), mint.toBuffer()],
                new PublicKey('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P')
            )[0];
            
            const accountInfo = await connection.getAccountInfo(bondingCurvePda);
            if (accountInfo) {
                // If we have bonding curve data, we could calculate more accurately
                // For now, use a conservative estimate based on amount
                const estimatedSolOut = amount.mul(new BN(1000000)); // Rough estimate: 1 token = 0.001 SOL
                console.log(`[PUMP_BUILDER_BC-SDK] Using bonding curve estimate: ${estimatedSolOut.toString()} lamports`);
                return estimatedSolOut;
            }
        } catch (curveError) {
            console.log(`[PUMP_BUILDER_BC-SDK] Could not fetch bonding curve data:`, curveError.message);
        }
        
        // Fallback calculation: conservative estimate
        // For copy trading, we want to be conservative to avoid failed transactions
        const estimatedSolOut = amount.mul(new BN(500000)); // 0.0005 SOL per token (very conservative)
        
        console.log(`[PUMP_BUILDER_BC-SDK] Using fallback estimate: ${estimatedSolOut.toString()} lamports`);
        return estimatedSolOut;
        
    } catch (error) {
        console.error(`[PUMP_BUILDER_BC-SDK] Error calculating SOL output:`, error.message);
        // Return a very conservative default
        return new BN(1000000); // 0.001 SOL minimum
    }
}


/// === Pump.fun AMM ===
async function buildPumpFunAmmInstruction(builderOptions) {
    const { connection, keypair, swapDetails, amountBN, slippageBps, nonceInfo = null, masterTraderWallet } = builderOptions;

    try {
        const isBuy = swapDetails.tradeType === 'buy';
        const tokenMint = isBuy ? swapDetails.outputMint : swapDetails.inputMint;
        if (!tokenMint) throw new Error("PumpFun AMM Builder: Token mint is missing from swapDetails.");

        // Validate tokenMint before creating PublicKey
        if (typeof tokenMint !== 'string') {
            throw new Error(`Invalid tokenMint for Pump.fun AMM: ${tokenMint}. Expected string, got ${typeof tokenMint}`);
        }

        console.log(`[PUMP_BUILDER_AMM] 🔍 TokenMint validation: ${tokenMint} (type: ${typeof tokenMint})`);

        // --- INTEL GATHERING (THIS IS THE FIX) ---
        // Use the proper Pump.fun SDK for AMM instruction building
        const pumpSdk = new PumpSdk(connection);
        
        // Extract fee program from transaction logs if available
        let feeProgram = null;
        if (swapDetails.originalTransaction?.meta?.logMessages) {
            const logMessages = swapDetails.originalTransaction.meta.logMessages;
            for (const log of logMessages) {
                if (log.includes('pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ')) {
                    feeProgram = 'pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ';
                    console.log(`[PUMP_BUILDER_AMM] 🎯 Found fee program in logs: ${feeProgram}`);
                    break;
                }
            }
        }
        
        // Get the canonical pool for this token using the available functions
        let pumpPoolAuthority, canonicalPool;
        try {
            pumpPoolAuthority = pumpPoolAuthorityPda(new PublicKey(tokenMint));
            canonicalPool = canonicalPumpPoolPda(new PublicKey(tokenMint));
        } catch (error) {
            throw new Error(`Failed to create PublicKey objects for Pump.fun AMM: ${error.message}`);
        }
        
            // Build instructions using the PumpAmmSdk
    let instructions;
    
    // Extract pool address using smart transaction extractor
    let poolKey;
    if (swapDetails.originalTransaction) {
        console.log(`[PUMP_BUILDER_AMM] 🔍 Extracting pool data from original transaction`);
        
        const txExtraction = extractTransactionData(swapDetails.originalTransaction, 'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA');
        
        if (txExtraction.success) {
            const txData = txExtraction.data;
            
            // Method 1: Look for pool in Pump.fun AMM instruction accounts (PRIMARY METHOD)
            if (!poolKey && txData.programInstructions['pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA']) {
                const ammInstructions = txData.programInstructions['pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA'];
                for (const ammIx of ammInstructions) {
                    const instruction = ammIx.instruction;
                    // Pool could be at various account indices in AMM instructions
                    // Check multiple common positions: 0, 1, 2, 3
                    if (instruction.accounts && instruction.accounts.length > 0) {
                        for (let i = 0; i < Math.min(4, instruction.accounts.length); i++) {
                            const poolIndex = instruction.accounts[i];
                            if (txData.accountKeys[poolIndex]) {
                                const candidatePoolKey = txData.accountKeys[poolIndex];
                                // Skip if this is the trader's wallet (not a pool)
                                if (candidatePoolKey.toString() !== masterTraderWallet) {
                                    poolKey = candidatePoolKey;
                                    console.log(`[PUMP_BUILDER_AMM] 🎯 Extracted pool from AMM instruction (index ${i}): ${shortenAddress(poolKey.toString())}`);
                                    break;
                                }
                            }
                        }
                        if (poolKey) break; // Exit outer loop if we found a pool
                    }
                }
            }
            
            // Method 2: Look for pool in token balance changes (FALLBACK - but be more intelligent)
            if (!poolKey) {
                console.log(`[PUMP_BUILDER_AMM] 🔍 Fallback: Looking for pool in token balance changes...`);
                for (const balance of txData.tokenBalanceChanges.pre) {
                    if (balance.mint === tokenMint && balance.owner) {
                        const ownerAddress = balance.owner;
                        // Skip if this is the trader's wallet (not a pool)
                        if (ownerAddress !== masterTraderWallet) {
                            // Additional validation: check if this account has significant token balance
                            // Pool accounts typically have large token balances
                            const balanceAmount = balance.uiTokenAmount?.amount || '0';
                            if (parseInt(balanceAmount) > 1000000) { // Only consider accounts with > 1M tokens
                                poolKey = new PublicKey(ownerAddress);
                                console.log(`[PUMP_BUILDER_AMM] 🎯 Extracted pool from token balance (fallback): ${shortenAddress(poolKey.toString())} (balance: ${balanceAmount})`);
                                break;
                            }
                        }
                    }
                }
            }
            
            // Method 3: Look for Raydium pool in loadedAddresses (CRITICAL INSIGHT!)
            if (!poolKey && swapDetails.originalTransaction?.meta?.loadedAddresses) {
                console.log(`[PUMP_BUILDER_AMM] 🔍 Looking for pool in loadedAddresses...`);
                const loadedAddresses = swapDetails.originalTransaction.meta.loadedAddresses;
                
                // Check readonly addresses for pool candidates
                if (loadedAddresses.readonly) {
                    for (const address of loadedAddresses.readonly) {
                        const addressStr = address.toString();
                        // Skip known system programs
                        if (addressStr === 'SysvarRecentB1ockHashes11111111111111111111' ||
                            addressStr === 'jitodontfrontd1111111TradeWithAxiomDotTrade' ||
                            addressStr === 'So11111111111111111111111111111111111111112' ||
                            addressStr === 'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA') {
                            continue;
                        }
                        
                        // These are likely pool addresses!
                        poolKey = new PublicKey(addressStr);
                        console.log(`[PUMP_BUILDER_AMM] 🎯 Found pool in loadedAddresses.readonly: ${shortenAddress(poolKey.toString())}`);
                        break;
                    }
                }
                
                // Check writable addresses for pool state accounts
                if (!poolKey && loadedAddresses.writable) {
                    for (const address of loadedAddresses.writable) {
                        const addressStr = address.toString();
                        // Skip known system accounts
                        if (addressStr.includes('11111111111111111111111111111111')) {
                            continue;
                        }
                        
                        // These could be pool state accounts
                        poolKey = new PublicKey(addressStr);
                        console.log(`[PUMP_BUILDER_AMM] 🎯 Found pool in loadedAddresses.writable: ${shortenAddress(poolKey.toString())}`);
                        break;
                    }
                }
            }
            
            // Method 3.5: Look for pool in addressTableLookups (ADDITIONAL INSIGHT!)
            if (!poolKey && swapDetails.originalTransaction?.transaction?.message?.addressTableLookups) {
                console.log(`[PUMP_BUILDER_AMM] 🔍 Looking for pool in addressTableLookups...`);
                const addressTableLookups = swapDetails.originalTransaction.transaction.message.addressTableLookups;
                
                for (const lookup of addressTableLookups) {
                    // The lookup table contains additional accounts
                    // We need to resolve these indices to actual addresses
                    console.log(`[PUMP_BUILDER_AMM] 🔍 Found lookup table: ${shortenAddress(lookup.accountKey)}`);
                    console.log(`[PUMP_BUILDER_AMM] 🔍 Readonly indices: ${lookup.readonlyIndexes?.join(', ')}`);
                    console.log(`[PUMP_BUILDER_AMM] 🔍 Writable indices: ${lookup.writableIndexes?.join(', ')}`);
                    
                    // Note: We would need to fetch the actual lookup table to resolve these indices
                    // For now, we'll log this information for debugging
                }
            }
            
            // Method 4: Look for Raydium pool in account keys (fallback)
            if (!poolKey) {
                console.log(`[PUMP_BUILDER_AMM] 🔍 Looking for Raydium pool in account keys...`);
                for (let i = 0; i < txData.accountKeys.length; i++) {
                    const account = txData.accountKeys[i];
                    const accountStr = account.toString();
                    
                    // Skip known system accounts and user wallets
                    if (accountStr === masterTraderWallet || 
                        accountStr === '11111111111111111111111111111111' ||
                        accountStr === 'ComputeBudget111111111111111111111111111111' ||
                        accountStr === 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL' ||
                        accountStr === 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' ||
                        accountStr === tokenMint) {
                        continue;
                    }
                    
                    // Check if this looks like a pool address (not a PDA pattern)
                    if (accountStr.length === 44 && !accountStr.includes('11111111111111111111111111111111')) {
                        poolKey = account;
                        console.log(`[PUMP_BUILDER_AMM] 🎯 Found potential pool at account index ${i}: ${shortenAddress(poolKey.toString())}`);
                        break;
                    }
                }
            }
        }
        
        // Method 3: Look for Raydium AMM program instructions in the transaction
        if (!poolKey && txExtraction.success) {
            const txData = txExtraction.data;
            console.log(`[PUMP_BUILDER_AMM] 🔍 Looking for Raydium AMM program instructions...`);
            
            // Common Raydium AMM program IDs
            const raydiumAmmPrograms = [
                '675kPX9MHTjS2zt1qEX1i3Vd8qsABPqdcuhkGS4MaoV4', // Raydium AMM v4
                '5quBtoiQqxF9Jv6KYKctB59NT3gtJDz6ZcZ6f9NKhULb', // Raydium AMM v4 (alternative)
                'CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK'  // Raydium CLMM
            ];
            
            for (const programId of raydiumAmmPrograms) {
                if (txData.programInstructions[programId]) {
                    console.log(`[PUMP_BUILDER_AMM] 🎯 Found Raydium AMM program: ${shortenAddress(programId)}`);
                    const ammInstructions = txData.programInstructions[programId];
                    
                    for (const ammIx of ammInstructions) {
                        const instruction = ammIx.instruction;
                        // Pool state is typically at account index 0 or 1 in Raydium AMM instructions
                        for (let i = 0; i < Math.min(3, instruction.accounts.length); i++) {
                            const poolIndex = instruction.accounts[i];
                            if (txData.accountKeys[poolIndex]) {
                                const candidatePoolKey = txData.accountKeys[poolIndex];
                                // Skip if this is the trader's wallet (not a pool)
                                if (candidatePoolKey.toString() !== masterTraderWallet) {
                                    poolKey = candidatePoolKey;
                                    console.log(`[PUMP_BUILDER_AMM] 🎯 Extracted pool from Raydium AMM instruction (index ${i}): ${shortenAddress(poolKey.toString())}`);
                                    break;
                                }
                            }
                        }
                        if (poolKey) break;
                    }
                    if (poolKey) break;
                }
            }
        }
        
        // Fallback: if we couldn't extract from transaction, use SDK derivation
        if (!poolKey) {
            console.log(`[PUMP_BUILDER_AMM] ⚠️ Could not extract pool from transaction, using SDK derivation`);
            const tokenMintPubkey = new PublicKey(tokenMint);
            const solMintPubkey = new PublicKey('So11111111111111111111111111111111111111112');
            
            try {
                const poolKeyResult = pumpSdk.pumpAmmSdk.poolKey(0, tokenMintPubkey, tokenMintPubkey, solMintPubkey);
                poolKey = poolKeyResult[0]; // Extract the PublicKey from the array
                console.log(`[PUMP_BUILDER_AMM] 🔧 Derived pool key: ${shortenAddress(poolKey.toString())}`);
            } catch (derivationError) {
                console.error(`[PUMP_BUILDER_AMM] ❌ Pool key derivation failed: ${derivationError.message}`);
                // Try alternative derivation method
                try {
                    const poolKeyResult = pumpSdk.pumpAmmSdk.poolKey(0, solMintPubkey, tokenMintPubkey, tokenMintPubkey);
                    poolKey = poolKeyResult[0];
                    console.log(`[PUMP_BUILDER_AMM] 🔧 Alternative derived pool key: ${shortenAddress(poolKey.toString())}`);
                } catch (altError) {
                    throw new Error(`All pool key derivation methods failed: ${derivationError.message}, ${altError.message}`);
                }
            }
        }
    } else {
        console.log(`[PUMP_BUILDER_AMM] ⚠️ No original transaction data available, using SDK derivation`);
        // Fallback to derivation if no original transaction data
        const poolKeyResult = pumpSdk.pumpAmmSdk.poolKey(0, new PublicKey(tokenMint), new PublicKey(tokenMint), new PublicKey('So11111111111111111111111111111111111111112'));
        poolKey = poolKeyResult[0]; // Extract the PublicKey from the array
    }
    
    // Get the swap state
    console.log(`[PUMP_BUILDER_AMM] 🔍 Attempting to get swap state for pool: ${shortenAddress(poolKey.toString())}`);
    let swapState;
    try {
        swapState = await pumpSdk.pumpAmmSdk.swapSolanaState(poolKey, keypair.publicKey);
        console.log(`[PUMP_BUILDER_AMM] ✅ Successfully retrieved swap state`);
    } catch (swapStateError) {
        console.error(`[PUMP_BUILDER_AMM] ❌ Failed to get swap state: ${swapStateError.message}`);
        console.log(`[PUMP_BUILDER_AMM] 🔧 Pool key that failed: ${shortenAddress(poolKey.toString())}`);
        console.log(`[PUMP_BUILDER_AMM] 🔧 Token mint: ${tokenMint}`);
        console.log(`[PUMP_BUILDER_AMM] 🔧 Trader wallet: ${masterTraderWallet}`);
        throw new Error(`Invalid pool key for AMM swap: ${swapStateError.message}`);
    }
    
    if (isBuy) {
        // Buy tokens with SOL using AMM (buyBaseInput = buy tokens with SOL)
        console.log(`[PUMP_BUILDER_AMM] 🔄 Building BUY instruction with:`);
        console.log(`[PUMP_BUILDER_AMM] 🔄 - Pool: ${shortenAddress(poolKey.toString())}`);
        console.log(`[PUMP_BUILDER_AMM] 🔄 - Amount: ${amountBN.toString()} lamports`);
        console.log(`[PUMP_BUILDER_AMM] 🔄 - Slippage: ${slippageBps / 100}%`);
        console.log(`[PUMP_BUILDER_AMM] 🔄 - User: ${shortenAddress(keypair.publicKey.toString())}`);
        
        try {
            instructions = await pumpSdk.pumpAmmSdk.buyBaseInput(
                swapState,
                amountBN,
                slippageBps / 100
            );
            console.log(`[PUMP_BUILDER_AMM] ✅ BUY instruction built successfully with ${instructions.length} instructions`);
        } catch (buyError) {
            console.error(`[PUMP_BUILDER_AMM] ❌ BUY instruction failed: ${buyError.message}`);
            console.error(`[PUMP_BUILDER_AMM] ❌ Pool state:`, swapState);
            throw new Error(`BUY instruction failed: ${buyError.message}`);
        }
    } else {
        // Sell tokens for SOL using AMM (sellBaseInput = sell tokens for SOL)
        console.log(`[PUMP_BUILDER_AMM] 🔄 Building SELL instruction with:`);
        console.log(`[PUMP_BUILDER_AMM] 🔄 - Pool: ${shortenAddress(poolKey.toString())}`);
        console.log(`[PUMP_BUILDER_AMM] 🔄 - Amount: ${amountBN.toString()} tokens`);
        console.log(`[PUMP_BUILDER_AMM] 🔄 - Slippage: ${slippageBps / 100}%`);
        console.log(`[PUMP_BUILDER_AMM] 🔄 - User: ${shortenAddress(keypair.publicKey.toString())}`);
        
        try {
            instructions = await pumpSdk.pumpAmmSdk.sellBaseInput(
                swapState,
                amountBN,
                slippageBps / 100
            );
            console.log(`[PUMP_BUILDER_AMM] ✅ SELL instruction built successfully with ${instructions.length} instructions`);
        } catch (sellError) {
            console.error(`[PUMP_BUILDER_AMM] ❌ SELL instruction failed: ${sellError.message}`);
            console.error(`[PUMP_BUILDER_AMM] ❌ Pool state:`, swapState);
            throw new Error(`SELL instruction failed: ${sellError.message}`);
        }
    }

        // Add nonce instruction if provided
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
    const logPrefix = `[PUMP_AMM_INTEL_V4]`;
    console.log(`${logPrefix} Fetching pool state for token: ${shortenAddress(tokenMint)}`);

    const endpoints = [
        `https://frontend-api.pump.fun/coins/${tokenMint}`, // New primary API
        `https://api.pump.fun/dev/coins/${tokenMint}`     // Old developer API (fallback)
    ];

    const maxRetries = 3;
    let lastError = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        for (const url of endpoints) {
            try {
                const response = await axios.get(url, { 
                    timeout: 5000, // Quick timeout for fast attempts
                    headers: { 
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                        'Accept': 'application/json'
                    }
                });
                const data = response.data;

                if (!data || !data.market_id || !data.raydium_authority || !data.token_account || !data.sol_account) {
                    lastError = `Malformed data from ${url}`;
                    continue; // Malformed data, try next endpoint
                }

                console.log(`${logPrefix} ✅ Success on attempt #${attempt} from ${url.split('/')[2]}.`);
                
                return {
                    poolAddress: new PublicKey(data.market_id),
                    poolState: {
                        solReserves: BigInt(data.sol_reserves || 0),
                        tokenReserves: BigInt(data.token_reserves || 0),
                        poolAuthority: new PublicKey(data.raydium_authority),
                        tokenVault: new PublicKey(data.token_account),
                        solVault: new PublicKey(data.sol_account),
                    }
                };

            } catch (error) {
                lastError = error; // Store the last error
                if (error.response?.status === 404) {
                    // This is the expected "Not Found" error for new pools
                    console.log(`${logPrefix} ⏳ Pool not yet indexed on ${url.split('/')[2]} (404). Retrying...`);
                } else {
                    // A different error occurred (e.g., server down, timeout)
                    const status = error.response?.status || 'N/A';
                    console.warn(`${logPrefix} ⚠️ Request to ${url.split('/')[2]} failed (Status: ${status}).`);
                }
            }
        } // End of endpoint loop

        // If all endpoints failed for this attempt, wait before retrying
        if (attempt < maxRetries) {
            const delay = 500 * attempt; // 500ms, then 1000ms
            console.log(`${logPrefix} All endpoints failed on attempt #${attempt}. Waiting ${delay}ms before next retry.`);
            await require('./utils.js').sleep(delay);
        }
    } // End of retry loop

    // If we exit the loop, all retries have failed.
    console.error(`${logPrefix} ❌ All retry attempts failed. Last error: ${lastError?.message || 'Unknown'}`);
    throw new Error(`Failed to fetch Pump.fun AMM pool state for ${tokenMint} after ${maxRetries} attempts.`);
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
        let { poolId, configId, authPda, vaultA, vaultB } = swapDetails.platformSpecificData || {};
        
        // Fallback: Extract from original transaction if not available
        if ((!poolId || !configId) && swapDetails.originalTransaction) {
            console.log(`[BLUEPRINT-V2] ⚠️ Missing poolId/configId, extracting from transaction`);
            
            const txExtraction = extractTransactionData(swapDetails.originalTransaction, 'LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj');
            
            if (txExtraction.success && txExtraction.data.targetInstruction) {
                const instruction = txExtraction.data.targetInstruction.instruction;
                const accountKeys = txExtraction.data.accountKeys;
                
                // Raydium Launchpad instruction structure:
                // Index 2: configId, Index 4: poolId, Index 1: authPda, Index 7: vaultA, Index 8: vaultB
                if (instruction.accounts && instruction.accounts.length >= 9) {
                    if (!configId && accountKeys[instruction.accounts[2]]) {
                        configId = accountKeys[instruction.accounts[2]].toString();
                        console.log(`[BLUEPRINT-V2] ✅ Extracted configId from transaction: ${shortenAddress(configId)}`);
                    }
                    if (!poolId && accountKeys[instruction.accounts[4]]) {
                        poolId = accountKeys[instruction.accounts[4]].toString();
                        console.log(`[BLUEPRINT-V2] ✅ Extracted poolId from transaction: ${shortenAddress(poolId)}`);
                    }
                    if (!authPda && accountKeys[instruction.accounts[1]]) {
                        authPda = accountKeys[instruction.accounts[1]].toString();
                        console.log(`[BLUEPRINT-V2] ✅ Extracted authPda from transaction: ${shortenAddress(authPda)}`);
                    }
                    if (!vaultA && accountKeys[instruction.accounts[7]]) {
                        vaultA = accountKeys[instruction.accounts[7]].toString();
                        console.log(`[BLUEPRINT-V2] ✅ Extracted vaultA from transaction: ${shortenAddress(vaultA)}`);
                    }
                    if (!vaultB && accountKeys[instruction.accounts[8]]) {
                        vaultB = accountKeys[instruction.accounts[8]].toString();
                        console.log(`[BLUEPRINT-V2] ✅ Extracted vaultB from transaction: ${shortenAddress(vaultB)}`);
                    }
                }
            }
        }
        
        if (!poolId || !configId) {
            throw new Error("Launchpad blueprint requires both poolId and configId. Could not extract from platformSpecificData or original transaction.");
        }

        const poolIdPk = new PublicKey(poolId);
        const configIdPk = new PublicKey(configId);
        
        console.log(`[BLUEPRINT-V2] 🔍 Using data: poolId=${shortenAddress(poolId)}, configId=${shortenAddress(configId)}`);
        if (authPda) console.log(`[BLUEPRINT-V2] 🔍 Using authPda: ${shortenAddress(authPda)}`);
        if (vaultA) console.log(`[BLUEPRINT-V2] 🔍 Using vaultA: ${shortenAddress(vaultA)}`);
        if (vaultB) console.log(`[BLUEPRINT-V2] 🔍 Using vaultB: ${shortenAddress(vaultB)}`);

        const { poolInfo, configInfo } = await _getLaunchpadPoolData(connection, poolIdPk, configIdPk, cacheManager);
        await traceLogger.appendTrace(swapDetails.masterTxSignature, 'launchpad_pool_data_fetched', { status: 'OK' });
        
        const baseMint = poolInfo.mintA;
        const quoteMint = poolInfo.mintB;
        const baseMintProgram = poolInfo.mintProgramFlag === 1 ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;
        const quoteMintProgram = TOKEN_PROGRAM_ID; // Quote is always SOL (SPL)

        // STEP 2: DERIVE ALL PDAs - using the official SDK's derivation logic or extracted data
        const authPdaPk = authPda ? new PublicKey(authPda) : RaydiumV2.pda.getPdaLaunchpadAuth(programId).publicKey;
        const { publicKey: platformVault } = RaydiumV2.pda.getPdaPlatformVault(programId, poolInfo.platformId, quoteMint);
        const { publicKey: creatorVault } = RaydiumV2.pda.getPdaCreatorVault(programId, poolInfo.creator, quoteMint);
        const { publicKey: eventPda } = RaydiumV2.pda.getPdaCpiEvent(programId);
        
        // Use extracted vault data if available, otherwise use pool data
        const vaultAPk = vaultA ? new PublicKey(vaultA) : poolInfo.vaultA;
        const vaultBPk = vaultB ? new PublicKey(vaultB) : poolInfo.vaultB;
        
        console.log(`[BLUEPRINT-V2] 🔍 Using vaultA: ${shortenAddress(vaultAPk.toBase58())} (${vaultA ? 'extracted' : 'derived'})`);
        console.log(`[BLUEPRINT-V2] 🔍 Using vaultB: ${shortenAddress(vaultBPk.toBase58())} (${vaultB ? 'extracted' : 'derived'})`);

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
            { pubkey: authPdaPk, isSigner: false, isWritable: false },
            { pubkey: configIdPk, isSigner: false, isWritable: false },
            { pubkey: poolInfo.platformId, isSigner: false, isWritable: false },
            { pubkey: poolIdPk, isSigner: false, isWritable: true },
            { pubkey: userBaseTokenAta, isSigner: false, isWritable: true },
            { pubkey: userQuoteTokenAta, isSigner: false, isWritable: true },
            { pubkey: vaultAPk, isSigner: false, isWritable: true },
            { pubkey: vaultBPk, isSigner: false, isWritable: true },
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
        
        // STEP 2: PRE-CALCULATE SWAP AMOUNTS - Use SDK math helpers to determine outcome and required tick arrays
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
        
        console.log(`[RAYDIUM_CLMM_SDK] 🧮 PRE-CALCULATED AMOUNTS:`);
        console.log(`[RAYDIUM_CLMM_SDK]   📊 Input amount: ${amountBN.toString()}`);
        console.log(`[RAYDIUM_CLMM_SDK]   🪙 Expected output: ${amountOut.toString()}`);
        console.log(`[RAYDIUM_CLMM_SDK]   📋 Min amount out: ${amountOutWithSlippage.toString()}`);
        console.log(`[RAYDIUM_CLMM_SDK]   📈 Slippage: ${slippageBps} BPS`);
        
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

        // STEP 3: PRE-CALCULATE AMOUNTS - Use the SDK's battle-tested math helper.
        const { amountOut, minAmountOut } = Cpmm.computeAmountOut({
            poolState,
            amountIn: new TokenAmount(new Token(TOKEN_PROGRAM_ID, swapDetails.inputMint, poolState.baseMint.equals(swapDetails.inputMint) ? poolState.baseDecimal : poolState.quoteDecimal), amountBN),
            slippage: new Percent(slippageBps, 10000),
        });
        
        console.log(`[RAYDIUM_CPMM_SDK] 🧮 PRE-CALCULATED AMOUNTS:`);
        console.log(`[RAYDIUM_CPMM_SDK]   📊 Input amount: ${amountBN.toString()}`);
        console.log(`[RAYDIUM_CPMM_SDK]   🪙 Expected output: ${amountOut.amount.toString()}`);
        console.log(`[RAYDIUM_CPMM_SDK]   📋 Min amount out: ${minAmountOut.amount.toString()}`);
        console.log(`[RAYDIUM_CPMM_SDK]   📈 Slippage: ${slippageBps} BPS`);

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
    const { connection, userPublicKey, swapDetails, amountBN, nonceInfo = null } = builderOptions;
    
    try {
        // Validate required parameters
        if (!userPublicKey) {
            throw new Error('userPublicKey is undefined or null');
        }
        
        if (!swapDetails) {
            throw new Error('swapDetails is undefined');
        }
        
        if (!swapDetails.platformSpecificData || !swapDetails.platformSpecificData.poolId) {
            throw new Error(`Missing poolId. platformSpecificData: ${JSON.stringify(swapDetails.platformSpecificData)}`);
        }
        
        // SAFE DEBUG LOGGING: Log only the essential parts, not the circular `connection` object.
        const safeLogOptions = {
            userPublicKey: userPublicKey.toBase58(),
            hasNonce: !!nonceInfo,
            swapDetails: swapDetails // swapDetails is a simple object and safe to stringify
        };
        console.log(`[METEORA_DBC_DEBUG] Received builderOptions:`, JSON.stringify(safeLogOptions, null, 2));
        
        const isBuy = swapDetails.tradeType === 'buy';
        
        // Validate poolId before creating PublicKey
        const poolId = swapDetails.platformSpecificData.poolId;
        if (!poolId || typeof poolId !== 'string') {
            throw new Error(`Invalid poolId for Meteora DBC: ${poolId}. Expected string, got ${typeof poolId}`);
        }
        
        const poolIdPk = new PublicKey(poolId);
        
        console.log(`[METEORA_DBC_SDK] Building ${swapDetails.tradeType.toUpperCase()} for pool ${shortenAddress(poolIdPk.toBase58())}.`);

        // 1. Initialize the DBC client
        const client = new DynamicBondingCurveClient(connection, 'confirmed');

        // 2. Fetch the required pool and config states using the SDK
        const poolState = await client.pool.pool.program.account.virtualPool.fetch(poolIdPk);
        const configState = await client.pool.pool.program.account.poolConfig.fetch(poolState.config);
        
        const inAmount = amountBN;

        // 3. PRE-CALCULATE EXPECTED OUTPUT - Use SDK to get accurate quote
        let expectedOutput, minAmountOut;
        try {
            // Get quote from the SDK to calculate expected output
            const quote = await client.pool.getQuote({
                pool: poolIdPk,
                poolConfig: poolState.config,
                amountIn: inAmount,
                swapBaseForQuote: !isBuy,
            });
            
            expectedOutput = quote.amountOut;
            // Apply slippage to get minimum amount out
            const slippageBps = slippageBps || 5000; // Default 50% slippage
            minAmountOut = expectedOutput.mul(new BN(10000 - slippageBps)).div(new BN(10000));
            
            console.log(`[METEORA_DBC_SDK] 🧮 PRE-CALCULATED AMOUNTS:`);
            console.log(`[METEORA_DBC_SDK]   📊 Input amount: ${inAmount.toString()}`);
            console.log(`[METEORA_DBC_SDK]   🪙 Expected output: ${expectedOutput.toString()}`);
            console.log(`[METEORA_DBC_SDK]   📋 Min amount out: ${minAmountOut.toString()}`);
            console.log(`[METEORA_DBC_SDK]   📈 Slippage: ${slippageBps} BPS`);
        } catch (quoteError) {
            console.warn(`[METEORA_DBC_SDK] ⚠️ Could not get quote, using conservative minimum: ${quoteError.message}`);
            // Fallback to conservative estimate
            minAmountOut = new BN(1);
        }

        // 4. Use the SDK's built-in swap instruction builder with pre-calculated amounts
        const swapTransaction = await client.pool.swap({
            pool: poolIdPk,
            poolConfig: poolState.config,
            amountIn: inAmount,
            minimumAmountOut: minAmountOut,
            swapBaseForQuote: !isBuy, // If we're BUYING the base token, we are swapping QUOTE for BASE, so isBuy=true -> swapBaseForQuote=false
            owner: new PublicKey(userPublicKey),
            payer: new PublicKey(userPublicKey), // Payer and owner are the same
        });

        if (!swapTransaction) throw new Error("Meteora DBC SDK failed to generate a swap transaction.");

        // 4. Extract instructions from the transaction and inject nonce
        let instructions = swapTransaction.instructions;
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
        
        // 2. PRE-CALCULATE SWAP QUOTE - Get accurate amounts from SDK
        const swapQuote = await dlmmPool.getSwapQuote(
            inputMintPk,
            amountIn,
            slippageBps || 5000 // High default slippage for copy trades
        );
        
        console.log(`[METEORA_DLMM_SDK] 🧮 PRE-CALCULATED AMOUNTS:`);
        console.log(`[METEORA_DLMM_SDK]   📊 Input amount: ${amountIn.toString()}`);
        console.log(`[METEORA_DLMM_SDK]   🪙 Expected output: ${swapQuote.outAmount.toString()}`);
        console.log(`[METEORA_DLMM_SDK]   📋 Min amount out: ${swapQuote.minOutAmount.toString()}`);
        console.log(`[METEORA_DLMM_SDK]   📈 Slippage: ${slippageBps || 5000} BPS`);

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

        // 3. PRE-CALCULATE SWAP QUOTE - Get accurate amounts from SDK
        const quote = cpAmm.getQuote({
            inAmount: amountIn,
            inputTokenMint: new PublicKey(swapDetails.inputMint),
            slippage: (slippageBps || 1000) / 100, // SDK expects slippage as a percentage (e.g., 10 for 10%)
            poolState: poolState,
            // These are optional but good practice for advanced cases
            currentTime: Math.floor(Date.now() / 1000), 
            currentSlot: 0, // Not strictly needed for basic swaps
        });
        
        const { minSwapOutAmount, outAmount } = quote;
        
        console.log(`[METEORA_CP-AMM_SDK] 🧮 PRE-CALCULATED AMOUNTS:`);
        console.log(`[METEORA_CP-AMM_SDK]   📊 Input amount: ${amountIn.toString()}`);
        console.log(`[METEORA_CP-AMM_SDK]   🪙 Expected output: ${outAmount.toString()}`);
        console.log(`[METEORA_CP-AMM_SDK]   📋 Min amount out: ${minSwapOutAmount.toString()}`);
        console.log(`[METEORA_CP-AMM_SDK]   📈 Slippage: ${slippageBps || 1000} BPS`);
        
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

// ==========================================================
// === JUPITER FALLBACK BUILDER ===
// ==========================================================

/**
 * Jupiter fallback builder for unknown DEX platforms
 * This ensures ALL trades are copyable regardless of platform
 */
async function buildJupiterInstruction(builderOptions) {
    const { connection, userPublicKey, swapDetails, amountBN, slippageBps, apiManager } = builderOptions;

    // --- Input Validation ---
    if (!apiManager) throw new Error("Jupiter builder requires an apiManager instance.");
    if (!swapDetails.inputMint || !swapDetails.outputMint) {
        throw new Error("Jupiter builder requires inputMint and outputMint in swapDetails.");
    }

    console.log(`[JUPITER-FALLBACK] 🔄 Building Jupiter fallback for unknown DEX`);
    console.log(`[JUPITER-FALLBACK] 📍 Input: ${shortenAddress(swapDetails.inputMint)}`);
    console.log(`[JUPITER-FALLBACK] 📍 Output: ${shortenAddress(swapDetails.outputMint)}`);
    console.log(`[JUPITER-FALLBACK] 💰 Amount: ${amountBN.toString()} raw units`);

    try {
        // Convert amount to proper format for Jupiter
        const amount = amountBN.toString();
        
        // Get Jupiter swap transaction
        const jupiterTransaction = await apiManager.getSwapTransactionFromJupiter({
            inputMint: swapDetails.inputMint,
            outputMint: swapDetails.outputMint,
            amount: amount,
            userWallet: userPublicKey.toBase58(),
            slippageBps: slippageBps || 5000 // 50% default slippage for copy trades
        });

        if (!jupiterTransaction || jupiterTransaction.length === 0) {
            throw new Error("Jupiter failed to generate swap transaction");
        }

        // V6 API FIX: Handle both single object and array responses from the API manager.
        const txArray = Array.isArray(jupiterTransaction) ? jupiterTransaction : [jupiterTransaction];
        
        const instructions = [];
        for (const serializedTx of txArray) {
            try {
                // Deserialize the transaction to extract instructions
                const transaction = VersionedTransaction.deserialize(Buffer.from(serializedTx, 'base64'));
                
                // We need the full message to properly map accounts
                const message = transaction.message;
                const accountKeys = message.staticAccountKeys.concat(message.addressTableLookups.flatMap(lookup => lookup.readonly.concat(lookup.writable)));
                
                for (const compiledIx of message.compiledInstructions) {
                    // Convert compiled instruction to regular instruction format
                    const instruction = {
                        programId: accountKeys[compiledIx.programIdIndex],
                        keys: compiledIx.accounts.map(accIndex => ({
                            pubkey: accountKeys[accIndex],
                            // Correctly determine if an account is a signer or writable
                            isSigner: message.isAccountSigner(accIndex),
                            isWritable: message.isAccountWritable(accIndex),
                        })),
                        data: compiledIx.data
                    };
                    
                    instructions.push(instruction);
                }
                
                console.log(`[JUPITER-FALLBACK] ✅ Converted ${message.compiledInstructions.length} compiled instructions to regular format`);
            } catch (deserializeError) {
                console.warn(`[JUPITER-FALLBACK] ⚠️ Failed to deserialize Jupiter transaction:`, deserializeError.message);
                // If deserialization fails, we'll try to use the raw transaction
                throw new Error(`Jupiter transaction deserialization failed: ${deserializeError.message}`);
            }
        }

        if (instructions.length === 0) {
            throw new Error("No instructions extracted from Jupiter transaction");
        }

        console.log(`[JUPITER-FALLBACK] ✅ Successfully built Jupiter fallback with ${instructions.length} instructions`);
        return instructions;

    } catch (error) {
        console.error(`[JUPITER-FALLBACK] ❌ Jupiter fallback failed:`, error.message);
        throw new Error(`Jupiter fallback failed: ${error.message}`);
    }
}

/**
 * Build Pump.fun Router instruction (Router that calls Pump.fun via CPI)
 */
async function buildPumpFunRouterInstruction(swapDetails, keypair, connection) {
    console.log(`[PUMP_BUILDER_ROUTER] 🔍 Building Pump.fun Router instruction...`);
    console.log(`[PUMP_BUILDER_ROUTER] 🎯 Token: ${shortenAddress(swapDetails.outputMint)}`);
    console.log(`[PUMP_BUILDER_ROUTER] 👤 User: ${shortenAddress(keypair.publicKey.toString())}`);
    
    try {
        // For now, fall back to direct Pump.fun instruction
        // TODO: Implement proper Router instruction building
        console.log(`[PUMP_BUILDER_ROUTER] ⚠️ Router instruction not yet implemented, falling back to direct Pump.fun`);
        return await buildPumpFunInstruction(swapDetails, keypair, connection);
    } catch (error) {
        console.error(`[PUMP_BUILDER_ROUTER] ❌ Failed to build Router instruction: ${error.message}`);
        throw error;
    }
}

module.exports = {
    testRouterInstructionClone,
    buildCustomDexBuyInstruction,
    buildPumpFunInstruction,
    buildPumpFunRouterInstruction,
    buildPumpFunAmmInstruction,
    buildRaydiumInstruction,
    buildRaydiumV4Instruction,
    buildRaydiumLaunchpadInstruction,
    buildRaydiumClmmInstruction,
    buildRaydiumCpmmInstruction,
    buildMeteoraDBCInstruction,
    buildMeteoraDLMMInstruction,
    buildMeteoraCpAmmInstruction,
    buildRouterInstruction,
    createBuyExactInInstructionData,
    createSellExactInInstructionData,
    _getLaunchpadPoolData,
    getPumpAmmPoolState,
    buildJupiterInstruction
};