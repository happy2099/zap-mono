// REPLACE THE ENTIRETY of map.js with this code.

const { shortenAddress } = require('./utils.js');
const { Buffer } = require('buffer');

function _formatDataDisplay(data) {
    if (!data) return 'empty';
    if (typeof data === 'string') return `${data.substring(0, 20)}...`;
    if (Buffer.isBuffer(data)) return `${data.toString('hex').substring(0, 20)}... (hex)`;
    if (Array.isArray(data)) return `${data.slice(0, 10).join(',')}... (bytes)`;
    return 'unknown format';
}

class DataMapper {
    constructor() {
        this.mappingLog = [];
        this.performanceMetrics = {
            detectionTime: null,
            normalizationTime: null,
            analysisTime: null,
            cloningTime: null,
            executionTime: null,
            totalLatency: null
        };
    }

    logCompleteMapping(rawHeliusData, normalizedData, tradeDetails, clonedInstructions, finalTransaction = null) {
        try {
            console.log(`\n🗺️ MAPPING STARTED FOR: ${rawHeliusData?.signature || 'unknown'}`);
            const startTime = Date.now();
            
            // Calculate byte volume for cloned instructions
            const byteVolume = this._calculateByteVolume(clonedInstructions);
            
            // Calculate latency metrics
            const latencyMetrics = this._calculateLatencyMetrics(rawHeliusData, finalTransaction);
            
            const mapping = {
                timestamp: new Date().toISOString(),
                signature: rawHeliusData?.signature || 'unknown',
                flow: {
                    stage1_detection: 'LaserStream gRPC → TraderMonitorWorker',
                    stage2_normalization: 'Raw Data → Normalized Transaction',
                    stage3_analysis: 'Universal Analyzer → Trade Detection',
                    stage4_cloning: 'Universal Cloner → User Instructions',
                    stage5_execution: 'Direct Solana Sender → Blockchain'
                },
                performance: {
                    byteVolume: byteVolume,
                    latency: latencyMetrics,
                    injectionStatus: this._verifyInjectionStatus(finalTransaction)
                },
                stages: {
                    raw: this._mapRawData(rawHeliusData),
                    normalized: this._mapNormalizedData(normalizedData),
                    analyzed: this._mapTradeDetails(tradeDetails),
                    cloned: this._mapClonedInstructions(clonedInstructions),
                    final: finalTransaction ? this._mapFinalTransaction(finalTransaction) : null
                }
            };

            this.mappingLog.push(mapping);
            this._printMapping(mapping);
            return mapping;
        } catch (e) {
            console.error(`[MAPPING-CRASH] The logger itself crashed while trying to map data. This is a critical display bug.`, { error: e.message, stack: e.stack });
        }
    }

    // =======================================================
    // ================ THE HARDENED FIX =====================
    // =======================================================
    _mapRawData(rawData) {
        if (!rawData) return { error: 'No raw data provided' };
        
        const message = rawData.transaction?.message || rawData.message || {};
        
        // PARANOID CHECK: Find the account keys wherever they might be.
        const accountKeysArray = message.accountKeys || rawData.accountKeys || [];

        return {
            signature: rawData.signature,
            // THIS IS THE FIX: We use the accountKeysArray we found above.
            accountKeysCount: accountKeysArray.length, 
            instructions: (message.instructions || []).map(ix => ({
                programIdIndex: ix.programIdIndex,
                accountsCount: ix.accounts?.length || 0,
                data: _formatDataDisplay(ix.data)
            }))
        };
    }
    
    _mapNormalizedData(normalizedData) {
        // Now this will also work correctly.
        return this._mapRawData(normalizedData);
    }

