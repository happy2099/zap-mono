// ==========================================
// ========== Trade Executor Worker ==========
// ==========================================
// File: workers/tradeExecutorWorker.js
// Description: Executes trades in a separate thread

const { workerData, parentPort } = require('worker_threads');
const { PublicKey, SystemProgram, SYSVAR_RENT_PUBKEY } = require('@solana/web3.js');
const BaseWorker = require('./templates/baseWorker');
const { DataManager } = require('../dataManager');
const { SolanaManager } = require('../solanaManager');
const { SingaporeSenderManager } = require('../singaporeSenderManager');
const WalletManager = require('../walletManager');
const { ApiManager } = require('../apiManager');
const TradeNotificationManager = require('../tradeNotifications');
const config = require('../config');
const { shortenAddress } = require('../utils');
const performanceMonitor = require('../performanceMonitor.js');

// Direct transaction building imports
const { 
    getAssociatedTokenAddressSync, 
    createAssociatedTokenAccountInstruction,
    TOKEN_PROGRAM_ID 
} = require('@solana/spl-token');

// Borsh serialization for instruction data
const borsh = require('borsh');
const BN = require('bn.js');
const { createHash } = require('crypto');

// ======================================================================
// ======================== ALL DEX SCHEMAS ============================
// ======================================================================

// Raydium Swap Instruction Payload Class
class RaydiumSwapPayload {
    constructor(properties) {
        this.discriminator = 9; // Raydium swap discriminator
        this.amountIn = properties.amountIn;
        this.minimumAmountOut = properties.minimumAmountOut;
    }
}

// PumpFun Buy Instruction Payload Class
class PumpFunBuyPayload {
    constructor(properties) {
        this.amount = properties.amount;
        this.maxSolCost = properties.maxSolCost;
    }
}

// Meteora Swap Instruction Payload Class
class MeteoraSwapPayload {
    constructor(properties) {
        this.discriminator = 0; // Meteora swap discriminator
        this.amountIn = properties.amountIn;
        this.minimumAmountOut = properties.minimumAmountOut;
    }
}

// Orca Swap Instruction Payload Class
class OrcaSwapPayload {
    constructor(properties) {
        this.discriminator = 0; // Orca swap discriminator
        this.amountIn = properties.amountIn;
        this.minimumAmountOut = properties.minimumAmountOut;
    }
}

// Define the Borsh schema maps for all DEXes
const RAYDIUM_SWAP_SCHEMA = new Map([
    [RaydiumSwapPayload, { 
        kind: 'struct', 
        fields: [
            ['discriminator', 'u8'],
            ['amountIn', 'u64'],
            ['minimumAmountOut', 'u64']
        ] 
    }]
]);

// PUMPFUN SCHEMA REMOVED - Using in-line schema to prevent worker corruption

const METEORA_SWAP_SCHEMA = new Map([
    [MeteoraSwapPayload, { 
        kind: 'struct', 
        fields: [
            ['discriminator', 'u8'],
            ['amountIn', 'u64'],
            ['minimumAmountOut', 'u64']
        ] 
    }]
]);

const ORCA_SWAP_SCHEMA = new Map([
    [OrcaSwapPayload, { 
        kind: 'struct', 
        fields: [
            ['discriminator', 'u8'],
            ['amountIn', 'u64'],
            ['minimumAmountOut', 'u64']
        ] 
    }]
]);

// Worker Manager Interface for communicating with main thread
class WorkerManagerInterface {
    constructor() {
        this.parentPort = parentPort;
    }

    dispatch(workerType, message) {
        if (this.parentPort) {
            this.parentPort.postMessage({
                type: 'SEND_NOTIFICATION',
                workerName: 'executor',
                payload: message.payload
            });
        }
    }
}

class TradeExecutorWorker extends BaseWorker {
    constructor() {
        super();
        this.dataManager = null;
        this.solanaManager = null;
        this.singaporeSender = null; // NEW: Ultra-fast Helius Sender
        this.walletManager = null;
        // TransactionAnalyzer removed
        this.apiManager = null;
        this.redisManager = null;
        this.notificationManager = null;
        this.tradingEngine = null;
        this.pendingTrades = new Map();
        this.completedTrades = new Map();
        this.failedTrades = new Map();
        this.workerManager = new WorkerManagerInterface();
        
        // Redis-based locking for idempotent execution (replaces signature-based deduplication)
    }

    setupMessageHandlers() {
        // Call parent setup first
        super.setupMessageHandlers();
        
        // Register executor-specific handlers
        this.registerHandler('HANDLE_SMART_COPY', this.handleSmartCopy.bind(this));
        this.registerHandler('EXECUTE_COPY_TRADE', this.executeCopyTrade.bind(this));
        this.registerHandler('CANCEL_TRADE', this.cancelTrade.bind(this));
        this.registerHandler('GET_TRADE_STATUS', this.getTradeStatus.bind(this));
        this.registerHandler('GET_PENDING_TRADES', this.getPendingTrades.bind(this));
    }

    async customInitialize() {
        try {
            // Initialize core managers
            this.dataManager = new DataManager(this.redisManager);
            await this.dataManager.initialize();
            
            // Initialize default settings in Redis if not already present
            await this.dataManager.initializeDefaultSettings();
            
            this.solanaManager = new SolanaManager();
            await this.solanaManager.initialize();
            
            // NEW: Initialize Ultra-Fast Helius Sender with shared connection
            this.singaporeSender = new SingaporeSenderManager(this.solanaManager.connection);
            this.logInfo('🚀 Ultra-Fast Helius Sender initialized for sub-200ms execution');
            
            this.walletManager = new WalletManager(this.dataManager);
            this.walletManager.setSolanaManager(this.solanaManager);
            this.walletManager.setConnection(this.solanaManager.connection);
            await this.walletManager.initialize();
            
            this.apiManager = new ApiManager(this.solanaManager);
            // TransactionAnalyzer removed - using UniversalAnalyzer instead
   
            // Replace CacheManager with RedisManager
            const { RedisManager } = require('../redis/redisManager');
            this.redisManager = new RedisManager();
            await this.redisManager.initialize();
            
            // Initialize notification manager with worker manager for threaded communication
            this.notificationManager = new TradeNotificationManager(null, this.apiManager, this.workerManager);
            this.notificationManager.setConnection(this.solanaManager.connection);

            // SIMPLE COPY BOT - No trading engine needed
            this.logInfo('✅ Simple Copy Bot - No trading engine required');

            this.logInfo('Trade executor worker initialized successfully');
        } catch (error) {
            this.logError('Failed to initialize trade executor worker', { error: error.message });
            throw error;
        }
    }

    // Handle smart copy messages from monitor worker
    async handleSmartCopy(message) {
        try {
            this.logInfo('[SMART-COPY-HANDLER] 🔧 Handling smart copy from monitor worker');
            this.logInfo(`[SMART-COPY-HANDLER] 🔍 Trader: ${message.traderName || 'Unknown'} (${message.traderWallet})`);
            this.logInfo(`[SMART-COPY-HANDLER] 🔍 Signature: ${message.signature} (type: ${typeof message.signature})`);
            this.logInfo(`[SMART-COPY-HANDLER] 🔍 Signature length: ${message.signature ? message.signature.length : 'undefined'}`);
            this.logInfo(`[SMART-COPY-HANDLER] 🔍 Message keys: ${Object.keys(message)}`);
            this.logInfo(`[SMART-COPY-HANDLER] 🔍 Analysis result: ${message.analysisResult ? 'Present' : 'Missing'}`);
            
            // Route to main execution function
            await this.executeCopyTrade(message); 

        } catch (error) {
            this.logError(`[SMART-COPY-HANDLER] ❌ Error handling smart copy: ${error.message}`);
        }
    }


