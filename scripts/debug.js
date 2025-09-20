// ==========================================
// ========== ZapBot Debug Script ==========
// ==========================================
// File: scripts/debug.js
// Description: Debug script to check all components and identify issues

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

class ZapBotDebugger {
    constructor() {
        this.issues = [];
        this.warnings = [];
        this.successes = [];
    }

    log(message, type = 'info') {
        const timestamp = new Date().toISOString();
        const prefix = {
            'error': '❌',
            'warning': '⚠️',
            'success': '✅',
            'info': 'ℹ️'
        }[type] || 'ℹ️';
        
        console.log(`${prefix} [${timestamp}] ${message}`);
    }

    async runAllChecks() {
        console.log('🔍 Starting ZapBot Debug Checks...\n');
        
        // 1. Environment Check
        await this.checkEnvironment();
        
        // 2. Dependencies Check
        await this.checkDependencies();
        
        // 3. File Structure Check
        await this.checkFileStructure();
        
        // 4. Database Check
        await this.checkDatabase();
        
        // 5. Redis Check
        await this.checkRedis();
        
        // 6. Configuration Check
        await this.checkConfiguration();
        
        // 7. Module Import Check
        await this.checkModuleImports();
        
        // 8. Summary
        this.printSummary();
    }

    async checkEnvironment() {
        this.log('Checking environment...', 'info');
        
        // Check Node.js version
        try {
            const nodeVersion = process.version;
            const majorVersion = parseInt(nodeVersion.slice(1).split('.')[0]);
            
            if (majorVersion >= 16) {
                this.log(`Node.js version: ${nodeVersion}`, 'success');
                this.successes.push('Node.js version compatible');
            } else {
                this.log(`Node.js version ${nodeVersion} is too old. Need >= 16.0.0`, 'error');
                this.issues.push('Node.js version incompatible');
            }
        } catch (error) {
            this.log('Failed to check Node.js version', 'error');
            this.issues.push('Node.js version check failed');
        }

        // Check .env file
        const envPath = path.join(process.cwd(), '.env');
        if (fs.existsSync(envPath)) {
            this.log('.env file exists', 'success');
            this.successes.push('.env file found');
            
            // Check required environment variables
            const envContent = fs.readFileSync(envPath, 'utf8');
            const requiredVars = [
                'TELEGRAM_BOT_TOKEN',
                'RPC_URL',
                'PUBLIC_KEY',
                'PRIVATE_KEY'
            ];
            
            const missingVars = requiredVars.filter(varName => !envContent.includes(varName));
            if (missingVars.length === 0) {
                this.log('All required environment variables found', 'success');
                this.successes.push('Environment variables complete');
            } else {
                this.log(`Missing environment variables: ${missingVars.join(', ')}`, 'warning');
                this.warnings.push(`Missing env vars: ${missingVars.join(', ')}`);
            }
        } else {
            this.log('.env file not found', 'error');
            this.issues.push('.env file missing');
        }
    }

    async checkDependencies() {
        this.log('Checking dependencies...', 'info');
        
        try {
            // Check if node_modules exists
            const nodeModulesPath = path.join(process.cwd(), 'node_modules');
            if (fs.existsSync(nodeModulesPath)) {
                this.log('node_modules directory exists', 'success');
                this.successes.push('Dependencies installed');
            } else {
                this.log('node_modules directory not found', 'error');
                this.issues.push('Dependencies not installed');
                return;
            }

            // Check critical dependencies
            const criticalDeps = [
                '@solana/web3.js',
                'node-telegram-bot-api',
                'sqlite3',
                'redis',
                'dotenv'
            ];

            for (const dep of criticalDeps) {
                const depPath = path.join(nodeModulesPath, dep);
                if (fs.existsSync(depPath)) {
                    this.log(`${dep} found`, 'success');
                } else {
                    this.log(`${dep} not found`, 'error');
                    this.issues.push(`Missing dependency: ${dep}`);
                }
            }
        } catch (error) {
            this.log('Failed to check dependencies', 'error');
            this.issues.push('Dependency check failed');
        }
    }

    async checkFileStructure() {
        this.log('Checking file structure...', 'info');
        
        const requiredFiles = [
            'zapbot.js',
            'start.js',
            'dataManager.js',
            'config.js',
            'database/dataManager.js',
            'database/schema.sql',
            'redis/redisManager.js'
        ];

        const requiredDirs = [
            'data',
            'logs',
            'database',
            'redis',
            'scripts'
        ];

        // Check required files
        for (const file of requiredFiles) {
            const filePath = path.join(process.cwd(), file);
            if (fs.existsSync(filePath)) {
                this.log(`File exists: ${file}`, 'success');
            } else {
                this.log(`File missing: ${file}`, 'error');
                this.issues.push(`Missing file: ${file}`);
            }
        }

        // Check required directories
        for (const dir of requiredDirs) {
            const dirPath = path.join(process.cwd(), dir);
            if (fs.existsSync(dirPath)) {
                this.log(`Directory exists: ${dir}`, 'success');
            } else {
                this.log(`Directory missing: ${dir}`, 'error');
                this.issues.push(`Missing directory: ${dir}`);
            }
        }
    }

