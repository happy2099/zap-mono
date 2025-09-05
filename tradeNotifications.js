// ==========================================
// File: tradeNotifications.js (THREAD-AWARE)
// Description: Manages and sends all trade-related notifications to Telegram.
// ==========================================

const { shortenAddress, escapeMarkdownV2 } = require('./utils.js');
const config = require('./config.js');

class TradeNotificationManager {
    constructor(botInstance, apiManager, workerManager = null, databaseManager = null) {
        // We can now accept either the bot instance OR the worker manager
        this.bot = botInstance;
        this.workerManager = workerManager;
        this.apiManager = apiManager;
        this.databaseManager = databaseManager;

        if (!apiManager) {
            throw new Error("TradeNotificationManager: apiManager is a required instance.");
        }
        if (!this.bot && !this.workerManager) {
            throw new Error("TradeNotificationManager: Must be provided with a bot instance OR a workerManager.");
        }

        this.connection = null;
        this.coinGeckoSolId = 'solana';

        const mode = this.workerManager ? 'Threaded Dispatch' : 'Direct Bot';
        console.log(`[TradeNotificationManager] Initialized in ${mode} mode.`);
    }
    
    // Internal helper to abstract sending messages
    async _sendMessage(chatId, text, options = {}) {
        const finalOptions = { parse_mode: 'MarkdownV2', disable_web_page_preview: true, ...options };
        
        // Ensure text is properly escaped for MarkdownV2 if not already escaped
        const escapedText = text.includes('\\-') ? text : escapeMarkdownV2(text);
        
        if (this.workerManager) {
            // Dispatch to the Telegram worker thread if in a threaded environment
            this.workerManager.dispatch('telegram', {
                type: 'SEND_MESSAGE',
                payload: { chatId, text: escapedText, options: finalOptions }
            });
        } else if (this.bot) {
            // Send directly using the bot instance if running single-threaded
            // This is a direct command, so we 'await' it.
            return this.bot.sendMessage(chatId, escapedText, finalOptions);
        } else {
             // If neither is available, we log the failure to send.
            console.error(`[NotificationManager] Cannot send message: No bot instance or worker manager available. ChatID: ${chatId}`);
        }
    }
    
    // Internal helper to abstract pinning messages
    async _pinMessage(chatId, messageId) {
        if (this.workerManager) {
            this.workerManager.dispatch('telegram', {
                type: 'PIN_MESSAGE',
                payload: { chatId, messageId, disable_notification: true }
            });
        } else if (this.bot) {
            await this.bot.pinChatMessage(chatId, messageId, { disable_notification: true });
        }
    }
    
    setConnection(connection) {
        if (!connection) {
            throw new Error("TradeNotificationManager connection instance cannot be null.");
        }
        this.connection = connection;
    }

    setDatabaseManager(databaseManager) {
        if (!databaseManager) {
            throw new Error("TradeNotificationManager databaseManager instance cannot be null.");
        }
        this.databaseManager = databaseManager;
    }

