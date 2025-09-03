// ==========================================
// ====== ZapBot Main (Final Merged) ========
// ==========================================
// File: zapbot.js
// Description: Main orchestrator for the modularized Solana copy trading bot.

// Core Node.js Modules / Utils
const TelegramBot = require('node-telegram-bot-api');
const path = require('path');
const fs = require('fs/promises');

// Project Modules (CommonJS requires)
const config = require('./config.js');
const { DatabaseManager } = require('./database/databaseManager.js');
const { SolanaManager } = require('./solanaManager.js');
const TelegramUI = require('./telegramUi.js');
const WalletManager = require('./walletManager.js');
const { TransactionAnalyzer } = require('./transactionAnalyzer.js');
const { ApiManager } = require('./apiManager.js');
const TradeNotificationManager = require('./tradeNotifications.js');
const { escapeMarkdownV2, shortenAddress } = require('./utils.js');
const { PublicKey } = require('@solana/web3.js');
const { RedisManager } = require('./redis/redisManager.js');
const { LaserStreamManager } = require('./laserstreamManager.js');
const platformBuilders = require('./platformBuilders.js');

class ZapBot {
    constructor() {
        this.isInitialized = false;
        this.isShuttingDown = false;
        this.periodicTaskInterval = null;
        this.activeSubscriptions = new Map();
        this.processedLaunchpadPools = new Set();
        this.subscribedTraderWalletsMap = new Map();

        console.log("ZapBot core modules instantiated. Awaiting initialization...");

        this.databaseManager = null; // We will inject the real one.
        this.solanaManager = new SolanaManager();
        this.apiManager = new ApiManager(this.solanaManager);
        // Pass null for now, it will be injected.
        this.walletManager = new WalletManager(this.databaseManager);
        this.walletManager.setSolanaManager(this.solanaManager);
        this.redisManager = new RedisManager();

        // Pass null for now, it will be injected.
        this.telegramUi = new TelegramUI(
            this.databaseManager,
            this.solanaManager,
            this.walletManager
        );
        this.notificationManager = new TradeNotificationManager(
            this.telegramUi.bot, // This is fine for now
            this.apiManager
        );

        this.transactionAnalyzer = null;
        this.tradingEngine = null;
    }

    // ADD THIS ENTIRE NEW FUNCTION
    setDatabaseManager(dbManager) {
        console.log("[ZAPBOT-CORE] ✅ DatabaseManager instance has been successfully injected.");
        this.databaseManager = dbManager;

        // Now, pass the REAL database manager to all child components.
        this.walletManager.databaseManager = dbManager;
        this.telegramUi.databaseManager = dbManager;
        this.telegramUi.isDatabaseManager = true; // IMPORTANT: Tell the UI to use DB mode.
    }

