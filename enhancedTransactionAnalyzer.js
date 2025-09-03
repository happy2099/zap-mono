// File: enhancedTransactionAnalyzer.js
// Description: Enhanced transaction analyzer with refined data extraction for copy trades
// Uses Helius premium features for optimal performance

const { PublicKey } = require('@solana/web3.js');
const { shortenAddress } = require('./utils.js');
const config = require('./config.js');

class EnhancedTransactionAnalyzer {
    constructor() {
        this.dexPrograms = {
            // Raydium V4
            '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8': {
                name: 'Raydium V4',
                type: 'AMM',
                version: '4.0',
                features: ['concentrated_liquidity', 'dynamic_fees', 'whitelist']
            },
            // Raydium Launchpad
            'LanMV9sAd7wArD4vJFi2qfr1NYHuzeLXfQM9H24wFSUt1Mp8': {
                name: 'Raydium Launchpad',
                type: 'Launchpad',
                version: '1.0',
                features: ['token_launch', 'fair_launch', 'liquidity_lock']
            },
            // Pump.fun
            '6EF8rrecthR5DkVaGFKLkma4YkdrkvPPHoqUPLQkwQjR': {
                name: 'Pump.fun',
                type: 'DEX',
                version: '2.0',
                features: ['meme_tokens', 'anti_bot', 'auto_liquidity']
            },
            // Meteora DLMM
            'LBUZKhRxPF3XUpBCjp4cd4YfXbG6TfvB2eRCcsgAsPY': {
                name: 'Meteora DLMM',
                type: 'AMM',
                version: '1.0',
                features: ['dynamic_liquidity', 'concentrated_ranges']
            }
        };

        this.tokenMints = new Map();
        this.poolData = new Map();
    }

    /**
     * Enhanced transaction analysis with refined data for copy trades
     */
    async analyzeTransactionForCopy(transactionResponse, traderPublicKey, isWebhookData = false) {
        try {
            console.log(`[ENHANCED-ANALYZER] 🔍 Starting enhanced analysis for trader: ${shortenAddress(traderPublicKey)}`);

            // ===============================================
            // ============ STAGE 1: VALIDATION ==============
            // ===============================================
            if (!this._validateTransactionStructure(transactionResponse)) {
                return { 
                    isCopyable: false, 
                    reason: "Invalid transaction structure", 
                    rawTransaction: transactionResponse 
                };
            }

            const { meta } = transactionResponse;
            const finalTraderPk = new PublicKey(traderPublicKey);
            
            // Enhanced instruction extraction
            const instructions = this._extractInstructions(transactionResponse, isWebhookData);
            const accountKeys = this._extractAccountKeys(transactionResponse);

            // ===============================================
            // ============ STAGE 2: ENHANCED ANALYSIS ======
            // ===============================================
            console.log(`[ENHANCED-ANALYZER] 🔍 Analyzing ${instructions.length} instructions with enhanced DEX detection...`);

            let instructionAnalysis = { found: false, dexPlatform: 'Unknown', reason: 'No DEX instructions found' };
            let tradeDetails = null;
            let riskAssessment = null;

            try {
                // Enhanced instruction analysis
                instructionAnalysis = await this._analyzeInstructionsEnhanced(instructions, accountKeys);
                
                if (instructionAnalysis.found) {
                    // Enhanced trade details extraction
                    tradeDetails = await this._extractTradeDetailsEnhanced(
                        instructions, 
                        accountKeys, 
                        instructionAnalysis,
                        transactionResponse
                    );

                    // Risk assessment for copy trading
                    riskAssessment = await this._assessCopyTradeRisk(
                        tradeDetails,
                        instructionAnalysis,
                        transactionResponse
                    );
                }

            } catch (error) {
                console.log(`[ENHANCED-ANALYZER] ❌ Error during enhanced analysis:`, error.message);
                instructionAnalysis = { 
                    found: false, 
                    dexPlatform: 'Error', 
                    reason: `Analysis failed: ${error.message}` 
                };
            }

            // ===============================================
            // ============ STAGE 3: COPY TRADE DECISION ====
            // ===============================================
            const isCopyable = this._determineCopyability(
                instructionAnalysis, 
                tradeDetails, 
                riskAssessment
            );

            const analysisResult = {
                isCopyable,
                reason: isCopyable ? 'Valid copy trade detected' : this._getCopyabilityReason(instructionAnalysis, tradeDetails, riskAssessment),
                dexPlatform: instructionAnalysis.dexPlatform,
                tradeDetails,
                riskAssessment,
                instructionAnalysis,
                rawTransaction: transactionResponse,
                analysisTimestamp: Date.now(),
                traderPublicKey: traderPublicKey
            };

            console.log(`[ENHANCED-ANALYZER] ✅ Analysis complete:`, {
                isCopyable,
                dexPlatform: instructionAnalysis.dexPlatform,
                hasTradeDetails: !!tradeDetails,
                riskLevel: riskAssessment?.riskLevel || 'Unknown'
            });

            return analysisResult;

        } catch (error) {
            console.log(`[ENHANCED-ANALYZER] ❌ Fatal error in enhanced analysis:`, error.message);
            return {
                isCopyable: false,
                reason: `Fatal analysis error: ${error.message}`,
                rawTransaction: transactionResponse
            };
        }
    }