    async getSolPriceInUSD() {
        if (!this.connection) {
            console.warn("[Notifications] Connection not available to fetch SOL price. Returning 0.");
            return 0;
        }
        try {
            const response = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${this.coinGeckoSolId}&vs_currencies=usd`);
            const data = await response.json();
            if (data && data[this.coinGeckoSolId] && data[this.coinGeckoSolId].usd) {
                return data[this.coinGeckoSolId].usd;
            }
        } catch (error) {
            console.error("[Notifications] Error fetching SOL price from CoinGecko:", error.message);
        }
        return 0;
    }

    async getEnhancedTokenData(mintAddress) {
        if (!this.connection || !mintAddress) {
            console.warn("[SOLANA_RPC] Connection not available or no mint address provided for metadata.");
            return null;
        }

        try {
            const response = await fetch(this.connection.rpcEndpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    jsonrpc: '2.0',
                    id: `get-metadata-${mintAddress}`,
                    method: 'getAsset',
                    params: { id: mintAddress },
                }),
            });

            if (!response.ok) {
                const errorBody = await response.text();
                console.error(`[SOLANA_RPC] API Error for ${shortenAddress(mintAddress)}: ${response.status} ${response.statusText}`, errorBody.substring(0, 500));
                return null;
            }

            const data = await response.json();
            const result = data?.result;

            if (!result) {
                console.warn(`[SOLANA_RPC] No metadata found in response for ${shortenAddress(mintAddress)}.`);
                return null;
            }

            const decimals = result.content?.metadata?.decimals ?? (result.spl_token_info?.decimals ?? null);
            const symbol = result.content?.metadata?.symbol || result.spl_token_info?.symbol || '';
            const name = result.content?.metadata?.name || result.spl_token_info?.name || '';
            const logo = result.content?.files?.[0]?.uri || null;
            
            const cleanSymbol = symbol.replace(/\u0000/g, '').trim();
            const cleanName = name.replace(/\u0000/g, '').trim();

            if (!cleanSymbol && !cleanName && decimals == null) {
                console.warn(`[SOLANA_RPC] Usable metadata (symbol, name, decimals) not found for ${shortenAddress(mintAddress)} in RPC response.`);
                return null;
            }

            return { symbol: cleanSymbol, name: cleanName, decimals: decimals, logo: logo };

        } catch (error) {
            console.error(`[SOLANA_RPC] Network/Fetch error for metadata of ${shortenAddress(mintAddress)}:`, error);
            return null;
        }
    }

    // Alias function for compatibility
    async sendCopyTradeNotification(chatId, traderName, tradeDetails, signature, additionalInfo = {}) {
        return this.notifySuccessfulCopy(chatId, traderName, additionalInfo.walletLabel || 'Trading Wallet', {
            ...tradeDetails,
            signature,
            ...additionalInfo
        });
    }

    // Alias function for error notifications
    async sendErrorNotification(chatId, message, context = '') {
        return this.notifyFailedCopy(chatId, 'System', 'Bot', 'error', `${context}: ${message}`);
    }

    async notifySuccessfulCopy(chatId, traderName, copyWalletLabel, tradeResult) {
        try {
            if (!tradeResult || typeof tradeResult !== 'object' || !tradeResult.signature || !tradeResult.tradeType) {
                throw new Error("Invalid or incomplete tradeResult object provided for successful copy notification.");
            }

            const {
                signature, tradeType, outputMint, inputMint, inputAmountRaw, outputAmountRaw, solSpent, solReceived
            } = tradeResult;

            const targetMintAddress = tradeType === 'buy' ? outputMint : inputMint;
            const solScanUrl = `https://solscan.io/tx/${signature}`;

            let tokenDecimals = tradeResult.tokenDecimals ?? 9;
            const solPriceUsd = await this.getSolPriceInUSD();
            let tokenSymbol = shortenAddress(targetMintAddress, 6);
            let tokenName = tokenSymbol;

            if (targetMintAddress) {
                try {
                    const enhancedData = await this.getEnhancedTokenData(targetMintAddress);
                    if (enhancedData) {
                        tokenSymbol = enhancedData.symbol || tokenSymbol;
                        tokenName = enhancedData.name || tokenName;
                        if (typeof enhancedData.decimals === 'number') {
                            tokenDecimals = enhancedData.decimals;
                        }
                    }
                } catch (fetchError) { 
                    console.error(`Error fetching token data: ${fetchError.message}`); 
                }
            }

            const formatValue = (value, unitType = 'sol', precision = 6) => {
                if (value == null || (typeof value === 'string' && value.trim() === '')) return '_N/A_';

                try {
                    if (unitType === 'token' && typeof value === 'string') {
                        const amountBigInt = BigInt(value);
                        if (amountBigInt === 0n) return '0';
                        const divisor = BigInt(10) ** BigInt(tokenDecimals || 9);
                        const displayVal = (Number(amountBigInt * BigInt(10 ** precision)) / Number(divisor)) / (10 ** precision);
                        return escapeMarkdownV2(displayVal.toLocaleString(undefined, {
                            minimumFractionDigits: Math.min(2, precision),
                            maximumFractionDigits: precision
                        }));
                    } else if (unitType === 'sol' && typeof value === 'number') {
                        return escapeMarkdownV2(value.toLocaleString(undefined, {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: precision
                        }));
                    }
                    return '_Err_';
                } catch (e) {
                    console.error(`Error formatting value ${value} (${unitType}):`, e.message);
                    return '_Err_';
                }
            };

            let messageTitle = "";
            let summaryContent = "";
            let tradeDetailsContent = "";

            const escTrader = escapeMarkdownV2(traderName);
            const escWallet = escapeMarkdownV2(copyWalletLabel);

            if (tradeType === 'buy') {
                const amountToken = formatValue(outputAmountRaw, 'token', 4);
                const solUsed = formatValue(solSpent, 'sol', 6);

                messageTitle = `🟢 *Buy Order Executed* ✅`;
                summaryContent = `*Summary*: Bought ${amountToken} ${escapeMarkdownV2(tokenSymbol)} for ${solUsed} SOL`;

                tradeDetailsContent = `*Token Name*: ${escapeMarkdownV2(tokenName)}\n` +
                    `*Token Symbol*: ${escapeMarkdownV2(tokenSymbol)}\n` +
                    `*Tokens Bought*: ${amountToken} ${escapeMarkdownV2(tokenSymbol)}\n` +
                    `*SOL Spent*: ${solUsed} SOL\n`;

                       } else if (tradeType === 'sell') {
                const amountToken = formatValue(inputAmountRaw, 'token', 4);
                const solReceivedFormatted = formatValue(solReceived, 'sol', 6);
                const sellFeeFormatted = formatValue(tradeResult.solFee, 'sol', 8);

                // Get original position to calculate PnL and total fees
                let userPositions;
                if (!this.databaseManager) {
                    console.warn("[TradeNotifications] DatabaseManager not available, skipping PnL calculation");
                    userPositions = new Map();
                } else {
                    userPositions = await this.databaseManager.getUserPositions(chatId);
                }
                const originalPosition = userPositions.get(targetMintAddress) || {};
                const originalSolSpent = originalPosition.solSpent || tradeResult.originalSolSpent || 0;
                const buyFee = originalPosition.solFeeBuy || 0;
                const totalFee = buyFee + (tradeResult.solFee || 0);

                let pnlSol = 0;
                if (typeof solReceived === 'number') {
                    pnlSol = solReceived - originalSolSpent;
                }
                const pnlNetSol = pnlSol - totalFee; // PnL after all fees

                const pnlPrefix = pnlNetSol >= 0 ? '🟢' : '🔻';
                const pnlGrossDisplay = formatValue(pnlSol, 'sol', 6);
                const pnlNetDisplay = formatValue(pnlNetSol, 'sol', 6);
                
                messageTitle = `🔴 *Sell Order Executed* ✅`;
                summaryContent = `*Summary*: Sold ${amountToken} ${escapeMarkdownV2(tokenSymbol)} for ${solReceivedFormatted} SOL`;

                tradeDetailsContent =
                    `*P/L \\(Net\\)*: ${pnlPrefix} *${pnlNetDisplay} SOL*\n` +
                    `*P/L \\(Gross\\)*: ${pnlGrossDisplay} SOL\n\n` +
                    `*SOL Received*: ${solReceivedFormatted} SOL\n` +
                    `*SOL Spent \\(initial\\)*: ${formatValue(originalSolSpent, 'sol', 6)} SOL\n\n` +
                    `*Network Fees*\n`+
                    `• Sell Fee: ${sellFeeFormatted} SOL\n` +
                    `• Total Fees: ${formatValue(totalFee, 'sol', 8)} SOL`;
            } else {
                console.warn(`[Notification] Unknown trade type: ${tradeType}`);
                return;
            }

            let finalMessage =
                `${messageTitle}\n\n` +
                `👤 *Trader*: ${escTrader}\n` +
                `💼 *Wallet*: ${escWallet}\n\n` +
                `${summaryContent}\n\n` +
                `*Trade Details*:\n` +
                `${tradeDetailsContent}` +
                `*Tx Link*: [View on Solscan](${solScanUrl})\n\n`;

            if (tradeResult.solFee != null) {
                finalMessage += `*Network Fee*: ${formatValue(tradeResult.solFee, 'sol', 8)} SOL\n`;
            }

            await this._sendMessage(chatId, finalMessage);

        } catch (error) {
            const telegramError = error.response?.body?.description || error.message;
            console.error(`❌ Error sending successful copy notification to chat ${chatId}:`, telegramError, error.stack);
            const fallbackSig = tradeResult?.signature ? `\`${escapeMarkdownV2(tradeResult.signature)}\`` : 'N/A';
            const fallbackMsg = `✅ Copy Success \\(Sig: ${fallbackSig}\\) \\- Error generating full notification details due to: ${escapeMarkdownV2(error.message)}\\.`;
            await this._sendMessage(chatId, fallbackMsg);
        }
    }