    async initialize() {
        if (this.isInitialized) {
            console.warn("ZapBot is already initialized.");
            return;
        }

        console.log('--- Starting Bot Initialization Sequence ---');

        // 1. Initialize data layer
        if (!this.databaseManager) {
             throw new Error("DatabaseManager was not injected. Bot cannot start.");
        }
        console.log('1/6: ✅ DatabaseManager is live and ready.');
        // No files to init, the database is already connected.

        // 2. Initialize Solana connection
        try {
            await this.solanaManager.initialize();
            console.log('2/6: ✅ SolanaManager initialized.');
        } catch (e) {
            throw new Error(`Failed to initialize SolanaManager: ${e.message}`);
        }

        // 3. Initialize WalletManager
        try {
            // 1. Give the connection to the instance we created in the constructor.
            this.walletManager.setConnection(this.solanaManager.connection);
            // 2. Initialize THAT instance. Do not create a new one.
            await this.walletManager.initialize();
            console.log('3/6: ✅ WalletManager initialized.');

            // this.processedLaunchpadPools = await this.dataManager.loadProcessedPools(); // Removed - using database now
            console.log(`🧠 Bot Brain Loaded: Recalling ${this.processedLaunchpadPools.size} previously processed pools.`);
        } catch (e) {
            throw new Error(`Failed to initialize WalletManager: ${e.message}`);
        }

        // 4. Initialize Telegram UI
        try {
            const initResult = this.telegramUi.initialize();
            if (initResult && initResult.mode === 'headless') {
                console.log('4/6: ⚠️ TelegramUI running in headless mode (no bot token).');
            } else if (!this.telegramUi.bot) {
                throw new Error("TelegramUI failed to initialize TelegramBot instance.");
            } else {
                this.telegramUi.bindActionHandlers({
                    onStartCopy: this.handleStartCopy.bind(this),
                    onStopCopy: this.handleStopCopy.bind(this),
                    onRemoveTrader: this.handleRemoveTrader.bind(this),
                    onAddTrader: this.handleAddTrader.bind(this),
                    onSetSolAmount: this.handleSetSolAmount.bind(this),
                    onGenerateWallet: this.handleGenerateWallet.bind(this),
                    onImportWallet: this.handleImportWallet.bind(this),
                    onResetData: this.handleResetData.bind(this),
            
                    onDeleteWallet: this.handleDeleteWallet.bind(this),
                    onWithdraw: this.handleWithdraw.bind(this),
                    onConfirmWithdraw: this.handleConfirmWithdraw.bind(this),
                    onManualCopy: this.handleManualCopy.bind(this),
                });
                console.log('4/6: ✅ TelegramUI initialized and wired.');
            }
        } catch (e) {
            throw new Error(`Failed to initialize TelegramUI: ${e.message}`);
        }

        // 5. Initialize TradeNotificationManager
        try {
            this.notificationManager = new TradeNotificationManager(
                this.telegramUi.bot || null,
                this.apiManager
            );
            this.notificationManager.setConnection(this.solanaManager.connection);
            console.log('5/6: ✅ TradeNotificationManager initialized.');
        } catch (e) {
            throw new Error(`Failed to initialize TradeNotificationManager: ${e.message}`);
        }

        // 6. Initialize TransactionAnalyzer and TradingEngine
        try {
    this.transactionAnalyzer = new TransactionAnalyzer(this.solanaManager.connection, this.apiManager);
    console.log('✅ TransactionAnalyzer created with live connection.');

            const { TradingEngine } = require('./tradingEngine.js');
            this.tradingEngine = new TradingEngine({
                solanaManager: this.solanaManager,
                databaseManager: this.databaseManager,
                walletManager: this.walletManager,
                transactionAnalyzer: this.transactionAnalyzer,
                notificationManager: this.notificationManager,
                apiManager: this.apiManager,
                redisManager: this.redisManager
            });
            console.log('✅ TradingEngine created with all modules.');

            // ---- Link the LaserStream Manager ----
            this.laserstreamManager = new LaserStreamManager(this.tradingEngine);
            this.laserstreamManager.on('status_change', this._handleLaserStreamStatusChange.bind(this));
            console.log('✅ LaserStreamManager created and linked to TradingEngine.');
            // ------------------------------------

            console.log('6/6: ✅ TransactionAnalyzer, TradingEngine, and LaserStream Manager configured.');
        } catch (e) {
            throw new Error(`Failed to initialize core trading components: ${e.message}`);
        }

        // 7. Prime caches and start tasks (keep this as is)
        try {
            await this.primeCachesAndSync();
            console.log('7/7: ✅ Caches primed.');

            // --- START DESIRED REAL-TIME / SCANNING SERVICES (Stage 2A) ---
            // Only start what's needed for the current phase to prevent unnecessary API calls or errors.

            // Stage 2A: Core Trader-following functionality (relies on `onLogs` listeners set here)
            // this.startGlobalPlatformSnipers();  // ✅ UPGRADED
            // this.setupPeriodicTasks(); // Back-up polling, less efficient
            // this.setupUniversalScanner(); // This one line replaces all the old ones.

            // --- FINAL STEP: Activate the correct monitoring mode , we need to remove after uprading solanatracker premium plan ---
            this.syncAndStartMonitoring();
            this.setupCacheJanitor();

            // Set initialized status AFTER all internal components have been successfully started.
            this.isInitialized = true;
            console.log('--- Bot Initialization Successfully Completed! ---');
            console.log("Real-time monitoring and periodic tasks started."); // THIS LOG WILL FIRE after bot init success
        } catch (e) {
            // This catch block handles errors *within* primeCachesAndSync or starting scanners/monitors.
            throw new Error(`Failed to prime caches or start tasks: ${e.message}`);
        }


        // 8. Send startup message to Admin
        if (this.telegramUi.bot && process.env.ADMIN_CHAT_ID) {
            try {
                const chatId = parseInt(process.env.ADMIN_CHAT_ID);
                if (!isNaN(chatId)) {
                    await this.telegramUi.bot.sendMessage(
                        chatId,
                        `🎉 *ZapBot is fully operational\\!*`,
                        { parse_mode: 'MarkdownV2' }
                    );
                } else {
                    console.warn('Invalid ADMIN_CHAT_ID; skipping startup message.');
                }
            } catch (e) {
                console.warn('Could not send startup message to Telegram:', e.message);
            }
        }
    }

    // setupUniversalScanner() {
    //     const SCAN_INTERVAL_MS = 60000; // Scan all markets once per minute
    //     console.log(`[UNIVERSAL_SCAN] Unified Proactive Scanner deployed. Interval: ${SCAN_INTERVAL_MS / 1000}s`);

    //     const scan = async () => {
    //         if (this.isShuttingDown) return;

    //         try {
    //             // 1. Call our new, all-powerful fetcher in apiManager
    //             const newPools = await this.apiManager.fetchLatestUniversalPools();
    //             if (!newPools || newPools.length === 0) {
    //                 return; // No new pools found, mission complete for this cycle.
    //             }

    //             const users = await this.dataManager.loadUsers();

    //             // 2. Loop through every single pool the universal scanner found
    //             for (const pool of newPools) {
    //                 // Use a universal identifier for the processed check. Mint or PoolID.
    //                 const uniqueId = pool.mint || pool.poolId || pool.base_mint;
    //                 if (!uniqueId || this.processedLaunchpadPools.has(uniqueId)) {
    //                     continue; // Skip if no ID or already processed
    //                 }
    //                 this.processedLaunchpadPools.add(uniqueId);

    //                 console.log(`[UNIVERSAL_SCAN] ⚡ New asset on ${pool.platform}: ${shortenAddress(uniqueId)}. Pre-building for all users...`);

    //                 // 3. Loop through every user to pre-build their personalized trade
    //                 for (const userId in users) {
    //                     try {
    //                         const keypairPacket = await this.walletManager.getPrimaryTradingKeypair(userId);
    //                         if (!keypairPacket) continue; // Skip user if no trading wallet

    //                         let tradeData = {
    //                             tradeType: 'buy',
    //                             inputMint: config.NATIVE_SOL_MINT,
    //                             prebuiltInstructions: null
    //                         };
    //                         let outputMint; // The new token we are targeting

    //                         // 4. This SWITCH is the brain. It routes based on the 'market' key we created.
    //                         switch (pool.market) {
    //                             case 'pumpfun_bc':
    //                                 outputMint = pool.mint;
    //                                 tradeData.dexPlatform = 'Pump.fun BC';
    //                                 tradeData.outputMint = outputMint;
    //                                 tradeData.prebuiltInstructions = await platformBuilders.buildPumpPrebuiltInstruction({
    //                                     connection: this.solanaManager.connection,
    //                                     outputMint: outputMint,
    //                                     userPublicKey: keypairPacket.keypair.publicKey,
    //                                     amountBN: new BN(10000000) // 0.01 SOL placeholder
    //                                 });
    //                                 break;

