// ==========================================
// ========== ZapBot Startup Script ==========
// ==========================================
// File: start.js
// Description: Main startup script for ZapBot with database and Redis initialization

const { DatabaseManager } = require('./database/databaseManager');
const { RedisManager } = require('./redis/redisManager');
const config = require('./patches/config');

class ZapBotStartup {
    constructor() {
        this.databaseManager = null;
        this.redisManager = null;
        this.dataManager = null;
        this.isInitialized = false;
        this.healthServer = null;
        this.healthPort = null;
        this.threadedBot = null;
        this.legacyBot = null;
        this.shutdownInProgress = false;
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

            // Step 3: Check if threading mode is enabled
            const isThreadingMode = process.argv.includes('--threading') || 
                                   process.env.THREADING_ENABLED === 'true';
            
            if (isThreadingMode) {
                console.log('🧵 Threaded mode: Skipping legacy DataManager initialization');
                // In threaded mode, we only use DatabaseManager
                this.dataManager = null;
            } else {
                // Step 3: Single-threaded mode - no legacy DataManager needed
                console.log('📁 Single-threaded mode: Using DatabaseManager only');
                this.dataManager = null;
            }

            // Step 4: Migrate data if needed (only in threaded mode)
            if (isThreadingMode) {
                await this.migrateDataIfNeeded();
            }

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
        
        // This is a more robust check. It ensures the table exists before querying it.
        // The DatabaseManager's initialize() should have already created it.
        const userCountResult = await this.databaseManager.get("SELECT name FROM sqlite_master WHERE type='table' AND name='users';");

        if (!userCountResult) {
            // This case should ideally not be hit if initialize() works, but it's a good safeguard.
            console.log('📦 Users table not found. Assuming first-time run. Starting migration...');
            console.log('📦 No legacy data to migrate - using DatabaseManager only');
            console.log('✅ Data migration completed on fresh DB.');
            return;
        }

        // Now that we know the table exists, we can safely check the count.
        const rowCount = await this.databaseManager.get('SELECT COUNT(id) as count FROM users');
        
        if (rowCount && rowCount.count === 0) {
            console.log('📦 Database is empty, starting migration from JSON files...');
            console.log('📦 No legacy data to migrate - using DatabaseManager only');
            console.log('✅ Data migration completed.');
        } else {
            console.log('✅ Database already contains data, skipping migration.');
        }
        
    } catch (error) {
        console.error('❌ Migration check failed catastrophically. Bot may not have user data.', error);
        // We throw the error here because a failed migration is a critical startup problem.
        throw new Error(`Migration check failed: ${error.message}`);
    }
}

    async startMainApplication() {
        try {
            console.log('🤖 Starting main ZapBot application...');
            
            // Check if threading mode is enabled
            const isThreadingMode = process.argv.includes('--threading') || 
                                   process.env.THREADING_ENABLED === 'true';
            
            if (isThreadingMode) {
                console.log('🧵 Starting in THREADED mode...');
                await this.startThreadedApplication();
            } else {
                console.log('🔧 Starting in SINGLE-THREADED mode...');
                await this.startSingleThreadedApplication();
            }
            
        } catch (error) {
            console.error('❌ Failed to start main application:', error);
            throw error;
        }
    }

    async startThreadedApplication() {
        try {
            // Import and start the threaded bot
            const ThreadedZapBot = require('./threadedZapBot');
            
            // Create threaded bot instance
            const bot = new ThreadedZapBot({
                databaseManager: this.databaseManager,
                redisManager: this.redisManager,
                dataManager: this.dataManager,
                maxWorkerMemory: process.env.MAX_WORKER_MEMORY || '1GB',
                workerRestartDelay: parseInt(process.env.WORKER_RESTART_DELAY) || 5000,
                maxConcurrentTrades: parseInt(process.env.MAX_CONCURRENT_TRADES) || 50,
                maxQueueSize: parseInt(process.env.MAX_QUEUE_SIZE) || 1000,
                heartbeatInterval: parseInt(process.env.HEARTBEAT_INTERVAL) || 30000,
                taskTimeout: parseInt(process.env.TASK_TIMEOUT) || 30000
            });

            // Initialize the threaded bot
            await bot.initialize();
            
            console.log('✅ Threaded application started successfully');
            
            // Set up graceful shutdown
            this.setupGracefulShutdown(bot);
            
        } catch (error) {
            console.error('❌ Failed to start threaded application:', error);
            throw error;
        }
    }

    async startSingleThreadedApplication() {
        try {
            // Import and start the main bot
            const ZapBot = require('./zapbot');
           

            // CRITICAL FIX: Instantiate the bot, THEN give it the real managers.
            const bot = new ZapBot();
            bot.setDatabaseManager(this.databaseManager); // Inject the one true DB manager.
            bot.notificationManager.setDatabaseManager(this.databaseManager); // Also inject it into the notification manager for PnL calcs.
            // bot.setRedisManager(this.redisManager); // Optional for future Redis use

            // Initialize the bot with the correct context
            await bot.initialize();

            // Initialize the bot
            await bot.initialize();
            
            console.log('✅ Single-threaded application started successfully');
            
            // Set up graceful shutdown
            this.setupGracefulShutdown(bot);
            
        } catch (error) {
            console.error('❌ Failed to start single-threaded application:', error);
            throw error;
        }
    }

    setupGracefulShutdown(bot) {
    // Capture the 'this' context of the ZapBotStartup instance
    const self = this;

    const shutdown = async (signal) => {
        console.log(`\n🛑 Received ${signal}, shutting down gracefully...`);
        
        try {
            // Stop the bot
            if (bot && typeof bot.shutdown === 'function') {
                await bot.shutdown();
            }
            
            // Close database connection, using the captured 'self' context
            if (self.databaseManager && self.databaseManager.isInitialized) {
                console.log('🚪 Closing database connection to force disk write...');
                await self.databaseManager.close();
                console.log('✅ Database connection closed.');
            }
            
            // Close Redis connection
            if (self.redisManager) {
                try {
                    await self.redisManager.cleanup();
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
            services: {},
            mode: process.argv.includes('--threading') || process.env.THREADING_ENABLED === 'true' ? 'threaded' : 'single-threaded'
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
            
            // Check threading mode
            if (health.mode === 'threaded') {
                health.services.threading = 'enabled';
                // Note: Worker health checks would be handled by the ThreadedZapBot instance
            } else {
                health.services.threading = 'disabled';
            }
            
            // Overall status
            const allHealthy = Object.values(health.services).every(status => 
                status === 'healthy' || status === 'enabled' || status === 'not_available'
            );
            health.status = allHealthy ? 'healthy' : 'unhealthy';
            
        } catch (error) {
            health.status = 'unhealthy';
            health.error = error.message;
        }

        return health;
    }

    async shutdown() {
        if (this.shutdownInProgress) {
            console.log('🔄 Shutdown already in progress...');
            return;
        }
        
        this.shutdownInProgress = true;
        console.log('🛑 Starting graceful shutdown...');
        
        try {
            // 1. Stop health check server
            if (this.healthServer) {
                console.log('🔌 Closing health check server...');
                await new Promise((resolve) => {
                    this.healthServer.close(() => {
                        console.log('✅ Health check server closed');
                        resolve();
                    });
                });
            }

            // 2. Stop threaded bot if running
            if (this.threadedBot) {
                console.log('🧵 Stopping threaded bot...');
                try {
                    await this.threadedBot.shutdown();
                    console.log('✅ Threaded bot stopped');
                } catch (error) {
                    console.error('❌ Error stopping threaded bot:', error.message);
                }
            }

            // 3. Stop legacy bot if running
            if (this.legacyBot) {
                console.log('🔄 Stopping legacy bot...');
                try {
                    await this.legacyBot.shutdown();
                    console.log('✅ Legacy bot stopped');
                } catch (error) {
                    console.error('❌ Error stopping legacy bot:', error.message);
                }
            }

            // 4. Close Redis connection
            if (this.redisManager) {
                console.log('🔴 Closing Redis connection...');
                try {
                    await this.redisManager.shutdown();
                    console.log('✅ Redis connection closed');
                } catch (error) {
                    console.error('❌ Error closing Redis:', error.message);
                }
            }

            // 5. Close database connection
            if (this.databaseManager) {
                console.log('📊 Closing database connection...');
                try {
                    await this.databaseManager.shutdown();
                    console.log('✅ Database connection closed');
                } catch (error) {
                    console.error('❌ Error closing database:', error.message);
                }
            }

            console.log('✅ Graceful shutdown completed');
            
        } catch (error) {
            console.error('❌ Error during shutdown:', error);
        } finally {
            // Force exit after a short delay
            setTimeout(() => {
                console.log('🚪 Forcing process exit...');
                process.exit(0);
            }, 2000);
        }
    }
}

// Main startup function
async function main() {
    const startup = new ZapBotStartup();
    
    // Set up signal handlers for graceful shutdown
    const setupSignalHandlers = () => {
        const signals = ['SIGINT', 'SIGTERM', 'SIGQUIT', 'SIGHUP'];
        
        signals.forEach(signal => {
            process.on(signal, async () => {
                console.log(`\n📡 Received ${signal}, initiating graceful shutdown...`);
                await startup.shutdown();
            });
        });

        // Handle uncaught exceptions
        process.on('uncaughtException', async (error) => {
            console.error('💥 Uncaught Exception:', error);
            await startup.shutdown();
        });

        // Handle unhandled promise rejections
        process.on('unhandledRejection', async (reason, promise) => {
            console.error('💥 Unhandled Rejection at:', promise, 'reason:', reason);
            await startup.shutdown();
        });
    };

    // Set up signal handlers first
    setupSignalHandlers();
    
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
        
        // Store server reference for shutdown
        startup.healthServer = server;
        
        // Function to find an available port
        const findAvailablePort = (startPort) => {
            return new Promise((resolve, reject) => {
                const testServer = require('http').createServer();
                testServer.listen(startPort, () => {
                    const port = testServer.address().port;
                    testServer.close(() => resolve(port));
                });
                testServer.on('error', (err) => {
                    if (err.code === 'EADDRINUSE') {
                        findAvailablePort(startPort + 1).then(resolve).catch(reject);
                    } else {
                        reject(err);
                    }
                });
            });
        };

        // Start health check server on available port
        findAvailablePort(3001).then(port => {
            startup.healthPort = port;
            server.listen(port, () => {
                console.log(`🏥 Health check server running on port ${port}`);
            });
        }).catch(err => {
            console.error('❌ Failed to find available port for health check server:', err);
        });
        
    } catch (error) {
        console.error('💥 Fatal startup error:', error);
        await startup.shutdown();
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