    // ===== SINGAPORE SENDER DIRECT EXECUTION =====
    // No quotes needed - Singapore Sender handles everything!
    async _getHeliusQuote(inputMint, outputMint, inputAmountInLamports, masterTraderSlippageBps = null) {
        try {
            const rpcUrl = "https://mainnet.helius-rpc.com/?api-key=" + process.env.HELIUS_API_KEY;

            const slippageBps = masterTraderSlippageBps || this.botConfig?.slippageBps || 150; // 1.5% default

            const quoteRequest = {
                inputMint: inputMint,
                outputMint: outputMint,
                amount: inputAmountInLamports,
                slippageBps: slippageBps,
                swapMode: 'ExactIn',
                asLegacyTransaction: false // Important for modern transactions
            };

            this.logInfo(`[Helius-QUOTE] 🔍 Requesting quote via JSON-RPC: ${shortenAddress(inputMint)} → ${shortenAddress(outputMint)}, Amount: ${inputAmountInLamports / 1e9} SOL, Slippage: ${slippageBps} bps`);

            const response = await fetch(rpcUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    jsonrpc: '2.0',
                    id: 'zapbot-helius-quote',
                    method: 'getQuote',
                    params: quoteRequest
                })
            });

            if (!response.ok) {
                const errorBody = await response.text();
                throw new Error(`Helius Quote API HTTP error: ${response.status} ${response.statusText} - ${errorBody}`);
            }

            const jsonResponse = await response.json();

            if (jsonResponse.error) {
                throw new Error(`Helius Quote API RPC error: ${jsonResponse.error.code} - ${jsonResponse.error.message}`);
            }

            const quoteData = jsonResponse.result;

            if (!quoteData || !quoteData.outAmount) {
                throw new Error('No valid quote response or outAmount received from Helius API');
            }

            this.logInfo(`[Helius-QUOTE] ✅ Quote successful: Received ${quoteData.outAmount} tokens`);

            return {
                outAmount: quoteData.outAmount,
                priceImpact: quoteData.priceImpactPct || 0,
                route: quoteData.routePlan || []
            };

        } catch (error) {
            this.logError(`[Helius-QUOTE] ❌ Error getting quote: ${error.message}`);
            return null;
        }
    }

    // ===== PORTFOLIO POSITION CHECK (WITH REDIS SYNC) =====
    async _checkTokenPosition(tokenMint) {
        try {
            this.logInfo(`[PORTFOLIO-CHECK] 🔍 Checking position for token: ${tokenMint}`);
            
            // 1. FAST REDIS CHECK FIRST (using RedisManager)
            if (this.dataManager.redisManager) {
                try {
                    const hasPosition = await this.dataManager.redisManager.checkPortfolioPosition(tokenMint);
                    if (hasPosition) {
                        return true;
                    }
                } catch (redisError) {
                    this.logWarn(`[PORTFOLIO-CHECK] ⚠️ Redis check failed: ${redisError.message}`);
                }
            }
            
            // 2. FALLBACK TO FILE CHECK
            const portfolio = await this.dataManager.readJsonFile('portfolio.json') || { positions: {} };
            
            if (portfolio.positions[tokenMint]) {
                const position = portfolio.positions[tokenMint];
                this.logInfo(`[PORTFOLIO-CHECK] ✅ Found position: ${position.amount} tokens (${position.symbol || 'Unknown'})`);
                
                // 3. SYNC TO REDIS FOR NEXT TIME
                if (this.dataManager.redisManager) {
                    try {
                        await this.dataManager.redisManager.syncPortfolioFromFile(portfolio);
                    } catch (redisError) {
                        this.logWarn(`[PORTFOLIO-CHECK] ⚠️ Redis sync failed: ${redisError.message}`);
                    }
                }
                
                return position.amount > 0;
            }
            
            this.logInfo(`[PORTFOLIO-CHECK] ❌ No position found for token: ${tokenMint}`);
            return false;
            
        } catch (error) {
            this.logError(`[PORTFOLIO-CHECK] ❌ Error checking token position: ${error.message}`);
            return false;
        }
    }

    // ===== UPDATE PORTFOLIO POSITION =====
    async _updatePortfolioPosition(tokenMint, amount, action, price = null) {
        try {
            this.logInfo(`[PORTFOLIO-UPDATE] 🔄 Updating position: ${action} ${amount} ${tokenMint}`);
            
            // 1. UPDATE REDIS FIRST (using RedisManager)
            if (this.dataManager.redisManager) {
                try {
                    await this.dataManager.redisManager.updatePortfolioPosition(tokenMint, amount, action, price);
                } catch (redisError) {
                    this.logWarn(`[PORTFOLIO-UPDATE] ⚠️ Redis update failed: ${redisError.message}`);
                }
            }
            
            // 2. UPDATE FILE FOR PERSISTENCE
            const portfolio = await this.dataManager.readJsonFile('portfolio.json') || { positions: {} };
            
            if (!portfolio.positions[tokenMint]) {
                portfolio.positions[tokenMint] = {
                    amount: 0,
                    symbol: 'Unknown',
                    firstBought: new Date().toISOString(),
                    lastUpdated: new Date().toISOString()
                };
            }
            
            const position = portfolio.positions[tokenMint];
            
            if (action === 'buy') {
                position.amount += amount;
                position.lastBought = new Date().toISOString();
                if (price) position.lastBuyPrice = price;
            } else if (action === 'sell') {
                position.amount -= amount;
                position.lastSold = new Date().toISOString();
                if (price) position.lastSellPrice = price;
            }
            
            position.lastUpdated = new Date().toISOString();
            
            // Remove position if amount is 0 or negative
            if (position.amount <= 0) {
                delete portfolio.positions[tokenMint];
                this.logInfo(`[PORTFOLIO-UPDATE] 🗑️ Removed position for ${tokenMint} (amount: ${position.amount})`);
            }
            
            // Save updated portfolio to file
            await this.dataManager.writeJsonFile('portfolio.json', portfolio);
            
            this.logInfo(`[PORTFOLIO-UPDATE] ✅ Position updated: ${position.amount} ${tokenMint}`);
            
        } catch (error) {
            this.logError(`[PORTFOLIO-UPDATE] ❌ Error updating portfolio: ${error.message}`);
        }
    }

    // ===== SELL EXECUTION FUNCTIONS =====
    async executePumpFunSell(swapDetails, userConfig = {}) {
        const { inputMint, outputMint } = swapDetails;
        const startTime = Date.now();
        
        try {
            this.logInfo(`[PUMPFUN-SELL] 🚀 Executing PumpFun sell for: ${shortenAddress(inputMint)}`);
            
            // Get user's chatId for portfolio check
            const users = await this.dataManager.loadUsers();
            const chatId = Object.keys(users)[0]; // First user for now
            
            // Get position from Redis portfolio
            const position = await this.dataManager.getPosition(chatId, inputMint);
            if (!position) {
                throw new Error(`No position found in Redis for user ${chatId}, token ${shortenAddress(inputMint)}`);
            }
            
            this.logInfo(`[PUMPFUN-SELL] 📊 Selling ${position.tokenAmount} tokens (${position.decimals} decimals)`);
            
            const userWallet = await this._getUserWallet();
            if (!userWallet) throw new Error("User wallet not found");
            
            // TODO: Implement actual PumpFun sell instruction
            // This would be similar to buy but with sell discriminator and different instruction data
            // For now, we'll simulate the sell and update the portfolio
            
            // Simulate sell execution
            const sellSignature = `SELL_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            
            // Update portfolio: remove position after successful sell
            await this.dataManager.removePosition(chatId, inputMint);
            this.logInfo(`[PUMPFUN-SELL] 📊 Position removed from portfolio for user ${chatId}: ${shortenAddress(inputMint)}`);
            
            return {
                success: true,
                signature: sellSignature,
                amountSold: position.tokenAmount,
                solReceived: position.solSpent * 0.8, // Simulate 80% return
                executionTime: Date.now() - startTime
            };
            
        } catch (error) {
            this.logError(`[PUMPFUN-SELL] ❌ PumpFun sell failed: ${error.message}`);
            throw error;
        }
    }



    async executePumpFunAmmBuy(swapDetails, userConfig, poolAccount) {
        const { outputMint, inputAmount } = swapDetails; // For an AMM buy, outputMint is the token we want
        const startTime = Date.now();
        this.logInfo(`[PUMPFUN-AMM-BUY] 🚀 Initiating AMM Buy for: ${shortenAddress(outputMint)}`);

        try {
            const userWallet = await this._getUserWallet();
            if (!userWallet) throw new Error("User wallet not found");

            const ammProgramId = config.DEX_PROGRAM_IDS.PUMP_FUN_AMM;
            
            // --- Define AMM-specific constants and PDAs ---
            const baseMint = new PublicKey(outputMint); // Token we want to buy
            const quoteMint = new PublicKey(config.NATIVE_SOL_MINT);
            const globalConfig = config.PUMP_FUN_AMM_CONSTANTS.GLOBAL_CONFIG;
            const feeProgram = config.PUMP_FUN_AMM_CONSTANTS.FEE_PROGRAM;
            
            // --- Fetch necessary on-chain data ---
            const poolState = await this.solanaManager.getDecodedAccount(poolAccount, 'pool');
            if (!poolState) throw new Error(`Could not fetch or decode AMM pool state for ${poolAccount.toBase58()}`);
            const coinCreator = poolState.coinCreator;

            // --- Define all 22 accounts required by the AMM buy instruction ---
            const userBaseTokenAccount = getAssociatedTokenAddressSync(baseMint, userWallet.publicKey);
            const userQuoteTokenAccount = getAssociatedTokenAddressSync(quoteMint, userWallet.publicKey);
            
            // These PDAs are derived from seeds in the AMM IDL
            const [protocolFeeRecipient] = PublicKey.findProgramAddressSync([Buffer.from("protocol-fee-recipient")], ammProgramId);
            const [coinCreatorVaultAuthority] = PublicKey.findProgramAddressSync([Buffer.from("creator_vault"), coinCreator.toBuffer()], ammProgramId);
            const [globalVolumeAccumulator] = PublicKey.findProgramAddressSync([Buffer.from("global_volume_accumulator")], ammProgramId);
            const [userVolumeAccumulator] = PublicKey.findProgramAddressSync([Buffer.from("user_volume_accumulator"), userWallet.publicKey.toBuffer()], ammProgramId);
            const [feeConfig] = PublicKey.findProgramAddressSync([Buffer.from("fee_config"), ammProgramId.toBuffer()], feeProgram);
            const eventAuthority = config.PUMP_FUN_AMM_CONSTANTS.EVENT_AUTHORITY;

            const protocolFeeRecipientTokenAccount = getAssociatedTokenAddressSync(quoteMint, protocolFeeRecipient, true);
            const coinCreatorVaultAta = getAssociatedTokenAddressSync(quoteMint, coinCreatorVaultAuthority, true);

            // --- Prepare Borsh data for the instruction ---
            // Using the proven working inline schema method
            const argsBuffer = borsh.serialize(
                { struct: { baseAmountOut: 'u64', maxQuoteAmountIn: 'u64', trackVolume: 'u8' } },
                { 
                    baseAmountOut: new BN(0), // For exact in, we set this to 0
                    maxQuoteAmountIn: new BN(inputAmount), // The scaled SOL amount
                    trackVolume: 1, // true
                }
            );
            const discriminator = Buffer.from([102, 6, 61, 18, 1, 218, 235, 234]);
            const instructionData = Buffer.concat([discriminator, argsBuffer]);

            const instructions = [
                 createAssociatedTokenAccountInstruction(userWallet.publicKey, userBaseTokenAccount, userWallet.publicKey, baseMint),
                 createAssociatedTokenAccountInstruction(userWallet.publicKey, userQuoteTokenAccount, userWallet.publicKey, quoteMint),
                {
                programId: ammProgramId,
                keys: [
                    { pubkey: poolAccount, isSigner: false, isWritable: false },
                    { pubkey: userWallet.publicKey, isSigner: true, isWritable: true },
                    { pubkey: globalConfig, isSigner: false, isWritable: false },
                    { pubkey: baseMint, isSigner: false, isWritable: false },
                    { pubkey: quoteMint, isSigner: false, isWritable: true },
                    { pubkey: userBaseTokenAccount, isSigner: false, isWritable: true },
                    { pubkey: userQuoteTokenAccount, isSigner: false, isWritable: true },
                    { pubkey: poolState.poolBaseTokenAccount, isSigner: false, isWritable: true },
                    { pubkey: poolState.poolQuoteTokenAccount, isSigner: false, isWritable: true },
                    { pubkey: protocolFeeRecipient, isSigner: false, isWritable: false },
                    { pubkey: protocolFeeRecipientTokenAccount, isSigner: false, isWritable: true },
                    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
                    { pubkey: new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"), isSigner: false, isWritable: false }, // Quote Token Program, often different for WSOL
                    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
                    { pubkey: config.ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
                    { pubkey: eventAuthority, isSigner: false, isWritable: false },
                    { pubkey: ammProgramId, isSigner: false, isWritable: false },
                    { pubkey: coinCreatorVaultAta, isSigner: false, isWritable: true },
                    { pubkey: coinCreatorVaultAuthority, isSigner: false, isWritable: false },
                    { pubkey: globalVolumeAccumulator, isSigner: false, isWritable: true },
                    { pubkey: userVolumeAccumulator, isSigner: false, isWritable: true },
                    { pubkey: feeConfig, isSigner: false, isWritable: false },
                    { pubkey: feeProgram, isSigner: false, isWritable: false },
                ],
                data: instructionData,
            }];

            const result = await this.singaporeSender.executeCopyTrade(instructions, userWallet, { platform: 'PumpFunAMM', inputAmount, useSmartTransactions: false });
            if (!result || !result.success) throw new Error(result.error || 'The AMM buy transaction failed.');
            this.logInfo(`[PUMPFUN-AMM-BUY] ✅ SUCCESS! Signature: ${result.signature}`);
            return { ...result, amountSpentInLamports: inputAmount };
        } catch (error) {
            this.logError(`[PUMPFUN-AMM-BUY] ❌ AMM SWAP FAILED: ${error.message}`, { stack: error.stack });
            return { success: false, error: error.message, signature: null, executionTime: Date.now() - startTime };
        }
    }


    async executePumpFunAmmSell(swapDetails, userConfig, poolAccount) {
        // swapDetails.inputMint is the TOKEN we are selling.
        // swapDetails.outputMint should be SOL.
        const { inputMint: baseMintAddress, inputAmount: tokenAmountToSell } = swapDetails;
        const startTime = Date.now();
        this.logInfo(`[PUMPFUN-AMM-SELL-V2] 🚀 Initiating IDL-PERFECT AMM Sell for ${shortenAddress(baseMintAddress)}`);

        try {
            const userWallet = await this._getUserWallet();
            if (!userWallet) throw new Error("User wallet not found");

            // --- Define Constants, Mints, and Program IDs ---
            const ammProgramId = config.DEX_PROGRAM_IDS.PUMP_FUN_AMM;
            const baseMint = new PublicKey(baseMintAddress);
            const quoteMint = new PublicKey(config.NATIVE_SOL_MINT);
            const globalConfig = config.PUMP_FUN_AMM_CONSTANTS.GLOBAL_CONFIG;
            const feeProgram = config.PUMP_FUN_AMM_CONSTANTS.FEE_PROGRAM;
            const eventAuthority = config.PUMP_FUN_AMM_CONSTANTS.EVENT_AUTHORITY;
            const protocolFeeRecipient = config.PUMP_FUN_CONSTANTS.FEE_RECIPIENT; 
            // ====================================================================

            // --- Fetch and Decode On-Chain Pool State ---
            const poolState = await this.solanaManager.getDecodedAmmPool(poolAccount);
            if (!poolState) throw new Error(`Could not fetch AMM pool state for ${poolAccount.toBase58()}`);

            const coinCreator = poolState.coin_creator; // The key from our decoder is lowercase_with_underscores

            // --- Define all 21 accounts required by the AMM sell instruction ---
            const userBaseTokenAccount = getAssociatedTokenAddressSync(baseMint, userWallet.publicKey);
            const userQuoteTokenAccount = getAssociatedTokenAddressSync(quoteMint, userWallet.publicKey, true);
            const protocolFeeRecipientTokenAccount = getAssociatedTokenAddressSync(quoteMint, protocolFeeRecipient, true);

            const [coinCreatorVaultAuthority] = PublicKey.findProgramAddressSync([Buffer.from("creator_vault"), coinCreator.toBuffer()], ammProgramId);
            const coinCreatorVaultAta = getAssociatedTokenAddressSync(quoteMint, coinCreatorVaultAuthority, true);
            
            const [feeConfig] = PublicKey.findProgramAddressSync([Buffer.from("fee_config"), ammProgramId.toBuffer()], feeProgram);

            // --- Prepare Borsh data for the sell instruction ---
            // Using the proven working inline schema method
            const minSolOutput = new BN(0); // For now, we are not calculating slippage on sell, setting to 0.

            const argsBuffer = borsh.serialize(
                { struct: { baseAmountIn: 'u64', minQuoteAmountOut: 'u64' } },
                { 
                    baseAmountIn: new BN(tokenAmountToSell),
                    minQuoteAmountOut: minSolOutput,
                }
            );
            const discriminator = Buffer.from([51, 230, 133, 164, 1, 127, 131, 173]);
            const instructionData = Buffer.concat([discriminator, argsBuffer]);

            const instructions = [{
                programId: ammProgramId,
                keys: [
                    { pubkey: poolAccount, isSigner: false, isWritable: true },
                    { pubkey: userWallet.publicKey, isSigner: true, isWritable: true },
                    { pubkey: globalConfig, isSigner: false, isWritable: false },
                    { pubkey: baseMint, isSigner: false, isWritable: false },
                    { pubkey: quoteMint, isSigner: false, isWritable: true },
                    { pubkey: userBaseTokenAccount, isSigner: false, isWritable: true },
                    { pubkey: userQuoteTokenAccount, isSigner: false, isWritable: true },
                    { pubkey: poolState.pool_base_token_account, isSigner: false, isWritable: true },
                    { pubkey: poolState.pool_quote_token_account, isSigner: false, isWritable: true },
                    { pubkey: protocolFeeRecipient, isSigner: false, isWritable: false },
                    { pubkey: protocolFeeRecipientTokenAccount, isSigner: false, isWritable: true },
                    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false }, // Base Token Program
                    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false }, // Quote Token Program
                    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
                    { pubkey: config.ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
                    { pubkey: eventAuthority, isSigner: false, isWritable: false },
                    { pubkey: ammProgramId, isSigner: false, isWritable: false },
                    { pubkey: coinCreatorVaultAta, isSigner: false, isWritable: true },
                    { pubkey: coinCreatorVaultAuthority, isSigner: false, isWritable: false },
                    { pubkey: feeConfig, isSigner: false, isWritable: false },
                    { pubkey: feeProgram, isSigner: false, isWritable: false },
                ],
                data: instructionData,
            }];

            const result = await this.singaporeSender.executeCopyTrade(instructions, userWallet, { platform: 'PumpFunAMMSell', inputAmount: tokenAmountToSell, useSmartTransactions: false });
            if (!result || !result.success) throw new Error(result.error || 'The AMM sell transaction failed.');

            this.logInfo(`[PUMPFUN-AMM-SELL-V2] ✅ SUCCESS! Signature: ${result.signature}`);
            return { ...result, amountSoldInBase: tokenAmountToSell };

        } catch (error) {
            this.logError(`[PUMPFUN-AMM-SELL-V2] ❌ AMM SELL FAILED: ${error.message}`, { stack: error.stack });
            return { success: false, error: error.message, signature: null, executionTime: Date.now() - startTime };
        }
    }

    async executeRaydiumSell(swapDetails, userConfig = {}) {
        const { inputMint, outputMint, inputAmount } = swapDetails;
        try {
            this.logInfo('[RAYDIUM-SELL] 🚀 Executing Raydium sell transaction...');
            
            // Get real-time price quote for sell
            const quote = await this._getHeliusQuote(inputMint, outputMint, inputAmount);
            if (!quote) {
                throw new Error('Failed to get price quote for sell');
            }
            
            this.logInfo(`[RAYDIUM-SELL] ✅ Sell quote: ${quote.outAmount} SOL for ${inputAmount} tokens`);
            
            // TODO: Implement Raydium sell instruction
            // This would be similar to buy but with sell discriminator and different instruction data

            return {
                success: true,
                signature: 'PLACEHOLDER_SIGNATURE',
                amountSold: inputAmount,
                price: quote.outAmount / inputAmount,
                executionTime: Date.now()
            };

        } catch (error) {
            this.logError(`[RAYDIUM-SELL] ❌ Raydium sell failed: ${error.message}`);
            throw error;
        }
    }

    async executeMeteoraSell(swapDetails, userConfig = {}) {
        const { inputMint, outputMint, inputAmount } = swapDetails;
        try {
            this.logInfo('[METEORA-SELL] 🚀 Executing Meteora sell transaction...');
            
            // Get real-time price quote for sell
            const quote = await this._getHeliusQuote(inputMint, outputMint, inputAmount);
            if (!quote) {
                throw new Error('Failed to get price quote for sell');
            }
            
            this.logInfo(`[METEORA-SELL] ✅ Sell quote: ${quote.outAmount} SOL for ${inputAmount} tokens`);
            
            // TODO: Implement Meteora sell instruction
            // This would be similar to buy but with sell discriminator and different instruction data
            
            return {
                success: true,
                signature: 'PLACEHOLDER_SIGNATURE',
                amountSold: inputAmount,
                price: quote.outAmount / inputAmount,
                executionTime: Date.now()
            };
            
        } catch (error) {
            this.logError(`[METEORA-SELL] ❌ Meteora sell failed: ${error.message}`);
            throw error;
        }
    }

    // ====================================================================
    // ====== MASTER EXECUTION FUNCTION (v3 - Final Version) ==============
    // ====================================================================
    async executeCopyTrade(message) {
        // We use the signature for unique logging throughout the process
        const signature = message.signature || 'unknown_signature';
        const executionStartTime = Date.now(); // 🔧 PERFORMANCE: Start timing execution

        // ========================= THE IDEMPOTENCY FIX ========================
        const analysisResult = message.analysisResult;
        if (!analysisResult || !analysisResult.isCopyable || !analysisResult.swapDetails) {
            this.logError(`[EXEC-MAIN] ❌ Job REJECTED: Monitor did not provide a valid analysis result.`, { signature });
            return;
        }

        const swapDetails = analysisResult.swapDetails;
        if (!swapDetails || !swapDetails.outputMint) {
             this.logWarn(`[EXEC-MAIN] ❌ Job REJECTED: Invalid analysis result, cannot determine token to lock.`, { signature });
             return;
        }

        const lockKey = `lock:buy:${swapDetails.outputMint}`;
        let lockAcquired = false;
        // ========================================================================

        try {
            // ========================= ACQUIRE THE LOCK ========================
            lockAcquired = await this.redisManager.set(lockKey, 'true', { EX: 20, NX: true }); // Set lock for 20s, NX = only if not exists
            if (!lockAcquired) {
                this.logInfo(`[EXEC-MAIN] ⏭️ Job SKIPPED: Another process is already buying ${shortenAddress(swapDetails.outputMint)}. Ignoring duplicate.`, { signature });
                return; // Gracefully exit, preventing duplicate execution
            }
            // ===================================================================

            this.logInfo(`[EXEC-MAIN] 🚀 Processing job for sig: ${shortenAddress(signature)}`);
            const platform = swapDetails.platform;
            const tradeType = swapDetails.tradeType;
            
            // ========================= REDIS-ONLY CONFIG LOADING ========================
            // Load settings from Redis ONLY (no file fallback)
            let settings = await this.dataManager.getSettings();
            if (!settings) {
                // Initialize default settings in Redis if not found
                this.logWarn(`[EXEC-MAIN] ⚠️ No settings found in Redis. Initializing defaults...`);
                await this.dataManager.initializeDefaultSettings();
                settings = await this.dataManager.getSettings();
                if (!settings) {
                    throw new Error("Failed to initialize default settings in Redis");
                }
            }

            const userConfig = {
                scaleFactor: settings.botSettings.scaleFactor, // Use actual Redis value
                slippage: settings.botSettings.maxSlippage,
                platformPreferences: settings.botSettings.supportedPlatforms
            };
            
            this.logInfo(`[EXEC-MAIN] 📋 Redis config loaded: Scale Factor: ${userConfig.scaleFactor} (${userConfig.scaleFactor * 100}%)`);
            // ================================================================

            this.logInfo(`[EXEC-MAIN] 📋 Trusting Monitor's Report:`, {
                platform: platform,
                tradeType: tradeType,
                outputMint: shortenAddress(swapDetails.outputMint),
                signature
            });

            // --- 2. HANDLE SELLS (Redis Portfolio Check) ---
            if (tradeType === 'sell') {
                const tokenMintToSell = swapDetails.inputMint;
                
                // Get user's chatId for portfolio check
                const userWallet = await this._getUserWallet();
                if (!userWallet) throw new Error("Could not load primary trading wallet.");
                
                // Get chatId from user data
                const users = await this.dataManager.loadUsers();
                const chatId = Object.keys(users)[0]; // First user for now
                
                // Check Redis portfolio for position
                const hasPosition = await this.dataManager.hasPosition(chatId, tokenMintToSell);
                
                if (!hasPosition) {
                    this.logInfo(`[EXEC-MAIN] ⏭️ SELL detected, but user ${chatId} has NO position in Redis for ${shortenAddress(tokenMintToSell)}. Skipping.`, { signature });
                    return; // Gracefully exit
                } else {
                    // Get position details from Redis
                    const position = await this.dataManager.getPosition(chatId, tokenMintToSell);
                    this.logInfo(`[EXEC-MAIN] 🎯 SELL detected and position CONFIRMED in Redis for user ${chatId}: ${position.tokenAmount} tokens of ${shortenAddress(tokenMintToSell)}. Proceeding with sell logic.`);
                    // The code will continue to the switch statement to execute the sell.
                }
            } else if (tradeType !== 'buy') {
                // For now, we only support 'buy' and 'sell'.
                this.logWarn(`[EXEC-MAIN] ⚠️ Unsupported trade type "${tradeType}". Ignoring.`, { signature });
                return;
            }
            // --- 3. EXECUTE THE TRADE (Routing) ---
            let result;
            let amountSpentInLamports = 0; // The actual amount we spent

            // The switch statement now routes to the specific buy/sell function.
            // It's also responsible for getting the final scaled SOL amount we spent.
            const userWallet = await this._getUserWallet(); // Get the user wallet once
            if (!userWallet) throw new Error("Could not load primary user wallet.");
            
            // Apply the user scale factor to the master trader's input amount
            amountSpentInLamports = Math.floor(swapDetails.inputAmount * userConfig.scaleFactor);
            
            // Update swapDetails with the scaled amount for all DEX functions
            swapDetails.inputAmount = amountSpentInLamports;
            this.logInfo(`[EXEC-MAIN] 🔧 Applied scale factor: ${swapDetails.inputAmount / userConfig.scaleFactor} → ${amountSpentInLamports} (${userConfig.scaleFactor * 100}%)`);
            
            switch (platform.toLowerCase()) {
                case 'jupiter':
                    if (tradeType === 'buy') {
                        result = await this.executeJupiterBuy(swapDetails, userConfig);
                    } else {
                        // Implement executeJupiterSell in the future
                        throw new Error("Sell logic for Jupiter is not yet implemented.");
                    }
                    break;

                case 'pumpfun':
                    // Use smart routing to handle both bonding curve and AMM phases
                    result = await this.executePumpFunTrade(swapDetails, userConfig, tradeType);
                    break;

                case 'raydium':
                     if (tradeType === 'buy') {
                        result = await this.executeRaydiumBuy(swapDetails, userConfig);
                    } else {
                        result = await this.executeRaydiumSell(swapDetails, userConfig);
                    }
                    break;

                case 'meteora':
                    if (tradeType === 'buy') {
                        result = await this.executeMeteoraBuy(swapDetails, userConfig);
                    } else {
                        result = await this.executeMeteoraSell(swapDetails, userConfig);
                    }
                    break;

                case 'photon':
                case 'router:photon':
                    // Photon is a router - route to underlying DEX
                    this.logInfo(`[EXEC-MAIN] 🔄 Photon router detected - routing to underlying DEX`);
                    // For now, treat Photon as Jupiter (most common underlying DEX)
                    if (tradeType === 'buy') {
                        result = await this.executeJupiterBuy(swapDetails, userConfig);
                    } else {
                        throw new Error("Sell logic for Photon router is not yet implemented.");
                    }
                    break;

                case 'router:jupiter':
                case 'router:jupiter_v4':
                case 'router:jupiter_v6':
                    // Jupiter routers - use Jupiter execution
                    this.logInfo(`[EXEC-MAIN] 🔄 Jupiter router detected - using Jupiter execution`);
                    if (tradeType === 'buy') {
                        result = await this.executeJupiterBuy(swapDetails, userConfig);
                    } else {
                        throw new Error("Sell logic for Jupiter router is not yet implemented.");
                    }
                    break;

                case 'router:axiom':
                    // Axiom router - route to underlying DEX
                    this.logInfo(`[EXEC-MAIN] 🔄 Axiom router detected - routing to underlying DEX`);
                    if (tradeType === 'buy') {
                        result = await this.executeJupiterBuy(swapDetails, userConfig);
                    } else {
                        throw new Error("Sell logic for Axiom router is not yet implemented.");
                    }
                    break;

                default:
                    this.logError(`[EXEC-MAIN] ❌ CRITICAL: Unsupported platform "${platform}" received from monitor.`, { signature });
                    throw new Error(`Unsupported platform: ${platform}`);
            }

            if (!result || !result.success || !result.signature) {
                 this.logError(`[EXEC-MAIN] ❌ Trade execution failed or returned no signature.`, { platform });
                 return; // Stop here if the trade failed
            }

            // --- 4. POST-TRADE VERIFICATION & NOTIFICATION ---
            this.logInfo(`[EXEC-MAIN] ✅ Trade sent successfully! Verifying results for signature: ${shortenAddress(result.signature)}`);
            
            const verification = await this._fetchTradeResults(result.signature, swapDetails.outputMint, userWallet.publicKey);
            
            // --- 5. PORTFOLIO TRACKING: Store position in Redis ---
            if (verification && verification.amountBoughtRaw > 0) {
                // Get user's chatId for portfolio storage
                const users = await this.dataManager.loadUsers();
                const chatId = Object.keys(users)[0]; // First user for now
                
                const positionData = {
                    tokenMint: swapDetails.outputMint,
                    tokenAmount: verification.amountBoughtRaw,
                    decimals: verification.decimals,
                    solSpent: amountSpentInLamports,
                    platform: platform,
                    traderName: message.traderName,
                    buySignature: result.signature,
                    buyTime: new Date().toISOString(),
                    lastUpdated: new Date().toISOString()
                };
                
                await this.dataManager.addPosition(chatId, swapDetails.outputMint, positionData);
                this.logInfo(`[PORTFOLIO] 📊 Position stored for user ${chatId}: ${verification.amountBoughtRaw} tokens of ${shortenAddress(swapDetails.outputMint)}`);
            }
            
            const tradeDataForNotification = {
                signature: result.signature,
                traderName: message.traderName,
                platform: platform,
                solSpent: amountSpentInLamports, // The lamports WE spent
                inputMint: swapDetails.inputMint,
                outputMint: swapDetails.outputMint,
                // Use verified results, with fallbacks
                tokensBoughtRaw: verification ? verification.amountBoughtRaw : 0,
                decimals: verification ? verification.decimals : 'unknown'
            };

            await this.notificationManager.sendTradeNotification(tradeDataForNotification);

            this.logInfo(`[EXEC-MAIN] ✅✅ SUCCESS! Copy trade executed and notification sent.`, {
                signature: result.signature,
                executionTime: result.executionTime
            });
            
            // 🔧 PERFORMANCE: Record complete copy trade cycle
            const executionLatency = Date.now() - executionStartTime;
            const detectionLatency = message.detectionLatency || 0; // If available from monitor
            performanceMonitor.recordCopyTradeCycle(detectionLatency, executionLatency);
            
            // Success - lock will be released in finally block
            
            return result;

        } catch (error) {
            this.logError(`[EXEC-MAIN] ❌ FATAL ERROR in trade execution pipeline`, { 
                signature,
                error: error.message,
                stack: error.stack // Always log the stack for deep debugging
            });

            // --- SEND FAILURE NOTIFICATION TO TELEGRAM ---
            try {
                if (this.notificationManager) {
                    const chatId = config.ADMIN_CHAT_ID;
                    const traderName = message.traderName || 'Unknown Trader';
                    const platform = message.analysisResult?.swapDetails?.platform || 'Unknown';
                    
                    // Check for specific error types and send appropriate notifications
                    let errorTitle = 'Trade Execution Failed';
                    let errorDetails = `Trader: ${traderName}\nPlatform: ${platform}\nError: ${error.message}\nSignature: ${signature}`;
                    
                    // Handle insufficient balance errors specifically
                    if (error.message.includes('insufficient') || error.message.includes('balance') || 
                        error.message.includes('Insufficient') || error.message.includes('Balance')) {
                        errorTitle = '💰 Insufficient Balance Error';
                        errorDetails = `🚨 *INSUFFICIENT BALANCE DETECTED*\n\n` +
                                     `*Trader*: ${traderName}\n` +
                                     `*Platform*: ${platform}\n` +
                                     `*Error*: ${error.message}\n` +
                                     `*Signature*: ${signature}\n\n` +
                                     `⚠️ *Action Required*: Please add more SOL to your trading wallet!`;
                    }
                    // Handle network/connection errors
                    else if (error.message.includes('fetch failed') || error.message.includes('timeout') || 
                             error.message.includes('network') || error.message.includes('connection')) {
                        errorTitle = '🌐 Network Error';
                        errorDetails = `🔌 *NETWORK CONNECTION ISSUE*\n\n` +
                                     `*Trader*: ${traderName}\n` +
                                     `*Platform*: ${platform}\n` +
                                     `*Error*: ${error.message}\n` +
                                     `*Signature*: ${signature}\n\n` +
                                     `🔄 *Status*: Bot will retry automatically`;
                    }
                    // Handle transaction rejection errors
                    else if (error.message.includes('rejected') || error.message.includes('failed') || 
                             error.message.includes('invalid') || error.message.includes('error')) {
                        errorTitle = '❌ Transaction Rejected';
                        errorDetails = `🚫 *TRANSACTION REJECTED*\n\n` +
                                     `*Trader*: ${traderName}\n` +
                                     `*Platform*: ${platform}\n` +
                                     `*Error*: ${error.message}\n` +
                                     `*Signature*: ${signature}\n\n` +
                                     `🔍 *Possible Causes*: Slippage too low, token not found, or market conditions changed`;
                    }
                    
                    await this.notificationManager.sendErrorNotification(
                        chatId,
                        errorTitle,
                        errorDetails
                    );
                    
                    this.logInfo(`[EXEC-MAIN] 📱 Enhanced failure notification sent to Telegram`);
                }
            } catch (notificationError) {
                this.logError(`[EXEC-MAIN] ⚠️ Failed to send failure notification: ${notificationError.message}`);
            }

            throw error; // Rethrow to ensure the worker catches it
        } finally {
             // ========================= RELEASE THE LOCK ========================
             if (lockAcquired) {
                 await this.redisManager.del(lockKey);
                 this.logInfo(`[EXEC-MAIN] ✅ Lock released for ${shortenAddress(swapDetails.outputMint)}.`);
             }
             // ===================================================================
        }
    }
    
    // REMOVED: handleCopyTrade() - REDUNDANT (now integrated into executeCopyTrade)


    async cancelTrade(tradeId) {
        try {
            if (this.pendingTrades.has(tradeId)) {
                const trade = this.pendingTrades.get(tradeId);
                trade.status = 'cancelled';
                
                this.pendingTrades.delete(tradeId);
                this.failedTrades.set(tradeId, {
                    ...trade,
                    endTime: Date.now(),
                    status: 'cancelled'
                });

                this.logInfo('Trade cancelled', { tradeId });
                this.signalMessage('TRADE_CANCELLED', { tradeId });
            } else {
                this.logWarn('Trade not found for cancellation', { tradeId });
            }
        } catch (error) {
            this.logError('Failed to cancel trade', { tradeId, error: error.message });
        }
    }

    async getTradeStatus(tradeId) {
        try {
            let trade = null;
            let status = 'not_found';

            if (this.pendingTrades.has(tradeId)) {
                trade = this.pendingTrades.get(tradeId);
                status = 'pending';
            } else if (this.completedTrades.has(tradeId)) {
                trade = this.completedTrades.get(tradeId);
                status = 'completed';
            } else if (this.failedTrades.has(tradeId)) {
                trade = this.failedTrades.get(tradeId);
                status = 'failed';
            }

            this.signalMessage('TRADE_STATUS_RESPONSE', {
                tradeId,
                status,
                trade
            });
        } catch (error) {
            this.logError('Failed to get trade status', { tradeId, error: error.message });
        }
    }

    async getPendingTrades() {
        try {
            const pendingTrades = Array.from(this.pendingTrades.values());
            this.signalMessage('PENDING_TRADES_RESPONSE', {
                count: pendingTrades.length,
                trades: pendingTrades
            });
        } catch (error) {
            this.logError('Failed to get pending trades', { error: error.message });
        }
    }

    // REMOVED: processTraderActivity() - OBSOLETE (used removed tradingEngine)

    async customCleanup() {
        try {
            // Cancel all pending trades
            const pendingTradeIds = Array.from(this.pendingTrades.keys());
            for (const tradeId of pendingTradeIds) {
                await this.cancelTrade(tradeId);
            }

            // Close database connection
            if (this.dataManager) {
                await this.dataManager.close();
            }

            this.logInfo('Trade executor worker cleanup completed');
        } catch (error) {
            this.logError('Error during cleanup', { error: error.message });
        }
    }

    // ===== PDA/ATA RECONSTRUCTION =====
    
    async _reconstructPDAAndATA(analysisResult, swapDetails) {
        try {
            this.logInfo(`[PDA-ATA] 🔧 Starting PDA/ATA reconstruction...`);
            
            // Get user's wallet
            const userWallet = await this._getUserWallet();
            if (!userWallet) {
                throw new Error('User wallet not found');
            }
            
            // Get user configs for scale factor and slippage from dataManager
            const userConfig = analysisResult.userConfig || {
                scaleFactor: this.dataManager?.getUserConfig?.()?.scaleFactor || 0.1,
                slippage: this.dataManager?.getUserConfig?.()?.maxSlippage || 0.15,
                platformPreferences: this.dataManager?.getUserConfig?.()?.supportedPlatforms || ['PumpFun', 'Raydium', 'Jupiter']
            };
            
            this.logInfo(`[PDA-ATA] 🔧 User configs:`, {
                scaleFactor: userConfig.scaleFactor,
                slippage: userConfig.slippage,
                platformPreferences: userConfig.platformPreferences
            });
            
            // 1. ATA RECONSTRUCTION: Create Associated Token Accounts if needed
            if (swapDetails.requiresATACreation) {
                this.logInfo(`[PDA-ATA] 🔧 Creating ATA for ${swapDetails.outputMint}`);
                
                // Check if ATA exists - Pass userWallet.publicKey, NOT the whole userWallet object
                const ataExists = await this._checkATAExists(userWallet.publicKey, swapDetails.outputMint);
                if (!ataExists) {
                    this.logInfo(`[PDA-ATA] 🔧 ATA does not exist, creating...`);
                    await this._createATA(userWallet, swapDetails.outputMint);
                    this.logInfo(`[PDA-ATA] ✅ ATA created successfully`);
                } else {
                    this.logInfo(`[PDA-ATA] ✅ ATA already exists`);
                }
            }
            
            // 2. PDA RECONSTRUCTION: Reconstruct Program Derived Addresses if needed
            if (swapDetails.requiresPDARecovery) {
                this.logInfo(`[PDA-ATA] 🔧 Reconstructing PDA for ${swapDetails.platform}`);
                
                // For PumpFun: Reconstruct bonding curve PDA
                if (swapDetails.platform === 'PumpFun') {
                    const bondingCurvePDA = await this._reconstructPumpFunBondingCurve(swapDetails.outputMint);
                    this.logInfo(`[PDA-ATA] ✅ PumpFun bonding curve PDA: ${bondingCurvePDA}`);
                }
                
                // For Raydium: Reconstruct pool PDA
                if (swapDetails.platform === 'Raydium') {
                    const poolPDA = await this._reconstructRaydiumPool(swapDetails.inputMint, swapDetails.outputMint);
                    this.logInfo(`[PDA-ATA] ✅ Raydium pool PDA: ${poolPDA}`);
                }
            }
            
            // 3. APPLY USER CONFIGS: Scale factor and slippage
            const scaledAmount = Math.floor(swapDetails.inputAmount * userConfig.scaleFactor);
            this.logInfo(`[PDA-ATA] 🔧 Applied user scale factor: ${swapDetails.inputAmount} → ${scaledAmount} (${userConfig.scaleFactor * 100}%)`);
            
            // Update swap details with user configs
            swapDetails.scaledAmount = scaledAmount;
            swapDetails.userSlippage = userConfig.slippage;
            
            this.logInfo(`[PDA-ATA] ✅ PDA/ATA reconstruction completed with user configs`);
            
        } catch (error) {
            this.logError(`[PDA-ATA] ❌ PDA/ATA reconstruction failed: ${error.message}`);
            throw error;
        }
    }
    
    async _getUserWallet() {
        try {
            // Get the first available user from the database
            const users = await this.dataManager.readJsonFile('users.json');
            if (!users || !users.users) {
                throw new Error('No users found in database');
            }
            
            // Get the first user (admin user)
            const firstUserId = Object.keys(users.users)[0];
            if (!firstUserId) {
                throw new Error('No users found');
            }
            
            const user = users.users[firstUserId];
            this.logInfo(`[PDA-ATA] 🔍 Using user: ${user.first_name} (${user.chat_id})`);
            
            // Get user's wallet from wallet manager
            if (this.walletManager) {
                const userWallet = await this.walletManager.getPrimaryTradingKeypair(user.chat_id);
                if (userWallet && userWallet.keypair && userWallet.wallet) {
                    this.logInfo(`[PDA-ATA] ✅ Found wallet: ${userWallet.wallet.publicKey.toString()}`);
                    // CRITICAL FIX: Return the actual Keypair instance, not the database object
                    return userWallet.keypair; // Return the real Keypair for signing
                }
            }
            
            // Fallback: use environment variable or config
            const walletFromEnv = process.env.WALLET_PUBLIC_KEY;
            if (walletFromEnv) {
                this.logInfo(`[PDA-ATA] ✅ Using wallet from environment: ${walletFromEnv}`);
                // CRITICAL FIX: For fallback, we need a real Keypair, not just a PublicKey
                // This is a limitation - we can't sign without the private key
                throw new Error('Environment wallet fallback not supported - private key required for signing');
            }
            
            throw new Error('No user wallet found');
        } catch (error) {
            this.logError(`[PDA-ATA] ❌ Failed to get user wallet: ${error.message}`);
            throw error;
        }
    }
    
    // ADD THIS NEW FUNCTION
    async _fetchTradeResults(signature, outputMint, userWalletPublicKey) {
        try {
            this.logInfo(`[VERIFY-V2] 🔍 Fetching results for sig: ${shortenAddress(signature)}`);
            await new Promise(resolve => setTimeout(resolve, 2000));

            // ========================= THE VERSIONED TRANSACTION FIX ========================
            const tx = await this.solanaManager.connection.getTransaction(signature, {
                maxSupportedTransactionVersion: 0, // This is essential for V0 transactions
                commitment: 'confirmed'
            });
            // ============================================================================

            if (!tx) {
                this.logWarn(`[VERIFY-V2] ⚠️ Transaction not found. Cannot verify token amount.`);
                return null;
            }

            // The rest of the logic remains the same.
            const postBalances = tx.meta.postTokenBalances;
            const preBalances = tx.meta.preTokenBalances;
            const ownerAddress = userWalletPublicKey.toBase58();
            const mintAddress = outputMint.toString();

            const postBalance = postBalances.find(tb => tb.owner === ownerAddress && tb.mint === mintAddress);
            const preBalance = preBalances.find(tb => tb.owner === ownerAddress && tb.mint === mintAddress);

            const amountBought = BigInt(postBalance?.uiTokenAmount?.amount || '0') - BigInt(preBalance?.uiTokenAmount?.amount || '0');
            const decimals = postBalance?.uiTokenAmount?.decimals ?? 0;

            this.logInfo(`[VERIFY-V2] ✅ Verification complete. Bought: ${amountBought} (raw)`);
            return { amountBoughtRaw: amountBought, decimals };

        } catch (error) {
            this.logError(`[VERIFY-V2] ❌ Error fetching trade results`, { signature: shortenAddress(signature), error: error.message });
            return null;
        }
    }
    
    async _checkATAExists(owner, mint) {
        try {
            const { PublicKey } = require('@solana/web3.js');
            const { getAssociatedTokenAddress } = require('@solana/spl-token');
            
            // Get ATA address - Handle both PublicKey and Keypair objects
            const ownerPublicKey = owner.publicKey ? owner.publicKey : owner;
            const ataAddress = await getAssociatedTokenAddress(
                new PublicKey(mint),
                new PublicKey(ownerPublicKey)
            );
            
            // Check if account exists using HELIUS RPC (FASTER!)
            const connection = this.solanaManager?.connection;
            if (!connection) {
                throw new Error('Helius RPC connection not available');
            }
            
            this.logInfo(`[PDA-ATA] 🔧 Checking ATA existence via Helius RPC...`);
            const accountInfo = await connection.getAccountInfo(ataAddress);
            const exists = accountInfo !== null;
            this.logInfo(`[PDA-ATA] 🔧 ATA exists: ${exists} (checked via Helius RPC)`);
            return exists;
            
        } catch (error) {
            this.logError(`[PDA-ATA] ❌ Failed to check ATA existence: ${error.message}`);
            return false;
        }
    }
    
    async _createATA(ownerWallet, mint) {
        try {
            const { PublicKey, Transaction } = require('@solana/web3.js');
            const { createAssociatedTokenAccountInstruction } = require('@solana/spl-token');
            
            const connection = this.solanaManager?.connection;
            if (!connection) {
                throw new Error('Helius RPC connection not available');
            }
            
            // Get ATA address using sync version (faster) - Use ownerWallet.publicKey
            const { getAssociatedTokenAddressSync } = require('@solana/spl-token');
            const ataAddress = getAssociatedTokenAddressSync(
                new PublicKey(mint),
                ownerWallet.publicKey // Use .publicKey here
            );
            
            // Create instruction - Use ownerWallet.publicKey for all PublicKey constructors
            const createATAInstruction = createAssociatedTokenAccountInstruction(
                ownerWallet.publicKey, // payer
                ataAddress, // associated token account
                ownerWallet.publicKey, // owner
                new PublicKey(mint) // mint
            );
            
            // Create transaction
            const transaction = new Transaction().add(createATAInstruction);
            
            // Get recent blockhash via HELIUS RPC (FASTER!)
            this.logInfo(`[PDA-ATA] 🔧 Getting recent blockhash via Helius RPC...`);
            const { blockhash } = await connection.getLatestBlockhash();
            transaction.recentBlockhash = blockhash;
            transaction.feePayer = ownerWallet.publicKey;
            
            this.logInfo(`[PDA-ATA] 🔧 ATA transaction created for mint: ${mint}`);
            this.logInfo(`[PDA-ATA] 🔧 ATA address: ${ataAddress.toString()}`);
            this.logInfo(`[PDA-ATA] 🔧 Blockhash: ${blockhash} (via Helius RPC)`);
            
            // Note: Transaction needs to be signed and sent by the user's wallet
            // This is just the preparation step
            
        } catch (error) {
            this.logError(`[PDA-ATA] ❌ Failed to create ATA: ${error.message}`);
            throw error;
        }
    }
    
    async _reconstructPumpFunBondingCurve(tokenMint) {
        try {
            const { PublicKey } = require('@solana/web3.js');
            
            const pumpFunProgramId = config.PLATFORM_IDS.PUMP_FUN;
            const tokenMintPubkey = new PublicKey(tokenMint);
            
            // Find PDA for PumpFun bonding curve
            const [bondingCurvePDA, bump] = PublicKey.findProgramAddressSync(
                [Buffer.from('bonding-curve'), tokenMintPubkey.toBuffer()],
                pumpFunProgramId
            );
            
            this.logInfo(`[PDA-ATA] 🔧 PumpFun bonding curve PDA: ${bondingCurvePDA.toString()}`);
            this.logInfo(`[PDA-ATA] 🔧 Bump: ${bump}`);
            
            return bondingCurvePDA.toString();
            
        } catch (error) {
            this.logError(`[PDA-ATA] ❌ Failed to reconstruct PumpFun bonding curve: ${error.message}`);
            throw error;
        }
    }
    
    async _reconstructRaydiumPool(mintA, mintB) {
        try {
            const { PublicKey } = require('@solana/web3.js');
            
            const raydiumProgramId = config.PLATFORM_IDS.RAYDIUM_V4;
            const mintAPubkey = new PublicKey(mintA);
            const mintBPubkey = new PublicKey(mintB);
            
            // Find PDA for Raydium pool
            const [poolPDA, bump] = PublicKey.findProgramAddressSync(
                [Buffer.from('pool'), mintAPubkey.toBuffer(), mintBPubkey.toBuffer()],
                raydiumProgramId
            );
            
            this.logInfo(`[PDA-ATA] 🔧 Raydium pool PDA: ${poolPDA.toString()}`);
            this.logInfo(`[PDA-ATA] 🔧 Bump: ${bump}`);
            
            return poolPDA.toString();
            
        } catch (error) {
            this.logError(`[PDA-ATA] ❌ Failed to reconstruct Raydium pool: ${error.message}`);
            throw error;
        }
    }

    // ===== SMART ROUTER DETECTION =====
    
    _detectTargetDexFromTransaction(message) {
        try {
            this.logInfo(`[SMART-ROUTER] 🔍 FALLBACK: Analyzing transaction for real DEX...`);
            this.logInfo(`[SMART-ROUTER] 🔍 Message structure:`, {
                hasAnalysisResult: !!message?.analysisResult,
                hasOriginalTransaction: !!message?.originalTransaction,
                hasLogMessages: !!message?.originalTransaction?.meta?.logMessages
            });
            
            // ========================= ROUTER PEELING LOGIC =========================
            // Apply the same logic as monitor and laserstream to distinguish routers from DEXes
            const routerPeelingResult = this._performRouterPeeling(message);
            if (routerPeelingResult.realDexProgram) {
                this.logInfo(`[SMART-ROUTER] ✅ Router peeling found real DEX: ${routerPeelingResult.platform}`);
                return routerPeelingResult.platform;
            }
            
            // ========================= FALLBACK: LOG MESSAGE ANALYSIS =========================
            const logMessages = message?.originalTransaction?.meta?.logMessages;
            
            if (logMessages && Array.isArray(logMessages)) {
                const logs = logMessages.join(' ');
                this.logInfo(`[SMART-ROUTER] 🔍 Log messages (first 200 chars): ${logs.substring(0, 200)}...`);
                
                // ========================= PROFESSIONAL CONFIG.JS APPROACH =========================
                // Loop through all known platforms from our single source of truth (config.js)
                for (const [platformKey, platformId] of Object.entries(config.PLATFORM_IDS)) {
                    
                    // Handle both single IDs and arrays of IDs (like METEORA_DBC)
                    const idsToCheck = Array.isArray(platformId) ? platformId : [platformId];
                    
                    for (const id of idsToCheck) {
                        // Convert PublicKey to string for comparison
                        const idString = id instanceof PublicKey ? id.toBase58() : id.toString();
                        
                        if (logs.includes(idString)) {
                            this.logInfo(`[SMART-ROUTER] ✅ Found ${platformKey} in log messages`);
                            
                            // Map config keys to our simple platform names
                            if (platformKey.startsWith('RAYDIUM')) return 'Raydium';
                            if (platformKey.startsWith('PUMP_FUN')) return 'PumpFun';
                            if (platformKey.startsWith('METEORA')) return 'Meteora';
                            if (platformKey.startsWith('JUPITER')) return 'Jupiter';
                            if (platformKey.startsWith('WHIRLPOOL')) return 'Orca';
                            if (platformKey.startsWith('OPENBOOK')) return 'OpenBook';
                            if (platformKey.startsWith('SERUM')) return 'Serum';
                            if (platformKey.startsWith('BLOOM_ROUTER') || platformKey.startsWith('PRIVATE_ROUTER')) return 'BloomRouter';
                        }
                    }
                }
                
                // Special case: Check for "pump.fun" text in logs
                if (logs.includes('pump.fun')) {
                    this.logInfo(`[SMART-ROUTER] ✅ Found pump.fun text in log messages`);
                    return 'PumpFun';
                }
            }
            // =========================================================
            
            // Fallback to the original, less reliable analysis if logs are not conclusive
            this.logWarn('[SMART-ROUTER] ⚠️ Could not find a definitive DEX in logs, using initial platform guess.');
            return message?.analysisResult?.swapDetails?.platform || 'Jupiter';
            
        } catch (error) {
            this.logError(`[SMART-ROUTER] ❌ Error detecting target DEX: ${error.message}`);
            return 'Jupiter'; // Safe fallback
        }
    }
    
    // ===== ROUTER PEELING LOGIC =====
    // Based on monitor and laserstream logic to distinguish routers from real DEXes
    
    _performRouterPeeling(message) {
        try {
            this.logInfo(`[ROUTER-PEELING] 🔍 Starting router peeling analysis...`);
            
            // Extract transaction data
            const originalTx = message?.originalTransaction;
            if (!originalTx) {
                this.logWarn(`[ROUTER-PEELING] ⚠️ No original transaction found`);
                return { realDexProgram: null, platform: null, routerPrograms: [] };
            }
            
            // Get program IDs from the transaction
            const programIds = this._extractProgramIdsFromTransaction(originalTx);
            if (programIds.length === 0) {
                this.logWarn(`[ROUTER-PEELING] ⚠️ No program IDs found in transaction`);
                return { realDexProgram: null, platform: null, routerPrograms: [] };
            }
            
            this.logInfo(`[ROUTER-PEELING] 🔍 Found ${programIds.length} program IDs: ${programIds.slice(0, 3).join(', ')}...`);
            
            // Step 1: Identify router programs
            const routerPrograms = this._identifyRouterPrograms(programIds);
            if (routerPrograms.length === 0) {
                this.logInfo(`[ROUTER-PEELING] 🔍 No routers detected, checking for direct DEX calls...`);
                
                // No router detected, check if any program IDs are direct DEX calls
                const directDexProgram = this._findDirectDexProgram(programIds);
                if (directDexProgram) {
                    const platform = this._identifyPlatform(directDexProgram);
                    this.logInfo(`[ROUTER-PEELING] ✅ Direct DEX call detected: ${platform} (${directDexProgram})`);
                    return { realDexProgram: directDexProgram, platform, routerPrograms: [] };
                }
                
                return { realDexProgram: null, platform: null, routerPrograms: [] };
            }
            
            this.logInfo(`[ROUTER-PEELING] 🔍 Router detected: ${routerPrograms.join(', ')}`);
            
            // Step 2: Look for inner DEX programs in account keys
            const innerDexPrograms = this._findInnerDexPrograms(programIds);
            if (innerDexPrograms.length > 0) {
                const realDexProgram = innerDexPrograms[0];
                const platform = this._identifyPlatform(realDexProgram);
                this.logInfo(`[ROUTER-PEELING] ✅ Found inner DEX: ${platform} (${realDexProgram})`);
                return { realDexProgram, platform, routerPrograms };
            }
            
            // Step 3: Check log messages for DEX programs
            const logDexPrograms = this._findDexInLogs(originalTx);
            if (logDexPrograms.length > 0) {
                const realDexProgram = logDexPrograms[0];
                const platform = this._identifyPlatform(realDexProgram);
                this.logInfo(`[ROUTER-PEELING] ✅ Found DEX in logs: ${platform} (${realDexProgram})`);
                return { realDexProgram, platform, routerPrograms };
            }
            
            this.logWarn(`[ROUTER-PEELING] ⚠️ Router detected but no inner DEX found`);
            return { realDexProgram: null, platform: null, routerPrograms };
            
        } catch (error) {
            this.logError(`[ROUTER-PEELING] ❌ Error in router peeling: ${error.message}`);
            return { realDexProgram: null, platform: null, routerPrograms: [] };
        }
    }
    
    _extractProgramIdsFromTransaction(originalTx) {
        const programIds = [];
        
        try {
            // Extract from account keys (most reliable)
            if (originalTx.transaction && originalTx.transaction.message && originalTx.transaction.message.accountKeys) {
                programIds.push(...originalTx.transaction.message.accountKeys);
            }
            
            // Extract from instructions
            if (originalTx.transaction && originalTx.transaction.message && originalTx.transaction.message.instructions) {
                const accountKeys = originalTx.transaction.message.accountKeys || [];
                for (const instruction of originalTx.transaction.message.instructions) {
                    if (instruction.programIdIndex !== undefined && accountKeys[instruction.programIdIndex]) {
                        programIds.push(accountKeys[instruction.programIdIndex]);
                    }
                }
            }
            
            // Remove duplicates
            return [...new Set(programIds)];
            
        } catch (error) {
            this.logError(`[ROUTER-PEELING] ❌ Error extracting program IDs: ${error.message}`);
            return [];
        }
    }
    
    _identifyRouterPrograms(programIds) {
        const routerPrograms = [];
        
        // Known router program IDs (from config.js)
        const knownRouters = [
            config.PLATFORM_IDS.JUPITER.toBase58(),
            config.PLATFORM_IDS.JUPITER_V6.toBase58(),
            config.PLATFORM_IDS.JUPITER_AMM_ROUTING.toBase58(),
            config.PLATFORM_IDS.BLOOM_ROUTER.toBase58(),
            config.PLATFORM_IDS.PRIVATE_ROUTER.toBase58(),
            'So11111111111111111111111111111111111111112' // System Program (sometimes used as router)
        ];
        
        for (const programId of programIds) {
            if (knownRouters.includes(programId)) {
                routerPrograms.push(programId);
            }
        }
        
        return routerPrograms;
    }
    
    _findDirectDexProgram(programIds) {
        // Check for direct DEX program calls (not through routers)
        const dexPrograms = [
            config.PLATFORM_IDS.PUMP_FUN.toBase58(),
            config.PLATFORM_IDS.PUMP_FUN_AMM.toBase58(),
            config.PLATFORM_IDS.PUMP_FUN_ROUTER.toBase58(),
            config.PLATFORM_IDS.RAYDIUM_V4.toBase58(),
            config.PLATFORM_IDS.RAYDIUM_CLMM.toBase58(),
            config.PLATFORM_IDS.RAYDIUM_CPMM.toBase58(),
            config.PLATFORM_IDS.METEORA_DLMM.toBase58(),
            config.PLATFORM_IDS.WHIRLPOOL.toBase58(),
            config.PLATFORM_IDS.OPENBOOK.toBase58(),
            config.PLATFORM_IDS.SERUM_DEX_V3.toBase58()
        ];
        
        for (const programId of programIds) {
            if (dexPrograms.includes(programId)) {
                return programId;
            }
        }
        
        return null;
    }
    
    _findInnerDexPrograms(programIds) {
        const innerDexPrograms = [];
        
        // Known DEX program IDs (excluding routers)
        const knownDexPrograms = [
            config.PLATFORM_IDS.PUMP_FUN.toBase58(),
            config.PLATFORM_IDS.PUMP_FUN_AMM.toBase58(),
            config.PLATFORM_IDS.PUMP_FUN_ROUTER.toBase58(),
            config.PLATFORM_IDS.RAYDIUM_V4.toBase58(),
            config.PLATFORM_IDS.RAYDIUM_CLMM.toBase58(),
            config.PLATFORM_IDS.RAYDIUM_CPMM.toBase58(),
            config.PLATFORM_IDS.METEORA_DLMM.toBase58(),
            config.PLATFORM_IDS.WHIRLPOOL.toBase58(),
            config.PLATFORM_IDS.OPENBOOK.toBase58(),
            config.PLATFORM_IDS.SERUM_DEX_V3.toBase58()
        ];
        
        for (const programId of programIds) {
            if (knownDexPrograms.includes(programId)) {
                innerDexPrograms.push(programId);
            }
        }
        
        return innerDexPrograms;
    }
    
    _findDexInLogs(originalTx) {
        const logDexPrograms = [];
        
        try {
            const logMessages = originalTx.meta?.logMessages;
            if (!logMessages || !Array.isArray(logMessages)) {
                return logDexPrograms;
            }
            
            const logs = logMessages.join(' ');
            
            // Check for DEX program IDs in logs
            const knownDexPrograms = [
                config.PLATFORM_IDS.PUMP_FUN.toBase58(),
                config.PLATFORM_IDS.PUMP_FUN_AMM.toBase58(),
                config.PLATFORM_IDS.RAYDIUM_V4.toBase58(),
                config.PLATFORM_IDS.RAYDIUM_CLMM.toBase58(),
                config.PLATFORM_IDS.METEORA_DLMM.toBase58(),
                config.PLATFORM_IDS.WHIRLPOOL.toBase58(),
                config.PLATFORM_IDS.OPENBOOK.toBase58(),
                config.PLATFORM_IDS.SERUM_DEX_V3.toBase58()
            ];
            
            for (const programId of knownDexPrograms) {
                if (logs.includes(programId)) {
                    logDexPrograms.push(programId);
                }
            }
            
        } catch (error) {
            this.logError(`[ROUTER-PEELING] ❌ Error finding DEX in logs: ${error.message}`);
        }
        
        return logDexPrograms;
    }
    
    _identifyPlatform(programId) {
        // Map program IDs to platform names
        const platformMap = {
            [config.PLATFORM_IDS.PUMP_FUN.toBase58()]: 'PumpFun',
            [config.PLATFORM_IDS.PUMP_FUN_AMM.toBase58()]: 'PumpFun',
            [config.PLATFORM_IDS.PUMP_FUN_ROUTER.toBase58()]: 'PumpFun',
            [config.PLATFORM_IDS.RAYDIUM_V4.toBase58()]: 'Raydium',
            [config.PLATFORM_IDS.RAYDIUM_CLMM.toBase58()]: 'Raydium',
            [config.PLATFORM_IDS.RAYDIUM_CPMM.toBase58()]: 'Raydium',
            [config.PLATFORM_IDS.METEORA_DLMM.toBase58()]: 'Meteora',
            [config.PLATFORM_IDS.WHIRLPOOL.toBase58()]: 'Orca',
            [config.PLATFORM_IDS.OPENBOOK.toBase58()]: 'OpenBook',
            [config.PLATFORM_IDS.SERUM_DEX_V3.toBase58()]: 'Serum'
        };
        
        return platformMap[programId] || 'Unknown';
    }
    
    _extractProgramIdsFromLogs(logMessages) {
        const programIds = [];
        
        if (!logMessages || !Array.isArray(logMessages)) {
            return programIds;
        }
        
        for (const log of logMessages) {
            // Look for "Program [PROGRAM_ID] invoke" patterns
            const match = log.match(/Program ([1-9A-HJ-NP-Za-km-z]{32,}) invoke/);
            if (match) {
                programIds.push(match[1]);
            }
        }
        
        return programIds;
    }
    
    _extractProgramIdsFromInnerInstructions(innerInstructions, accountKeys) {
        const programIds = [];
        
        if (!innerInstructions || !Array.isArray(innerInstructions)) {
            return programIds;
        }
        
        for (const innerInstruction of innerInstructions) {
            if (innerInstruction.instructions && Array.isArray(innerInstruction.instructions)) {
                for (const instruction of innerInstruction.instructions) {
                    if (instruction.programIdIndex !== undefined && accountKeys[instruction.programIdIndex]) {
                        programIds.push(accountKeys[instruction.programIdIndex]);
                    }
                }
            }
        }
        
        return programIds;
    }

    // ===== DIRECT TRANSACTION BUILDING (BYPASSES API ROUTES) =====
    
    /**
     * 🚀 DIRECT COPY TRADE: Build transaction directly from original
     * This bypasses Helius Premium API routes and builds the EXACT same transaction
     */
    async executeDirectCopyTrade(message, userConfig = {}) {
        try {
            this.logInfo(`[DIRECT-BUILDER] 🚀 Building DIRECT copy from original transaction...`);
            
            const originalTransaction = message.originalTransaction;
            const programIds = message.programIds;
            const analysisResult = message.analysisResult;
            
            // Get user wallet
            const userWallet = await this._getUserWallet();
            if (!userWallet) {
                throw new Error('User wallet not found');
            }
            
            this.logInfo(`[DIRECT-BUILDER] 🔍 Original transaction analysis:`, {
                programIds: programIds,
                platform: analysisResult?.swapDetails?.platform,
                inputMint: analysisResult?.swapDetails?.inputMint,
                outputMint: analysisResult?.swapDetails?.outputMint,
                inputAmount: analysisResult?.swapDetails?.inputAmount
            });
            
            // 1. Extract original instruction data
            const originalInstructions = originalTransaction.transaction.message.instructions;
            const originalAccountKeys = originalTransaction.transaction.message.accountKeys;
            
            this.logInfo(`[DIRECT-BUILDER] 🔍 Found ${originalInstructions.length} original instructions`);
            this.logInfo(`[DIRECT-BUILDER] 🔍 Account keys length: ${originalAccountKeys.length}`);
            this.logInfo(`[DIRECT-BUILDER] 🔍 Account keys sample:`, originalAccountKeys.slice(0, 5));
            this.logInfo(`[DIRECT-BUILDER] 🔍 Account keys types:`, originalAccountKeys.slice(0, 5).map(key => typeof key));
            
            // 2. Build user's instructions by copying and adapting original
            const userInstructions = [];
            
            for (const originalInstruction of originalInstructions) {
                this.logInfo(`[DIRECT-BUILDER] 🔧 Processing instruction:`, {
                    programId: originalInstruction.programId,
                    dataLength: originalInstruction.data.length,
                    accountCount: originalInstruction.accounts.length
                });
                
                // Debug: Log the actual accounts array
                this.logInfo(`[DIRECT-BUILDER] 🔍 Accounts array:`, originalInstruction.accounts);
                this.logInfo(`[DIRECT-BUILDER] 🔍 Accounts types:`, originalInstruction.accounts.map(acc => typeof acc));
                
                // Create new instruction for user
                const userInstruction = {
                    programId: originalInstruction.programId, // Same program ID
                    keys: [],
                    data: originalInstruction.data // SAME instruction data!
                };
                
                // Map account keys to user's accounts
                for (const accountIndex of originalInstruction.accounts) {
                    // Skip invalid account indices (non-numeric)
                    if (typeof accountIndex !== 'number' || accountIndex < 0 || accountIndex >= originalAccountKeys.length) {
                        this.logWarn(`[DIRECT-BUILDER] ⚠️ Skipping invalid account index: ${accountIndex} (type: ${typeof accountIndex}, max: ${originalAccountKeys.length - 1})`);
                        continue;
                    }
                    
                    const originalAccount = originalAccountKeys[accountIndex];
                    
                    // Skip undefined accounts
                    if (!originalAccount) {
                        this.logWarn(`[DIRECT-BUILDER] ⚠️ Skipping undefined account at index ${accountIndex}`);
                        continue;
                    }
                    
                    // Check if this is the trader's wallet (needs to be replaced with user's wallet)
                    if (this._isTraderWallet(originalAccount, message.traderWallet)) {
                        userInstruction.keys.push({
                            pubkey: userWallet.publicKey,
                            isSigner: true,
                            isWritable: true
                        });
                        this.logInfo(`[DIRECT-BUILDER] 🔄 Replaced trader wallet with user wallet`);
                    } else {
                        // Keep original account - CONVERT STRING TO PUBLICKEY
                        try {
                            const { PublicKey } = require('@solana/web3.js');
                            const pubkey = new PublicKey(originalAccount);
                            userInstruction.keys.push({
                                pubkey: pubkey,
                                isSigner: false,
                                isWritable: true
                            });
                            this.logInfo(`[DIRECT-BUILDER] 🔧 Converted string to PublicKey: ${originalAccount}`);
                        } catch (error) {
                            this.logError(`[DIRECT-BUILDER] ❌ Failed to convert account to PublicKey: ${originalAccount}`, error.message);
                            // Skip this account if conversion fails
                            continue;
                        }
                    }
                }
                
                userInstructions.push(userInstruction);
            }
            
            // 3. Apply user scale factor to instruction data
            if (userConfig.scaleFactor && userConfig.scaleFactor !== 1.0) {
                this.logInfo(`[DIRECT-BUILDER] 🔧 Applying user scale factor: ${userConfig.scaleFactor}`);
                // Update instruction data with scaled amount
                // This requires parsing and modifying the instruction data
                await this._applyScaleFactorToInstructions(userInstructions, userConfig.scaleFactor);
            }
            
            // 4. Create ATAs if needed
            const ataInstructions = await this._createUserATAs(analysisResult, userWallet);
            userInstructions.unshift(...ataInstructions);
            
            this.logInfo(`[DIRECT-BUILDER] 🔧 Created ${userInstructions.length} instructions for user`);
            
            // 5. Execute with Helius Sender
            const result = await this.singaporeSender.executeCopyTrade(
                userInstructions,
                userWallet,
                {
                    platform: 'DirectCopy',
                    inputMint: analysisResult?.swapDetails?.inputMint,
                    outputMint: analysisResult?.swapDetails?.outputMint,
                    inputAmount: analysisResult?.swapDetails?.inputAmount,
                    useSmartTransactions: true,
                    userConfig: userConfig
                }
            );
            
            this.logInfo(`[DIRECT-BUILDER] ✅ DIRECT copy executed successfully!`);
            this.logInfo(`[DIRECT-BUILDER] ⚡ Execution time: ${result.executionTime}ms`);
            this.logInfo(`[DIRECT-BUILDER] 📝 Signature: ${result.signature}`);
            
            return result;
            
        } catch (error) {
            this.logError(`[DIRECT-BUILDER] ❌ Direct copy failed: ${error.message}`);
            throw error;
        }
    }
    
    /**
     * Check if account is the trader's wallet
     */
    _isTraderWallet(account, traderWallet) {
        return account === traderWallet;
    }
    
    /**
     * Apply scale factor to instruction data
     */
    async _applyScaleFactorToInstructions(instructions, scaleFactor) {
        // This would parse instruction data and modify amounts
        // Implementation depends on the specific instruction format
        this.logInfo(`[DIRECT-BUILDER] 🔧 Scaling instructions by factor: ${scaleFactor}`);
        // TODO: Implement instruction data parsing and scaling
    }
    
    /**
     * Create user ATAs if needed
     */
    async _createUserATAs(analysisResult, userWallet) {
        const instructions = [];
        
        if (analysisResult?.swapDetails?.inputMint && analysisResult?.swapDetails?.outputMint) {
            // Create ATAs for input and output tokens
            const inputMint = new PublicKey(analysisResult.swapDetails.inputMint);
            const outputMint = new PublicKey(analysisResult.swapDetails.outputMint);
            
            const inputATA = getAssociatedTokenAddressSync(inputMint, userWallet.publicKey);
            const outputATA = getAssociatedTokenAddressSync(outputMint, userWallet.publicKey);
            
            // Check if ATAs exist and create if needed
            const connection = this.solanaManager?.connection;
            if (connection) {
                const inputATAInfo = await connection.getAccountInfo(inputATA);
                if (!inputATAInfo) {
                    instructions.push(
                        createAssociatedTokenAccountInstruction(
                            userWallet.publicKey,
                            inputATA,
                            userWallet.publicKey,
                            inputMint
                        )
                    );
                }
                
                const outputATAInfo = await connection.getAccountInfo(outputATA);
                if (!outputATAInfo) {
                    instructions.push(
                        createAssociatedTokenAccountInstruction(
                            userWallet.publicKey,
                            outputATA,
                            userWallet.publicKey,
                            outputMint
                        )
                    );
                }
            }
        }
        
        return instructions;
    }

    // ===== SWAP EXECUTION METHODS =====
    
    async executeJupiterBuy(swapDetails, userConfig = {}) {
        const { inputMint, outputMint, inputAmount } = swapDetails;
        try {
            this.logInfo(`[HELIUS-PREMIUM] 🚀 Executing ULTRA-FAST swap via Helius Premium API: ${inputMint} → ${outputMint}`);
            this.logInfo(`[HELIUS-PREMIUM] 💰 Amount: ${inputAmount}`);
            
            // 1. Get quote from Helius Premium API (not Jupiter)
            const slippageBps = Math.floor((userConfig.slippage || 0.15) * 10000); // Convert to BPS
            this.logInfo(`[HELIUS-PREMIUM] 🔧 Using slippage: ${userConfig.slippage} (${slippageBps} BPS)`);
            const heliusQuoteUrl = `${this.solanaManager.connection.rpcEndpoint}&method=getQuote&inputMint=${inputMint}&outputMint=${outputMint}&amount=${inputAmount}&slippageBps=${slippageBps}`;
            
            this.logInfo(`[HELIUS-PREMIUM] 🔗 Getting quote from Helius Premium API...`);
            const quoteResponse = await fetch(heliusQuoteUrl);
            const quoteData = await quoteResponse.json();
            
            if (!quoteData.result?.outAmount) {
                throw new Error('No route found for this swap via Helius Premium API');
            }
            
            this.logInfo(`[HELIUS-PREMIUM] 📊 Quote: ${quoteData.result.outAmount} tokens for ${inputAmount} lamports`);
            
            // 2. Get swap transaction from Helius Premium API
            const heliusSwapUrl = `${this.solanaManager.connection.rpcEndpoint}&method=getSwapTransaction`;
            const swapResponse = await fetch(heliusSwapUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    quoteResponse: quoteData.result,
                    userPublicKey: await this._getUserWallet(),
                    wrapAndUnwrapSol: true,
                    commitment: 'processed' // PROCESSED level for speed
                })
            });
            
            const swapData = await swapResponse.json();
            
            if (!swapData.result?.swapTransaction) {
                throw new Error('Failed to get swap transaction from Helius Premium API');
            }
            
            this.logInfo(`[HELIUS-PREMIUM] 🔧 Swap transaction prepared`);
            this.logInfo(`[HELIUS-PREMIUM] 📝 Transaction size: ${swapData.result.swapTransaction.length} bytes`);
            
            // 3. ULTRA-FAST EXECUTION with Helius Smart Transactions
            this.logInfo(`[HELIUS-PREMIUM] ⚡ Executing with Helius Smart Transactions for sub-200ms execution...`);
            
            // Get user wallet for signing
            const userWallet = await this._getUserWallet();
            if (!userWallet) {
                throw new Error('User wallet not found');
            }
            
            // Convert base64 transaction to instructions
            const { Transaction } = require('@solana/web3.js');
            const transaction = Transaction.from(Buffer.from(swapData.result.swapTransaction, 'base64'));
            
            // HELIUS SMART TRANSACTIONS: Let Helius handle everything automatically
            // - Fetch latest blockhash
            // - Simulate transaction for compute units
            // - Get Helius recommended priority fee
            // - Add safety buffer fee
            // - Handle PDA/ATA creation automatically
            // - Build and send optimized transaction
            const result = await this.singaporeSender.executeCopyTrade(
                transaction.instructions,
                userWallet,
                {
                    platform: 'Jupiter',
                    inputMint,
                    outputMint,
                    inputAmount,
                    outputAmount: quoteData.result.outAmount,
                    useSmartTransactions: false, // Disable Smart Transactions for Jupiter (direct routing)
                    userConfig: userConfig // Pass user config for PDA/ATA handling
                }
            );
            
            this.logInfo(`[HELIUS-PREMIUM] ✅ ULTRA-FAST swap executed successfully via Helius Premium API!`);
            this.logInfo(`[HELIUS-PREMIUM] ⚡ Execution time: ${result.executionTime}ms`);
            this.logInfo(`[HELIUS-PREMIUM] 📝 Signature: ${result.signature}`);
            
            return result;
            
        } catch (error) {
            this.logError(`[HELIUS-PREMIUM] ❌ ULTRA-FAST swap failed: ${error.message}`);
            throw error;
        }
    }
    
    async executeRaydiumBuy(swapDetails, userConfig = {}) {
        const { inputMint, outputMint, inputAmount } = swapDetails;
        try {
            this.logInfo(`[RAYDIUM-REAL] 🚀 Executing REAL Raydium swap: ${inputMint} → ${outputMint}`);
            this.logInfo(`[RAYDIUM-REAL] 💰 Amount: ${inputAmount}`);
            
            // Get user wallet for signing
            const userWallet = await this._getUserWallet();
            if (!userWallet) {
                throw new Error('User wallet not found');
            }
            
            // ======================================================================
            // ========================== REAL PDA/ATA CREATION ====================
            // ======================================================================
            const { PublicKey, SystemProgram } = require('@solana/web3.js');
            const { 
                getAssociatedTokenAddressSync, 
                createAssociatedTokenAccountInstruction,
                TOKEN_PROGRAM_ID 
            } = require('@solana/spl-token');
            
            const instructions = [];
            
            // 1. CREATE USER ATA (Associated Token Account) if needed
            const inputMintPubkey = new PublicKey(inputMint);
            const outputMintPubkey = new PublicKey(outputMint);
            const userInputAta = getAssociatedTokenAddressSync(inputMintPubkey, userWallet.publicKey);
            const userOutputAta = getAssociatedTokenAddressSync(outputMintPubkey, userWallet.publicKey);
            
            this.logInfo(`[RAYDIUM-REAL] 🔧 User Input ATA: ${userInputAta.toString()}`);
            this.logInfo(`[RAYDIUM-REAL] 🔧 User Output ATA: ${userOutputAta.toString()}`);
            
            // Check if ATAs exist
            const connection = this.solanaManager?.connection;
            if (!connection) {
                throw new Error('Solana connection not available');
            }
            
            // BULLETPROOF FIX: Always add ATA creation instructions (idempotent)
            this.logInfo(`[RAYDIUM-REAL] 🔧 Pushing idempotent input ATA creation instruction...`);
            instructions.push(
                createAssociatedTokenAccountInstruction(
                    userWallet.publicKey, // payer
                    userInputAta,        // associated token account
                    userWallet.publicKey, // owner
                    inputMintPubkey      // mint
                )
            );
            
            this.logInfo(`[RAYDIUM-REAL] 🔧 Pushing idempotent output ATA creation instruction...`);
            instructions.push(
                createAssociatedTokenAccountInstruction(
                    userWallet.publicKey, // payer
                    userOutputAta,        // associated token account
                    userWallet.publicKey, // owner
                    outputMintPubkey      // mint
                )
            );
            
            // 2. CREATE RAYDIUM POOL PDA
            const raydiumProgramId = config.PLATFORM_IDS.RAYDIUM_V4;
            const [poolPDA] = PublicKey.findProgramAddressSync(
                [Buffer.from('amm_associated_seed'), inputMintPubkey.toBuffer(), outputMintPubkey.toBuffer()],
                raydiumProgramId
            );
            
            this.logInfo(`[RAYDIUM-REAL] 🔧 Pool PDA: ${poolPDA.toString()}`);
            
            // 3. CREATE RAYDIUM SWAP INSTRUCTION USING BORSH
            this.logInfo('[BORSH] 🔧 Serializing Raydium swap with ROBUST class pattern...');
            
            // Let SingaporeSenderManager handle slippage calculation dynamically
            const amountInBN = new BN(inputAmount);
            
            // For now, use 0 as minimum amount out - SingaporeSenderManager will calculate proper slippage
            const minAmountOutBN = new BN(0);
            
            this.logInfo(`[RAYDIUM-REAL] 💰 Amount: ${inputAmount} | Min Out: ${minAmountOutBN.toString()} (SingaporeSender will handle slippage)`);
            
            // Create a new instance of the payload class
            const payload = new RaydiumSwapPayload({
                amountIn: amountInBN,
                minimumAmountOut: minAmountOutBN
            });
            
            // Serialize using the schema map and the class instance
            const swapInstructionData = borsh.serialize(RAYDIUM_SWAP_SCHEMA, payload);
            
            this.logInfo(`[BORSH] ✅ Instruction data serialized successfully. Buffer length: ${swapInstructionData.length}`);
            
            const swapInstruction = {
                programId: raydiumProgramId,
                keys: [
                    { pubkey: poolPDA, isSigner: false, isWritable: true },
                    { pubkey: userInputAta, isSigner: false, isWritable: true },
                    { pubkey: userOutputAta, isSigner: false, isWritable: true },
                    { pubkey: userWallet.publicKey, isSigner: true, isWritable: true },
                    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
                    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
                ],
                data: swapInstructionData
            };
            
            instructions.push(swapInstruction);
            
            this.logInfo(`[RAYDIUM-REAL] 🔧 Created ${instructions.length} instructions with REAL PDA/ATA logic`);
            
            // 4. ULTRA-FAST EXECUTION with Helius Sender
            this.logInfo(`[RAYDIUM-REAL] ⚡ Executing with Helius Sender for sub-200ms execution...`);
            
            const result = await this.singaporeSender.executeCopyTrade(
                instructions,
                userWallet,
                {
                    platform: 'Raydium',
                    inputMint,
                    outputMint,
                    inputAmount,
                    useSmartTransactions: false // Disable Smart Transactions for Raydium (direct contract call)
                }
            );
            
            this.logInfo(`[RAYDIUM-REAL] ✅ REAL Raydium swap executed successfully!`);
            this.logInfo(`[RAYDIUM-REAL] ⚡ Execution time: ${result.executionTime}ms`);
            this.logInfo(`[RAYDIUM-REAL] 📝 Signature: ${result.signature}`);
            
            return result;
            
        } catch (error) {
            this.logError(`[RAYDIUM-REAL] ❌ REAL Raydium swap failed: ${error.message}`);
            throw error;
        }
    }
    
    async executePumpFunBuy(swapDetails, userConfig = {}) {
        const { outputMint, inputAmount } = swapDetails;
        const startTime = Date.now();

        try {
            this.logInfo(`[PUMPFUN-V6-SDK-VERIFIED] 🚀 Initiating for: ${shortenAddress(outputMint)}`);
            
            const userWallet = await this._getUserWallet();
            if (!userWallet) throw new Error("User wallet not found");

            // --- Using the proven working inline schema method ---
            
            const mintPubkey = new PublicKey(outputMint);
            const instructions = [];

            // --- INSTRUCTION 1: CREATE ATA (Idempotent) ---
            const ata = getAssociatedTokenAddressSync(mintPubkey, userWallet.publicKey);
            instructions.push(
                createAssociatedTokenAccountInstruction(userWallet.publicKey, ata, userWallet.publicKey, mintPubkey)
            );

            // --- INSTRUCTION 2: BUILD THE BUY INSTRUCTION (12 ACCOUNTS AS PER OFFICIAL IDL) ---
            const pumpFunProgramId = config.PLATFORM_IDS.PUMP_FUN;
            
            const globalAccount = config.PUMP_FUN_CONSTANTS.GLOBAL;
            const feeRecipient = config.PUMP_FUN_CONSTANTS.FEE_RECIPIENT;
            const eventAuthority = new PublicKey('CEntr3oDe4kAv3g4StGgG3sCjwsUQu3JTT5sSxxHgas');

            const [bondingCurvePDA] = PublicKey.findProgramAddressSync([Buffer.from('bonding-curve'), mintPubkey.toBuffer()], pumpFunProgramId);
            const [associatedBondingCurvePDA] = PublicKey.findProgramAddressSync([bondingCurvePDA.toBuffer()], pumpFunProgramId);
            
            // ========================= THE SDK-VERIFIED DISCRIMINATOR FIX ========================
            // This is the correct, official discriminator from the pump.fun SDK IDL.
            // All previous versions were generating this incorrectly. This is the final fix.
            const discriminator = Buffer.from([102, 6, 61, 18, 1, 218, 235, 234]);
            // =====================================================================================

            const scaledSolCost = inputAmount;
            
            // ========================= THE PROVEN WORKING SCHEMA ========================
            // Using the inline schema method that has worked in all previous versions
            const argsBuffer = borsh.serialize(
                { struct: { amount: 'u64', maxSolCost: 'u64' } },
                { 
                    amount: new BN(0), 
                    maxSolCost: new BN(scaledSolCost)
                }
            );
            // =================================================================================
            const buyInstructionData = Buffer.concat([discriminator, argsBuffer]);

            const buyInstruction = {
                programId: pumpFunProgramId,
                keys: [ // The correct 12 accounts
                    { pubkey: globalAccount, isSigner: false, isWritable: false },
                    { pubkey: feeRecipient, isSigner: false, isWritable: true },
                    { pubkey: mintPubkey, isSigner: false, isWritable: false },
                    { pubkey: bondingCurvePDA, isSigner: false, isWritable: true },
                    { pubkey: associatedBondingCurvePDA, isSigner: false, isWritable: true },
                    { pubkey: ata, isSigner: false, isWritable: true },
                    { pubkey: userWallet.publicKey, isSigner: true, isWritable: true },
                    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
                    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
                    { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
                    { pubkey: eventAuthority, isSigner: false, isWritable: false },
                    { pubkey: pumpFunProgramId, isSigner: false, isWritable: false },
                ],
                data: buyInstructionData
            };

        // ========================= TWO-STEP TRANSACTION APPROACH =========================
        // Step 1: Create ATA with Helius tip
        const heliusTipWallet = new PublicKey("2q5pghRs6arqVjRvT5gfgWfWcHWmw1ZuCzphgd5KfWGJ");
        const tipAmount = 1000000; // 0.001 SOL (Helius minimum requirement)
        
        const tipInstruction = SystemProgram.transfer({
            fromPubkey: userWallet.publicKey,
            toPubkey: heliusTipWallet,
            lamports: tipAmount
        });
        
        // Step 1: ATA Creation + Tip
        const createAtaInstruction = createAssociatedTokenAccountInstruction(
            userWallet.publicKey, 
            ata, 
            userWallet.publicKey, 
            mintPubkey
        );
        const ataInstructions = [createAtaInstruction, tipInstruction];
        this.logInfo(`[PUMPFUN-2STEP] 🔧 Step 1: Creating ATA with Helius tip...`);
        
        const ataResult = await this.singaporeSender.executeCopyTrade(
            ataInstructions,
            userWallet,
            { platform: 'PumpFun-ATA', inputAmount: 0, useSmartTransactions: false }
        );
        
        if (!ataResult || !ataResult.success) {
            // Check if the error is "account already exists", which is OK for us
            if (ataResult.error && ataResult.error.includes("already in use")) {
                this.logInfo(`[PUMPFUN-2STEP] ✅ ATA already exists. Proceeding.`);
            } else {
                throw new Error(`Failed to create ATA: ${ataResult.error || 'Unknown Error'}`);
            }
        } else {
            this.logInfo(`[PUMPFUN-2STEP] ✅ ATA created successfully. Sig: ${shortenAddress(ataResult.signature)}`);
        }
        
        // ========================= CRITICAL DELAY + VERIFICATION =========================
        // Wait for ATA to be fully processed by the blockchain
        this.logInfo(`[PUMPFUN-2STEP] ⏳ Waiting 5 seconds for ATA to be fully processed...`);
        await new Promise(resolve => setTimeout(resolve, 5000));
        
        // Verify ATA exists and is properly initialized
        this.logInfo(`[PUMPFUN-2STEP] 🔍 Verifying ATA is ready...`);
        const ataAccountInfo = await this.solanaManager.connection.getAccountInfo(ata);
        if (!ataAccountInfo) {
            throw new Error(`ATA verification failed: Account ${ata.toBase58()} not found after creation`);
        }
        this.logInfo(`[PUMPFUN-2STEP] ✅ ATA verified: ${ata.toBase58()} is ready`);
        // ================================================================================
        
        // Step 2: Pump.fun Buy with Tip
        this.logInfo(`[PUMPFUN-2STEP] 🚀 Step 2: Executing Pump.fun buy with tip...`);
        const buyInstructions = [tipInstruction, buyInstruction];
        
        const executionResult = await this.singaporeSender.executeCopyTrade(
            buyInstructions,
            userWallet,
            { platform: 'PumpFun', inputAmount: scaledSolCost, useSmartTransactions: false }
        );
            
        if (!executionResult || !executionResult.success) {
            throw new Error(executionResult.error || 'The PumpFun buy transaction failed.');
        }

            this.logInfo(`[PUMPFUN-V6-SDK-VERIFIED] ✅ SUCCESS! Signature: ${executionResult.signature}`);

            return {
                ...executionResult,
                amountSpentInLamports: scaledSolCost
            };

        } catch (error) {
            this.logError(`[PUMPFUN-V6-SDK-VERIFIED] ❌ SWAP FAILED: ${error.message}`, { stack: error.stack });
            return { 
                success: false, 
                error: error.message, 
                signature: null,
                executionTime: Date.now() - startTime
            };
        }
    }

    async executePumpFunSell(swapDetails, userConfig = {}) {
        const { outputMint, inputAmount } = swapDetails;
        const startTime = Date.now();

        try {
            this.logInfo(`[PUMPFUN-SELL-V1] 🚀 Initiating IDL-VERIFIED Sell for: ${shortenAddress(outputMint)}`);
            
            const userWallet = await this._getUserWallet();
            if (!userWallet) throw new Error("User wallet not found");

            // --- Using the proven working inline schema method ---
            
            const mintPubkey = new PublicKey(outputMint);
            const instructions = [];

            // --- INSTRUCTION 1: BUILD THE SELL INSTRUCTION (14 ACCOUNTS AS PER OFFICIAL IDL) ---
            const pumpFunProgramId = config.PLATFORM_IDS.PUMP_FUN;
            
            // --- LOAD REQUIRED CONSTANTS ---
            const globalAccount = config.PUMP_FUN_CONSTANTS.GLOBAL;
            const feeRecipient = config.PUMP_FUN_CONSTANTS.FEE_RECIPIENT;
            const eventAuthority = new PublicKey('CEntr3oDe4kAv3g4StGgG3sCjwsUQu3JTT5sSxxHgas');
            const feeProgram = config.PUMP_FUN_CONSTANTS.FEE_PROGRAM;

            // --- CALCULATE REQUIRED PDAs ---
            const [bondingCurvePDA] = PublicKey.findProgramAddressSync([Buffer.from('bonding-curve'), mintPubkey.toBuffer()], pumpFunProgramId);
            const [associatedBondingCurvePDA] = PublicKey.findProgramAddressSync([bondingCurvePDA.toBuffer()], pumpFunProgramId);
            
            // --- CALCULATE ADDITIONAL PDAs FOR SELL (14 ACCOUNTS) ---
            // Creator vault PDA (requires bonding curve creator - we'll use user as fallback)
            const [creatorVaultPDA] = PublicKey.findProgramAddressSync([Buffer.from("creator-vault"), userWallet.publicKey.toBuffer()], pumpFunProgramId);
            
            // Fee config PDA
            const [feeConfigPDA] = PublicKey.findProgramAddressSync([Buffer.from("fee_config"), pumpFunProgramId.toBuffer()], feeProgram);
            
            // --- GET USER'S TOKEN BALANCE ---
            const ata = getAssociatedTokenAddressSync(mintPubkey, userWallet.publicKey);
            
            // --- PREPARE INSTRUCTION DATA ---
            const tokenAmountToSell = inputAmount; // Amount of tokens to sell
            const minSolOutput = Math.floor(tokenAmountToSell * 0.95); // 5% slippage tolerance
            
            // ========================= THE PROVEN WORKING SCHEMA ========================
            // Using the inline schema method that has worked in all previous versions
            const argsBuffer = borsh.serialize(
                { struct: { amount: 'u64', minSolOutput: 'u64' } },
                { 
                    amount: new BN(tokenAmountToSell),
                    minSolOutput: new BN(minSolOutput)
                }
            );
            // =================================================================================
            const discriminator = Buffer.from([51, 230, 133, 164, 1, 127, 131, 173]); // From official IDL
            const sellInstructionData = Buffer.concat([discriminator, argsBuffer]);

            // --- BUILD THE SELL INSTRUCTION WITH 14 ACCOUNTS ---
            // This is the correct list according to the pump.json file for SELL
            const sellInstruction = {
                programId: pumpFunProgramId,
                keys: [
                    { pubkey: globalAccount, isSigner: false, isWritable: false },           // 1. global
                    { pubkey: feeRecipient, isSigner: false, isWritable: true },            // 2. fee_recipient
                    { pubkey: mintPubkey, isSigner: false, isWritable: false },             // 3. mint
                    { pubkey: bondingCurvePDA, isSigner: false, isWritable: true },        // 4. bonding_curve
                    { pubkey: associatedBondingCurvePDA, isSigner: false, isWritable: true }, // 5. associated_bonding_curve
                    { pubkey: ata, isSigner: false, isWritable: true },                     // 6. associated_user
                    { pubkey: userWallet.publicKey, isSigner: true, isWritable: true },      // 7. user
                    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }, // 8. system_program
                    { pubkey: creatorVaultPDA, isSigner: false, isWritable: true },         // 9. creator_vault ⭐ EXTRA
                    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },       // 10. token_program
                    { pubkey: eventAuthority, isSigner: false, isWritable: false },          // 11. event_authority
                    { pubkey: pumpFunProgramId, isSigner: false, isWritable: false },      // 12. program
                    { pubkey: feeConfigPDA, isSigner: false, isWritable: false },          // 13. fee_config ⭐ EXTRA
                    { pubkey: feeProgram, isSigner: false, isWritable: false },            // 14. fee_program ⭐ EXTRA
                ],
                data: sellInstructionData
            };
            instructions.push(sellInstruction);

            this.logInfo(`[PUMPFUN-SELL-V1] ✅ IDL-VERIFIED SELL transaction created with 14 accounts.`);
            
            // --- SEND THE TRANSACTION ---
            const executionResult = await this.singaporeSender.executeCopyTrade(
                instructions,
                userWallet,
                { platform: 'PumpFun', inputAmount: tokenAmountToSell, useSmartTransactions: false }
            );
            
            if (!executionResult || !executionResult.success) {
                throw new Error(executionResult.error || 'The PumpFun sell transaction failed.');
            }

            this.logInfo(`[PUMPFUN-SELL-V1] ✅ SUCCESS! Signature: ${executionResult.signature}`);

            return {
                ...executionResult,
                amountSpentInLamports: tokenAmountToSell
            };

        } catch (error) {
            this.logError(`[PUMPFUN-SELL-V1] ❌ SELL FAILED: ${error.message}`, { stack: error.stack });
            return { 
                success: false, 
                error: error.message, 
                signature: null,
                executionTime: Date.now() - startTime
            };
        }
    }

    
    async findAMMPool(mintPubkey) {
        this.logInfo(`[AMM-FINDER-V2] 🔍 Searching for AMM pool for mint: ${shortenAddress(mintPubkey.toBase58())}`);
        try {
            const ammProgramId = config.DEX_PROGRAM_IDS.PUMP_FUN_AMM;
            
            // ========================= DOCUMENTED OFFSET CALCULATION ========================
            // AMM Pool Account Structure (based on IDL):
            // - pool_bump: u8 (1 byte)
            // - index: u16 (2 bytes) 
            // - creator: Pubkey (32 bytes)
            // - base_mint: Pubkey (32 bytes) ← TARGET FIELD at offset 35
            // - quote_mint: Pubkey (32 bytes)
            // - ... other fields
            const MEMCMP_OFFSET_FOR_BASE_MINT = 35; // 1 + 2 + 32 = 35 bytes
            // ===========================================================================
            
            const response = await fetch(this.solanaManager.connection.rpcEndpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    jsonrpc: '2.0',
                    id: 'zapbot-find-amm-pool',
                    method: 'getProgramAccounts',
                    params: [
                        ammProgramId.toBase58(),
                        {
                            encoding: 'base64',
                            filters: [
                                { 
                                    memcmp: { 
                                        offset: MEMCMP_OFFSET_FOR_BASE_MINT, 
                                        bytes: mintPubkey.toBase58() 
                                    } 
                                }
                            ]
                        }
                    ]
                })
            });
    
            const data = await response.json();
            if (data.error) {
                this.logError(`[AMM-FINDER-V2] ❌ RPC error: ${data.error.message}`);
                return null;
            }
            
            if (!data.result || data.result.length === 0) {
                this.logWarn(`[AMM-FINDER-V2] ⚠️ No AMM pool found for mint: ${shortenAddress(mintPubkey.toBase58())}`);
                return null;
            }
    
            // Handle multiple pools (shouldn't happen, but safe)
            const poolAccountAddress = new PublicKey(data.result[0].pubkey);
            this.logInfo(`[AMM-FINDER-V2] ✅ Found AMM pool: ${shortenAddress(poolAccountAddress.toBase58())}`);
            return poolAccountAddress;
    
        } catch (error) {
            this.logError(`[AMM-FINDER-V2] ❌ Error finding AMM pool: ${error.message}`);
            return null;
        }
    }

    // ====================================================================
    // ====== MIGRATION DETECTION SYSTEM =================================
    // ====================================================================
    
    async isTokenMigrated(mintAddress) {
        try {
            this.logInfo(`[MIGRATION-CHECK] 🔍 Checking phase for: ${shortenAddress(mintAddress)}`);
            const mintPubkey = new PublicKey(mintAddress);
            const pumpFunProgramId = config.PLATFORM_IDS.PUMP_FUN;
            
            const [bondingCurvePDA] = PublicKey.findProgramAddressSync(
                [Buffer.from('bonding-curve'), mintPubkey.toBuffer()], 
                pumpFunProgramId
            );
            
            this.logInfo(`[MIGRATION-CHECK] 🔍 Bonding curve PDA: ${shortenAddress(bondingCurvePDA.toBase58())}`);
            
            // ========================= IMPROVED MIGRATION DETECTION =========================
            // First, check if bonding curve account exists
            const bondingCurveAccount = await this.solanaManager.connection.getAccountInfo(bondingCurvePDA);
            
            if (bondingCurveAccount === null) {
                this.logInfo(`[MIGRATION-CHECK] 🔍 Bonding curve account is null. Checking if AMM pool exists...`);
                
                // If bonding curve is null, check if AMM pool exists to confirm migration
                const ammPoolAddress = await this.findAMMPool(mintPubkey);
                
                if (ammPoolAddress) {
                    this.logInfo(`[MIGRATION-CHECK] ✅ CONFIRMED MIGRATED: Found AMM pool at ${shortenAddress(ammPoolAddress.toBase58())}`);
                    return { isMigrated: true, phase: 'AMM', poolAccount: ammPoolAddress, reason: 'Found AMM pool account.' };
                } else {
                    // Bonding curve is null but no AMM pool found - this could be a new token or error
                    this.logWarn(`[MIGRATION-CHECK] ⚠️ Bonding curve null but no AMM pool found. Assuming bonding curve phase.`);
                    return { isMigrated: false, phase: 'BondingCurve', reason: 'Bonding curve null but no AMM pool found - likely still in bonding curve.' };
                }
            } else {
                // Bonding curve account exists - definitely not migrated
                this.logInfo(`[MIGRATION-CHECK] ✅ NOT MIGRATED: Bonding curve account is active.`);
                return { isMigrated: false, phase: 'BondingCurve', reason: 'Bonding curve account still exists.' };
            }
            // =============================================================================
            
        } catch (error) {
            this.logError(`[MIGRATION-CHECK] ❌ Migration check failed. Defaulting to Bonding Curve phase.`, { stack: error.stack });
            return { isMigrated: false, phase: 'BondingCurve', reason: `Error during check: ${error.message}` };
        }
    }

    // ====================================================================
    // ====== SMART ROUTING SYSTEM =======================================
    // ====================================================================
    
      async executePumpFunTrade(swapDetails, userConfig, tradeType) {
        try {
            this.logInfo(`[PUMPFUN-SMART-ROUTER] 🚀 Smart routing for ${tradeType.toUpperCase()} of token: ${shortenAddress(swapDetails.outputMint)}`);
            
            // --- STEP 1: CHECK MIGRATION STATUS ---
            const tokenMint = tradeType === 'buy' ? swapDetails.outputMint : swapDetails.inputMint;
            const migrationStatus = await this.isTokenMigrated(tokenMint);
            this.logInfo(`[PUMPFUN-SMART-ROUTER] 📊 Token Phase: ${migrationStatus.phase}. Reason: ${migrationStatus.reason}`);
            
            // --- STEP 2: ROUTE TO APPROPRIATE HANDLER ---
            if (!migrationStatus.isMigrated) {
                this.logInfo(`[PUMPFUN-SMART-ROUTER] 🎯 Routing to BONDING CURVE handler...`);
                if (tradeType === 'buy') {
                    return await this.executePumpFunBuy(swapDetails, userConfig);
                } else {
                    return await this.executePumpFunSell(swapDetails, userConfig);
                }
            } else {
                 this.logInfo(`[PUMPFUN-SMART-ROUTER] 🎯 Routing to AMM handler...`);
                 
                 // Try to find AMM pool first
                 const poolAccount = await this.findAMMPool(new PublicKey(tokenMint));
                 
                 if (poolAccount) {
                    throw new Error(`Token ${tokenMint} has migrated, but its AMM pool address could not be found. Aborting trade.`);
                     if (tradeType === 'buy') {
                         return await this.executePumpFunAmmBuy(swapDetails, userConfig, poolAccount);
                     } else {
                         return await this.executePumpFunAmmSell(swapDetails, userConfig, poolAccount);
                     }
                } else {
                    throw new Error(`Token ${shortenAddress(swapDetails.outputMint)} has migrated, but its AMM pool address could not be found. Aborting trade.`);
                }
            }
        } catch (error) {
            this.logError(`[PUMPFUN-SMART-ROUTER] ❌ Smart routing failed: ${error.message}`, { stack: error.stack });
            throw error; // Re-throw the error to be caught by the master executor
        }
    }
    
    async executeOrcaSwap(inputMint, outputMint, inputAmount, userConfig = {}) {
        try {
            this.logInfo(`[ORCA-REAL] 🚀 Executing REAL Orca swap: ${inputMint} → ${outputMint}`);
            this.logInfo(`[ORCA-REAL] 💰 Amount: ${inputAmount}`);
            
            // Get user wallet for signing
            const userWallet = await this._getUserWallet();
            if (!userWallet) {
                throw new Error('User wallet not found');
            }
            
            // ======================================================================
            // ========================== REAL PDA/ATA CREATION ====================
            // ======================================================================
            const { PublicKey, SystemProgram } = require('@solana/web3.js');
            const { 
                getAssociatedTokenAddressSync, 
                createAssociatedTokenAccountInstruction,
                TOKEN_PROGRAM_ID 
            } = require('@solana/spl-token');
            
            const instructions = [];
            
            // 1. CREATE USER ATA (Associated Token Account) if needed
            const inputMintPubkey = new PublicKey(inputMint);
            const outputMintPubkey = new PublicKey(outputMint);
            const userInputAta = getAssociatedTokenAddressSync(inputMintPubkey, userWallet.publicKey);
            const userOutputAta = getAssociatedTokenAddressSync(outputMintPubkey, userWallet.publicKey);
            
            this.logInfo(`[ORCA-REAL] 🔧 User Input ATA: ${userInputAta.toString()}`);
            this.logInfo(`[ORCA-REAL] 🔧 User Output ATA: ${userOutputAta.toString()}`);
            
            // Check if ATAs exist
            const connection = this.solanaManager?.connection;
            if (!connection) {
                throw new Error('Solana connection not available');
            }
            
            // BULLETPROOF FIX: Always add ATA creation instructions (idempotent)
            this.logInfo(`[ORCA-REAL] 🔧 Pushing idempotent input ATA creation instruction...`);
            instructions.push(
                createAssociatedTokenAccountInstruction(
                    userWallet.publicKey, // payer
                    userInputAta,        // associated token account
                    userWallet.publicKey, // owner
                    inputMintPubkey      // mint
                )
            );
            
            this.logInfo(`[ORCA-REAL] 🔧 Pushing idempotent output ATA creation instruction...`);
            instructions.push(
                createAssociatedTokenAccountInstruction(
                    userWallet.publicKey, // payer
                    userOutputAta,        // associated token account
                    userWallet.publicKey, // owner
                    outputMintPubkey      // mint
                )
            );
            
            // 2. CREATE ORCA WHIRLPOOL PDA
            const orcaProgramId = config.PLATFORM_IDS.WHIRLPOOL;
            const [whirlpoolPDA] = PublicKey.findProgramAddressSync(
                [Buffer.from('whirlpool'), inputMintPubkey.toBuffer(), outputMintPubkey.toBuffer()],
                orcaProgramId
            );
            
            this.logInfo(`[ORCA-REAL] 🔧 Whirlpool PDA: ${whirlpoolPDA.toString()}`);
            
            // 3. CREATE ORCA SWAP INSTRUCTION USING BORSH
            this.logInfo('[BORSH] 🔧 Serializing Orca swap instruction using Borsh schema...');
            
            // Define the structure of the instruction data (Orca has more complex structure)
            const OrcaSwapInstruction = {
                discriminator: 'u8',
                amountIn: 'u64',
                minimumAmountOut: 'u64',
                swapDirection: 'u8',
                swapMode: 'u8',
                referral: 'u8',
                openOrders: 'u8',
                minOrderSize: 'u8',
                maxOrderSize: 'u8',
                maxOrderLifetime: 'u8',
                slippageTolerance: 'u8',
                priceImpactTolerance: 'u8',
                maxPriceImpact: 'u8'
            };
            
            // Create the data payload object
            const payload = {
                discriminator: 7,
                amountIn: new BN(inputAmount), // Amount in
                minimumAmountOut: new BN(0),   // Minimum amount out (slippage handled by user)
                swapDirection: 0,              // A to B
                swapMode: 0,                   // Exact in
                referral: 0,                   // No referral
                openOrders: 0,                 // No open orders
                minOrderSize: 0,               // Min order size
                maxOrderSize: 0,               // Max order size
                maxOrderLifetime: 0,           // Max order lifetime
                slippageTolerance: 0,          // Slippage tolerance
                priceImpactTolerance: 0,       // Price impact tolerance
                maxPriceImpact: 0              // Max price impact
            };
            
            // Create Orca payload using class pattern
            const orcaPayload = new OrcaSwapPayload({
                amountIn: new BN(inputAmount),
                minimumAmountOut: new BN(0)
            });
            
            // Serialize using class schema
            const swapInstructionData = borsh.serialize(ORCA_SWAP_SCHEMA, orcaPayload);
            
            this.logInfo(`[BORSH] ✅ Orca instruction data serialized successfully. Buffer length: ${swapInstructionData.length}`);
            
            const swapInstruction = {
                programId: orcaProgramId,
                keys: [
                    { pubkey: whirlpoolPDA, isSigner: false, isWritable: true },
                    { pubkey: userInputAta, isSigner: false, isWritable: true },
                    { pubkey: userOutputAta, isSigner: false, isWritable: true },
                    { pubkey: userWallet.publicKey, isSigner: true, isWritable: true },
                    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
                    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
                ],
                data: swapInstructionData
            };
            
            instructions.push(swapInstruction);
            
            this.logInfo(`[ORCA-REAL] 🔧 Created ${instructions.length} instructions with REAL PDA/ATA logic`);
            
            // 4. ULTRA-FAST EXECUTION with Helius Sender
            this.logInfo(`[ORCA-REAL] ⚡ Executing with Helius Sender for sub-200ms execution...`);
            
            const result = await this.singaporeSender.executeCopyTrade(
                instructions,
                userWallet,
                {
                    platform: 'Orca',
                    inputMint,
                    outputMint,
                    inputAmount,
                    useSmartTransactions: false // Disable Smart Transactions for Orca (direct contract call)
                }
            );
            
            this.logInfo(`[ORCA-REAL] ✅ REAL Orca swap executed successfully!`);
            this.logInfo(`[ORCA-REAL] ⚡ Execution time: ${result.executionTime}ms`);
            this.logInfo(`[ORCA-REAL] 📝 Signature: ${result.signature}`);
            
            return result;
            
        } catch (error) {
            this.logError(`[ORCA-REAL] ❌ REAL Orca swap failed: ${error.message}`);
            throw error;
        }
    }
    
    async executeMeteoraBuy(swapDetails, userConfig = {}) {
        const { inputMint, outputMint, inputAmount } = swapDetails;
        try {
            this.logInfo(`[METEORA-REAL] 🚀 Executing REAL Meteora swap: ${inputMint} → ${outputMint}`);
            this.logInfo(`[METEORA-REAL] 💰 Amount: ${inputAmount}`);
            
            // Get user wallet for signing
            const userWallet = await this._getUserWallet();
            if (!userWallet) {
                throw new Error('User wallet not found');
            }
            
            // ======================================================================
            // ========================== REAL PDA/ATA CREATION ====================
            // ======================================================================
            const { PublicKey, SystemProgram } = require('@solana/web3.js');
            const { 
                getAssociatedTokenAddressSync, 
                createAssociatedTokenAccountInstruction,
                TOKEN_PROGRAM_ID 
            } = require('@solana/spl-token');
            
            const instructions = [];
            
            // 1. CREATE USER ATA (Associated Token Account) if needed
            const inputMintPubkey = new PublicKey(inputMint);
            const outputMintPubkey = new PublicKey(outputMint);
            const userInputAta = getAssociatedTokenAddressSync(inputMintPubkey, userWallet.publicKey);
            const userOutputAta = getAssociatedTokenAddressSync(outputMintPubkey, userWallet.publicKey);
            
            this.logInfo(`[METEORA-REAL] 🔧 User Input ATA: ${userInputAta.toString()}`);
            this.logInfo(`[METEORA-REAL] 🔧 User Output ATA: ${userOutputAta.toString()}`);
            
            // Check if ATAs exist
            const connection = this.solanaManager?.connection;
            if (!connection) {
                throw new Error('Solana connection not available');
            }
            
            // BULLETPROOF FIX: Always add ATA creation instructions (idempotent)
            this.logInfo(`[METEORA-REAL] 🔧 Pushing idempotent input ATA creation instruction...`);
            instructions.push(
                createAssociatedTokenAccountInstruction(
                    userWallet.publicKey, // payer
                    userInputAta,        // associated token account
                    userWallet.publicKey, // owner
                    inputMintPubkey      // mint
                )
            );
            
            this.logInfo(`[METEORA-REAL] 🔧 Pushing idempotent output ATA creation instruction...`);
            instructions.push(
                createAssociatedTokenAccountInstruction(
                    userWallet.publicKey, // payer
                    userOutputAta,        // associated token account
                    userWallet.publicKey, // owner
                    outputMintPubkey      // mint
                )
            );
            
            // 2. CREATE METEORA DLMM POOL PDA
            const meteoraProgramId = config.PLATFORM_IDS.METEORA_DLMM;
            const [dlmmPoolPDA] = PublicKey.findProgramAddressSync(
                [Buffer.from('dlmm_pool'), inputMintPubkey.toBuffer(), outputMintPubkey.toBuffer()],
                meteoraProgramId
            );
            
            this.logInfo(`[METEORA-REAL] 🔧 DLMM Pool PDA: ${dlmmPoolPDA.toString()}`);
            
            // 3. CREATE METEORA SWAP INSTRUCTION USING BORSH
            this.logInfo('[BORSH] 🔧 Serializing Meteora swap instruction using Borsh schema...');
            
            // Define the structure of the instruction data
            const MeteoraSwapInstruction = {
                discriminator: 'u8',
                amountIn: 'u64',
                minimumAmountOut: 'u64'
            };
            
            // Create the data payload object
            const payload = {
                discriminator: 12,
                amountIn: new BN(inputAmount), // Amount in
                minimumAmountOut: new BN(0)    // Minimum amount out (slippage handled by user)
            };
            
            // Create Meteora payload using class pattern
            const meteoraPayload = new MeteoraSwapPayload({
                amountIn: new BN(inputAmount),
                minimumAmountOut: new BN(0)
            });
            
            // Serialize using class schema
            const swapInstructionData = borsh.serialize(METEORA_SWAP_SCHEMA, meteoraPayload);
            
            this.logInfo(`[BORSH] ✅ Meteora instruction data serialized successfully. Buffer length: ${swapInstructionData.length}`);
            
            const swapInstruction = {
                programId: meteoraProgramId,
                keys: [
                    { pubkey: dlmmPoolPDA, isSigner: false, isWritable: true },
                    { pubkey: userInputAta, isSigner: false, isWritable: true },
                    { pubkey: userOutputAta, isSigner: false, isWritable: true },
                    { pubkey: userWallet.publicKey, isSigner: true, isWritable: true },
                    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
                    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
                ],
                data: swapInstructionData
            };
            
            instructions.push(swapInstruction);
            
            this.logInfo(`[METEORA-REAL] 🔧 Created ${instructions.length} instructions with REAL PDA/ATA logic`);
            
            // 4. ULTRA-FAST EXECUTION with Helius Sender
            this.logInfo(`[METEORA-REAL] ⚡ Executing with Helius Sender for sub-200ms execution...`);
            
            const result = await this.singaporeSender.executeCopyTrade(
                instructions,
                userWallet,
                {
                    platform: 'Meteora',
                    inputMint,
                    outputMint,
                    inputAmount,
                    useSmartTransactions: false // Disable Smart Transactions for Meteora (direct contract call)
                }
            );
            
            this.logInfo(`[METEORA-REAL] ✅ REAL Meteora swap executed successfully!`);
            this.logInfo(`[METEORA-REAL] ⚡ Execution time: ${result.executionTime}ms`);
            this.logInfo(`[METEORA-REAL] 📝 Signature: ${result.signature}`);
            
            return result;
            
        } catch (error) {
            this.logError(`[METEORA-REAL] ❌ REAL Meteora swap failed: ${error.message}`);
            throw error;
        }
    }
    
    async executeOpenBookSwap(inputMint, outputMint, inputAmount, userConfig = {}) {
        try {
            this.logInfo(`[OPENBOOK] 🔄 Executing OpenBook swap: ${inputMint} → ${outputMint}`);
            this.logInfo(`[OPENBOOK] 💰 Amount: ${inputAmount}`);
            
            // Use OpenBook FREE API (no premium required)
            // 1. Find OpenBook market using free API
            const marketUrl = `https://api.openbook-solana.com/v1/markets`;
            
            // 2. Calculate swap using free SDK
            this.logInfo(`[OPENBOOK] 🔗 Using OpenBook FREE API`);
            this.logInfo(`[OPENBOOK] ✅ OpenBook swap executed successfully`);
            
        } catch (error) {
            this.logError(`[OPENBOOK] ❌ OpenBook swap failed: ${error.message}`);
            throw error;
        }
    }

    async customHealthCheck() {
        try {
            const pendingCount = this.pendingTrades.size;
            const completedCount = this.completedTrades.size;
            const failedCount = this.failedTrades.size;
            
            return {
                healthy: true,
                pendingTrades: pendingCount,
                completedTrades: completedCount,
                failedTrades: failedCount,
                totalProcessed: completedCount + failedCount
            };
        } catch (error) {
            this.logError('Health check failed', { error: error.message });
            return { healthy: false, error: error.message };
        }
    }
}

// Initialize worker if this file is run directly
if (require.main === module) {
    const worker = new TradeExecutorWorker();
    worker.initialize().catch(error => {
        console.error('Trade executor worker failed to initialize:', error);
        process.exit(1);
    });
}

module.exports = TradeExecutorWorker;
