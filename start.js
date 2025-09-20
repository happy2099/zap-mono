// ==========================================
// ========== ZapBot Startup Script ==========
// ==========================================
// File: start.js
// Description: Main startup script for ZapBot with database and Redis initialization

const { DataManager } = require('./dataManager');
const { RedisManager } = require('./redis/redisManager');
const config = require('./config.js');

// Initialize performance monitoring for ULTRA-LOW LATENCY optimizations
const performanceMonitor = require('./performanceMonitor.js');

// Import the leader tracker for ultra-low latency execution
const leaderTracker = require('./leaderTracker.js');

// Start periodic metrics saving
performanceMonitor.startPeriodicSaving(60000); // Save every minute

console.log('🚀 Starting ZapBot with Helius integration...');
console.log('⚡ ULTRA-LOW LATENCY optimizations enabled:');
console.log('   - LaserStream: <100ms detection target');
console.log('   - Sender: <200ms execution target');
console.log('   - Overall: <300ms copy trade cycle target');
console.log('📊 Performance monitoring active');

class ZapBotStartup {
    constructor() {
        this.dataManager = null;
        this.redisManager = null;
        this.isInitialized = false;
        this.healthServer = null;
        this.healthPort = null;
        this.threadedBot = null;
        this.legacyBot = null;
        this.shutdownInProgress = false;
    }

    async initialize() {
        
        try {
            // Step 1: Initialize Data Manager
            console.log('📊 Initializing JSON data manager...');
            this.dataManager = new DataManager();
            await this.dataManager.initialize();
            console.log('✅ Data manager initialized successfully');

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
                console.log('🧵 Threaded mode: Using JSON DataManager');
                // In threaded mode, we use the JSON DataManager
            } else {
                // Step 3: Single-threaded mode - using JSON DataManager
                console.log('📁 Single-threaded mode: Using JSON DataManager');
            }

            // Step 4: Migrate data if needed (only in threaded mode)
            if (isThreadingMode) {
                await this.migrateDataIfNeeded();
            }

            // Step 5: Initialize Leader Tracker for ultra-low latency
            console.log('🎯 Initializing proactive leader tracking...');
            try {
                await leaderTracker.startMonitoring();
                console.log('✅ Proactive leader tracking has been activated.');
            } catch (error) {
                console.warn('⚠️ Leader tracker failed to start:', error.message);
                console.warn('⚠️ Continuing without leader tracking - performance may be reduced.');
            }

            // Step 6: Start the main application
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
        
        // Check if we have any existing data in JSON files
        const users = await this.dataManager.loadUsers();
        const userCount = Object.keys(users).length;
        
        if (userCount === 0) {
            console.log('📦 No existing data found. Starting fresh with JSON data manager...');
            console.log('✅ Data migration completed - using JSON files.');
        } else {
            console.log(`✅ Found ${userCount} existing users in JSON files, no migration needed.`);
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
                dataManager: this.dataManager,
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
            bot.setdataManager(this.dataManager); // Inject the JSON data manager.
            // Note: notificationManager is null in single-threaded mode (handled by telegramWorker in threaded mode)
            if (bot.notificationManager) {
                bot.notificationManager.setdataManager(this.dataManager); // Also inject it into the notification manager for PnL calcs.
            }
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
            if (self.dataManager && self.dataManager.isInitialized) {
                console.log('🚪 Closing database connection to force disk write...');
                await self.dataManager.close();
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
            // Stop leader tracker monitoring
            try {
                await leaderTracker.stopMonitoring();
                console.log('✅ Leader tracker stopped');
            } catch (error) {
                console.warn('⚠️ Leader tracker cleanup warning:', error.message);
            }
            
            if (this.dataManager) {
                await this.dataManager.close();
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
            const dbHealth = await this.dataManager.loadUsers();
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
            if (this.dataManager) {
                console.log('📊 Closing database connection...');
                try {
                    await this.dataManager.shutdown();
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