    //                             case 'pumpfun_amm':
    //                                 outputMint = pool.baseMint === config.NATIVE_SOL_MINT ? pool.quoteMint : pool.baseMint;
    //                                 tradeData.dexPlatform = 'Pump.fun AMM';
    //                                 tradeData.outputMint = outputMint;
    //                                 tradeData.platformSpecificData = { poolId: pool.poolId };
    //                                 tradeData.prebuiltInstructions = await platformBuilders.buildPumpFunAmmInstruction({
    //                                     connection: this.solanaManager.connection,
    //                                     keypair: keypairPacket.keypair,
    //                                     swapDetails: tradeData,
    //                                     amountBN: new BN(10000000),
    //                                     slippageBps: 2500
    //                                 });
    //                                 break;

    //                             case 'raydium_launchpad':
    //                                 if (!pool.configId) {
    //                                     console.warn(`[UNIVERSAL_SCAN] Raydium Launchpad pool ${pool.poolId} missing configId. Skipping.`);
    //                                     continue;
    //                                 }
    //                                 const poolState = await this.apiManager.fetchRaydiumLaunchpadState(this.solanaManager.connection, pool.poolId);
    //                                 if (poolState?.isComplete) {
    //                                     console.log(`[UNIVERSAL_SCAN] Launchpad pool ${pool.poolId} already completed. Skipping.`);
    //                                     continue;
    //                                 }
    //                                 outputMint = pool.tokenMint;
    //                                 tradeData.dexPlatform = 'Raydium Launchpad';
    //                                 tradeData.outputMint = outputMint;
    //                                 tradeData.platformSpecificData = {
    //                                     poolId: pool.poolId,
    //                                     configId: pool.configId
    //                                 };
    //                                 tradeData.prebuiltInstructions = await platformBuilders.buildRaydiumLaunchpadInstruction({
    //                                     connection: this.solanaManager.connection,
    //                                     keypair: keypairPacket.keypair,
    //                                     swapDetails: tradeData,
    //                                     amountBN: new BN(10000000), // 0.01 SOL placeholder
    //                                     slippageBps: 1000, // 1% for launchpad buys
    //                                     cachedPoolData: null,
    //                                     updateCache: (data) => this.redisManager.addLaunchpadPoolData(pool.poolId, data)
    //                                 });
    //                                 if (tradeData.prebuiltInstructions) {
    //                                     this._precacheSellInstruction(pool.poolId, {
    //                                         ...tradeData,
    //                                         tradeType: 'sell',
    //                                         inputMint: outputMint,
    //                                         originalSolSpent: 0.01 // Track SOL spent for PnL
    //                                     });
    //                                 }
    //                                 break;

    //                             case 'raydium_amm':
    //                                 outputMint = pool.baseMint === config.NATIVE_SOL_MINT ? pool.quoteMint : pool.baseMint;
    //                                 tradeData.dexPlatform = 'Raydium V4';
    //                                 tradeData.outputMint = outputMint;
    //                                 tradeData.platformSpecificData = { poolId: pool.poolId };
    //                                 tradeData.prebuiltInstructions = await platformBuilders.buildRaydiumV4Instruction({
    //                                     connection: this.solanaManager.connection,
    //                                     userPublicKey: keypairPacket.keypair.publicKey,
    //                                     swapDetails: tradeData,
    //                                     amountBN: new BN(10000000),
    //                                     slippageBps: 2500
    //                                 });
    //                                 break;

    //                             case 'raydium_clmm':
    //                                 outputMint = pool.baseMint === config.NATIVE_SOL_MINT ? pool.quoteMint : pool.baseMint;
    //                                 tradeData.dexPlatform = 'Raydium CLMM';
    //                                 tradeData.outputMint = outputMint;
    //                                 tradeData.platformSpecificData = { poolId: pool.poolId, feeTier: pool.feeTier || '0.25%' };
    //                                 tradeData.prebuiltInstructions = await platformBuilders.buildRaydiumClmmInstruction({
    //                                     connection: this.solanaManager.connection,
    //                                     userPublicKey: keypairPacket.keypair.publicKey,
    //                                     swapDetails: tradeData,
    //                                     amountBN: new BN(10000000),
    //                                     slippageBps: 1000
    //                                 });
    //                                 break;

    //                             case 'meteora_dlmm':
    //                                 outputMint = pool.baseMint === config.NATIVE_SOL_MINT ? pool.quoteMint : pool.baseMint;
    //                                 tradeData.dexPlatform = 'Meteora DLMM';
    //                                 tradeData.outputMint = outputMint;
    //                                 tradeData.platformSpecificData = { poolId: pool.poolId, binId: pool.binId || 'active' };
    //                                 tradeData.prebuiltInstructions = await platformBuilders.buildMeteoraDLMMInstruction({
    //                                     connection: this.solanaManager.connection,
    //                                     userPublicKey: keypairPacket.keypair.publicKey,
    //                                     swapDetails: tradeData,
    //                                     amountBN: new BN(10000000),
    //                                     slippageBps: 500
    //                                 });
    //                                 break;