    _mapTradeDetails(tradeDetails) {
        if (!tradeDetails) return { error: 'No trade details provided' };

        // Enhanced DEX platform detection
        let dexPlatform = tradeDetails.dexPlatform || 'Unknown';
        
        // Try to identify DEX from program IDs in the transaction
        if (tradeDetails.dexPlatform === 'Unknown' && tradeDetails.originalTransaction) {
            const instructions = tradeDetails.originalTransaction.instructions || [];
            for (const ix of instructions) {
                const programId = tradeDetails.originalTransaction.accountKeys?.[ix.programIdIndex];
                if (programId) {
                    if (programId.includes('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P')) {
                        dexPlatform = 'Pump.fun BC';
                        break;
                    } else if (programId.includes('pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA')) {
                        dexPlatform = 'Pump.fun AMM';
                        break;
                    } else if (programId.includes('675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8')) {
                        dexPlatform = 'Raydium V4';
                        break;
                    } else if (programId.includes('LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj')) {
                        dexPlatform = 'Raydium Launchpad';
                        break;
                    } else if (programId.includes('CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C')) {
                        dexPlatform = 'Raydium CPMM';
                        break;
                    } else if (programId.includes('CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK')) {
                        dexPlatform = 'Raydium CLMM';
                        break;
                    } else if (programId.includes('JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4')) {
                        dexPlatform = 'Jupiter';
                        break;
                    } else if (programId.includes('whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc')) {
                        dexPlatform = 'Whirlpool';
                        break;
                    }
                }
            }
        }

        return {
            tradeType: tradeDetails.tradeType,
            traderPubkey: shortenAddress(tradeDetails.traderPubkey),
            inputMint: shortenAddress(tradeDetails.inputMint),
            outputMint: shortenAddress(tradeDetails.outputMint),
            dexPlatform: dexPlatform,
            amount: tradeDetails.amount || 'N/A',
            solSpent: tradeDetails.solSpent || 0
        };
    }

    _mapClonedInstructions(clonedInstructions) {
        if (!clonedInstructions) return { error: 'No cloned instructions provided' };

        return {
            count: clonedInstructions.length,
            instructions: clonedInstructions.map((ix, index) => ({
                index,
                programId: shortenAddress(ix.programId.toBase58()),
                accounts: ix.keys.map(acc => ({
                    pubkey: shortenAddress(acc.pubkey.toBase58()),
                    isSigner: acc.isSigner,
                    isWritable: acc.isWritable
                })),
                data: _formatDataDisplay(ix.data)
            }))
        };
    }

    _mapFinalTransaction(finalTransaction) {
        if (!finalTransaction) return null;
        return {
            success: finalTransaction.success,
            signature: finalTransaction.signature,
            error: finalTransaction.error || null
        };
    }

    // =======================================================
    // ================ PERFORMANCE MONITORING ===============
    // =======================================================
    
    _calculateByteVolume(clonedInstructions) {
        if (!clonedInstructions) return { totalBytes: 0, instructionCount: 0, averageBytes: 0 };
        
        let totalBytes = 0;
        const instructionBytes = [];
        
        clonedInstructions.forEach((ix, index) => {
            let instructionSize = 0;
            
            // Calculate instruction data size
            if (ix.data) {
                if (Buffer.isBuffer(ix.data)) {
                    instructionSize += ix.data.length;
                } else if (typeof ix.data === 'string') {
                    instructionSize += Buffer.byteLength(ix.data, 'utf8');
                } else if (Array.isArray(ix.data)) {
                    instructionSize += ix.data.length;
                }
            }
            
            // Add account overhead (32 bytes per account + metadata)
            instructionSize += (ix.keys?.length || 0) * 32;
            
            // Add program ID overhead (32 bytes)
            instructionSize += 32;
            
            instructionBytes.push({
                index: index,
                programId: shortenAddress(ix.programId.toBase58()),
                accounts: ix.keys?.length || 0,
                dataBytes: ix.data ? (Buffer.isBuffer(ix.data) ? ix.data.length : Buffer.byteLength(String(ix.data), 'utf8')) : 0,
                totalBytes: instructionSize
            });
            
            totalBytes += instructionSize;
        });
        
        return {
            totalBytes: totalBytes,
            instructionCount: clonedInstructions.length,
            averageBytes: clonedInstructions.length > 0 ? Math.round(totalBytes / clonedInstructions.length) : 0,
            instructionBreakdown: instructionBytes,
            sizeCategory: this._categorizeTransactionSize(totalBytes)
        };
    }
    
    _categorizeTransactionSize(totalBytes) {
        if (totalBytes < 1000) return 'SMALL';
        if (totalBytes < 5000) return 'MEDIUM';
        if (totalBytes < 10000) return 'LARGE';
        return 'MASSIVE';
    }
    