    async notifyFailedCopy(chatId, traderName, copyWalletLabel, tradeType, errorMessage) {
        try {
            const escTrader = escapeMarkdownV2(traderName);
            const escWallet = escapeMarkdownV2(copyWalletLabel);
            const escType = escapeMarkdownV2(tradeType?.toUpperCase() || 'TRADE');
            const escError = escapeMarkdownV2(String(errorMessage || "Unknown Error").substring(0, 500));

            let message = `❌ *Copy ${escType} FAILED* ❗️ \\(${escTrader}\\)\n\n`;
            message += `*Wallet*: ${escWallet}\n`;
            message += `*Reason*: _${escError}_`;

            await this._sendMessage(chatId, message);

        } catch (error) {
            const telegramError = error.response?.body?.description || error.message;
            console.error(`❌ Error sending FAILED copy notification to chat ${chatId}:`, telegramError);
            try {
                const fallbackMsg = `ALERT: Copy Failed for trader ${traderName}! Wallet: ${copyWalletLabel}. Type: ${tradeType}. Error: ${String(errorMessage || "").substring(0, 400)}`;
                await this._sendMessage(chatId, fallbackMsg);
            } catch { }
        }
    }

    async notifyNoCopy(chatId, traderName, walletLabel, reason) {
        try {
            const escTrader = escapeMarkdownV2(traderName);
            const escWallet = escapeMarkdownV2(walletLabel || 'Unknown');
            const escReason = escapeMarkdownV2(String(reason || "Internal criteria not met.").substring(0, 500));

            let message = `🧐 *Copy Skipped* \\(${escTrader}\\)\n\n`;
            message += `*Wallet*: ${escWallet}\n`;
            message += `*Reason*: _${escReason}_`;

            await this._sendMessage(chatId, message);

        } catch (error) {
            console.error(`❌ Error sending NO COPY notification to chat ${chatId}:`, error.message);
        }
    }

