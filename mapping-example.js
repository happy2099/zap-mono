/**
 * MAPPING EXAMPLE - How to use the DataMapper
 * 
 * This file shows you how to use the mapping system to debug your bot
 */

const { DataMapper, quickMap } = require('./map.js');

// Example usage
async function exampleMapping() {
    // Create a mapper instance
    const mapper = new DataMapper();

    // Example raw Helius data (from LaserStream)
    // NOTE: This is just an example using a real trader from your database
    // The mapping system works with ANY active trader dynamically!
    const rawHeliusData = {
        signature: "5WzHjM2h...",
        slot: 368333650,
        blockTime: 1758472712,
        transaction: {
            message: {
                accountKeys: [
                    "xXpRSpAe1ajq4tJP78tS3X1AqNwJVQ4Vvb1Swg4hHQh", // Example: trader "alo" (any active trader works)
                    "F5tf...zvBq", // DEX program
                    "9Vs3...TRtk", // Output ATA
                    "yN8d...pump"  // Token mint
                ],
                instructions: [
                    {
                        programIdIndex: 1,
                        accounts: [0, 2, 3],
                        data: "AQAAAAAAAAB..." // Base58 encoded instruction data
                    }
                ],
                addressTableLookups: [
                    {
                        accountKey: "GwME...", // ALT account
                        writableIndexes: [0, 1, 2],
                        readonlyIndexes: [3, 4, 5]
                    }
                ]
            },
            meta: {
                err: null,
                fee: 5000,
                computeUnitsConsumed: 1000000,
                preBalances: [1000000000, 0, 0, 0],
                postBalances: [888424948, 0, 0, 0],
                preTokenBalances: [],
                postTokenBalances: [
                    {
                        accountIndex: 2,
                        mint: "yN8dtfvyNT7f4khnQaETTkEUsQT8V8THchtdBrhpump",
                        amount: "1000000000"
                    }
                ]
            }
        }
    };

    // Example normalized data (from traderMonitorWorker normalization)
    const normalizedData = {
        signature: "5WzHjM2h...",
        sourceWallet: "xXpRSpAe1ajq4tJP78tS3X1AqNwJVQ4Vvb1Swg4hHQh",
        slot: 368333650,
        blockTime: 1758472712,
        isSuccess: true,
        accountKeys: [
            // Base accounts from transaction
            "xXpRSpAe1ajq4tJP78tS3X1AqNwJVQ4Vvb1Swg4hHQh", // Trader wallet
            "F5tf...zvBq", // DEX program
            "9Vs3...TRtk", // Output ATA
            "yN8d...pump", // Token mint
            // Additional accounts from ALT (Address Lookup Table)
            "GwME...", // ALT account
            "3xRU...", // Additional account 1
            "7VMV...", // Additional account 2
            // ... more accounts from ALT
        ],
        instructions: [
            {
                programIdIndex: 1,
                accounts: [0, 2, 3],
                data: "AQAAAAAAAAB..." // Base58 encoded instruction data
            }
        ],
        preBalances: [1000000000, 0, 0, 0, 0, 0, 0, 0],
        postBalances: [888424948, 0, 0, 0, 0, 0, 0, 0],
        preTokenBalances: [],
        postTokenBalances: [
            {
                accountIndex: 2,
                mint: "yN8dtfvyNT7f4khnQaETTkEUsQT8V8THchtdBrhpump",
                uiTokenAmount: { amount: "1000000000" }
            }
        ],
        addressTableLookups: [
            {
                accountKey: "GwME...",
                writableIndexes: [0, 1, 2],
                readonlyIndexes: [3, 4, 5]
            }
        ]
    };

    // Example trade details
    const tradeDetails = {
        tradeType: "buy",
        traderPubkey: "xXpRSpAe1ajq4tJP78tS3X1AqNwJVQ4Vvb1Swg4hHQh",
        inputMint: "So11111111111111111111111111111111111111112", // SOL
        outputMint: "yN8dtfvyNT7f4khnQaETTkEUsQT8V8THchtdBrhpump",
        cloningTarget: {
            programId: "F5tf...zvBq",
            instructionIndex: 0,
            accounts: [0, 2, 3]
        },
        solAmount: 0.1,
        tokenAmount: "1000000000"
    };

    // Example cloned instructions
    const clonedInstructions = [
        {
            programId: "F5tf...zvBq",
            accounts: [
                { pubkey: "HyF8...EACS", isSigner: true, isWritable: true },  // User wallet
                { pubkey: "2MR9...SGit", isSigner: false, isWritable: true }, // User ATA
                { pubkey: "yN8d...pump", isSigner: false, isWritable: false } // Token mint
            ],
            data: Buffer.from("AQAAAAAAAAB...", 'hex')
        }
    ];

    // Example final result
    const finalResult = {
        success: true,
        signature: "3moAc...",
        error: null
    };

    // Log the complete mapping
    mapper.logCompleteMapping(
        rawHeliusData,
        normalizedData,
        tradeDetails,
        clonedInstructions,
        finalResult
    );

    // Export to file
    mapper.exportToFile('example-mapping.json');

    // Show quick mapping examples
    console.log('\n🔍 QUICK MAPPING EXAMPLES:');
    
    // Map the complete flow
    quickMap.completeFlow(
        "5WzHjM2h...",
        "alo",
        "buy",
        "Pump.fun BC"
    );
    
    // Map a raw instruction
    quickMap.rawInstruction(
        rawHeliusData.transaction.message.instructions[0],
        rawHeliusData.transaction.message.accountKeys
    );

    // Map forging process
    quickMap.forging(
        "xXpRSpAe1ajq4tJP78tS3X1AqNwJVQ4Vvb1Swg4hHQh",
        "HyF8...EACS",
        "Trader wallet → User wallet"
    );

    // Map cloned instruction
    quickMap.clonedInstruction(clonedInstructions[0], 0);
}

// Run the example
if (require.main === module) {
    exampleMapping().catch(console.error);
}

module.exports = { exampleMapping };
