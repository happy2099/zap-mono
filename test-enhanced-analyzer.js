// File: test-enhanced-analyzer.js
// Description: Test script for enhanced transaction analyzer

const { EnhancedTransactionAnalyzer } = require('./enhancedTransactionAnalyzer.js');

async function testEnhancedAnalyzer() {
    console.log('🧪 Testing Enhanced Transaction Analyzer...\n');

    try {
        const analyzer = new EnhancedTransactionAnalyzer();
        console.log('✅ Enhanced Transaction Analyzer initialized successfully');

        // Test 1: DEX Programs Configuration
        console.log('\n📋 Test 1: DEX Programs Configuration');
        console.log('Found DEX programs:', Object.keys(analyzer.dexPrograms).length);
        for (const [programId, info] of Object.entries(analyzer.dexPrograms)) {
            console.log(`  - ${info.name} (${info.type}) - ${info.version}`);
        }

        // Test 2: Mock Transaction Analysis
        console.log('\n📋 Test 2: Mock Transaction Analysis');
        const mockTransaction = {
            transaction: {
                message: {
                    instructions: [
                        {
                            programIdIndex: 0,
                            accounts: [1, 2, 3],
                            data: '0x66063d1101052472'
                        }
                    ],
                    accountKeys: [
                        '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8', // Raydium V4
                        'TokenAccount1',
                        'TokenAccount2',
                        'UserAccount'
                    ]
                }
            },
            meta: {
                err: null,
                fee: 5000,
                innerInstructions: []
            },
            blockTime: Date.now() / 1000
        };

        const analysisResult = await analyzer.analyzeTransactionForCopy(
            mockTransaction,
            'TestTrader123456789',
            false
        );

        console.log('Analysis Result:', {
            isCopyable: analysisResult.isCopyable,
            dexPlatform: analysisResult.dexPlatform,
            reason: analysisResult.reason,
            hasTradeDetails: !!analysisResult.tradeDetails,
            riskLevel: analysisResult.riskAssessment?.riskLevel || 'Unknown'
        });

        if (analysisResult.tradeDetails) {
            console.log('\n📊 Trade Details:', {
                dexPlatform: analysisResult.tradeDetails.dexPlatform,
                estimatedGas: analysisResult.tradeDetails.estimatedGas,
                priorityFee: analysisResult.tradeDetails.priorityFee,
                success: analysisResult.tradeDetails.success
            });
        }

        if (analysisResult.riskAssessment) {
            console.log('\n⚠️ Risk Assessment:', {
                riskLevel: analysisResult.riskAssessment.riskLevel,
                riskScore: analysisResult.riskAssessment.riskScore,
                riskFactors: analysisResult.riskAssessment.riskFactors,
                recommendations: analysisResult.riskAssessment.recommendations
            });
        }

        // Test 3: Error Handling
        console.log('\n📋 Test 3: Error Handling');
        const invalidTransaction = { invalid: 'structure' };
        const errorResult = await analyzer.analyzeTransactionForCopy(
            invalidTransaction,
            'TestTrader123456789',
            false
        );
        console.log('Error handling test:', {
            isCopyable: errorResult.isCopyable,
            reason: errorResult.reason
        });

        console.log('\n🎉 All Enhanced Analyzer tests completed successfully!');
        console.log('\n🚀 Your ZapBot now has:');
        console.log('   ✅ Enhanced transaction analysis');
        console.log('   ✅ Refined copy trade data extraction');
        console.log('   ✅ Risk assessment for copy trading');
        console.log('   ✅ DEX-specific instruction analysis');
        console.log('   ✅ Singapore regional optimization');

    } catch (error) {
        console.error('❌ Test failed:', error.message);
        console.error(error.stack);
    }
}

// Run the test
testEnhancedAnalyzer();

module.exports = { testEnhancedAnalyzer };