    //                             case 'meteora_dbc':
    //                                 outputMint = pool.baseMint === config.NATIVE_SOL_MINT ? pool.quoteMint : pool.baseMint;
    //                                 tradeData.dexPlatform = 'Meteora DBC';
    //                                 tradeData.outputMint = outputMint;
    //                                 tradeData.platformSpecificData = { poolId: pool.poolId };
    //                                 tradeData.prebuiltInstructions = await platformBuilders.buildMeteoraDBCInstruction({
    //                                     connection: this.solanaManager.connection,
    //                                     userPublicKey: keypairPacket.keypair.publicKey,
    //                                     swapDetails: tradeData,
    //                                     amountBN: new BN(10000000),
    //                                     slippageBps: 1000
    //                                 });
    //                                 break;
    //                                  case 'meteora_cpamm': // Assuming this market type from universal scanner
    //                                 outputMint = pool.baseMint === config.NATIVE_SOL_MINT ? pool.quoteMint : pool.baseMint;
    //                                 tradeData.dexPlatform = 'Meteora CP-AMM'; // Consistent with analyzer
    //                                 tradeData.outputMint = outputMint;
    //                                 tradeData.platformSpecificData = { poolId: pool.poolId };
    //                                 tradeData.prebuiltInstructions = await platformBuilders.buildMeteoraCpAmmInstruction({
    //                                     connection: this.solanaManager.connection,
    //                                     userPublicKey: keypairPacket.keypair.publicKey,
    //                                     swapDetails: tradeData, // Pass the correct tradeData
    //                                     amountBN: new BN(10000000),
    //                                     slippageBps: 500 // Adjust slippage as needed for CP-AMM
    //                                 });
    //                                 break;

    //                             default:
    //                                 console.warn(`[UNIVERSAL_SCAN] Unsupported market type: ${pool.market}. Skipping pre-build for ${shortenAddress(uniqueId)}.`);
    //                                 continue;
    //                         }

    //                         // 5. If we successfully pre-built instructions, cache them (except Launchpad, handled above)
    //                         if (outputMint && tradeData.prebuiltInstructions && pool.market !== 'raydium_launchpad') {
    //                             this.redisManager.addTradeData(outputMint, tradeData);
    //                         }

    //                     } catch (error) {
    //                         console.error(`[UNIVERSAL_SCAN] Pre-build error for ${shortenAddress(uniqueId)} on user ${userId}:`, error.message);
    //                     }
    //                 }
    //             }
    //             await this.dataManager.saveProcessedPools(this.processedLaunchpadPools);
    //         } catch (error) {
    //             console.error(`[UNIVERSAL_SCAN] CRITICAL error in main scanner loop:`, error.message);
    //         }
    //     };

    //     setInterval(scan, SCAN_INTERVAL_MS);
    //     setTimeout(scan, 5000); // Run once on startup
    // }


    setupCacheJanitor() {
        const JANITOR_INTERVAL_MS = 60000; // Run the janitor once every 60 seconds
        console.log(`[JANITOR] Quantum Janitor engaged. Cleaning every ${JANITOR_INTERVAL_MS / 1000}s`);

        setInterval(async () => {
            if (this.isShuttingDown) return;

            try {
                const allCachedMints = Array.from(this.redisManager.tradeReadyCache.keys());
                if (allCachedMints.length === 0) return;

                // Batch fetch prices and metadata
                const [prices, metadatas] = await Promise.all([
                    this.apiManager.getTokenPrices(allCachedMints),
                    this.apiManager.getTokenMetadatas(allCachedMints) // New metadata fetcher
                ]);

                for (const mint of allCachedMints) {
                    const cacheEntry = this.redisManager.tradeReadyCache.get(mint);
                    if (!cacheEntry) continue;

                    // Enhanced metadata handling
                    const metadata = metadatas.get(mint) || cacheEntry.metadata || {};
                    const { totalSupply, decimals } = metadata;

                    if (totalSupply === undefined || decimals === undefined) {
                        console.warn(`[JANITOR] Missing metadata for ${shortenAddress(mint)}. Skipping this cycle.`);
                        continue;
                    }

                    const price = prices.get(mint);
                    if (price === undefined) {
                        console.warn(`[JANITOR] No price data for ${shortenAddress(mint)}. Skipping.`);
                        continue;
                    }

                    // Universal market cap calculation
                    const marketCap = (Number(totalSupply) / (10 ** decimals)) * price;
                    const tokenAgeMs = Date.now() - (cacheEntry.timestamp || 0);

                    // Platform-specific rules
                    let prune = false;
                    let reason = '';
                    const platform = cacheEntry.dexPlatform || 'Unknown';

                    // 1. Pump.fun rules (BC & AMM)
                    if (platform.includes('Pump.fun')) {
                        if (marketCap < config.JANITOR_PUMP_MCAP_THRESHOLD) {
                            prune = true;
                            reason = `${platform} MCap $${marketCap.toFixed(2)} < $${config.JANITOR_PUMP_MCAP_THRESHOLD}`;
                        }
                    }
                    // 2. Launchpad rules
                    else if (platform.includes('Launchpad')) {
                        const graceExpired = tokenAgeMs > (config.JANITOR_LAUNCHPAD_GRACE_MS || 300000); // 5 minutes default
                        if (graceExpired && (marketCap < (config.JANITOR_LAUNCHPAD_MCAP_THRESHOLD || 50000) || marketCap === 0)) {
                            prune = true;
                            reason = `${platform} MCap $${marketCap.toFixed(2)} < $${config.JANITOR_LAUNCHPAD_MCAP_THRESHOLD} after ${Math.floor(tokenAgeMs / 60000)}m`;
                        }
                    }
                    // 3. General DEX rules (Raydium V4/CLMM, Meteora DLMM/DBC)
                    else {
                        const graceExpired = tokenAgeMs > (config.JANITOR_DEX_GRACE_MS || 3600000); // 1 hour default
                        if (graceExpired && marketCap < (config.JANITOR_DEX_MCAP_THRESHOLD || 250000)) {
                            prune = true;
                            reason = `${platform} MCap $${marketCap.toFixed(2)} < $${config.JANITOR_DEX_MCAP_THRESHOLD} after ${Math.floor(tokenAgeMs / 3600000)}h`;
                        }
                    }

                    if (prune) {
                        this.redisManager.tradeReadyCache.delete(mint);
                        console.log(`[JANITOR] 🧹 Pruned ${shortenAddress(mint)} (${platform}): ${reason}`);
                    }
                }
            } catch (error) {
                console.error(`[JANITOR] Cycle failed:`, error.message);
            }
        }, JANITOR_INTERVAL_MS);
    }