    async sendInsufficientBalanceNotification(chatId, requiredSol, currentSol, copyWalletInfo, tradeDetails) {
        if (!chatId || !copyWalletInfo || !tradeDetails) {
            console.error("[Notify Balance] Missing vital info for insufficient balance notification.");
            return;
        }

        const traderNameStr = tradeDetails.traderName || 'Unknown Trader'; 
        const tokenMint = tradeDetails.outputMint || tradeDetails.inputMint;
        let tokenSymbol = tokenMint ? shortenAddress(tokenMint, 6) : "Unknown Token";

        try {
            const enhancedData = await this.getEnhancedTokenData(tokenMint);
            if (enhancedData && enhancedData.symbol) {
                tokenSymbol = enhancedData.symbol;
            }
        } catch (e) { }

        try {
            const tradeTypeStr = tradeDetails.tradeType || 'trade';
            const walletLabelStr = copyWalletInfo.label || 'Unnamed Wallet';
            
            const walletPubkeyStr = typeof copyWalletInfo.publicKey === 'object' && copyWalletInfo.publicKey !== null
                ? copyWalletInfo.publicKey.toBase58()
                : String(copyWalletInfo.publicKey || 'N/A');

            const requiredSolFormatted = parseFloat(requiredSol).toFixed(6);
            const currentSolFormatted = parseFloat(currentSol).toFixed(6);

            const escTraderName = escapeMarkdownV2(traderNameStr);
            const escWalletLabel = escapeMarkdownV2(walletLabelStr);
            const escPubkey = escapeMarkdownV2(walletPubkeyStr);
            const escTokenDisplay = escapeMarkdownV2(tokenSymbol);
            const escReq = escapeMarkdownV2(requiredSolFormatted);
            const escCurr = escapeMarkdownV2(currentSolFormatted);
            const escType = escapeMarkdownV2(tradeTypeStr.toUpperCase());

            const message = 
                `⚠️ *Insufficient Balance* ⚠️\n\n` +
                `*Trader*: ${escTraderName}\n\n` +
                `*Your Wallet*: *${escWalletLabel}*\n` +
                `*Addr*: \`${escPubkey}\`\n\n` +
                `Skipped *${escType}* copy for *${escTokenDisplay}*\\.\n\n` +
                `> *Need*: ${escReq} SOL\n` +
                `> *Have*:  ${escCurr} SOL\n\n` +
                `_Deposit SOL to the address above to enable copies\\._`;

            await this._sendMessage(chatId, message);

        } catch (error) {
            console.error(`❌ Failed to send Insufficient Balance alert to ${chatId}:`, error.message);
        }
    }

