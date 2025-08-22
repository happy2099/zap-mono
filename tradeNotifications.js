// ==========================================
// File: tradeNotifications.js
// Description: Manages and sends all trade-related notifications to Telegram.
// ==========================================

const { shortenAddress, escapeMarkdownV2 } = require('./utils.js');
const config = require('./config.js'); // Import config for Helius API Key & LAMPORTS_PER_SOL

class TradeNotificationManager {
    constructor(bot, apiManager) {
        // Change the original problematic `if` block (lines 14-17 from your snapshot) to this:
        if (!bot || !apiManager) {
            console.error("TradeNotificationManager Constructor Error: Passed 'bot' or 'apiManager' are null or undefined.");
            throw new Error("TradeNotificationManager: Required instances missing on initialization.");
        }
        // Removed specific instanceof/constructor.name checks here
        // Adding more logs for ultra-final debug if this fails, before actual assignments.
        console.log(`Debug TradeNotif Final: Receiving bot type ${typeof bot}, constructor name ${bot.constructor?.name}`);
        console.log(`Debug TradeNotif Final: Receiving apiManager type ${typeof apiManager}, constructor name ${apiManager.constructor?.name}`);

        this.bot = bot;
        this.apiManager = apiManager;
        this.connection = null; // Initialize connection as null
        this.coinGeckoSolId = 'solana'; // Static ID for Solana on CoinGecko

        console.log("[TradeNotificationManager] Initialized. (Connection will be set shortly).");
    }

    setConnection(connection) {
        if (!connection) {
            console.error("[TradeNotificationManager] FATAL: setConnection received null or invalid connection instance.");
            // Decide to throw or handle gracefully. For core ops, usually fatal.
            // Keeping the error log from your original for consistency:
            throw new Error("TradeNotificationManager connection instance cannot be null."); // Re-throw fatal for startup.
        }
        this.connection = connection;
        // console.log("[TradeNotificationManager] Connection set successfully.");
    }

