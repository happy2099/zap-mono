// REPLACE THE ENTIRETY of directSolanaSender.js with this code.

const {
    VersionedTransaction,
    TransactionMessage,
    PublicKey,
    SystemProgram,
    ComputeBudgetProgram
} = require('@solana/web3.js');
const config = require('./config.js');
const { shortenAddress } = require('./utils.js');
const leaderTracker = require('./leaderTracker.js');

class DirectSolanaSender {
    constructor(connection) {
        this.connection = connection;
    }

    _getSafeTipAccount() {
        try {
            const currentLeader = leaderTracker.getCurrentLeader();
            if (!currentLeader || typeof currentLeader !== 'string' || currentLeader.length < 32) {
                 return new PublicKey(config.TIP_ACCOUNTS[0]);
            }
            return new PublicKey(currentLeader);
        } catch (e) {
            return new PublicKey(config.TIP_ACCOUNTS[0]);
        }
    }

    async executeCopyTrade(keypair, executionOptions) {
        // Destructure all the new parts we need
        const { clonedInstructions, computeUnitLimit: intelligentCuLimit, addressLookupTables } = executionOptions;

        try {
            const { blockhash, lastValidBlockHeight } = await this.connection.getLatestBlockhash('confirmed');
            
            let computeUnitLimit = intelligentCuLimit || 1400000;
            let priorityFee = 750000;
            try {
                const fees = await this.connection.getRecentPrioritizationFees({ lockedAccounts: [] });
                if (fees.length > 0) {
                    const p80 = fees.sort((a, b) => a.prioritizationFee - b.prioritizationFee)[Math.floor(fees.length * 0.80)]?.prioritizationFee || priorityFee;
                    priorityFee = Math.ceil(p80 * 1.15); // 15% premium for aggression
                }
            } catch (feeError) {
                console.warn(`[DIRECT-SENDER] ⚠️ Could not fetch fees. Using default: ${priorityFee}.`);
            }
            
            const tipAccount = this._getSafeTipAccount();
            const tipAmount = config.DEFAULT_JITO_TIP_LAMPORTS || 10000;
            
            // Replace compute budget instructions in their original positions instead of adding at top
            const finalInstructions = [...clonedInstructions];
            
            // Find and replace compute budget instructions in their original positions
            for (let i = 0; i < finalInstructions.length; i++) {
                const instruction = finalInstructions[i];
                const programId = instruction.programId.toBase58();
                
                if (programId === 'ComputeBudget111111111111111111111111111111') {
                    // Check if this is a compute unit limit or price instruction based on data
                    const data = instruction.data;
                    if (data.length === 4) {
                        // This is likely a compute unit limit instruction
                        console.log(`[DIRECT-SENDER] 🔄 Replacing compute unit limit at position ${i}`);
                        finalInstructions[i] = ComputeBudgetProgram.setComputeUnitLimit({ units: computeUnitLimit });
                    } else if (data.length === 8) {
                        // This is likely a compute unit price instruction
                        console.log(`[DIRECT-SENDER] 🔄 Replacing compute unit price at position ${i}`);
                        finalInstructions[i] = ComputeBudgetProgram.setComputeUnitPrice({ microLamports: priorityFee });
                    }
                }
            }
            
            // Add tip instruction at the end
            finalInstructions.push(SystemProgram.transfer({ fromPubkey: keypair.publicKey, toPubkey: tipAccount, lamports: tipAmount }));
            
            // ===============================================
            // =========== THE "TOTAL RECOMPILE" =============
            // ===============================================

            // We are no longer trusting any part of the old structure.
            // We build a NEW message from scratch using our parts.
            const message = new TransactionMessage({
                payerKey: keypair.publicKey,          // Our user
                recentBlockhash: blockhash,             // A FRESH blockhash
                instructions: finalInstructions,       // Our PERFECTLY cloned instructions
            });
            
            // Then, we compile it with the ALTs. This is the magic step.
            // It builds the transaction payload correctly, using the phonebooks.
            const compiledMessage = message.compileToV0Message(addressLookupTables || []);
            
            // And finally, we wrap it in the modern container.
            const transaction = new VersionedTransaction(compiledMessage);
            
            // ===============================================

            transaction.sign([keypair]);
            
            // ===============================================
            // =========== SIMULATION FIRST ==================
            // ===============================================
            console.log(`[DIRECT-SENDER] 🔍 Simulating transaction before sending...`);
            try {
                const simulation = await this.connection.simulateTransaction(transaction);
                if (simulation.value.err) {
                    throw new Error(`Simulation failed: ${JSON.stringify(simulation.value.err)}`);
                }
                console.log(`[DIRECT-SENDER] ✅ Simulation passed. Compute units: ${simulation.value.unitsConsumed}`);
            } catch (simError) {
                console.error(`[DIRECT-SENDER] ❌ Simulation failed:`, simError.message);
                throw new Error(`Transaction simulation failed: ${simError.message}`);
            }
            
            const txSignature = await this.connection.sendRawTransaction(transaction.serialize(), { skipPreflight: false });
            
            console.log(`[DIRECT-SENDER] ✅ TX Recompiled & Injected. Sig: ${txSignature}`);
            
            // This is now the SENDER's responsibility. It confirms its own shot.
            console.log(`[DIRECT-SENDER] ⏳ Confirming transaction landing...`);
            const confirmation = await this.connection.confirmTransaction({
                signature: txSignature,
                blockhash: blockhash,
                lastValidBlockHeight: lastValidBlockHeight
            }, 'confirmed');

            if (confirmation.value.err) {
                throw new Error(`Transaction was INJECTED but FAILED on-chain: ${JSON.stringify(confirmation.value.err)}`);
            }

            console.log(`[DIRECT-SENDER] ✅ Confirmed. Transaction has LANDED.`);
            
            return {
                success: true,
                signature: txSignature,
            };

        } catch (error) {
            console.error(`[DIRECT-SENDER] ❌ Recompile or Submission FAILED:`, error.message);
            return { success: false, error: error.message, signature: null };
        }
    }
}

module.exports = DirectSolanaSender;