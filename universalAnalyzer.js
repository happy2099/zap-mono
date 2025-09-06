// ==========================================
// Universal Transaction Analyzer - Core Swap Instruction Finder
// ==========================================
// File: universalAnalyzer.js
// Description: Finds the core swap instruction to clone, regardless of platform

const { Connection, PublicKey, LAMPORTS_PER_SOL } = require('@solana/web3.js');
const config = require('./config.js');
const { shortenAddress } = require('./utils.js');

class UniversalAnalyzer {
    constructor(connection) {
        this.connection = connection;
        this.platformIds = config.PLATFORM_IDS;
    }

    /**
     * Main analysis function - finds the core swap instruction to clone
     */
    async analyzeTransaction(transactionResponse, masterTraderWallet) {
        try {
            console.log(`[UNIVERSAL-ANALYZER] 🔍 Analyzing transaction for core swap instruction...`);
            
            // Step 1: Check if this is a copyable trade (balance changes)
            const balanceAnalysis = await this._analyzeBalanceChanges(transactionResponse);
            if (!balanceAnalysis.isCopyable) {
                return {
                    isCopyable: false,
                    reason: balanceAnalysis.reason
                };
            }

            console.log(`[UNIVERSAL-ANALYZER] ✅ Trade is copyable: ${balanceAnalysis.tradeType}`);
            console.log(`[UNIVERSAL-ANALYZER] 💰 Input: ${balanceAnalysis.inputMint} → Output: ${balanceAnalysis.outputMint}`);

            // Step 2: Find the core swap instruction
            const coreInstruction = await this._findCoreSwapInstruction(
                transactionResponse, 
                masterTraderWallet,
                balanceAnalysis
            );

            if (!coreInstruction) {
                return {
                    isCopyable: false,
                    reason: "Could not identify core swap instruction"
                };
            }

            console.log(`[UNIVERSAL-ANALYZER] 🎯 Found core swap instruction:`, {
                programId: shortenAddress(coreInstruction.programId),
                accountCount: coreInstruction.accounts.length,
                dataLength: coreInstruction.data.length
            });

            // Step 3: Return the structured cloning target
            return {
                isCopyable: true,
                tradeType: balanceAnalysis.tradeType,
                inputMint: balanceAnalysis.inputMint,
                outputMint: balanceAnalysis.outputMint,
                inputAmount: balanceAnalysis.inputAmount,
                outputAmount: balanceAnalysis.outputAmount,
                cloningTarget: {
                    programId: coreInstruction.programId,
                    accounts: coreInstruction.accounts,
                    data: coreInstruction.data,
                    isSigner: coreInstruction.isSigner,
                    isWritable: coreInstruction.isWritable
                },
                masterTraderWallet: masterTraderWallet,
                originalTransaction: transactionResponse
            };

        } catch (error) {
            console.error(`[UNIVERSAL-ANALYZER] ❌ Analysis failed:`, error.message);
            return {
                isCopyable: false,
                reason: `Analysis error: ${error.message}`
            };
        }
    }

    /**
     * Analyze balance changes to determine if trade is copyable
     */
    async _analyzeBalanceChanges(transactionResponse) {
        try {
            const meta = transactionResponse.meta;
            const preBalances = meta.preBalances || [];
            const postBalances = meta.postBalances || [];
            const accountKeys = transactionResponse.transaction.message.accountKeys || [];

            if (preBalances.length !== postBalances.length) {
                return { isCopyable: false, reason: "Balance arrays length mismatch" };
            }

            // Find significant balance changes
            let maxSOLChange = 0;
            let maxSOLChangeIndex = -1;
            let tokenChanges = [];

            for (let i = 0; i < preBalances.length; i++) {
                const change = postBalances[i] - preBalances[i];
                
                // Check for SOL changes
                if (Math.abs(change) > maxSOLChange) {
                    maxSOLChange = Math.abs(change);
                    maxSOLChangeIndex = i;
                }

                // Check for token changes (non-SOL accounts)
                if (change !== 0 && accountKeys[i] !== 'So11111111111111111111111111111111111111112') {
                    tokenChanges.push({
                        account: accountKeys[i],
                        change: change,
                        index: i
                    });
                }
            }

            // Determine trade type and mints
            if (maxSOLChange > 1000000) { // More than 0.001 SOL change
                const isBuy = postBalances[maxSOLChangeIndex] > preBalances[maxSOLChangeIndex];
                
                if (isBuy) {
                    // SOL → Token (BUY)
                    const tokenChange = tokenChanges.find(tc => tc.change > 0);
                    if (tokenChange) {
                        return {
                            isCopyable: true,
                            tradeType: 'buy',
                            inputMint: 'So11111111111111111111111111111111111111112', // SOL
                            outputMint: tokenChange.account,
                            inputAmount: maxSOLChange,
                            outputAmount: tokenChange.change
                        };
                    }
                } else {
                    // Token → SOL (SELL)
                    const tokenChange = tokenChanges.find(tc => tc.change < 0);
                    if (tokenChange) {
                        return {
                            isCopyable: true,
                            tradeType: 'sell',
                            inputMint: tokenChange.account,
                            outputMint: 'So11111111111111111111111111111111111111112', // SOL
                            inputAmount: Math.abs(tokenChange.change),
                            outputAmount: maxSOLChange
                        };
                    }
                }
            }

            return { isCopyable: false, reason: "No significant balance changes detected" };

        } catch (error) {
            console.error(`[UNIVERSAL-ANALYZER] ❌ Balance analysis failed:`, error.message);
            return { isCopyable: false, reason: `Balance analysis error: ${error.message}` };
        }
    }