    _calculateLatencyMetrics(rawHeliusData, finalTransaction) {
        const now = Date.now();
        
        // Try multiple sources for blockTime
        let blockTime = null;
        if (rawHeliusData?.blockTime) {
            blockTime = rawHeliusData.blockTime * 1000;
        } else if (rawHeliusData?.transaction?.blockTime) {
            blockTime = rawHeliusData.transaction.blockTime * 1000;
        } else if (rawHeliusData?.meta?.blockTime) {
            blockTime = rawHeliusData.meta.blockTime * 1000;
        }
        
        // If still no blockTime, use current time as fallback for relative timing
        if (!blockTime) {
            return {
                detectionToExecution: 'N/A',
                blockTimeToExecution: 'N/A',
                executionLatency: 'N/A',
                blockTime: 'N/A',
                currentTime: new Date(now).toISOString(),
                status: 'NO_BLOCKTIME_DATA',
                performanceGrade: 'N/A',
                note: 'Block time not available in transaction data'
            };
        }
        
        const detectionToExecution = finalTransaction ? (now - blockTime) : 'PENDING';
        const blockTimeToExecution = finalTransaction ? (now - blockTime) : 'PENDING';
        const executionLatency = finalTransaction ? (now - blockTime) : 'PENDING';
        
        return {
            detectionToExecution: detectionToExecution,
            blockTimeToExecution: blockTimeToExecution,
            executionLatency: executionLatency,
            blockTime: new Date(blockTime).toISOString(),
            currentTime: new Date(now).toISOString(),
            status: finalTransaction ? 'COMPLETED' : 'PENDING',
            performanceGrade: this._gradePerformance(executionLatency)
        };
    }
    
    _gradePerformance(latency) {
        if (latency === 'PENDING' || latency === 'N/A') return 'PENDING';
        if (latency < 1000) return 'EXCELLENT';
        if (latency < 2000) return 'GOOD';
        if (latency < 5000) return 'FAIR';
        return 'SLOW';
    }
    
    _verifyInjectionStatus(finalTransaction) {
        if (!finalTransaction) {
            return {
                status: 'NOT_INJECTED',
                signature: null,
                success: false,
                error: 'No transaction result available'
            };
        }
        
        return {
            status: finalTransaction.success ? 'INJECTED_SUCCESS' : 'INJECTION_FAILED',
            signature: finalTransaction.signature,
            success: finalTransaction.success,
            error: finalTransaction.error || null,
            verification: this._verifyTransactionIntegrity(finalTransaction)
        };
    }
    
    _verifyTransactionIntegrity(finalTransaction) {
        if (!finalTransaction.success) {
            return {
                integrity: 'FAILED',
                reason: finalTransaction.error || 'Unknown error',
                recommendation: 'Check error logs for details'
            };
        }
        
        if (!finalTransaction.signature) {
            return {
                integrity: 'SUSPICIOUS',
                reason: 'Success but no signature',
                recommendation: 'Investigate transaction submission'
            };
        }
        
        return {
            integrity: 'VERIFIED',
            reason: 'Transaction successfully injected with valid signature',
            recommendation: 'Monitor for confirmation'
        };
    }

