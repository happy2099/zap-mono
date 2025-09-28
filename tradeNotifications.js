// ==========================================
// File: tradeNotifications.js (THREAD-AWARE)
// Description: Manages and sends all trade-related notifications to Telegram.
// ==========================================

const { shortenAddress, escapeMarkdownV2 } = require('./utils.js');
const config = require('./config.js');

class TradeNotificationManager {
    constructor(botInstance, apiManager, workerManager = null, dataManager = null) {
        // We can now accept either the bot instance OR the worker manager
        this.bot = botInstance;
        this.workerManager = workerManager;
        this.apiManager = apiManager;
        this.dataManager = dataManager;

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

    setdataManager(dataManager) {
        if (!dataManager) {
            throw new Error("TradeNotificationManager dataManager instance cannot be null.");
        }
        this.dataManager = dataManager;
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
            if (!tradeResult || typeof tradeResult !== 'object' || !tradeResult.signature) {
                throw new Error("Invalid tradeResult provided for notification.");
            }

            // --- Use the new, VERIFIED data from the executor ---
            const {
                signature, tradeType, outputMint, solSpent, // Lamports WE spent
                tokensBoughtRaw, decimals                    // The raw amount of tokens WE received
            } = tradeResult;

            const solScanUrl = `https://solscan.io/tx/${signature}`;

            // Fetch token metadata for display
            const tokenData = await this.getEnhancedTokenData(outputMint) || {
                symbol: shortenAddress(outputMint, 6),
                name: 'Unknown Token'
            };

            // --- 1. THE FIX for "SOL Spent" ---
            // Convert the lamports we spent into a human-readable SOL string.
            const solSpentFormatted = escapeMarkdownV2(
                (solSpent / 1000000000).toLocaleString(undefined, { minimumFractionDigits: 4, maximumFractionDigits: 4 })
            );

            // --- 2. THE FIX for "Tokens Bought" ---
            // Use the raw token amount and its decimals to create a correct display string.
            let tokensBoughtFormatted = '_Err_';
            if (typeof tokensBoughtRaw !== 'undefined' && typeof decimals === 'number' && decimals >= 0) {
                if (tokensBoughtRaw === 0) {
                    tokensBoughtFormatted = '0';
                } else {
                    const divisor = BigInt(10) ** BigInt(decimals);
                    tokensBoughtFormatted = escapeMarkdownV2(
                        (Number(BigInt(tokensBoughtRaw) * 1000000n / divisor) / 1000000).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 })
                    );
                }
            }
            
            // Escape all parts of the message for Telegram
            const escTrader = escapeMarkdownV2(traderName);
            const escWallet = escapeMarkdownV2(copyWalletLabel);
            const escSymbol = escapeMarkdownV2(tokenData.symbol);
            const escName = escapeMarkdownV2(tokenData.name);
            
            // Construct the final, correct message
            const message =
                  `🟢 *Buy Order Executed* ✅\n\n` +
                  `👤 *Trader*: ${escTrader}\n` +
                  `💼 *Wallet*: ${escWallet}\n\n` +
                  `*Summary*: Bought ${tokensBoughtFormatted} ${escSymbol} for ${solSpentFormatted} SOL\n\n` +
                  `*Trade Details*:\n` +
                  `• *Token Name*: ${escName}\n` +
                  `• *Token Symbol*: ${escSymbol}\n` +
                  `• *Tokens Bought*: ${tokensBoughtFormatted}\n` +
                  `• *SOL Spent*: ${solSpentFormatted} SOL\n` +
                  `*Tx Link*: [View on Solscan](${solScanUrl})`;