    async handleManualCopy(chatId, signature) {
        console.log(`[MANUAL FIRE CONTROL] Received /copy command. Target signature: ${signature}`);
        await this.telegramUi.sendOrEditMessage(chatId, `🎯 *TARGET ACQUIRED*\\nAuthorizing copy for sig: \`${escapeMarkdownV2(signature)}\``, {});

        // --- IMPORTANT: Find which trader this signature belongs to ---
        // This is the hardest part of manual mode. You need to know which trader to simulate.
        // For this op, let's assume we test against the FIRST configured active trader.
        const syndicateData = await this.databaseManager.loadTraders();
        const userTraders = syndicateData.user_traders[String(chatId)];

        let targetTraderWallet = null;
        let targetTraderName = 'Unknown';
        if (userTraders) {
            for (const name in userTraders) {
                if (userTraders[name].active) {
                    targetTraderWallet = userTraders[name].wallet;
                    targetTraderName = name;
                    break;
                }
            }
        }

        if (!targetTraderWallet) {
            await this.telegramUi.sendErrorMessage(chatId, "Live Fire Failed: No active trader is configured for this test.");
            return;
        }
        console.log(`[MANUAL FIRE CONTROL] Simulating activity from trader: ${targetTraderName} (${targetTraderWallet})`);

        // Now, we feed this directly into the bot's brain.
        await this.tradingEngine.processSignature(targetTraderWallet, signature);
    }


    // --- Action Handlers ---
    async handleStartCopy(chatId, traderName) {
        console.log(`[Action] START request for ${traderName} from chat ${chatId}`);
        try {
            // Update trader status in database
            await this.databaseManager.updateTraderStatus(chatId, traderName, true);
            // Re-sync and restart the global snipers to pick up the new active trader
            // this.startGlobalPlatformSnipers(); 
            this.syncAndStartMonitoring();
            await this.telegramUi.showMainMenu(chatId);
        } catch (e) {
            await this.telegramUi.sendErrorMessage(chatId, `Failed to start copying: ${e.message}`);
        }
    }

    async handleStopCopy(chatId, traderName) {
        console.log(`[Action] STOP request for ${traderName} from chat ${chatId}`);
        try {
            // Update trader status in database
            await this.databaseManager.updateTraderStatus(chatId, traderName, false);
            // Re-sync and restart the global snipers to remove the inactive trader
            // this.startGlobalPlatformSnipers(); 
            this.syncAndStartMonitoring();
            await this.telegramUi.showMainMenu(chatId);
        } catch (e) {
            await this.telegramUi.sendErrorMessage(chatId, `Failed to stop copying: ${e.message}`);
        }
    }


    async handleRemoveTrader(chatId, traderName) {
        console.log(`[Action] REMOVE request for ${traderName} from chat ${chatId}`);
        try {
            // Get user to get internal user ID
            const user = await this.databaseManager.getUser(chatId);
            if (!user) {
                throw new Error('User not found');
            }
            
            // Remove trader from database
            await this.databaseManager.deleteTrader(user.id, traderName);
            
            const message = `✅ Trader *${traderName}* has been removed successfully!`;
            await this.telegramUi.sendOrEditMessage(chatId, message, {
                reply_markup: { inline_keyboard: [[{ text: "🔙 Back to Traders List", callback_data: "traders_list" }]] }
            });
        } catch (e) {
            await this.telegramUi.sendErrorMessage(chatId, `Failed to remove trader: ${e.message}`);
        }
    }

    // REPLACE this entire function
    async handleAddTrader(chatId, traderName, walletAddress) {
        console.log(`[Action] ADD request for ${traderName} from chat ${chatId}`);
        try {
            // Get user to get internal user ID
            const user = await this.databaseManager.getUser(chatId);
            if (!user) {
                throw new Error('User not found in database. Cannot add trader.');
            }

            // Create the trader in the database, linked to the user's ID
            await this.databaseManager.createTrader(user.id, traderName, walletAddress);

            // Re-sync monitoring to start following the new trader if they were made active.
            this.syncAndStartMonitoring();

            await this.telegramUi.sendOrEditMessage(
                chatId,
                `✅ Trader *${escapeMarkdownV2(traderName)}* added successfully!`, 
                {
                    reply_markup: {
                        inline_keyboard: [[{ text: "🔙 Main Menu", callback_data: "main_menu" }]]
                    }
                }
            );
        } catch (e) {
            await this.telegramUi.sendErrorMessage(chatId, `Failed to add trader: ${e.message}`);
        }
    }

    async handleDeleteWallet(chatId, walletLabel) {
        console.log(`[Action] DELETE wallet request for label "${walletLabel}" from chat ${chatId}`);
        try {
            const deleted = await this.walletManager.deleteWalletByLabel(chatId, walletLabel);
            if (deleted) {
                console.log(`[Action] Wallet ${walletLabel} deleted for user ${chatId}.`);
            }
            await this.telegramUi.displayWalletList(chatId);
        } catch (e) {
            await this.telegramUi.sendErrorMessage(chatId, `Failed to delete wallet: ${e.message}`);
        }
    }



    // REPLACE this entire function
    async handleSetSolAmount(chatId, amount) {
        console.log(`[Action] SET SOL amount request for ${amount} from chat ${chatId}`);
        try {
            await this.databaseManager.updateUserTradingSettings(chatId, { sol_amount_per_trade: amount });
            await this.telegramUi.showMainMenu(chatId);
        } catch (e) {
            await this.telegramUi.sendErrorMessage(chatId, `Failed to set SOL amount: ${e.message}`);
        }
    }