    _printMapping(mapping) {
        // Clear some space for better visibility
        console.log('\n\n' + '='.repeat(80));
        console.log(`🗺️  DATA MAPPING FOR SIGNATURE: ${mapping.signature}`);
        console.log('='.repeat(80));

        // =======================================================
        // ================ PERFORMANCE METRICS ==================
        // =======================================================
        console.log('\n🚀 PERFORMANCE METRICS');
        console.log('-'.repeat(40));
        
        // Byte Volume Analysis
        const byteVol = mapping.performance.byteVolume;
        console.log(`📊 TRANSACTION SIZE: ${byteVol.totalBytes} bytes (${byteVol.sizeCategory})`);
        console.log(`📋 Instructions: ${byteVol.instructionCount} | Avg: ${byteVol.averageBytes} bytes/ix`);
        
        // Latency Analysis
        const latency = mapping.performance.latency;
        console.log(`⏱️  EXECUTION LATENCY: ${latency.executionLatency} (${latency.performanceGrade})`);
        console.log(`🕐 Block Time: ${latency.blockTime || 'N/A'}`);
        console.log(`🕐 Current Time: ${latency.currentTime || 'N/A'}`);
        if (latency.note) {
            console.log(`📝 Note: ${latency.note}`);
        }
        
        // Injection Status
        const injection = mapping.performance.injectionStatus;
        console.log(`💉 INJECTION STATUS: ${injection.status}`);
        if (injection.signature) console.log(`🔑 Signature: ${injection.signature}`);
        if (injection.verification) {
            console.log(`✅ Integrity: ${injection.verification.integrity}`);
            console.log(`📝 Reason: ${injection.verification.reason}`);
        }
        
        // =======================================================
        // ================ DETAILED BREAKDOWN ===================
        // =======================================================
        console.log('\n📥 STAGE 1 & 2: RAW / NORMALIZED DATA');
        console.log('-'.repeat(40));
        console.log(`Total Account Keys: ${mapping.stages.raw.accountKeysCount}`); 

        console.log('\n🔍 STAGE 3: ANALYZED TRADE');
        console.log('-'.repeat(40));
        console.log(`Trade Type: ${mapping.stages.analyzed.tradeType} on ${mapping.stages.analyzed.dexPlatform}`);
        console.log(`Input: ${mapping.stages.analyzed.inputMint}, Output: ${mapping.stages.analyzed.outputMint}`);
        
        console.log('\n⚡ STAGE 4: CLONED INSTRUCTIONS (Final Blueprint)');
        console.log('-'.repeat(40));
        console.log(`Final Cloned Count: ${mapping.stages.cloned.count}`);
        
        // Show byte breakdown for each instruction
        if (byteVol.instructionBreakdown) {
            console.log('\n📊 INSTRUCTION BYTE BREAKDOWN:');
            byteVol.instructionBreakdown.forEach(ix => {
                console.log(`  [${ix.index}] ${ix.programId}: ${ix.totalBytes} bytes (${ix.accounts} accounts, ${ix.dataBytes} data)`);
            });
        }
        
        // Show detailed cloned instructions with proper alignment
        mapping.stages.cloned.instructions?.forEach((ix) => {
            console.log(`\n  [${ix.index}] Program: ${ix.programId}`);
            ix.accounts.forEach(acc => {
                const signer = acc.isSigner ? 'SIGNER' : '';
                const writable = acc.isWritable ? 'WRITABLE' : '';
                const signerPadding = signer ? 'SIGNER  ' : '        ';
                const writablePadding = writable ? 'WRITABLE' : '        ';
                console.log(`      -> Account: ${acc.pubkey.padEnd(12)} ${signerPadding}${writablePadding}`);
            });
        });
        
        if (mapping.stages.final) {
            console.log('\n🎯 STAGE 5: FINAL RESULT');
            console.log('-'.repeat(40));
            console.log(`Success: ${mapping.stages.final.success}`);
            if (mapping.stages.final.signature) console.log(`Signature: ${mapping.stages.final.signature}`);
            if (mapping.stages.final.error) console.log(`Error: ${mapping.stages.final.error}`);
        }
        
        // =======================================================
        // ================ PERFORMANCE SUMMARY ==================
        // =======================================================
        console.log('\n📈 PERFORMANCE SUMMARY');
        console.log('-'.repeat(40));
        console.log(`🎯 Total Latency: ${latency.executionLatency}`);
        console.log(`📦 Transaction Size: ${byteVol.totalBytes} bytes (${byteVol.sizeCategory})`);
        console.log(`💉 Injection: ${injection.status}`);
        console.log(`🏆 Grade: ${latency.performanceGrade}`);
        
        console.log('\n' + '='.repeat(80) + '\n');
    }

    exportToFile(filename = 'mapping-log.json') {
        const fs = require('fs');
        const path = require('path');
        const logDir = path.join(__dirname, 'logs');
        if (!fs.existsSync(logDir)) {
            fs.mkdirSync(logDir);
        }
        const filePath = path.join(logDir, filename);
        fs.writeFileSync(filePath, JSON.stringify(this.mappingLog, null, 2), 'utf-8');
        console.log(`[MAPPING] Exported complete mapping log to ${filePath}`);
    }
}

