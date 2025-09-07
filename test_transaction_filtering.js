// ==========================================
// Transaction Filtering System Test Suite
// ==========================================
// File: test_transaction_filtering.js
// Description: Test suite for the new transaction filtering system

const { LaserStreamManager } = require('./laserstreamManager.js');
const { TradingEngine } = require('./tradingEngine.js');
const config = require('./config.js');

class TransactionFilteringTestSuite {
    constructor() {
        this.testResults = {
            total: 0,
            passed: 0,
            failed: 0,
            errors: []
        };
    }

    async runAllTests() {
        console.log('🧪 Starting Transaction Filtering Test Suite...\n');

        try {
            // Test 1: Time-based filtering with recent transaction
            await this.testRecentTransactionFiltering();
            
            // Test 2: Time-based filtering with old transaction
            await this.testOldTransactionFiltering();
            
            // Test 3: Configuration-based filtering
            await this.testConfigurationBasedFiltering();
            
            // Test 4: Error handling in filtering
            await this.testFilteringErrorHandling();
            
            // Test 5: Blockhash validation
            await this.testBlockhashValidation();
            
        } catch (error) {
            console.error('❌ Test suite failed:', error.message);
            this.testResults.errors.push(error.message);
        }

        this.printResults();
    }

    async testRecentTransactionFiltering() {
        console.log('⏰ Test 1: Recent Transaction Filtering');
        
        try {
            const mockTransaction = {
                blockTime: Math.floor(Date.now() / 1000) - 10, // 10 seconds ago
                message: {
                    recentBlockhash: 'testBlockhash123'
                }
            };

            const mockLaserStreamManager = new LaserStreamManager({});
            const result = mockLaserStreamManager.isTransactionRecent(mockTransaction, 'testSignature123');
            
            if (result === true) {
                this.passTest('Recent transaction correctly allowed through');
            } else {
                this.failTest('Recent transaction incorrectly filtered out');
            }
            
        } catch (error) {
            this.failTest(`Recent transaction filtering test failed: ${error.message}`);
        }
    }

    async testOldTransactionFiltering() {
        console.log('⏰ Test 2: Old Transaction Filtering');
        
        try {
            const mockTransaction = {
                blockTime: Math.floor(Date.now() / 1000) - 60, // 60 seconds ago (too old)
                message: {
                    recentBlockhash: 'testBlockhash123'
                }
            };

            const mockLaserStreamManager = new LaserStreamManager({});
            const result = mockLaserStreamManager.isTransactionRecent(mockTransaction, 'testSignature456');
            
            if (result === false) {
                this.passTest('Old transaction correctly filtered out');
            } else {
                this.failTest('Old transaction incorrectly allowed through');
            }
            
        } catch (error) {
            this.failTest(`Old transaction filtering test failed: ${error.message}`);
        }
    }

    async testConfigurationBasedFiltering() {
        console.log('⚙️ Test 3: Configuration-Based Filtering');
        
        try {
            // Test with filtering disabled
            const originalConfig = config.TRANSACTION_FILTERING.ENABLED;
            config.TRANSACTION_FILTERING.ENABLED = false;

            const mockTransaction = {
                blockTime: Math.floor(Date.now() / 1000) - 60, // 60 seconds ago (would be filtered)
                message: {
                    recentBlockhash: 'testBlockhash123'
                }
            };

            const mockLaserStreamManager = new LaserStreamManager({});
            const result = mockLaserStreamManager.isTransactionRecent(mockTransaction, 'testSignature789');
            
            // Restore original config
            config.TRANSACTION_FILTERING.ENABLED = originalConfig;
            
            if (result === true) {
                this.passTest('Configuration-based filtering works correctly');
            } else {
                this.failTest('Configuration-based filtering failed');
            }
            
        } catch (error) {
            this.failTest(`Configuration-based filtering test failed: ${error.message}`);
        }
    }

    async testFilteringErrorHandling() {
        console.log('🛡️ Test 4: Error Handling in Filtering');
        
        try {
            const mockLaserStreamManager = new LaserStreamManager({});
            
            // Test with invalid transaction data
            const result = mockLaserStreamManager.isTransactionRecent(null, 'testSignatureError');
            
            if (result === true) {
                this.passTest('Error handling correctly allows transaction through on error');
            } else {
                this.failTest('Error handling incorrectly blocked transaction on error');
            }
            
        } catch (error) {
            this.failTest(`Error handling test failed: ${error.message}`);
        }
    }

    async testBlockhashValidation() {
        console.log('🔗 Test 5: Blockhash Validation');
        
        try {
            const mockTransaction = {
                blockTime: Math.floor(Date.now() / 1000) - 10, // Recent
                message: {
                    recentBlockhash: 'validBlockhash123'
                }
            };

            const mockLaserStreamManager = new LaserStreamManager({});
            const result = mockLaserStreamManager.isBlockhashRecent(mockTransaction, 'testSignatureBlockhash');
            
            if (result === true) {
                this.passTest('Blockhash validation works correctly');
            } else {
                this.failTest('Blockhash validation failed');
            }
            
        } catch (error) {
            this.failTest(`Blockhash validation test failed: ${error.message}`);
        }
    }

    passTest(testName) {
        this.testResults.total++;
        this.testResults.passed++;
        console.log(`✅ ${testName}`);
    }

    failTest(testName) {
        this.testResults.total++;
        this.testResults.failed++;
        console.log(`❌ ${testName}`);
    }

    printResults() {
        console.log('\n📊 Transaction Filtering Test Results:');
        console.log(`Total Tests: ${this.testResults.total}`);
        console.log(`Passed: ${this.testResults.passed}`);
        console.log(`Failed: ${this.testResults.failed}`);
        console.log(`Success Rate: ${((this.testResults.passed / this.testResults.total) * 100).toFixed(1)}%`);
        
        if (this.testResults.errors.length > 0) {
            console.log('\n❌ Errors:');
            this.testResults.errors.forEach(error => console.log(`  - ${error}`));
        }
        
        if (this.testResults.failed === 0) {
            console.log('\n🎉 All filtering tests passed! Transaction filtering system is ready.');
        } else {
            console.log('\n⚠️ Some filtering tests failed. Please review and fix issues.');
        }
    }
}

// Export for use in other modules
module.exports = {
    TransactionFilteringTestSuite
};

// Run tests if this file is executed directly
if (require.main === module) {
    const testSuite = new TransactionFilteringTestSuite();
    testSuite.runAllTests().catch(console.error);
}