    async handleGenerateWallet(chatId, label) {
        console.log(`[Action] GENERATE wallet request for label "${label}" from chat ${chatId}`);
        try {
            const { walletInfo, privateKey } = await this.walletManager.generateAndAddWallet(label, 'trading', chatId);
            
            // Also store in database
            const user = await this.databaseManager.getUser(chatId);
            if (user) {
                await this.databaseManager.createWallet(
                    user.id, 
                    label, 
                    walletInfo.publicKey.toBase58(), 
                    walletInfo.encryptedPrivateKey
                );
            }
            
            const message = `✅ Wallet *${escapeMarkdownV2(label)}* Generated\\!\n` +
                `Address: \`${escapeMarkdownV2(walletInfo.publicKey.toBase58())}\`\n\n` +
                `🚨 *SAVE THIS PRIVATE KEY SECURELY* 🚨\n\n` +
                `\`${escapeMarkdownV2(privateKey)}\``;

            await this.telegramUi.sendOrEditMessage(chatId, message, {
                reply_markup: { inline_keyboard: [[{ text: "🔙 Back to Wallet Menu", callback_data: "wallets_menu" }]] }
            });
        } catch (e) {
            await this.telegramUi.sendErrorMessage(chatId, `Failed to generate wallet: ${e.message}`);
        }
    }

    async handleImportWallet(chatId, label, privateKey) {
        console.log(`[Action] IMPORT wallet request for label "${label}" from chat ${chatId}`);
        try {
            const walletInfo = await this.walletManager.importWalletFromPrivateKey(privateKey, label, 'trading', chatId);

            // Also store in database
            const user = await this.databaseManager.getUser(chatId);
            if (user) {
                await this.databaseManager.createWallet(
                    user.id, 
                    label, 
                    walletInfo.publicKey.toBase58(), 
                    walletInfo.encryptedPrivateKey
                );
            }

            // Delete the message containing the user's private key IMMEDIATELY for security.
            const lastMsgId = this.telegramUi.latestMessageIds.get(chatId);
            if (lastMsgId) {
                await this.telegramUi.bot.deleteMessage(chatId, lastMsgId).catch(() => { });
            }

            const message = `✅ Wallet *${escapeMarkdownV2(label)}* Imported Successfully\\!\n` +
                `Address: \`${escapeMarkdownV2(walletInfo.publicKey.toBase58())}\`\n\n` +
                `Your wallet is ready for copy trading\\!`;

            await this.telegramUi.sendOrEditMessage(chatId, message, {
                reply_markup: { inline_keyboard: [[{ text: "🔙 Back to Wallet Menu", callback_data: "wallets_menu" }]] }
            });

        } catch (e) {
            await this.telegramUi.sendErrorMessage(chatId, `Failed to import wallet: ${e.message}`);
        }
    }

    async handleWithdraw(chatId, toAddress, amount) {
        console.log(`[Action] WITHDRAW request for ${amount} SOL to ${toAddress} from chat ${chatId}`);
        try {
            const solAmount = parseFloat(amount);
            if (isNaN(solAmount) || solAmount <= 0) {
                throw new Error("Invalid amount. Please enter a positive number.");
            }

            let destinationPubkey;
            try {
                destinationPubkey = new PublicKey(toAddress);
            } catch (e) {
                throw new Error("Invalid destination wallet address.");
            }

            const keypairPacket = await this.walletManager.getFirstTradingKeypair(chatId);
            if (!keypairPacket || !keypairPacket.wallet.publicKey) {
                throw new Error("No trading wallet configured or invalid public key.");
            }

            const balance = await this.solanaManager.getBalance(keypairPacket.wallet.publicKey.toBase58());
            const requiredBalance = solAmount * 1.01; // Estimate fee (1%) for a successful tx.

            if (balance < requiredBalance) {
                throw new Error(`Insufficient balance. Need ${requiredBalance.toFixed(4)} SOL but only have ${balance.toFixed(4)} SOL.`);
            }

            const escapedToAddress = escapeMarkdownV2(toAddress);
            const escapedSolAmount = escapeMarkdownV2(solAmount.toFixed(4));
            const escapedCurrentBalance = escapeMarkdownV2(balance.toFixed(4));
            const escapedAfterBalance = escapeMarkdownV2((balance - requiredBalance).toFixed(4));

            await this.telegramUi.sendOrEditMessage(
                chatId,
                `⚠️ *Withdrawal Confirmation* ⚠️\n\n` +
                `You are about to send *${escapedSolAmount} SOL* to:\n\`${escapedToAddress}\`\n\n` +
                `Current balance: *${escapedCurrentBalance} SOL*\n` +
                `After withdrawal: *${escapedAfterBalance} SOL*\n\n` +
                `Please confirm this transaction:`,
                {
                    reply_markup: {
                        inline_keyboard: [
                            [
                                { text: "✅ Confirm Withdrawal", callback_data: `confirm_withdraw_${solAmount}_${toAddress}` },
                                { text: "❌ Cancel", callback_data: "main_menu" }
                            ]
                        ]
                    }
                }
            );
        } catch (e) {
            console.error("Withdrawal flow error:", e);
            await this.telegramUi.sendErrorMessage(chatId, `❌ Withdrawal failed: ${e.message}`);
        }
    }

