#!/usr/bin/env node

// ==========================================
// ========== Comprehensive System Testing ==========
// ==========================================
// File: scripts/comprehensive-testing.js
// Description: Comprehensive testing of all ZapBot features

const { DatabaseDataManager } = require('../database/databaseDataManager.js');
const { DatabaseManager } = require('../database/databaseManager.js');
const { SolanaManager } = require('../solanaManager.js');
const config = require('../patches/config.js');

class ComprehensiveTester {
    constructor() {
        this.results = {
            passed: 0,
            failed: 0,
            tests: []
        };
        this.databaseManager = null;
        this.dataManager = null;
        this.solanaManager = null;
    }

    async initialize() {
        console.log('🚀 Initializing Comprehensive Testing...\n');
        
        try {
            // Initialize database
            this.databaseManager = new DatabaseManager();
            await this.databaseManager.initialize();
            console.log('✅ Database initialized');

            // Initialize data manager
            this.dataManager = new DatabaseDataManager();
            await this.dataManager.initialize();
            console.log('✅ Data manager initialized');

            // Initialize Solana manager
            this.solanaManager = new SolanaManager();
            await this.solanaManager.initialize();
            console.log('✅ Solana manager initialized');

        } catch (error) {
            console.error('❌ Initialization failed:', error.message);
            throw error;
        }
    }

    async runTest(testName, testFunction) {
        try {
            console.log(`🔍 Running: ${testName}`);
            await testFunction();
            this.results.passed++;
            this.results.tests.push({ name: testName, status: 'PASSED' });
            console.log(`✅ PASSED: ${testName}\n`);
        } catch (error) {
            this.results.failed++;
            this.results.tests.push({ name: testName, status: 'FAILED', error: error.message });
            console.log(`❌ FAILED: ${testName} - ${error.message}\n`);
        }
    }

    // ===== DATABASE TESTS =====
    async testDatabaseConnection() {
        const version = await this.databaseManager.get('SELECT sqlite_version() as version');
        if (!version || !version.version) {
            throw new Error('Database connection failed');
        }
    }

    async testDatabaseSchema() {
        const tables = await this.databaseManager.all(`
            SELECT name FROM sqlite_master 
            WHERE type='table' AND name NOT LIKE 'sqlite_%'
        `);
        
        const expectedTables = ['users', 'traders', 'positions', 'trade_stats', 'withdrawals', 'saved_addresses', 'processed_pools'];
        const actualTables = tables.map(t => t.name);
        
        for (const expectedTable of expectedTables) {
            if (!actualTables.includes(expectedTable)) {
                throw new Error(`Missing table: ${expectedTable}`);
            }
        }
    }

    async testUserCRUD() {
        const testChatId = '999999999';
        const testUserData = {
            username: 'TestUser',
            settings: '{}',
            sol_amount: 0.1,
            primary_wallet_label: 'test',
            is_admin: false
        };

        // Create user
        await this.databaseManager.createUserComplete(testChatId, testUserData);
        
        // Read user
        const user = await this.databaseManager.getUser(testChatId);
        if (!user || user.username !== 'TestUser') {
            throw new Error('User creation/retrieval failed');
        }

        // Update user
        await this.databaseManager.setUserAdmin(testChatId, true);
        const updatedUser = await this.databaseManager.getUser(testChatId);
        if (!updatedUser.is_admin) {
            throw new Error('User update failed');
        }

        // Delete user (cleanup)
        await this.databaseManager.run('DELETE FROM users WHERE chat_id = ?', [testChatId]);
    }

    // ===== DATA MANAGER TESTS =====
    async testDataManagerInterface() {
        const testChatId = '888888888';
        
        // Test user management
        await this.dataManager.createUser(testChatId, { username: 'TestUser' });
        const users = await this.dataManager.loadUsers();
        if (!users[testChatId]) {
            throw new Error('DataManager user creation failed');
        }

        // Test admin functions
        await this.dataManager.setUserAdmin(testChatId, true);
        const isAdmin = await this.dataManager.isUserAdmin(testChatId);
        if (!isAdmin) {
            throw new Error('DataManager admin functions failed');
        }

        // Cleanup
        await this.databaseManager.run('DELETE FROM users WHERE chat_id = ?', [testChatId]);
    }

    async testTraderManagement() {
        const testChatId = '777777777';
        await this.dataManager.createUser(testChatId, { username: 'TraderTest' });
        
        // Add trader
        await this.dataManager.addTrader(testChatId, 'TestTrader', 'TestWallet123', true);
        
        // Get traders
        const traders = await this.dataManager.loadTraders();
        const userTraders = traders.user_traders[testChatId] || {};
        
        if (!userTraders['TestTrader']) {
            throw new Error('Trader management failed');
        }

        // Cleanup - temporarily disable foreign keys
        await this.databaseManager.run('PRAGMA foreign_keys = OFF');
        await this.databaseManager.run('DELETE FROM users WHERE chat_id = ?', [testChatId]);
        await this.databaseManager.run('DELETE FROM traders WHERE wallet = ?', ['TestWallet123']);
        await this.databaseManager.run('PRAGMA foreign_keys = ON');
    }