    /**
     * Fetches SOL price in USD from CoinGecko API. Uses caching.
     * @returns {Promise<number|null>} SOL price in USD, or null on persistent error.
     */
    async getSolPriceInUSD() {
        if (!this.connection) { // Check if connection has been set before using
            console.warn("[Notifications] Connection not available to fetch SOL price. Returning 0.");
            return 0; // Return 0 if connection not available
        }
        try {
            // Your CoinGecko logic goes here...
            const response = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${this.coinGeckoSolId}&vs_currencies=usd`);
            const data = await response.json();
            if (data && data[this.coinGeckoSolId] && data[this.coinGeckoSolId].usd) {
                return data[this.coinGeckoSolId].usd;
            }
        } catch (error) {
            console.error("[Notifications] Error fetching SOL price from CoinGecko:", error.message);
        }
        return 0; // Default or fallback price
    }

    /**
     * Fetches token metadata using the Helius API.
     * @param {string} mintAddress - The token mint address.
     * @returns {Promise<{name: string, symbol: string, decimals: number|null, logo: string|null}|null>}
     */
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
                params: {
                    id: mintAddress
                },
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
        
        // Sanitize the strings to remove any null characters that can come from on-chain data
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

    /**
     * Sends a notification for a successful copy trade.
     * @param {number} chatId User's Telegram chat ID.
     * @param {string} traderName Name of the copied trader.
     * @param {string} copyWalletLabel Label of the bot's wallet used.
     * @param {object} tradeResult Detailed trade results. Includes: signature, tradeType, outputMint, inputMint, inputAmountRaw (string), outputAmountRaw (string), solSpent (SOL units), solReceived (SOL units).
     */
    async notifySuccessfulCopy(chatId, traderName, copyWalletLabel, tradeResult) {
        try {
            if (!tradeResult || typeof tradeResult !== 'object' || !tradeResult.signature || !tradeResult.tradeType) {
                throw new Error("Invalid or incomplete tradeResult object provided for successful copy notification.");
            }

            const {
                signature, tradeType, // Common
                outputMint, inputMint, // Mints
                inputAmountRaw, outputAmountRaw, // Raw string amounts
                solSpent, solReceived, // Already in SOL units from trading engine
                // Assuming `orderPrice` or `pnl` would come from analysis and be in tradeResult directly for more detail
            } = tradeResult;

            const targetMintAddress = tradeType === 'buy' ? outputMint : inputMint; // Token Mint Address
            const solScanUrl = `https://solscan.io/tx/${signature}`; // Build Solscan URL

            // Get relevant decimals from tradeResult for formatting, if available from Analyzer
            // Defaulting to 9 (SOL decimals) or trying enhancedData for consistency
            let tokenDecimals = tradeResult.tokenDecimals ?? 9;

            // --- Fetch Enhanced Token Data and SOL Price ---
            const solPriceUsd = await this.getSolPriceInUSD();
            let tokenSymbol = shortenAddress(targetMintAddress, 6); // Fallback display name
            let tokenName = tokenSymbol; // Fallback display name

            if (targetMintAddress) {
                try {
                    const enhancedData = await this.getEnhancedTokenData(targetMintAddress);
                    if (enhancedData) {
                        tokenSymbol = enhancedData.symbol || tokenSymbol;
                        tokenName = enhancedData.name || tokenName;
                        if (typeof enhancedData.decimals === 'number') {
                            tokenDecimals = enhancedData.decimals; // Use Helius decimals if more accurate
                        }
                    }
                } catch (fetchError) { console.error(`Error fetching token data: ${fetchError.message}`); }
            }

            // --- Amount Formatting Helper ---
            // Handles both BigInt strings (raw amounts) and regular numbers (SOL amounts, already in SOL)
            // Displays in MarkdownV2 escaped format
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

            // --- Determine Trade Direction & Build Message ---
            let messageTitle = "";
            let summaryContent = "";
            let tradeDetailsContent = "";

            // Trader info for consistency across buy/sell
            const escTrader = escapeMarkdownV2(traderName);
            const escWallet = escapeMarkdownV2(copyWalletLabel);

            // Dynamically build message content
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
                const amountToken = formatValue(inputAmountRaw, 'token', 4); // inputAmountRaw from Analyzer for Sells (tokens sold)
                const solReceived = formatValue(solReceived, 'sol', 6); // solReceived from trading engine in SOL units

                  // --- PnL Calculation ---
                let pnlSol = null;
                // The trading engine now provides us with the original cost.
                if (typeof tradeResult.originalSolSpent === 'number' && typeof solReceived === 'number') {
                    pnlSol = solReceived - tradeResult.originalSolSpent;
                }
                const pnlPrefix = (pnlSol && pnlSol >= 0) ? '🟢' : '🔻';
                const pnlSolDisplay = (pnlSol != null) ? `${formatValue(pnlSol, 'sol', 6)} SOL` : '_N/A_';

                const pnlUsd = (pnlSol != null && solPriceUsd) ? pnlSol * solPriceUsd : null;
                const pnlUsdDisplay = (pnlUsd != null) ? `\\$${escapeMarkdownV2(pnlUsd.toFixed(4))}` : '_N/A_';

                const pnlLine = (pnlSol != null) ? `*P/L*: ${pnlPrefix} ${pnlUsdDisplay} (${pnlSolDisplay})\n` : '';


                messageTitle = `🔴 *Sell Order Executed* ✅`;
                summaryContent = `*Summary*: Sold ${amountToken} ${escapeMarkdownV2(tokenSymbol)} for ${solReceived} SOL`;

                tradeDetailsContent =
                    pnlLine +
                    `*Token Name*: ${escapeMarkdownV2(tokenName)}\n` +
                    `*Token Symbol*: ${escapeMarkdownV2(tokenSymbol)}\n` +
                    `*Tokens Sold*: ${amountToken} ${escapeMarkdownV2(tokenSymbol)}\n` +
                    `*SOL Received*: ${solReceived} SOL\n`;
            } else {
                console.warn(`[Notification] Unknown trade type: ${tradeType}`);
                return; // Do not send notification for unknown trade type
            }

            // --- Assemble Final Message ---
            let finalMessage =
                `${messageTitle}\n\n` +
                `👤 *Trader*: ${escTrader}\n` +
                `💼 *Wallet*: ${escWallet}\n\n` +
                `${summaryContent}\n\n` +
                `*Trade Details*:\n` +
                `${tradeDetailsContent}` +
                `*Tx Link*: [View on Solscan](${solScanUrl})\n\n`;

            // Optional: Add gas/fee if provided in tradeResult (assuming its passed as `solFee` for network fee, and total gas can be combined).
            if (tradeResult.solFee != null) {
                finalMessage += `*Network Fee*: ${formatValue(tradeResult.solFee, 'sol', 8)} SOL\n`;
                // Add this if 'totalGas' represents the full transaction cost beyond network fee (Compute Budget + rent, etc.)
                // For simplicity, total gas is usually just network fee + priority fee.
                // You can add tradeResult.priorityFee from TradingEngine's call if passed:
                // finalMessage += `*Total Gas*: ${formatValue(tradeResult.totalGas || (tradeResult.solFee + (tradeResult.priorityFee/1e9 || 0)), 'sol', 8)} SOL\n\n`;
            }

            // 4. --- SEND MESSAGE ---
            await this.bot.sendMessage(chatId, finalMessage, {
                parse_mode: "MarkdownV2",
                disable_web_page_preview: true
            });

        } catch (error) {
            const telegramError = error.response?.body?.description || error.message;
            console.error(`❌ Error sending successful copy notification to chat ${chatId}:`, telegramError, error.stack);
            const fallbackSig = tradeResult?.signature ? `\`${escapeMarkdownV2(tradeResult.signature)}\`` : 'N/A';
            const fallbackMsg = `✅ Copy Success \\(Sig: ${fallbackSig}\\) \\- Error generating full notification details due to: ${escapeMarkdownV2(error.message)}\\.`;
            await this.bot.sendMessage(chatId, fallbackMsg, { parse_mode: 'MarkdownV2' });
        }
    }

    /**
    * Sends a notification to the user about a failed copy trade attempt.
    * @param {number} chatId User's chat ID.
    * @param {string} traderName Name of the trader being copied.
    * @param {string} copyWalletLabel Label of the wallet used.
    * @param {string} tradeType 'buy' or 'sell' or 'trade'.
    * @param {string} errorMessage The error message describing the failure.
    */
    async notifyFailedCopy(chatId, traderName, copyWalletLabel, tradeType, errorMessage) {
        try {
            const escTrader = escapeMarkdownV2(traderName);
            const escWallet = escapeMarkdownV2(copyWalletLabel);
            const escType = escapeMarkdownV2(tradeType?.toUpperCase() || 'TRADE');
            const escError = escapeMarkdownV2(String(errorMessage || "Unknown Error").substring(0, 500)); // Increased char limit slightly

            let message = `❌ *Copy ${escType} FAILED* ❗️ \\(${escTrader}\\)\n\n`;
            message += `*Wallet*: ${escWallet}\n`;
            message += `*Reason*: _${escError}_`;

            await this.bot.sendMessage(chatId, message, { parse_mode: "MarkdownV2" });

        } catch (error) {
            const telegramError = error.response?.body?.description || error.message;
            console.error(`❌ Error sending FAILED copy notification to chat ${chatId}:`, telegramError);
            try {
                // Fallback simpler message with minimal escaping, max 400 chars.
                const fallbackMsg = `ALERT: Copy Failed for trader ${traderName}! Wallet: ${copyWalletLabel}. Type: ${tradeType}. Error: ${String(errorMessage || "").substring(0, 400)}`;
                await this.bot.sendMessage(chatId, fallbackMsg);
            } catch { } // Catch fallback send error
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

            await this.bot.sendMessage(chatId, message, { parse_mode: "MarkdownV2" });

        } catch (error) {
            console.error(`❌ Error sending NO COPY notification to chat ${chatId}:`, error.message);
        }
    }


    // New common notification for insufficient balance (Called by TradingEngine)
    // Assumes `tradeDetails` includes `traderName` and `traderWallet` and `chatId` might come from it or elsewhere
    async sendInsufficientBalanceNotification(chatId, requiredSol, currentSol, copyWalletInfo, tradeDetails) {
    if (!chatId || !copyWalletInfo || !tradeDetails) {
        console.error("[Notify Balance] Missing vital info for insufficient balance notification.");
        return;
    }

    // Default to a clear "Not Provided" if the traderName is still missing for some reason.
    const traderNameStr = tradeDetails.traderName || 'Unknown Trader'; 

    const tokenMint = tradeDetails.outputMint || tradeDetails.inputMint;
    let tokenSymbol = tokenMint ? shortenAddress(tokenMint, 6) : "Unknown Token";

    // Attempt to get the real token symbol for a better message.
    try {
        const enhancedData = await this.getEnhancedTokenData(tokenMint);
        if (enhancedData && enhancedData.symbol) {
            tokenSymbol = enhancedData.symbol;
        }
    } catch (e) { 
        // Ignore if Helius fails, we'll just use the shortened mint address.
    }

    try {
        const tradeTypeStr = tradeDetails.tradeType || 'trade';
        const walletLabelStr = copyWalletInfo.label || 'Unnamed Wallet';
        
        // --- THE MAIN FIX IS HERE ---
        // We now safely check if publicKey is an object and call .toBase58()
        const walletPubkeyStr = typeof copyWalletInfo.publicKey === 'object' && copyWalletInfo.publicKey !== null
            ? copyWalletInfo.publicKey.toBase58()
            : String(copyWalletInfo.publicKey || 'N/A');

        // Format amounts for clean display
        const requiredSolFormatted = parseFloat(requiredSol).toFixed(6);
        const currentSolFormatted = parseFloat(currentSol).toFixed(6);

        // Escape all parts for perfect MarkdownV2
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

        await this.bot.sendMessage(chatId, message, { parse_mode: "MarkdownV2" });

    } catch (error) {
        console.error(`❌ Failed to send Insufficient Balance alert to ${chatId}:`, error.message);
    }
} // End sendInsufficientBalanceNotification

    /**
     * Sends a general formatted error notification.
     * @param {number} chatId
     * @param {string} title
     * @param {string} details
     */
    async sendErrorNotification(chatId, title, details) {
        if (!this.bot) {
            console.error("[Notify] Cannot send general error notification: Bot instance not set.");
            return;
        }
        try {
            const escTitle = escapeMarkdownV2(title);
            const escDetails = escapeMarkdownV2(details);
            const message = `❌ *${escTitle}*\n\n${escDetails}`;
            await this.bot.sendMessage(chatId, message, { parse_mode: 'MarkdownV2' });

        } catch (error) {
            console.error(`[Notify] ❌ Error sending general error notification (title: ${title}) to chat ${chatId}:`, error);
            // Fallback on severe send failure
            const fallbackMsg = `ALERT: General Bot Error: ${title}. Details: ${details.substring(0, 200)}`;
            try { await this.bot.sendMessage(chatId, fallbackMsg); } catch { }
        }
    }

     async notifyMigrationEvent(chatId, tokenMint, oldPlatform, newPlatform, signature) {
        if (!chatId) return; // Can't send without a chat ID.
        
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

            // Send the message first...
            const sentMessage = await this.bot.sendMessage(chatId, message, {
                parse_mode: "MarkdownV2",
                disable_web_page_preview: true
            });

            // ...then pin it. The bot must be an admin in the channel for this to work.
            if (sentMessage) {
                await this.bot.pinChatMessage(chatId, sentMessage.message_id, { disable_notification: true });
                 console.log(`[NOTIFY_MIGRATE] Pinned migration alert for ${tokenData.symbol} in chat ${chatId}.`);
            }

        } catch (error) {
            console.error(`[NOTIFY_MIGRATE] Failed to send/pin migration alert:`, error.message);
        }
    }

      async startMigrationMonitoringNotification(chatId, tokenMint, initialProgress) {
        try {
            const { createAsciiProgressBar } = require('./utils.js'); // Import our new util
            
            const tokenData = await this.getEnhancedTokenData(tokenMint) || { symbol: 'TOKEN' };
            const progressBar = createAsciiProgressBar(initialProgress);

            const message = `🔄 *Migration In Progress*\n\n` +
                            `*Token*: *${escapeMarkdownV2(tokenData.symbol)}*\n` +
                            `\`${escapeMarkdownV2(progressBar)}\``;
            
            const sentMessage = await this.bot.sendMessage(chatId, message, {
                parse_mode: 'MarkdownV2'
            });

            await this.bot.pinChatMessage(chatId, sentMessage.message_id, { disable_notification: true });

            console.log(`[PROGRESS_BAR] Created and pinned progress monitor for ${tokenData.symbol}.`);
            return sentMessage.message_id; // CRITICAL: Return the ID so we can edit it later.

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

            // We don't pin these because they are one-time events.
            await this.bot.sendMessage(chatId, message, { parse_mode: "MarkdownV2" });
        } catch (error) {
            console.error(`[Notify] Failed to send simple migration alert for ${tokenMint}:`, error.message);
        }
    }

}


// CommonJS Export: Export the class directly as the module's export
module.exports = TradeNotificationManager;