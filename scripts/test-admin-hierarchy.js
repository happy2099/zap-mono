#!/usr/bin/env node

// ==========================================
// ========== Admin Hierarchy Test ==========
// ==========================================
// File: scripts/test-admin-hierarchy.js
// Description: Comprehensive test of admin hierarchy and functionality

const { DatabaseManager } = require('../database/databaseManager.js');
const config = require('../patches/config.js');

class AdminHierarchyTester {
    constructor() {
        this.databaseManager = new DatabaseManager();
        this.testResults = [];
    }

    async initialize() {
        console.log('🔧 Initializing Admin Hierarchy Tester...');
        await this.databaseManager.initialize();
        console.log('✅ Database initialized');
    }

    async logTest(testName, result, details = '') {
        const status = result ? '✅ PASS' : '❌ FAIL';
        console.log(`${status} ${testName}${details ? ` - ${details}` : ''}`);
        this.testResults.push({ testName, result, details });
    }

    async testAdminSetup() {
        console.log('\n📋 Testing Admin Setup...');
        
        // Test 1: Check if admin exists
        const adminChatId = config.ADMIN_CHAT_ID;
        const adminUser = await this.databaseManager.getUser(adminChatId);
        await this.logTest('Admin User Exists', !!adminUser, `Chat ID: ${adminChatId}`);
        
        // Test 2: Check admin privileges
        const isAdmin = await this.databaseManager.isUserAdmin(adminChatId);
        await this.logTest('Admin Privileges', isAdmin, `Is Admin: ${isAdmin}`);
        
        // Test 3: Get all admins
        const allAdmins = await this.databaseManager.getAllAdmins();
        await this.logTest('Get All Admins', allAdmins.length > 0, `Count: ${allAdmins.length}`);
        
        return { adminUser, isAdmin, allAdmins };
    }

    async testUserCreation() {
        console.log('\n👤 Testing User Creation...');
        
        // Test 1: Create regular user
        const testUserId = '123456789';
        const testUserData = {
            username: 'TestUser',
            settings: '{}',
            sol_amount: 0.1,
            primary_wallet_label: 'test',
            is_admin: 0
        };
        
        await this.databaseManager.createUserComplete(testUserId, testUserData);
        const createdUser = await this.databaseManager.getUser(testUserId);
        await this.logTest('Create Regular User', !!createdUser, `Username: ${createdUser?.username}`);
        
        // Test 2: Check user is not admin
        const userIsAdmin = await this.databaseManager.isUserAdmin(testUserId);
        await this.logTest('User Not Admin', !userIsAdmin, `Is Admin: ${userIsAdmin}`);
        
        return { testUserId, createdUser };
    }

    async testAdminPromotion() {
        console.log('\n👑 Testing Admin Promotion...');
        
        const testUserId = '987654321';
        const testUserData = {
            username: 'PromoteUser',
            settings: '{}',
            sol_amount: 0.1,
            primary_wallet_label: 'promote',
            is_admin: 0
        };
        
        // Test 1: Create user as non-admin
        await this.databaseManager.createUserComplete(testUserId, testUserData);
        let isAdmin = await this.databaseManager.isUserAdmin(testUserId);
        await this.logTest('User Created as Non-Admin', !isAdmin, `Initial Admin Status: ${isAdmin}`);
        
        // Test 2: Promote to admin
        await this.databaseManager.setUserAdmin(testUserId, true);
        isAdmin = await this.databaseManager.isUserAdmin(testUserId);
        await this.logTest('User Promoted to Admin', isAdmin, `Promoted Admin Status: ${isAdmin}`);
        
        // Test 3: Check admin count increased
        const allAdmins = await this.databaseManager.getAllAdmins();
        await this.logTest('Admin Count Increased', allAdmins.length > 1, `Total Admins: ${allAdmins.length}`);
        
        return { testUserId };
    }