    // ===== SOLANA MANAGER TESTS =====
    async testSolanaConnection() {
        const version = await this.solanaManager.connection.getVersion();
        if (!version || !version['solana-core']) {
            throw new Error('Solana connection failed');
        }
    }

    async testSolanaBalance() {
        const balance = await this.solanaManager.getSOLBalance(config.USER_WALLET_PUBKEY);
        if (typeof balance !== 'number' || balance < 0) {
            throw new Error('Balance retrieval failed');
        }
    }

    async testSolanaBlockhash() {
        const { blockhash } = await this.solanaManager.connection.getLatestBlockhash();
        if (!blockhash) {
            throw new Error('Blockhash retrieval failed');
        }
    }

    // ===== CONFIGURATION TESTS =====
    async testConfiguration() {
        const requiredConfigs = [
            'BOT_TOKEN',
            'USER_WALLET_PUBKEY',
            'USER_WALLET_PRIVATE_KEY',
            'ADMIN_CHAT_ID',
            'RPC_URL'
        ];

        for (const configKey of requiredConfigs) {
            if (!config[configKey]) {
                throw new Error(`Missing configuration: ${configKey}`);
            }
        }
    }

    async testHeliusIntegration() {
        const rpcUrl = config.RPC_URL;
        if (!rpcUrl.includes('helius-rpc.com')) {
            throw new Error('Helius RPC not configured');
        }

        if (!rpcUrl.includes('api-key=')) {
            throw new Error('Helius API key not configured');
        }
    }

    // ===== ADMIN SYSTEM TESTS =====
    async testAdminSystem() {
        const adminChatId = config.ADMIN_CHAT_ID;
        
        // Test admin creation
        await this.databaseManager.createUserComplete(adminChatId, {
            username: 'Admin',
            settings: '{}',
            sol_amount: 0.1,
            primary_wallet_label: 'admin',
            is_admin: true
        });

        // Test admin verification
        const isAdmin = await this.dataManager.isUserAdmin(adminChatId);
        if (!isAdmin) {
            throw new Error('Admin system failed');
        }

        // Test admin listing
        const admins = await this.dataManager.getAllAdmins();
        if (!admins.some(admin => admin.chat_id === adminChatId)) {
            throw new Error('Admin listing failed');
        }
    }

    // ===== PERFORMANCE TESTS =====
    async testDatabasePerformance() {
        const startTime = Date.now();
        
        // Temporarily disable foreign key constraints
        await this.databaseManager.run('PRAGMA foreign_keys = OFF');
        
        // Test multiple user creation
        for (let i = 0; i < 10; i++) {
            await this.databaseManager.createUserComplete(`perf${i}`, {
                username: `PerfUser${i}`,
                settings: '{}',
                sol_amount: 0.001,
                primary_wallet_label: 'perf',
                is_admin: false
            });
        }

        const endTime = Date.now();
        const duration = endTime - startTime;
        
        if (duration > 5000) { // 5 seconds
            throw new Error(`Database performance test failed: ${duration}ms`);
        }

        // Cleanup
        for (let i = 0; i < 10; i++) {
            await this.databaseManager.run('DELETE FROM users WHERE chat_id = ?', [`perf${i}`]);
        }
        
        // Re-enable foreign key constraints
        await this.databaseManager.run('PRAGMA foreign_keys = ON');
    }

    async testSolanaPerformance() {
        const startTime = Date.now();
        
        // Test multiple balance checks
        const promises = [];
        for (let i = 0; i < 5; i++) {
            promises.push(this.solanaManager.getSOLBalance(config.USER_WALLET_PUBKEY));
        }
        
        await Promise.all(promises);
        
        const endTime = Date.now();
        const duration = endTime - startTime;
        
        if (duration > 10000) { // 10 seconds
            throw new Error(`Solana performance test failed: ${duration}ms`);
        }
    }

