// debug_worker.js - Debug version to see what transactions we're getting

const { subscribe, CommitmentLevel } = require('helius-laserstream');

const config = {
    laserstreamGrpcUrl: "laserstream.helius.xyz:443",
    heliusApiKey: "b9a69ad0-d823-429e-8c18-7cbea0e31769",
    walletsToMonitor: [
        "37a8UCdfWeoHMGDr4wseNXaTgDAQGx89RuH7jm6W2TF7",
        "EKDDjxzJ39Bjkr47NiARGJDKFVxiiV9WNJ5XbtEhPEXP"
    ]
};

const run = async () => {
    try {
        const stream = await subscribe(
            { apiKey: config.heliusApiKey, endpoint: config.laserstreamGrpcUrl },
            { "zap-copy-trades": { accountIncludes: config.walletsToMonitor, vote: false, failed: false } },
            CommitmentLevel.PROCESSED,
            async (update) => {
                try {
                    const rawTx = update.transaction;
                    if (!rawTx) return;

                    console.log("\n" + "=".repeat(60));
                    console.log("🔍 DEBUG: Transaction Received");
                    console.log("=".repeat(60));
                    
                    // Check transaction structure
                    console.log("📊 Transaction Structure:");
                    console.log(`   Raw keys: ${Object.keys(rawTx)}`);
                    
                    if (rawTx.transaction) {
                        console.log(`   Transaction keys: ${Object.keys(rawTx.transaction)}`);
                        
                        if (rawTx.transaction.message) {
                            // console.log(`   Message keys: ${Object.keys(rawTx.transaction.message)}`); // SILENCED FOR CLEAN TERMINAL
                            // console.log(`   Account keys length: ${rawTx.transaction.message.accountKeys?.length || 0}`); // SILENCED FOR CLEAN TERMINAL
                        }
                        
                        if (rawTx.transaction.meta) {
                            // console.log(`   Meta keys: ${Object.keys(rawTx.transaction.meta)}`); // SILENCED FOR CLEAN TERMINAL
                            // console.log(`   Inner instructions: ${rawTx.transaction.meta.innerInstructions?.length || 0}`); // SILENCED FOR CLEAN TERMINAL
                        }
                    }
                    
                    // Check for pump.fun program ID
                    if (rawTx.transaction?.message?.accountKeys) {
                        const accountKeys = rawTx.transaction.message.accountKeys.map(k => 
                            k.pubkey ? k.pubkey.toString() : k.toString()
                        );
                        
                        console.log("\n🔍 Program IDs in transaction:");
                        accountKeys.forEach((key, index) => {
                            if (key === '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P') {
                                console.log(`   ✅ PUMP.FUN FOUND at index ${index}: ${key}`);
                            } else if (key.includes('pump') || key.includes('Pump')) {
                                console.log(`   🎯 PUMP-RELATED at index ${index}: ${key}`);
                            }
                        });
                        
                        // Check inner instructions for pump.fun
                        if (rawTx.transaction.meta?.innerInstructions) {
                            console.log("\n🔍 Inner Instructions Analysis:");
                            rawTx.transaction.meta.innerInstructions.forEach((innerIx, ixIndex) => {
                                console.log(`   Inner instruction group ${ixIndex}:`);
                                innerIx.instructions.forEach((instruction, instIndex) => {
                                    const programId = accountKeys[instruction.programIdIndex];
                                    console.log(`     Instruction ${instIndex}: Program ${programId}`);
                                    
                                    if (programId === '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P') {
                                        console.log(`       🚀 PUMP.FUN INSTRUCTION FOUND!`);
                                        console.log(`       Data: ${instruction.data}`);
                                        console.log(`       Accounts: ${instruction.accounts}`);
                                    }
                                });
                            });
                        }
                    }
                    
                    console.log("=".repeat(60));
                    
                } catch (e) { 
                    console.error("❌ Error processing transaction:", e); 
                }
            },
            (err) => { 
                console.error("❌ SDK Error:", err); 
            }
        );
        
        console.log(`✅ Connected to LaserStream. Monitoring ${config.walletsToMonitor.length} wallets.`);
        console.log("🔍 Debug mode: Showing all transaction details...\n");
        
    } catch (e) {
        console.error("❌ Failed to start LaserStream:", e.message);
    }
};

run();