    async handleConfirmWithdraw(chatId, amount, toAddress) {
        try {
            const solAmount = parseFloat(amount);
            if (isNaN(solAmount) || solAmount <= 0) {
                throw new Error("Invalid amount.");
            }

            const keypairPacket = await this.walletManager.getFirstTradingKeypair(chatId);
            if (!keypairPacket) {
                throw new Error("No trading wallet available.");
            }

            await this.telegramUi.sendOrEditMessage(
                chatId,
                `⏳ Processing withdrawal...\\n\\nSending ${escapeMarkdownV2(solAmount.toFixed(4))} SOL to:\\n\`${escapeMarkdownV2(toAddress)}\``,
                { parse_mode: 'MarkdownV2' }
            );

            const txSignature = await this.solanaManager.sendSol(
                keypairPacket.wallet.label,
                toAddress,
                solAmount
            );

            const explorerLink = `[View on Solana Explorer](https://explorer.solana.com/tx/${txSignature}?cluster=${escapeMarkdownV2(this.solanaManager.cluster)})`;

            await this.telegramUi.sendOrEditMessage(
                chatId,
                `✅ *Withdrawal Successful\\!*\\n\\n` +
                `Sent *${escapeMarkdownV2(solAmount.toFixed(4))} SOL* to:\\n\`${escapeMarkdownV2(toAddress)}\`\\n\\n` +
                `Transaction ID:\\n\`${escapeMarkdownV2(txSignature)}\`\\n\\n` +
                `${explorerLink}`,
                { parse_mode: "MarkdownV2" }
            );

            const newBalance = await this.solanaManager.getBalance(keypairPacket.wallet.publicKey.toBase58());
            await this.telegramUi.sendOrEditMessage(
                chatId,
                `New balance: *${escapeMarkdownV2(newBalance.toFixed(4))} SOL*`,
                { parse_mode: "MarkdownV2" }
            );
        } catch (e) {
            console.error("Withdrawal error:", e);
            await this.telegramUi.sendErrorMessage(
                chatId,
                `❌ Withdrawal failed: ${escapeMarkdownV2(e.message)}\\n\\nPlease try again or check your balance.`
            );
        } finally {
            await this.telegramUi.showMainMenu(chatId);
        }
    }

    async handleResetData(chatId) {
        console.log(`[Action] RESET data request from chat ${chatId}`);
        try {
            await this.telegramUi.sendOrEditMessage(chatId, "♻️ *PERFORMING RESET\\.\\.\\.*", {});
            // Reset data in database instead of files
            await this.databaseManager.run('DELETE FROM traders WHERE user_id = (SELECT id FROM users WHERE chat_id = ?)', [chatId]);
            await this.databaseManager.run('DELETE FROM user_positions WHERE user_id = (SELECT id FROM users WHERE chat_id = ?)', [chatId]);
            await this.databaseManager.run('DELETE FROM trade_stats WHERE user_id = (SELECT id FROM users WHERE chat_id = ?)', [chatId]);
            await this.walletManager.initialize();
            await this.telegramUi.sendOrEditMessage(chatId, "✅ *RESET COMPLETE\\!*", {});
            await this.telegramUi.showMainMenu(chatId);
        } catch (e) {
            await this.telegramUi.sendErrorMessage(chatId, `Reset failed: ${e.message}`);
        }
    }

    // In zapbot.js
    startGlobalPlatformSnipers() {
        console.log('[WEAPON_SYSTEM] Activating unified WebSocket intelligence streams...');

        // 1. Start the pool sniper. This is for automatically finding and pre-caching new tokens.
        this.apiManager.startUniversalDataStream(this.tradingEngine);

        // 2. Start the trader monitor. This is the heart of the copy trading.
        // We wait for the stream to confirm it's connected before we subscribe to traders.
        if (this.apiManager.solanaTrackerStream) {
            this.apiManager.solanaTrackerStream.once('connected', () => {
                console.log('[WEAPON_SYSTEM] ✅ WebSocket connection established. Activating trader monitoring...');
                this.apiManager.startTraderMonitoringStream(this.tradingEngine);
            });

            // Add a handler for re-connecting after a disconnect
            this.apiManager.solanaTrackerStream.on('reconnected', () => {
                console.log('[WEAPON_SYSTEM] ✅ WebSocket RECONNECTED. Re-syncing trader monitoring...');
                this.apiManager.startTraderMonitoringStream(this.tradingEngine);
            });

        } else {
            console.error("[WEAPON_SYSTEM] ❌ CRITICAL: SolanaTrackerStream object does not exist. Automatic copy trading will not function.");
        }
    }


    // --- Monitoring & Tasks ---

    _startFallbackPolling() {
        if (this.isFallbackPollingActive) {
            return; // Prevent multiple intervals from running
        }
   
        const SCAN_INTERVAL_MS = 25000;
        console.log(`[CIRCUIT-BREAKER] ❗️ ENGAGING FALLBACK POLLING MODE. Interval: ${SCAN_INTERVAL_MS / 1000}s.`);
        this.isFallbackPollingActive = true;
        
        // This is the original logic from setupPeriodicTasks
        this.fallbackPollingInterval = setInterval(async () => {
            if (this.isShuttingDown) {
                this._stopFallbackPolling();
                return;
            }
            
            const syndicateData = await this.databaseManager.loadTraders();
            if (syndicateData && syndicateData.user_traders) {
                for (const userChatId in syndicateData.user_traders) {
                    const userTraders = syndicateData.user_traders[userChatId];
                    for (const traderName in userTraders) {
                        const traderConfig = userTraders[traderName];
                        if (traderConfig.active && traderConfig.wallet) {
                            const traderTaskInfo = { ...traderConfig, name: traderName, userChatId: userChatId };
                            this.tradingEngine.processTrader(traderTaskInfo)
                                .catch(e => console.error(`[POLLER_ERROR] Uncaught error for trader ${traderName}: ${e.message}`));
                        }
                    }
                }
            }
        }, SCAN_INTERVAL_MS);
    }
   