    // ===== INTEGRATION TESTS =====
    async testFullUserWorkflow() {
        const testChatId = '666666666';
        
        // 1. Create user
        await this.dataManager.createUser(testChatId, { username: 'WorkflowTest' });
        
        // 2. Add trader
        await this.dataManager.addTrader(testChatId, 'WorkflowTrader', 'WorkflowWallet123', true);
        
        // 3. Set SOL amount
        await this.dataManager.setSolAmount(testChatId, 0.05);
        
        // 4. Verify all data
        const user = await this.dataManager.getUser(testChatId);
        const traders = await this.dataManager.loadTraders();
        const solAmount = await this.dataManager.getSolAmount(testChatId);
        
        if (!user || !traders.user_traders[testChatId] || solAmount !== 0.05) {
            throw new Error('Full user workflow failed');
        }

        // Cleanup - temporarily disable foreign keys
        await this.databaseManager.run('PRAGMA foreign_keys = OFF');
        await this.databaseManager.run('DELETE FROM users WHERE chat_id = ?', [testChatId]);
        await this.databaseManager.run('DELETE FROM traders WHERE wallet = ?', ['WorkflowWallet123']);
        await this.databaseManager.run('PRAGMA foreign_keys = ON');
    }

    async testAdminWorkflow() {
        const adminChatId = config.ADMIN_CHAT_ID;
        const testChatId = '555555555';
        
        // 1. Create test user
        await this.dataManager.createUser(testChatId, { username: 'AdminTest' });
        
        // 2. Promote to admin
        await this.dataManager.setUserAdmin(testChatId, true);
        
        // 3. Verify admin status
        const isAdmin = await this.dataManager.isUserAdmin(testChatId);
        if (!isAdmin) {
            throw new Error('Admin promotion failed');
        }
        
        // 4. Demote from admin
        await this.dataManager.setUserAdmin(testChatId, false);
        
        // 5. Verify demotion
        const isAdminAfter = await this.dataManager.isUserAdmin(testChatId);
        if (isAdminAfter) {
            throw new Error('Admin demotion failed');
        }

        // Cleanup
        await this.databaseManager.run('DELETE FROM users WHERE chat_id = ?', [testChatId]);
    }

    // ===== RUN ALL TESTS =====
    async runAllTests() {
        console.log('🧪 Starting Comprehensive Testing Suite...\n');

        // Database Tests
        await this.runTest('Database Connection', () => this.testDatabaseConnection());
        await this.runTest('Database Schema', () => this.testDatabaseSchema());
        await this.runTest('User CRUD Operations', () => this.testUserCRUD());
        await this.runTest('Database Performance', () => this.testDatabasePerformance());

        // Data Manager Tests
        await this.runTest('Data Manager Interface', () => this.testDataManagerInterface());
        await this.runTest('Trader Management', () => this.testTraderManagement());

        // Solana Manager Tests
        await this.runTest('Solana Connection', () => this.testSolanaConnection());
        await this.runTest('Solana Balance Check', () => this.testSolanaBalance());
        await this.runTest('Solana Blockhash', () => this.testSolanaBlockhash());
        await this.runTest('Solana Performance', () => this.testSolanaPerformance());

        // Configuration Tests
        await this.runTest('Configuration Validation', () => this.testConfiguration());
        await this.runTest('Helius Integration', () => this.testHeliusIntegration());

        // Admin System Tests
        await this.runTest('Admin System', () => this.testAdminSystem());
        await this.runTest('Admin Workflow', () => this.testAdminWorkflow());

        // Integration Tests
        await this.runTest('Full User Workflow', () => this.testFullUserWorkflow());

        // Display Results
        this.displayResults();
    }

    displayResults() {
        console.log('\n' + '='.repeat(60));
        console.log('📊 COMPREHENSIVE TESTING RESULTS');
        console.log('='.repeat(60));
        
        console.log(`✅ Passed: ${this.results.passed}`);
        console.log(`❌ Failed: ${this.results.failed}`);
        console.log(`📈 Success Rate: ${((this.results.passed / (this.results.passed + this.results.failed)) * 100).toFixed(1)}%`);
        
        console.log('\n📋 Test Details:');
        for (const test of this.results.tests) {
            const status = test.status === 'PASSED' ? '✅' : '❌';
            console.log(`${status} ${test.name}`);
            if (test.error) {
                console.log(`   Error: ${test.error}`);
            }
        }

        console.log('\n' + '='.repeat(60));
        
        if (this.results.failed === 0) {
            console.log('🎉 ALL TESTS PASSED! System is ready for production.');
        } else {
            console.log('⚠️ Some tests failed. Please review the errors above.');
        }
        
        console.log('='.repeat(60));
    }

    async cleanup() {
        try {
            if (this.databaseManager) {
                await this.databaseManager.close();
            }
            if (this.solanaManager) {
                this.solanaManager.stop();
            }
        } catch (error) {
            console.error('Cleanup error:', error.message);
        }
    }
}

// Run tests if called directly
if (require.main === module) {
    const tester = new ComprehensiveTester();
    
    tester.initialize()
        .then(() => tester.runAllTests())
        .then(() => tester.cleanup())
        .catch(error => {
            console.error('❌ Testing failed:', error);
            process.exit(1);
        });
}

module.exports = { ComprehensiveTester };
