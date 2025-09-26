// =============================================================
// == Universal Transaction Analyzer (vFINAL - Authority Hardened) ==
// =============================================================

const { PublicKey } = require('@solana/web3.js');
const config = require('./config.js');
const { shortenAddress } = require('./utils.js');

class UniversalAnalyzer {
    constructor(connection) {
        this.connection = connection;
        this.knownDexAndRouterIds = new Set();
        for (const key in config.PLATFORM_IDS) {
            const value = config.PLATFORM_IDS[key];
            if (Array.isArray(value)) {
                value.forEach(id => this.knownDexAndRouterIds.add(id.toBase58()));
            } else if (value instanceof PublicKey) {
                this.knownDexAndRouterIds.add(value.toBase58());
            }
        }
        console.log(`[UNIVERSAL-ANALYZER] 🚀 Initialized with ${this.knownDexAndRouterIds.size} known DEX/Router Program IDs.`);
    }


    // ===============================================
    // ================ THE FINAL FIX #1 ===============
    // This is the new, more skeptical helper function.
    // ===============================================
    _isKnownDexOrRouter(programId) {
        return this.platformIds.has(programId);
    }

    async analyzeTransaction(normalizedTx, masterTraderWallet) {
        try {
            const masterTraderWalletAddress = new PublicKey(masterTraderWallet);
            if (!normalizedTx.isSuccess) return { isCopyable: false, reason: "TX failed on-chain." };
            
            const { instructions, accountKeys, ...meta } = normalizedTx;
            const message = { instructions, accountKeys };
            
            const swapDetails = await this._extractSwapDetails(meta, masterTraderWalletAddress, message);
            if (!swapDetails) return { isCopyable: false, reason: "Economic analysis failed." };

            const coreInstruction = await this._findCoreSwapInstruction(message, masterTraderWalletAddress, accountKeys);
            if (!coreInstruction) return { isCopyable: false, reason: "No core swap instruction found." };

            // ===============================================
            // =========== THE "GOLDEN FLEECE" CHECK ===========
            // ===============================================
            const coreProgramId = coreInstruction.programId;
            const isDirectlyKnown = this.knownDexAndRouterIds.has(coreProgramId);

            if (isDirectlyKnown) {
                 console.log(`[ANALYZER-AUTH] ✅ Authority Check PASSED: Core program ${shortenAddress(coreProgramId)} is a known DEX/Router.`);
            } else {
                // If the main program is a private router, scan the whole transaction for context.
                const hasContextualAuthority = accountKeys.some(key => this.knownDexAndRouterIds.has(key));
                if (hasContextualAuthority) {
                    console.log(`[ANALYZER-AUTH] ✅ Authority Check PASSED (Contextual): Core program is unknown, but a known Router/DEX was involved in the transaction.`);
                } else {
                    return { 
                        isCopyable: false, 
                        reason: `Final Authority Check FAILED: Core program (${shortenAddress(coreProgramId)}) is not a known DEX and no known Routers were involved.` 
                    };
                }
            }
            
            const cloningBlueprint = {
                programId: coreProgramId,
                accounts: coreInstruction.accounts,
                data: coreInstruction.data,
                platform: this._getPlatformName(coreProgramId)
            };
            
            return {
                isCopyable: true,
                details: { ...swapDetails, dexPlatform: cloningBlueprint.platform, cloningTarget: cloningBlueprint, traderPubkey: masterTraderWalletAddress.toBase58() },
                summary: `${swapDetails.tradeType.toUpperCase()} on ${cloningBlueprint.platform}`,
                originalTransaction: normalizedTx
            };

        } catch (error) {
            return { isCopyable: false, reason: `Analysis error: ${error.message}` };
        }
    }

    // ===============================================
    // ================ THE FINAL FIX #2 ===============
    // This version fixes the "0 SOL" logging bug.
    // ===============================================
    async _extractSwapDetails(meta, masterTraderWallet, message) {
        try {
            if (!meta || !meta.preBalances || !meta.postBalances) return null;
            
            const traderPkString = masterTraderWallet.toString();
            const tokenChanges = new Map();

            (meta.preTokenBalances || []).filter(tb => tb.owner === traderPkString).forEach(balance => {
                const amount = BigInt(balance.uiTokenAmount.amount);
                tokenChanges.set(balance.mint, (tokenChanges.get(balance.mint) || 0n) - amount);
            });
            (meta.postTokenBalances || []).filter(tb => tb.owner === traderPkString).forEach(balance => {
                const amount = BigInt(balance.uiTokenAmount.amount);
                tokenChanges.set(balance.mint, (tokenChanges.get(balance.mint) || 0n) + amount);
            });

            let sentTokens = [], receivedTokens = [];
            tokenChanges.forEach((change, mint) => {
                if (change > 0n) receivedTokens.push({ mint, amount: change });
                if (change < 0n) sentTokens.push({ mint, amount: -change });
            });

            const accountKeys = message.accountKeys || [];
            const traderIndex = accountKeys.findIndex(key => key === traderPkString);
            const solChange = traderIndex !== -1 ? BigInt(meta.postBalances[traderIndex]) - BigInt(meta.preBalances[traderIndex]) : 0n;

            // This is the logging fix: Use Number for display math, not BigInt.
            const solAmountForDisplay = Math.abs(Number(solChange)) / config.LAMPORTS_PER_SOL_CONST;

            if (solChange < 0n && receivedTokens.length === 1) { // BUY with SOL
                console.log(`[UNIVERSAL-ANALYZER] ✅ Detected BUY: ${solAmountForDisplay.toFixed(4)} SOL → ${shortenAddress(receivedTokens[0].mint)}`);
                return {
                    tradeType: 'buy', inputMint: config.NATIVE_SOL_MINT, outputMint: receivedTokens[0].mint,
                    inputAmountLamports: (-solChange).toString(), outputAmountRaw: receivedTokens[0].amount.toString()
                };
            } else if (solChange > 0n && sentTokens.length === 1) { // SELL for SOL
                console.log(`[UNIVERSAL-ANALYZER] ✅ Detected SELL: ${shortenAddress(sentTokens[0].mint)} → ${solAmountForDisplay.toFixed(4)} SOL`);
                return {
                    tradeType: 'sell', inputMint: sentTokens[0].mint, outputMint: config.NATIVE_SOL_MINT,
                    inputAmountRaw: sentTokens[0].amount.toString(), outputAmountLamports: solChange.toString()
                };
            }
            
            // Handle token-to-token swaps
            else if (sentTokens.length === 1 && receivedTokens.length === 1) {
                 console.log(`[UNIVERSAL-ANALYZER] ✅ Detected TOKEN SWAP: ${shortenAddress(sentTokens[0].mint)} → ${shortenAddress(receivedTokens[0].mint)}`);
                 return {
                    tradeType: 'buy', // Classify as buy
                    inputMint: sentTokens[0].mint,
                    outputMint: receivedTokens[0].mint,
                    inputAmountRaw: sentTokens[0].amount.toString(),
                    outputAmountRaw: receivedTokens[0].amount.toString()
                 };
            }
            
            return null; // Not a clear 1-for-1 swap pattern.
        } catch (error) {
            console.error(`[UNIVERSAL-ANALYZER] ❌ Swap details extraction failed:`, error.message);
            return null;
        }
    }