    _stopFallbackPolling() {
        if (!this.isFallbackPollingActive) {
            return;
        }
        console.log("[CIRCUIT-BREAKER] ✅ DISENGAGING FALLBACK POLLING MODE. Real-time stream is active.");
        if (this.fallbackPollingInterval) {
            clearInterval(this.fallbackPollingInterval);
            this.fallbackPollingInterval = null;
        }
        this.isFallbackPollingActive = false;
    }

    _handleLaserStreamStatusChange({ status, reason, error }) {
        if (status === 'connected') {
            // If the stream is healthy, make sure the fallback is turned OFF.
            this._stopFallbackPolling();
        } else if (status === 'disconnected') {
            // If the stream disconnects for any reason, turn the fallback ON.
            console.warn(`[CIRCUIT-BREAKER] LaserStream disconnected. Reason: ${error || reason}`);
            this._startFallbackPolling();
        }
    }



    // FIND and REPLACE this entire function in zapbot.js
// REPLACE this entire function
syncAndStartMonitoring() {
    console.log('[SYNC] Initiating primary monitoring stream...');

    // The new logic is simple: always try to start the best monitoring system.
    // The "Circuit Breaker" event handler we added will automatically
    // manage starting or stopping the fallback polling based on the stream's status.
    this.laserstreamManager.startMonitoring();
}

    async primeCachesAndSync() {
        console.log("[CACHE] Priming caches...");
        try {
            await this.walletManager.updateAllBalances();
            console.log("[CACHE] Wallet balances refreshed.");
        } catch (e) {
            console.warn(`[CACHE] Failed to refresh initial wallet balances: ${e.message}`);
        }
    }

    async processTrade(tradeDetails, traderName) {
        try {
            // Get the first available trading wallet for the default user
            const defaultUser = await this.databaseManager.all('SELECT * FROM users LIMIT 1');
            if (defaultUser.length === 0) throw new Error('No users configured');
            
            const walletInfo = (await this.walletManager.getFirstTradingKeypair(defaultUser[0].chat_id))?.wallet;
            if (!walletInfo) throw new Error('No trading wallet available');

            await this.tradingEngine.executeTrade(tradeDetails, walletInfo, traderName);
        } catch (error) {
            console.error(`[DIAG] Trade processing failed: ${error.message}`);
            utils.logPerformance('trade_error', { traderName, error: error.message });
            await this.tradeNotifications.sendErrorNotification(
                config.ADMIN_CHAT_ID,
                'Trade Processing Failed',
                `Trader: ${traderName}, Error: ${error.message}`
            );
            throw error;
        }
    }

    // Fix for routeMessage error - handle WebSocket messages
    async routeMessage(traderName, wallet, messageParams) {
        try {
            console.log(`[WS] Received activity for ${traderName} (${shortenAddress(wallet)})`);

            // Process the message through the trading engine
            const traderInfo = {
                name: traderName,
                wallet: wallet,
                userChatId: 0 // Default user
            };

            await this.tradingEngine.processTrader(traderInfo);

        } catch (error) {
            console.error(`[WS] Error routing message for ${traderName}: ${error.message}`);
        }
    }

    async setupShutdownHandler() {
        const signals = ['SIGINT', 'SIGTERM', 'SIGQUIT'];
        signals.forEach(signal => {
            process.on(signal, async () => {
                if (this.isShuttingDown) return;
                this.isShuttingDown = true;
                console.log(`\n🚦 Received ${signal}. Shutting down gracefully...`);
                await this.shutdown();
                process.exit(0);
            });
        });
    }

    async shutdown() {
        console.log("--- Initiating Bot Shutdown Sequence ---");
        if (this.periodicTaskInterval) clearInterval(this.periodicTaskInterval);

        // Unsubscribe from all logs BEFORE closing the connection
        const unsubPromises = [];
        for (const [wallet, subId] of this.activeSubscriptions.entries()) {
            console.log(`[SHUTDOWN] Attempting to unsubscribe from wallet: ${wallet}`);
            unsubPromises.push(
                this.solanaManager.connection.removeOnLogsListener(subId).catch(e => {
                    console.warn(`[SHUTDOWN] Error unsubscribing from listener ${subId}: ${e.message}`);
                })
            );
        }
        await Promise.all(unsubPromises);
        this.activeSubscriptions.clear();

        // Stop Telegram bot polling
        if (this.telegramUi.bot && this.telegramUi.bot.isPolling()) {
            try {
                await this.telegramUi.bot.stopPolling({ cancel: true });
            } catch (error) {
                console.error(`[SHUTDOWN] Error stopping Telegram bot polling: ${error.message}`);
            }
        }

        // Close Solana WebSocket connections
        if (this.solanaManager) {
            this.solanaManager.stop();
        }

        if (this.laserstreamManager) {
            this.laserstreamManager.stop();
        }
        // Close Solana WebSocket connections
        if (this.solanaManager) {
            this.solanaManager.stop();
        }

        console.log("--- Shutdown Sequence Complete ---");
    }

    async withRetry(fn, retries = 3, delay = 500) {
        for (let i = 0; i < retries; i++) {
            try {
                // IMPORTANT: The function call MUST be awaited.
                return await fn();
            } catch (error) {
                if (i < retries - 1) {
                    console.warn(`[RETRY] Attempt ${i + 1} failed: ${error.message}. Retrying in ${delay}ms...`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                } else {
                    // Re-throw the error after all retries have failed.
                    throw error;
                }
            }
        }
    }
}

// --- Main Execution Block ---
async function main() {
    const bot = new ZapBot();
    bot.setupShutdownHandler();

    try {
        await bot.initialize();
    } catch (error) {
        console.error("❌❌ BOT FAILED TO INITIALIZE ❌❌");
        console.error(error.stack);
        if (!bot.isShuttingDown) {
            process.exit(1);
        }
    }
}

// Export the ZapBot class for use in start.js
module.exports = ZapBot;

// Only run main() if this file is executed directly
if (require.main === module) {
    main();
}