    /**
     * Find the core swap instruction using heuristics
     * PRIORITY: Router detection first, then other DEXs
     */
    async _findCoreSwapInstruction(transactionResponse, masterTraderWallet, balanceAnalysis) {
        try {
            const instructions = transactionResponse.transaction.message.instructions || [];
            const accountKeys = transactionResponse.transaction.message.accountKeys || [];

            console.log(`[UNIVERSAL-ANALYZER] 🔍 Searching through ${instructions.length} instructions...`);

            // PRIORITY 1: Look for Router first (F5tfvb...)
            for (let i = 0; i < instructions.length; i++) {
                const instruction = instructions[i];
                const programId = accountKeys[instruction.programIdIndex];
                
                console.log(`[UNIVERSAL-ANALYZER] 🔍 Checking instruction ${i}:`, {
                    programId: shortenAddress(programId),
                    accountCount: instruction.accounts.length
                });

                // Check if this is the Router program
                if (programId === 'F5tfvbLog9VdGUPqBDTT8rgXvTTcq7e5UiGnupL1zvBq') {
                    console.log(`[UNIVERSAL-ANALYZER] 🎯 Found Router instruction at index ${i}`);
                    
                    // Verify master trader is a signer
                    const isSigner = instruction.accounts.some(accountIndex => {
                        const account = accountKeys[accountIndex];
                        return account === masterTraderWallet;
                    });

                    if (isSigner) {
                        console.log(`[UNIVERSAL-ANALYZER] ✅ Router instruction confirmed with master trader as signer`);
                        
                        return {
                            programId: programId,
                            accounts: instruction.accounts.map(accountIndex => ({
                                pubkey: accountKeys[accountIndex],
                                isSigner: accountIndex === 0, // First account is usually signer
                                isWritable: true // Assume writable for now
                            })),
                            data: instruction.data,
                            isSigner: true,
                            isWritable: true,
                            instructionIndex: i,
                            platform: 'Router'
                        };
                    }
                }
            }

            // PRIORITY 2: Look for other known DEX programs
            for (let i = 0; i < instructions.length; i++) {
                const instruction = instructions[i];
                const programId = accountKeys[instruction.programIdIndex];
                
                // Check if master trader is a signer
                const isSigner = instruction.accounts.some(accountIndex => {
                    const account = accountKeys[accountIndex];
                    return account === masterTraderWallet;
                });

                if (isSigner) {
                    console.log(`[UNIVERSAL-ANALYZER] ✅ Found signer instruction at index ${i}`);
                    
                    // Check if it's a known DEX/Router
                    const isKnownDex = this._isKnownDexProgram(programId);
                    
                    if (isKnownDex) {
                        console.log(`[UNIVERSAL-ANALYZER] ✅ Confirmed as known DEX/Router: ${isKnownDex}`);
                        
                        return {
                            programId: programId,
                            accounts: instruction.accounts.map(accountIndex => ({
                                pubkey: accountKeys[accountIndex],
                                isSigner: accountIndex === 0,
                                isWritable: true
                            })),
                            data: instruction.data,
                            isSigner: true,
                            isWritable: true,
                            instructionIndex: i,
                            platform: isKnownDex
                        };
                    }
                }
            }

            // PRIORITY 3: Fallback - any known DEX program
            for (let i = 0; i < instructions.length; i++) {
                const instruction = instructions[i];
                const programId = accountKeys[instruction.programIdIndex];
                
                const isKnownDex = this._isKnownDexProgram(programId);
                if (isKnownDex) {
                    console.log(`[UNIVERSAL-ANALYZER] ✅ Found known DEX program at index ${i} (fallback)`);
                    
                    return {
                        programId: programId,
                        accounts: instruction.accounts.map(accountIndex => ({
                            pubkey: accountKeys[accountIndex],
                            isSigner: accountIndex === 0,
                            isWritable: true
                        })),
                        data: instruction.data,
                        isSigner: false,
                        isWritable: true,
                        instructionIndex: i,
                        platform: isKnownDex
                    };
                }
            }

            return null;

        } catch (error) {
            console.error(`[UNIVERSAL-ANALYZER] ❌ Core instruction search failed:`, error.message);
            return null;
        }
    }

    /**
     * Check if a program ID is a known DEX or Router
     */
    _isKnownDexProgram(programId) {
        try {
            const programIdStr = typeof programId === 'string' ? programId : programId.toString();
            
            for (const [name, pId] of Object.entries(this.platformIds)) {
                if (Array.isArray(pId)) {
                    if (pId.some(id => id.toString() === programIdStr)) {
                        return name;
                    }
                } else if (pId instanceof PublicKey) {
                    if (pId.toString() === programIdStr) {
                        return name;
                    }
                }
            }
            
            return false;
        } catch (error) {
            return false;
        }
    }
}

module.exports = { UniversalAnalyzer };
