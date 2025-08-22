// ==========================================
// ========== ZapBot Startup Script ==========
// ==========================================
// File: start.js
// Description: Main startup script for ZapBot with database and Redis initialization

const { DatabaseManager } = require('./database/databaseManager');
const { RedisManager } = require('./redis/redisManager');
const { DataManager } = require('./dataManager');
const config = require('./patches/config');

class ZapBotStartup {
    constructor() {
        this.databaseManager = null;
        this.redisManager = null;
        this.dataManager = null;
        this.isInitialized = false;
    }

    async initialize() {
        console.log('🚀 Starting ZapBot with Helius integration...');
        
        try {
            // Step 1: Initialize Database
            console.log('📊 Initializing SQLite database...');
            this.databaseManager = new DatabaseManager();
            await this.databaseManager.initialize();
            console.log('✅ Database initialized successfully');

            // Step 2: Initialize Redis (optional)
            console.log('🔴 Initializing Redis for flight data...');
            this.redisManager = new RedisManager();
            try {
                await this.redisManager.initialize();
                await this.redisManager.warmCache();
                console.log('✅ Redis initialized successfully');
            } catch (error) {
                console.warn('⚠️ Redis initialization failed, continuing without Redis:', error.message);
                this.redisManager = null;
            }

            // Step 3: Initialize legacy DataManager (for migration)
            console.log('📁 Initializing legacy data manager...');
            this.dataManager = new DataManager();
            await this.dataManager.initFiles();
            console.log('✅ Legacy data manager initialized');

            // Step 4: Migrate data if needed
            await this.migrateDataIfNeeded();

            // Step 5: Start the main application
            await this.startMainApplication();

            this.isInitialized = true;
            console.log('🎉 ZapBot startup completed successfully!');

        } catch (error) {
            console.error('❌ Startup failed:', error);
            await this.cleanup();
            process.exit(1);
        }
    }

    async migrateDataIfNeeded() {
        try {
            console.log('🔄 Checking for data migration...');
            
            // Check if database is empty
            const userCount = await this.databaseManager.get('SELECT COUNT(*) as count FROM users');
            
            if (userCount.count === 0) {
                console.log('📦 Database is empty, starting migration from JSON files...');
                await this.databaseManager.migrateFromJson(this.dataManager);
                console.log('✅ Data migration completed');
            } else {
                console.log('✅ Database already contains data, skipping migration');
            }
            
        } catch (error) {
            console.warn('⚠️ Migration check failed, continuing with startup:', error.message);
        }
    }

    async startMainApplication() {
        try {
            console.log('🤖 Starting main ZapBot application...');
            
            // Import and start the main bot
            const ZapBot = require('./zapbot');
            
            // Create bot instance with new managers
            const bot = new ZapBot({
                databaseManager: this.databaseManager,
                redisManager: this.redisManager,
                dataManager: this.dataManager
            });

            // Initialize the bot
            await bot.initialize();
            
            console.log('✅ Main application started successfully');
            
            // Set up graceful shutdown
            this.setupGracefulShutdown(bot);
            
        } catch (error) {
            console.error('❌ Failed to start main application:', error);
            throw error;
        }
    }

    setupGracefulShutdown(bot) {
        const shutdown = async (signal) => {
            console.log(`\n🛑 Received ${signal}, shutting down gracefully...`);
            
            try {
                // Stop the bot
                if (bot && typeof bot.shutdown === 'function') {
                    await bot.shutdown();
                }
                
                // Close database connection
                if (this.databaseManager) {
                    await this.databaseManager.close();
                }
                
                // Close Redis connection
                if (this.redisManager) {
                    try {
                        await this.redisManager.cleanup();
                    } catch (error) {
                        console.warn('Redis cleanup warning:', error.message);
                    }
                }
                
                console.log('✅ Graceful shutdown completed');
                process.exit(0);
                
            } catch (error) {
                console.error('❌ Error during shutdown:', error);
                process.exit(1);
            }
        };

        // Handle different shutdown signals
        process.on('SIGINT', () => shutdown('SIGINT'));
        process.on('SIGTERM', () => shutdown('SIGTERM'));
        process.on('SIGQUIT', () => shutdown('SIGQUIT'));
        
        // Handle uncaught exceptions
        process.on('uncaughtException', (error) => {
            console.error('💥 Uncaught Exception:', error);
            shutdown('uncaughtException');
        });
        
        process.on('unhandledRejection', (reason, promise) => {
            console.error('💥 Unhandled Rejection at:', promise, 'reason:', reason);
            shutdown('unhandledRejection');
        });
    }

    async cleanup() {
        console.log('🧹 Cleaning up resources...');
        
        try {
            if (this.databaseManager) {
                await this.databaseManager.close();
            }
            
            if (this.redisManager) {
                await this.redisManager.cleanup();
            }
            
            console.log('✅ Cleanup completed');
            
        } catch (error) {
            console.error('❌ Error during cleanup:', error);
        }
    }

    // Health check method
    async healthCheck() {
        const health = {
            status: 'healthy',
            timestamp: new Date().toISOString(),
            services: {}
        };

        try {
            // Check database
            const dbHealth = await this.databaseManager.get('SELECT 1 as health');
            health.services.database = dbHealth ? 'healthy' : 'unhealthy';
            
            // Check Redis
            if (this.redisManager) {
                const redisHealth = await this.redisManager.healthCheck();
                health.services.redis = redisHealth.status;
            } else {
                health.services.redis = 'not_available';
            }
            
            // Overall status
            const allHealthy = Object.values(health.services).every(status => status === 'healthy');
            health.status = allHealthy ? 'healthy' : 'unhealthy';
            
        } catch (error) {
            health.status = 'unhealthy';
            health.error = error.message;
        }

        return health;
    }
}

// Main startup function
async function main() {
    const startup = new ZapBotStartup();
    
    try {
        await startup.initialize();
        
        // Start health check server
        const http = require('http');
        const server = http.createServer(async (req, res) => {
            if (req.url === '/health') {
                const health = await startup.healthCheck();
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(health, null, 2));
            } else {
                res.writeHead(404);
                res.end('Not Found');
            }
        });
        
        server.listen(3001, () => {
            console.log('🏥 Health check server running on port 3001');
        });
        
    } catch (error) {
        console.error('💥 Fatal startup error:', error);
        process.exit(1);
    }
}

// Run the startup
if (require.main === module) {
    main().catch(error => {
        console.error('💥 Startup failed:', error);
        process.exit(1);
    });
}

module.exports = { ZapBotStartup };