    async testAdminDemotion() {
        console.log('\n⬇️ Testing Admin Demotion...');
        
        const testUserId = '555666777';
        const testUserData = {
            username: 'DemoteUser',
            settings: '{}',
            sol_amount: 0.1,
            primary_wallet_label: 'demote',
            is_admin: 1  // Start as admin
        };
        
        // Test 1: Create user as admin
        await this.databaseManager.createUserComplete(testUserId, testUserData);
        let isAdmin = await this.databaseManager.isUserAdmin(testUserId);
        await this.logTest('User Created as Admin', isAdmin, `Initial Admin Status: ${isAdmin}`);
        
        // Test 2: Demote from admin
        await this.databaseManager.setUserAdmin(testUserId, false);
        isAdmin = await this.databaseManager.isUserAdmin(testUserId);
        await this.logTest('User Demoted from Admin', !isAdmin, `Demoted Admin Status: ${isAdmin}`);
        
        return { testUserId };
    }

    async testAccessControl() {
        console.log('\n🔒 Testing Access Control...');
        
        // Test 1: Admin can access admin functions
        const adminChatId = config.ADMIN_CHAT_ID;
        const adminIsAdmin = await this.databaseManager.isUserAdmin(adminChatId);
        await this.logTest('Admin Access Control', adminIsAdmin, `Admin ${adminChatId} has access`);
        
        // Test 2: Regular user cannot access admin functions
        const regularUserId = '111222333';
        const regularUserData = {
            username: 'RegularUser',
            settings: '{}',
            sol_amount: 0.1,
            primary_wallet_label: 'regular',
            is_admin: 0
        };
        
        await this.databaseManager.createUserComplete(regularUserId, regularUserData);
        const regularIsAdmin = await this.databaseManager.isUserAdmin(regularUserId);
        await this.logTest('Regular User Access Control', !regularIsAdmin, `User ${regularUserId} has no admin access`);
        
        return { adminChatId, regularUserId };
    }

    async testDatabaseIntegrity() {
        console.log('\n🔍 Testing Database Integrity...');
        
        // Test 1: Check all users
        const allUsers = await this.databaseManager.all('SELECT * FROM users');
        await this.logTest('Database Users Query', allUsers.length > 0, `Total Users: ${allUsers.length}`);
        
        // Test 2: Check admin column exists
        const adminUsers = await this.databaseManager.all('SELECT * FROM users WHERE is_admin = 1');
        await this.logTest('Admin Column Query', adminUsers.length > 0, `Admin Users: ${adminUsers.length}`);
        
        // Test 3: Check user roles
        const regularUsers = await this.databaseManager.all('SELECT * FROM users WHERE is_admin = 0');
        await this.logTest('Regular Users Query', regularUsers.length > 0, `Regular Users: ${regularUsers.length}`);
        
        return { allUsers, adminUsers, regularUsers };
    }

    async runAllTests() {
        console.log('🚀 Starting Admin Hierarchy Tests...\n');
        
        try {
            await this.initialize();
            
            await this.testAdminSetup();
            await this.testUserCreation();
            await this.testAdminPromotion();
            await this.testAdminDemotion();
            await this.testAccessControl();
            await this.testDatabaseIntegrity();
            
            // Summary
            console.log('\n📊 Test Summary:');
            console.log('='.repeat(50));
            
            const passed = this.testResults.filter(r => r.result).length;
            const total = this.testResults.length;
            
            console.log(`✅ Passed: ${passed}/${total}`);
            console.log(`❌ Failed: ${total - passed}/${total}`);
            console.log(`📈 Success Rate: ${((passed / total) * 100).toFixed(1)}%`);
            
            if (passed === total) {
                console.log('\n🎉 All tests passed! Admin hierarchy is working correctly.');
            } else {
                console.log('\n⚠️ Some tests failed. Check the details above.');
            }
            
        } catch (error) {
            console.error('❌ Test execution failed:', error);
        } finally {
            await this.databaseManager.close();
        }
    }
}

// Run tests if called directly
if (require.main === module) {
    const tester = new AdminHierarchyTester();
    tester.runAllTests();
}

module.exports = { AdminHierarchyTester };