    async checkDatabase() {
        this.log('Checking database setup...', 'info');
        
        try {
            // Check if database directory exists
            const dbDir = path.join(process.cwd(), 'database');
            if (!fs.existsSync(dbDir)) {
                this.log('Database directory not found', 'error');
                this.issues.push('Database directory missing');
                return;
            }

            // Check schema file
            const schemaPath = path.join(dbDir, 'schema.sql');
            if (fs.existsSync(schemaPath)) {
                this.log('Database schema file exists', 'success');
                this.successes.push('Database schema found');
            } else {
                this.log('Database schema file missing', 'error');
                this.issues.push('Database schema missing');
            }

            // Check if database file exists (will be created on first run)
            const dbPath = path.join(dbDir, 'zapbot.db');
            if (fs.existsSync(dbPath)) {
                this.log('Database file exists', 'success');
                this.successes.push('Database file found');
            } else {
                this.log('Database file will be created on first run', 'info');
            }
        } catch (error) {
            this.log('Database check failed', 'error');
            this.issues.push('Database check failed');
        }
    }

    async checkRedis() {
        this.log('Checking Redis setup...', 'info');
        
        try {
            // Try to connect to Redis
            const redis = require('redis');
            const client = redis.createClient({
                host: process.env.REDIS_HOST || 'localhost',
                port: process.env.REDIS_PORT || 6379
            });

            await client.connect();
            await client.ping();
            await client.quit();
            
            this.log('Redis connection successful', 'success');
            this.successes.push('Redis connection working');
        } catch (error) {
            this.log(`Redis connection failed: ${error.message}`, 'warning');
            this.warnings.push('Redis not available - will use fallback');
        }
    }

    async checkConfiguration() {
        this.log('Checking configuration...', 'info');
        
        try {
            const config = require('../config.js');
            
            // Check critical config values
            if (config.RPC_URL) {
                this.log('RPC URL configured', 'success');
                this.successes.push('RPC URL configured');
            } else {
                this.log('RPC URL not configured', 'error');
                this.issues.push('RPC URL missing');
            }

            if (config.BOT_TOKEN) {
                this.log('Telegram bot token configured', 'success');
                this.successes.push('Telegram bot configured');
            } else {
                this.log('Telegram bot token not configured', 'error');
                this.issues.push('Telegram bot token missing');
            }

            if (config.USER_WALLET_PUBKEY && config.USER_WALLET_PRIVATE_KEY) {
                this.log('Wallet configuration found', 'success');
                this.successes.push('Wallet configured');
            } else {
                this.log('Wallet configuration missing', 'error');
                this.issues.push('Wallet configuration missing');
            }
        } catch (error) {
            this.log(`Configuration check failed: ${error.message}`, 'error');
            this.issues.push('Configuration check failed');
        }
    }

    async checkModuleImports() {
        this.log('Checking module imports...', 'info');
        
        const modulesToTest = [
            { name: 'dataManager', path: '../database/dataManager' },
            { name: 'RedisManager', path: '../redis/redisManager' },
            { name: 'DataManager', path: '../dataManager' },
            { name: 'Config', path: '../config.js' }
        ];

        for (const module of modulesToTest) {
            try {
                require(module.path);
                this.log(`${module.name} imports successfully`, 'success');
                this.successes.push(`${module.name} import working`);
            } catch (error) {
                this.log(`${module.name} import failed: ${error.message}`, 'error');
                this.issues.push(`${module.name} import failed`);
            }
        }
    }

    printSummary() {
        console.log('\n' + '='.repeat(50));
        console.log('📊 DEBUG SUMMARY');
        console.log('='.repeat(50));
        
        console.log(`\n✅ Successes (${this.successes.length}):`);
        this.successes.forEach(success => console.log(`  • ${success}`));
        
        if (this.warnings.length > 0) {
            console.log(`\n⚠️ Warnings (${this.warnings.length}):`);
            this.warnings.forEach(warning => console.log(`  • ${warning}`));
        }
        
        if (this.issues.length > 0) {
            console.log(`\n❌ Issues (${this.issues.length}):`);
            this.issues.forEach(issue => console.log(`  • ${issue}`));
        }
        
        console.log('\n' + '='.repeat(50));
        
        if (this.issues.length === 0) {
            console.log('🎉 All checks passed! Bot should be ready to run.');
            console.log('\nNext steps:');
            console.log('1. Ensure Redis is running: redis-server');
            console.log('2. Start the bot: npm start');
        } else {
            console.log('🔧 Please fix the issues above before running the bot.');
        }
        
        console.log('='.repeat(50));
    }
}

// Run debug checks
async function main() {
    const debuggerInstance = new ZapBotDebugger();
    await debuggerInstance.runAllChecks();
}

if (require.main === module) {
    main().catch(error => {
        console.error('💥 Debug script failed:', error);
        process.exit(1);
    });
}

module.exports = { ZapBotDebugger };