    /**
     * Enhanced instruction analysis with detailed DEX detection
     */
    async _analyzeInstructionsEnhanced(instructions, accountKeys) {
        for (const ix of instructions) {
            const programId = this._resolveProgramId(ix, accountKeys);
            if (!programId) continue;

            const programIdStr = programId.toBase58();
            console.log(`[ENHANCED-ANALYZER] 📋 Analyzing instruction with program: ${shortenAddress(programIdStr)}`);

            // Check if this is a known DEX program
            if (this.dexPrograms[programIdStr]) {
                const dexInfo = this.dexPrograms[programIdStr];
                console.log(`[ENHANCED-ANALYZER] 🎯 Found DEX program: ${dexInfo.name} (${dexInfo.type})`);

                // Enhanced DEX-specific analysis
                const dexAnalysis = await this._analyzeDexSpecific(ix, programId, dexInfo, accountKeys);
                
                return {
                    found: true,
                    dexPlatform: dexInfo.name,
                    programId: programIdStr,
                    dexInfo,
                    analysis: dexAnalysis,
                    reason: `DEX instruction detected: ${dexInfo.name}`
                };
            }
        }

        return { found: false, dexPlatform: 'Unknown', reason: 'No known DEX programs found' };
    }

    /**
     * DEX-specific instruction analysis
     */
    async _analyzeDexSpecific(instruction, programId, dexInfo, accountKeys) {
        const analysis = {
            instructionType: 'Unknown',
            accounts: [],
            data: null,
            estimatedGas: 0,
            priorityFee: 0
        };

        try {
            // Extract account information
            if (instruction.accounts && Array.isArray(instruction.accounts)) {
                analysis.accounts = instruction.accounts.map((acc, index) => {
                    const accountKey = accountKeys[acc];
                    return {
                        index,
                        publicKey: accountKey ? accountKey.toBase58() : 'Unknown',
                        isWritable: acc.isWritable || false,
                        isSigner: acc.isSigner || false
                    };
                });
            }

            // Extract instruction data
            if (instruction.data) {
                analysis.data = {
                    raw: instruction.data,
                    length: instruction.data.length,
                    decoded: this._attemptDecodeInstructionData(instruction.data, dexInfo.name)
                };
            }

            // Estimate gas and priority fees
            analysis.estimatedGas = this._estimateGasUsage(instruction, dexInfo);
            analysis.priorityFee = this._estimatePriorityFee(instruction, dexInfo);

        } catch (error) {
            console.log(`[ENHANCED-ANALYZER] ⚠️ Error in DEX-specific analysis:`, error.message);
        }

        return analysis;
    }

    /**
     * Enhanced trade details extraction
     */
    async _extractTradeDetailsEnhanced(instructions, accountKeys, instructionAnalysis, transactionResponse) {
        const tradeDetails = {
            dexPlatform: instructionAnalysis.dexPlatform,
            instructionType: instructionAnalysis.analysis?.instructionType || 'Unknown',
            accounts: instructionAnalysis.analysis?.accounts || [],
            estimatedGas: instructionAnalysis.analysis?.estimatedGas || 0,
            priorityFee: instructionAnalysis.analysis?.priorityFee || 0,
            timestamp: Date.now(),
            signature: transactionResponse.transaction?.signatures?.[0] || 'Unknown',
            blockTime: transactionResponse.blockTime || Date.now() / 1000,
            fee: transactionResponse.meta?.fee || 0,
            success: transactionResponse.meta?.err === null
        };

        // Extract token information if available
        if (instructionAnalysis.analysis?.accounts) {
            tradeDetails.tokens = this._extractTokenInformation(
                instructionAnalysis.analysis.accounts,
                accountKeys
            );
        }

        return tradeDetails;
    }