    _getPlatformName(programId) {
        const programIdStr = programId.toString();
        for (const [name, pId] of Object.entries(config.PLATFORM_IDS)) {
            if (Array.isArray(pId) ? pId.some(id => id.toString() === programIdStr) : pId.toString() === programIdStr) {
                return name;
            }
        }
        return 'Unknown';
    }

    async _findCoreSwapInstruction(message, masterTraderWallet, fullAccountListStrings) {
        try {
            const instructions = message.instructions || [];
            const masterTraderStr = masterTraderWallet.toBase58();

            console.log(`[ELITE-ANALYZER] Searching for core SWAP instruction...`);

            // This is a Set of all known DEX and Router Program IDs from your config.
            const knownPlatforms = new Set();
            for (const key in config.PLATFORM_IDS) {
                const value = config.PLATFORM_IDS[key];
                if (Array.isArray(value)) { value.forEach(id => knownPlatforms.add(id.toBase58())); }
                else { knownPlatforms.add(value.toBase58()); }
            }

            let bestCandidate = null;
            let bestCandidateIndex = -1;

            for (let i = 0; i < instructions.length; i++) {
                const instruction = instructions[i];
                const programId = fullAccountListStrings[instruction.programIdIndex];
                
                // Skip system programs immediately.
                if (programId === config.SYSTEM_PROGRAM_ID.toBase58() || programId === config.COMPUTE_BUDGET_PROGRAM_ID.toBase58()) {
                    continue;
                }
                
                // =========================================================================
                // ====================== THIS IS THE FINAL FIX ==========================
                // This is the new rule. We IGNORE simple ATA creation as a core instruction.
                if (programId === config.ASSOCIATED_TOKEN_PROGRAM_ID.toBase58()) {
                     console.log(`[ELITE-ANALYZER] Ignoring prerequisite instruction at index ${i} (ATA Creation).`);
                     continue;
                }
                
                // =========================================================================
                // ====================== MARKETPLACE FILTER ==============================
                // Ignore marketplace programs (not DEX programs)
                if (programId.includes('BLUR') || programId.includes('OpenSea') || programId.includes('MagicEden')) {
                     console.log(`[ELITE-ANALYZER] Ignoring marketplace instruction at index ${i} (${programId}).`);
                     continue;
                }
                // =========================================================================
                
                const accountIndexes = Array.from(instruction.accounts);

                let isTraderInvolved = false;
                for (const accountIndex of accountIndexes) {
                    if (fullAccountListStrings[accountIndex] === masterTraderStr) {
                        isTraderInvolved = true;
                        break;
                    }
                }
                
                if (isTraderInvolved) {
                    const candidate = {
                        programId: programId,
                        accounts: accountIndexes.map(index => ({
                            pubkey: fullAccountListStrings[index],
                            isSigner: fullAccountListStrings[index] === masterTraderStr,
                            isWritable: true 
                        })),
                        data: instruction.data || Buffer.alloc(0),
                    };

                    // An instruction on a KNOWN platform is the highest priority.
                    if (knownPlatforms.has(programId)) {
                         console.log(`[ELITE-ANALYZER] ✅ Found HIGH-CONFIDENCE core instruction at index ${i}. Program: ${shortenAddress(programId)}`);
                         bestCandidate = candidate;
                         bestCandidateIndex = i;
                         break; // We found the best possible one, mission complete.
                    }

                    // If we haven't found a better one yet, store this as a possibility.
                    if (!bestCandidate) {
                        bestCandidate = candidate;
                        bestCandidateIndex = i;
                    }
                }
            }
            
            if (bestCandidate) {
                console.log(`[ELITE-ANALYZER] ✅ Final core instruction selected at index ${bestCandidateIndex}. Program: ${shortenAddress(bestCandidate.programId)}`);
                return { ...bestCandidate, index: bestCandidateIndex };
            }

            console.log(`[ELITE-ANALYZER] ❌ No valid core SWAP instruction found involving trader: ${masterTraderStr}`);
            return null;

        } catch (error) {
            console.error(`[ELITE-ANALYZER] ❌ Core instruction search failed critically:`, error.message, error.stack);
            return null;
        }
    }
}

module.exports = { UniversalAnalyzer };