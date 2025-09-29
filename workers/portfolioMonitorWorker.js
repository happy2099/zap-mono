// workers/portfolioMonitorWorker.js
const BaseWorker = require('./templates/baseWorker');
const { RedisManager } = require('../redis/redisManager');
const { SolanaManager } = require('../solanaManager');
const { DataManager } = require('../dataManager');
const config = require('../config');
const { shortenAddress } = require('../utils');
const { PublicKey } = require('@solana/web3.js');

class PortfolioMonitorWorker extends BaseWorker {
    constructor() {
        super();
        this.redisManager = null;
        this.solanaManager = null;
        this.dataManager = null;
    }

    async customInitialize() {
        this.redisManager = new RedisManager();
        await this.redisManager.initialize();
        this.solanaManager = new SolanaManager();
        await this.solanaManager.initialize();
        this.dataManager = new DataManager(this.redisManager);
        await this.dataManager.initialize();

        this.logInfo('✅ Universal Portfolio Monitor worker initialized successfully');

        // Start the main monitoring loop
        this.startMonitoring();
    }

    startMonitoring() {
        this.logInfo(`[PORTFOLIO-MONITOR] 🚀 Starting monitoring loop. Update interval: ${config.PORTFOLIO_MONITOR_INTERVAL_SECONDS} seconds.`);
        
        // Run the loop immediately, then on a set interval
        this._monitorPositions(); 
        setInterval(() => this._monitorPositions(), config.PORTFOLIO_MONITOR_INTERVAL_SECONDS * 1000);
    }

    async _monitorPositions() {
        this.logInfo(`[PORTFOLIO-MONITOR] 🔄 --- Cycle Start ---`);
        try {
            const activeMints = await this._getActiveMintsFromRedis();
            if (activeMints.size === 0) {
                this.logInfo(`[PORTFOLIO-MONITOR] 🧘 No active positions to monitor.`);
                return;
            }

            this.logInfo(`[PORTFOLIO-MONITOR] 👀 Monitoring ${activeMints.size} unique tokens.`);

            for (const mintAddress of activeMints) {
                const status = await this._fetchUniversalTokenStatus(mintAddress);
                if (status) {
                    await this.redisManager.updateTokenStatusInRedis(mintAddress, status);
                }
            }

        } catch (error) {
            this.logError('[PORTFOLIO-MONITOR] ❌ Error in monitoring cycle', { error: error.message, stack: error.stack });
        } finally {
            this.logInfo(`[PORTFOLIO-MONITOR] ✅ --- Cycle End ---`);
        }
    }
    
    async _getActiveMintsFromRedis() {
        const uniqueMints = new Set();
        try {
            // Get all position keys from Redis using the client directly
            const keys = await this.redisManager.client.keys('positions:*'); 

            for (const key of keys) {
                const positions = await this.redisManager.hgetall(key);
                for (const mint of Object.keys(positions)) {
                    uniqueMints.add(mint);
                }
            }
        } catch (error) {
            this.logError('[PORTFOLIO-MONITOR] ❌ Error getting active mints from Redis', { error: error.message });
        }
        return uniqueMints;
    }
    
    async _fetchUniversalTokenStatus(mintAddress) {
        try {
            const solMint = config.NATIVE_SOL_MINT;

            // --- UNIVERSAL PRICE FETCH using Helius Jupiter API ---
            // This works for ANY token on ANY major DEX.
            const priceUrl = `https://mainnet.helius-rpc.com/?api-key=b9a69ad0-d823-429e-8c18-7cbea0e31769`;
            const priceResponse = await fetch(priceUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ mints: [mintAddress], vsMints: [solMint] }),
            });
            const priceData = await priceResponse.json();
            const priceInSol = priceData?.data?.[mintAddress]?.[solMint] || 0;
            
            // --- METADATA FETCH using Helius API ---
            const metadataUrl = `https://api.mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}`;
            const metadataResponse = await fetch(metadataUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    jsonrpc: '2.0',
                    id: 'zapbot-token-metadata',
                    method: 'getTokenMetadata',
                    params: [[mintAddress]]
                })
            });
            const metadataResult = await metadataResponse.json();
            const metadata = metadataResult?.result?.[0]?.onchainMetadata?.metadata;
            
            const tokenStatus = {
                priceInSol: priceInSol,
                name: metadata?.name || 'Unknown Name',
                symbol: metadata?.symbol || 'N/A',
                lastUpdatedAt: new Date().toISOString()
            };

            this.logInfo(`[TOKEN-STATUS] ${shortenAddress(mintAddress)} (${tokenStatus.symbol}): ${tokenStatus.priceInSol.toFixed(9)} SOL`);
            return tokenStatus;
        } catch (error) {
            this.logError(`[TOKEN-STATUS] ❌ Failed to fetch status for ${shortenAddress(mintAddress)}`, { error: error.message });
            return null;
        }
    }
}

// Initialize and run the worker
const worker = new PortfolioMonitorWorker();
worker.initialize().catch(error => {
    console.error('Portfolio Monitor worker failed to initialize:', error);
    process.exit(1);
});

module.exports = PortfolioMonitorWorker;