    /**
     * Risk assessment for copy trading
     */
    async _assessCopyTradeRisk(tradeDetails, instructionAnalysis, transactionResponse) {
        const riskFactors = [];
        let riskScore = 0;

        // Check transaction success
        if (!tradeDetails.success) {
            riskFactors.push('Transaction failed');
            riskScore += 50;
        }

        // Check gas usage
        if (tradeDetails.estimatedGas > 200000) {
            riskFactors.push('High gas usage');
            riskScore += 20;
        }

        // Check priority fees
        if (tradeDetails.priorityFee > 100000) {
            riskFactors.push('High priority fees');
            riskScore += 15;
        }

        // Check DEX platform
        if (tradeDetails.dexPlatform === 'Pump.fun') {
            riskFactors.push('Meme token platform');
            riskScore += 25;
        }

        // Determine risk level
        let riskLevel = 'Low';
        if (riskScore >= 50) riskLevel = 'High';
        else if (riskScore >= 25) riskLevel = 'Medium';

        return {
            riskLevel,
            riskScore,
            riskFactors,
            recommendations: this._getRiskRecommendations(riskLevel, riskFactors)
        };
    }

    /**
     * Get risk mitigation recommendations
     */
    _getRiskRecommendations(riskLevel, riskFactors) {
        const recommendations = [];

        if (riskLevel === 'High') {
            recommendations.push('Consider reducing copy trade amount');
            recommendations.push('Monitor transaction closely');
            recommendations.push('Set stop-loss if applicable');
        } else if (riskLevel === 'Medium') {
            recommendations.push('Use moderate copy trade amount');
            recommendations.push('Monitor for unusual activity');
        } else {
            recommendations.push('Safe for normal copy trading');
        }

        return recommendations;
    }

    /**
     * Determine if transaction is copyable
     */
    _determineCopyability(instructionAnalysis, tradeDetails, riskAssessment) {
        if (!instructionAnalysis.found) return false;
        if (!tradeDetails) return false;
        if (riskAssessment?.riskLevel === 'High') return false;
        if (!tradeDetails.success) return false;

        return true;
    }

    /**
     * Get copyability reason
     */
    _getCopyabilityReason(instructionAnalysis, tradeDetails, riskAssessment) {
        if (!instructionAnalysis.found) return 'No DEX instructions found';
        if (!tradeDetails) return 'Trade details extraction failed';
        if (riskAssessment?.riskLevel === 'High') return 'Risk level too high for copy trading';
        if (!tradeDetails.success) return 'Transaction failed';

        return 'Unknown reason';
    }

    // Helper methods
    _validateTransactionStructure(transactionResponse) {
        if (!transactionResponse?.transaction) return false;
        if (!transactionResponse?.meta) return false;
        return true;
    }

    _extractInstructions(transactionResponse, isWebhookData) {
        try {
            if (isWebhookData) {
                return transactionResponse.transaction.instructions || [];
            } else {
                return transactionResponse.transaction.message.instructions || [];
            }
        } catch (error) {
            console.log(`[ENHANCED-ANALYZER] ⚠️ Error extracting instructions:`, error.message);
            return [];
        }
    }

    _extractAccountKeys(transactionResponse) {
        try {
            const rawAccountKeys = transactionResponse.transaction.message.accountKeys;
            if (!Array.isArray(rawAccountKeys)) return [];

            return rawAccountKeys.map(key => {
                if (key && key.pubkey) return new PublicKey(key.pubkey);
                if (key instanceof PublicKey) return key;
                return new PublicKey(key);
            });
        } catch (error) {
            console.log(`[ENHANCED-ANALYZER] ⚠️ Error extracting account keys:`, error.message);
            return [];
        }
    }

    _resolveProgramId(instruction, accountKeys) {
        try {
            if (instruction.programIdIndex !== undefined) {
                return accountKeys[instruction.programIdIndex];
            }
            if (instruction.programId) {
                return new PublicKey(instruction.programId);
            }
            return null;
        } catch (error) {
            return null;
        }
    }

    _attemptDecodeInstructionData(data, dexName) {
        // Basic hex decoding - can be enhanced with specific DEX decoders
        try {
            return {
                hex: data,
                length: data.length,
                decoded: 'Basic hex data (enhance with DEX-specific decoders)'
            };
        } catch (error) {
            return { error: error.message };
        }
    }

    _estimateGasUsage(instruction, dexInfo) {
        // Basic gas estimation - can be enhanced with historical data
        const baseGas = 200000;
        const accountMultiplier = instruction.accounts?.length || 1;
        return Math.floor(baseGas * accountMultiplier * 0.8);
    }

    _estimatePriorityFee(instruction, dexInfo) {
        // Basic priority fee estimation
        return 10000; // 0.00001 SOL
    }

    _extractTokenInformation(accounts, accountKeys) {
        // Extract token mint addresses from accounts
        const tokens = [];
        for (const account of accounts) {
            if (account.publicKey && account.publicKey !== 'Unknown') {
                tokens.push({
                    publicKey: account.publicKey,
                    isWritable: account.isWritable,
                    isSigner: account.isSigner
                });
            }
        }
        return tokens;
    }
}

module.exports = { EnhancedTransactionAnalyzer };