            await this._sendMessage(chatId, message);

        } catch (error) {
            // This is the original, good error handling logic
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
            const escType = escapeMarkdownV2((tradeType || 'TRADE').toUpperCase());
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
            const escType = escapeMarkdownV2((tradeTypeStr || 'TRADE').toUpperCase());

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

    async notifyInsufficientBalance(chatId, traderName, platform, errorMessage, signature) {
        if (!this.bot && !this.workerManager) {
            console.error("[Notify] Cannot send insufficient balance notification: No bot instance or worker manager.");
            return;
        }
        try {
            const escTrader = escapeMarkdownV2(traderName);
            const escPlatform = escapeMarkdownV2(platform);
            const escError = escapeMarkdownV2(errorMessage);
            const escSignature = escapeMarkdownV2(signature);
            
            const message = `💰 *INSUFFICIENT BALANCE ERROR* 💰\n\n` +
                          `🚨 *Your trading wallet needs more SOL\\!*\n\n` +
                          `*Trader*: ${escTrader}\n` +
                          `*Platform*: ${escPlatform}\n` +
                          `*Error*: ${escError}\n` +
                          `*Signature*: \`${escSignature}\`\n\n` +
                          `⚠️ *ACTION REQUIRED*:\n` +
                          `• Add more SOL to your trading wallet\n` +
                          `• Check your wallet balance\n` +
                          `• Ensure sufficient funds for transaction fees\n\n` +
                          `🔄 *Bot Status*: Paused until balance is restored`;

            await this._sendMessage(chatId, message);
            console.log(`[NOTIFY_BALANCE] Insufficient balance alert sent for ${escTrader} on ${escPlatform}`);

        } catch (error) {
            console.error(`[NOTIFY_BALANCE] Failed to send insufficient balance notification:`, error.message);
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

    // NEW METHOD: Send trade notification with verified bot execution data
    async sendTradeNotification(tradeData) {
        try {
            const { signature, traderName, platform, solSpent, inputMint, outputMint, tokensBoughtRaw, decimals } = tradeData;
            
            // Get enhanced token data for the output token
            const tokenData = await this.getEnhancedTokenData(outputMint) || { 
                symbol: shortenAddress(outputMint),
                name: 'Unknown Token'
            };
            
            // Convert lamports to SOL for display
            const solSpentFormatted = (solSpent / 1000000000).toFixed(4);
            
            // Format token amount based on decimals
            let tokensBoughtFormatted = '0';
            if (tokensBoughtRaw && tokensBoughtRaw > 0 && decimals !== 'unknown') {
                const divisor = Math.pow(10, decimals);
                tokensBoughtFormatted = (Number(tokensBoughtRaw) / divisor).toFixed(2);
            }
            
            const message = `🕺 *BUY ORDER EXECUTED* 🕺\n\n` +
                          `*Trader*: ${escapeMarkdownV2(traderName)}\n` +
                          `*Wallet*: Trading Wallet\n` +
                          `*Summary*: Bought ${tokensBoughtFormatted} ${escapeMarkdownV2(tokenData.symbol)} for ${solSpentFormatted} SOL\n\n` +
                          `*Trade Details:*\n` +
                          `• Token Name: ${escapeMarkdownV2(tokenData.name)}\n` +
                          `• Token Symbol: ${escapeMarkdownV2(tokenData.symbol)}\n` +
                          `• Tokens Bought: ${tokensBoughtFormatted} ${escapeMarkdownV2(tokenData.symbol)}\n` +
                          `• SOL Spent: ${solSpentFormatted} SOL\n` +
                          `• Platform: ${escapeMarkdownV2(platform)}\n` +
                          `• Tx Link: [View on Solscan](https://solscan.io/tx/${signature})`;
            
            const chatId = config.ADMIN_CHAT_ID;
            await this._sendMessage(chatId, message);
            
            console.log(`[TRADE_NOTIFICATION] ✅ Trade notification sent for ${traderName} on ${platform}`);
            
        } catch (error) {
            console.error(`[TRADE_NOTIFICATION] ❌ Failed to send trade notification:`, error.message);
        }
    }
}

module.exports = TradeNotificationManager;