// Quick mapping utility for granular logging
const quickMap = {
    /**
     * Map raw Helius instruction to show what we're cloning
     */
    rawInstruction: (rawIx, accountKeys) => {
        console.log('\n🔍 RAW INSTRUCTION MAPPING:');
        console.log(`Program ID Index: ${rawIx.programIdIndex}`);
        console.log(`Program ID: ${shortenAddress(accountKeys[rawIx.programIdIndex])}`);
        console.log(`Accounts: [${rawIx.accounts?.join(', ') || 'none'}]`);
        
        // Handle different data types safely
        let dataDisplay = 'empty';
        if (rawIx.data) {
            if (typeof rawIx.data === 'string') {
                dataDisplay = `${rawIx.data.substring(0, 40)}...`;
            } else if (Buffer.isBuffer(rawIx.data)) {
                dataDisplay = `${rawIx.data.toString('hex').substring(0, 40)}...`;
            } else {
                dataDisplay = `${String(rawIx.data).substring(0, 40)}...`;
            }
        }
        console.log(`Data: ${dataDisplay}`);
    },

    /**
     * Map forging process
     */
    forging: (originalAccount, forgedAccount, reason) => {
        console.log(`\n🔄 FORGING: ${shortenAddress(originalAccount)} → ${shortenAddress(forgedAccount)} (${reason})`);
    },

    /**
     * Map cloned instruction with correct account details
     */
    clonedInstruction: (clonedInstruction, index) => {
        // 🔧 FIX: Check if programId exists before calling toBase58()
        const programIdStr = clonedInstruction.programId ? 
            shortenAddress(clonedInstruction.programId.toBase58()) : 
            'UNKNOWN';
        console.log(`\n  [${index}] Program: ${programIdStr}`);
        
        // Show actual account details with proper alignment
        if (clonedInstruction.keys && Array.isArray(clonedInstruction.keys)) {
            clonedInstruction.keys.forEach((acc, i) => {
                const signer = acc.isSigner ? 'SIGNER' : '';
                const writable = acc.isWritable ? 'WRITABLE' : '';
                const signerPadding = signer ? 'SIGNER  ' : '        ';
                const writablePadding = writable ? 'WRITABLE' : '        ';
                console.log(`      -> Account: ${shortenAddress(acc.pubkey.toBase58()).padEnd(12)} ${signerPadding}${writablePadding}`);
            });
        }
        
        // Handle data safely
        let dataDisplay = 'empty';
        if (clonedInstruction.data) {
            if (Buffer.isBuffer(clonedInstruction.data)) {
                dataDisplay = `${clonedInstruction.data.toString('hex').substring(0, 20)}...`;
            } else {
                dataDisplay = `${String(clonedInstruction.data).substring(0, 20)}...`;
            }
        }
        console.log(`      Data: ${dataDisplay}`);
    },

    /**
     * Map the complete detection to execution flow
     */
    completeFlow: (signature, traderName, tradeType, dexPlatform) => {
        console.log('\n🔄 COMPLETE DETECTION → EXECUTION FLOW MAPPING');
        console.log('='.repeat(60));
        console.log(`📡 STAGE 1 (DETECTION): LaserStream gRPC → TraderMonitorWorker`);
        console.log(`   └─ Signature: ${signature}`);
        console.log(`   └─ Trader: ${traderName}`);
        console.log(`   └─ Trade Type: ${tradeType}`);
        console.log(`   └─ Platform: ${dexPlatform}`);
        
        console.log(`\n🔄 STAGE 2 (NORMALIZATION): Raw Data → Normalized Transaction`);
        console.log(`   └─ Account Keys: Expanded with ALT (Address Lookup Tables)`);
        console.log(`   └─ Instructions: Parsed and validated`);
        console.log(`   └─ Balances: Pre/Post token and SOL balances`);
        
        console.log(`\n🔍 STAGE 3 (ANALYSIS): Universal Analyzer → Trade Detection`);
        console.log(`   └─ Economic Analysis: SOL and token balance changes`);
        console.log(`   └─ Platform Detection: DEX identification`);
        console.log(`   └─ Trade Classification: BUY/SELL determination`);
        
        console.log(`\n⚡ STAGE 4 (CLONING): Universal Cloner → User Instructions`);
        console.log(`   └─ Account Forging: Trader accounts → User accounts`);
        console.log(`   └─ Amount Scaling: User-specific trade amounts`);
        console.log(`   └─ Instruction Reconstruction: Platform-specific data`);
        
        console.log(`\n🚀 STAGE 5 (EXECUTION): Direct Solana Sender → Blockchain`);
        console.log(`   └─ Transaction Building: Final transaction assembly`);
        console.log(`   └─ Signing: User keypair signing`);
        console.log(`   └─ Submission: RPC transaction submission`);
        console.log('='.repeat(60));
    }
};

module.exports = { DataMapper, quickMap };