    async sendErrorNotification(chatId, title, details) {
        if (!this.bot && !this.workerManager) {
            console.error("[Notify] Cannot send general error notification: No bot instance or worker manager.");
            return;
        }
        try {
            const escTitle = escapeMarkdownV2(title);
            const escDetails = escapeMarkdownV2(details);
            const message = `❌ *${escTitle}*\n\n${escDetails}`;
            await this._sendMessage(chatId, message);

        } catch (error) {
            console.error(`[Notify] ❌ Error sending general error notification (title: ${title}) to chat ${chatId}:`, error);
            const fallbackMsg = `ALERT: General Bot Error: ${title}. Details: ${details.substring(0, 200)}`;
            try { await this._sendMessage(chatId, fallbackMsg); } catch { }
        }
    }

    async notifyMigrationEvent(chatId, tokenMint, oldPlatform, newPlatform, signature) {
        if (!chatId) return;
        
        try {
            const tokenData = await this.getEnhancedTokenData(tokenMint) || { symbol: 'TOKEN', name: 'Unknown Token' };
            const escSymbol = escapeMarkdownV2(tokenData.symbol);
            const solscanLink = `https://solscan.io/tx/${signature}`;

            const message = `🚨 *MIGRATION ALERT* 🚨\n\n` +
                            `A token you are holding has migrated\\!\n\n` +
                            `*Token*: *${escSymbol}* \\- \`${escapeMarkdownV2(tokenMint)}\`\n` +
                            `*Path*: ${escapeMarkdownV2(oldPlatform)} ➡️ ${escapeMarkdownV2(newPlatform)}\n\n` +
                            `_The bot will now use the new market for any future sell actions\\._\n\n` +
                            `[View Migration Tx](${solscanLink})`;

            const sentMessage = await this._sendMessage(chatId, message, {
                parse_mode: "MarkdownV2",
                disable_web_page_preview: true
            });

            if (sentMessage && sentMessage.message_id) {
                await this._pinMessage(chatId, sentMessage.message_id);
                console.log(`[NOTIFY_MIGRATE] Pinned migration alert for ${tokenData.symbol} in chat ${chatId}.`);
            }

        } catch (error) {
            console.error(`[NOTIFY_MIGRATE] Failed to send/pin migration alert:`, error.message);
        }
    }

    async startMigrationMonitoringNotification(chatId, tokenMint, initialProgress) {
        try {
            const { createAsciiProgressBar } = require('./utils.js');
            
            const tokenData = await this.getEnhancedTokenData(tokenMint) || { symbol: 'TOKEN' };
            const progressBar = createAsciiProgressBar(initialProgress);

            const message = `🔄 *Migration In Progress*\n\n` +
                            `*Token*: *${escapeMarkdownV2(tokenData.symbol)}*\n` +
                            `\`${escapeMarkdownV2(progressBar)}\``;
            
            const sentMessage = await this._sendMessage(chatId, message, {
                parse_mode: 'MarkdownV2'
            });

            if (sentMessage && sentMessage.message_id) {
                await this._pinMessage(chatId, sentMessage.message_id);
                console.log(`[PROGRESS_BAR] Created and pinned progress monitor for ${tokenData.symbol}.`);
                return sentMessage.message_id;
            }
            return null;

        } catch (error) {
            console.error(`[PROGRESS_BAR] Failed to create progress bar:`, error.message);
            return null;
        }
    }

    async sendSimpleMigrationAlert(chatId, tokenMint, newPlatform) {
        try {
            const tokenData = await this.getEnhancedTokenData(tokenMint) || { symbol: shortenAddress(tokenMint) };

            const message = `🔔 *MIGRATION ALERT* 🔔\n\n` +
                          `*Token*: \`${escapeMarkdownV2(tokenData.symbol)}\`\n` +
                          `*Event*: Has migrated to *${escapeMarkdownV2(newPlatform)}*\\!\n\n` +
                          `The bot is now ready to trade this token on its new home\\.`;

            await this._sendMessage(chatId, message);
        } catch (error) {
            console.error(`[Notify] Failed to send simple migration alert for ${tokenMint}:`, error.message);
        }
    }
}

module.exports = TradeNotificationManager;