// ==========================================
// File: adminManager.js - ENHANCED ADMIN PANEL
// Description: Advanced admin functionality for user management, statistics, and system monitoring
// ==========================================

const { PublicKey } = require('@solana/web3.js');
const { shortenAddress, escapeMarkdownV2 } = require('./utils.js');
const config = require('./config.js');

class AdminManager {
    constructor(dataManager, solanaManager, walletManager, tradingEngine) {
        this.dataManager = dataManager;
        this.solanaManager = solanaManager;
        this.walletManager = walletManager;
        this.tradingEngine = tradingEngine;
        
        console.log('[ADMIN MANAGER] Initialized with enhanced functionality');
    }

    /**
     * Check if user is admin
     */
    async isAdmin(chatId) {
        try {
            const user = await this.dataManager.getUser(chatId);
            return user && user.is_admin === 1;
        } catch (error) {
            console.error('Error checking admin status:', error);
            return false;
        }
    }

    /**
     * Get comprehensive user statistics
     */
    async getUserStatistics() {
        try {
            // Get users from database
            const dbUsers = await this.dataManager.all('SELECT * FROM users');
            const users = {};
            dbUsers.forEach(user => {
                const userSettings = JSON.parse(user.settings || '{}');
                users[user.chat_id] = {
                    username: userSettings.username || user.chat_id,
                    active: true,
                    addedAt: user.created_at,
                    lastActivity: user.updated_at
                };
            });

            // Get traders from database
            const dbTraders = await this.dataManager.all('SELECT * FROM traders');
            const traders = { user_traders: {} };
            dbTraders.forEach(trader => {
                if (!traders.user_traders[trader.user_id]) {
                    traders.user_traders[trader.user_id] = {};
                }
                traders.user_traders[trader.user_id][trader.name] = {
                    wallet: trader.wallet,
                    active: trader.active === 1,
                    addedAt: trader.created_at
                };
            });

            // Get trade stats (placeholder - would need to implement in database)
            const tradeStats = { totalTrades: 0, successfulCopies: 0, failedCopies: 0, tradesUnder10Secs: "0.00" };

            // Get positions from user settings
            const positions = {};
            dbUsers.forEach(user => {
                const userSettings = JSON.parse(user.settings || '{}');
                if (userSettings.positions) {
                    positions[user.chat_id] = Object.values(userSettings.positions);
                }
            });

            const stats = {
                totalUsers: Object.keys(users).length,
                activeUsers: 0,
                totalTraders: 0,
                activeTraders: 0,
                totalTrades: tradeStats.totalTrades || 0,
                successfulTrades: tradeStats.successfulCopies || 0,
                failedTrades: tradeStats.failedCopies || 0,
                successRate: 0,
                averageTradeTime: tradeStats.tradesUnder10Secs || "0.00",
                totalPositions: 0,
                totalValueLocked: 0
            };

            // Calculate active users and traders
            for (const [userId, userData] of Object.entries(users)) {
                if (userData.active) stats.activeUsers++;
                
                const userTraders = traders.user_traders?.[userId] || {};
                for (const [traderName, traderData] of Object.entries(userTraders)) {
                    stats.totalTraders++;
                    if (traderData.active) stats.activeTraders++;
                }
            }

            // Calculate success rate
            if (stats.totalTrades > 0) {
                stats.successRate = ((stats.successfulTrades / stats.totalTrades) * 100).toFixed(2);
            }

            // Calculate positions and TVL
            for (const [userId, userPositions] of Object.entries(positions)) {
                if (userPositions && Array.isArray(userPositions)) {
                    stats.totalPositions += userPositions.length;
                    // Calculate TVL (simplified - would need price feeds for accurate calculation)
                    stats.totalValueLocked += userPositions.reduce((sum, pos) => sum + (pos.solSpent || 0), 0);
                }
            }

            return stats;
        } catch (error) {
            console.error('[ADMIN MANAGER] Error getting user statistics:', error);
            throw error;
        }
    }

    /**
     * Get detailed user activity
     */
    async getUserActivity() {
        try {
            // Get users from database
            const dbUsers = await this.dataManager.all('SELECT * FROM users');
            const users = {};
            dbUsers.forEach(user => {
                const userSettings = JSON.parse(user.settings || '{}');
                users[user.chat_id] = {
                    username: userSettings.username || user.chat_id,
                    active: true,
                    addedAt: user.created_at,
                    lastActivity: user.updated_at
                };
            });

            // Get traders from database
            const dbTraders = await this.dataManager.all('SELECT * FROM traders');
            const traders = { user_traders: {} };
            dbTraders.forEach(trader => {
                if (!traders.user_traders[trader.user_id]) {
                    traders.user_traders[trader.user_id] = {};
                }
                traders.user_traders[trader.user_id][trader.name] = {
                    wallet: trader.wallet,
                    active: trader.active === 1,
                    addedAt: trader.created_at
                };
            });

            // Get positions from user settings
            const positions = {};
            dbUsers.forEach(user => {
                const userSettings = JSON.parse(user.settings || '{}');
                if (userSettings.positions) {
                    positions[user.chat_id] = Object.values(userSettings.positions);
                }
            });

            const activity = [];

            for (const [userId, userData] of Object.entries(users)) {
                const userTraders = traders.user_traders?.[userId] || {};
                const userPositions = positions[userId] || [];
                
                const userActivity = {
                    userId: userId,
                    username: userData.username || 'Unknown',
                    active: userData.active || false,
                    traders: Object.keys(userTraders).length,
                    activeTraders: Object.values(userTraders).filter(t => t.active).length,
                    positions: userPositions.length,
                    lastActivity: userData.lastActivity || 'Never',
                    totalSolSpent: userPositions.reduce((sum, pos) => sum + (pos.solSpent || 0), 0)
                };

                activity.push(userActivity);
            }

            // Sort by last activity (most recent first)
            activity.sort((a, b) => {
                const dateA = new Date(a.lastActivity);
                const dateB = new Date(b.lastActivity);
                return dateB - dateA;
            });

            return activity;
        } catch (error) {
            console.error('[ADMIN MANAGER] Error getting user activity:', error);
            throw error;
        }
    }

    /**
     * Get user P&L data
     */
    async getUserPnl() {
        try {
            // Get users from database
            const dbUsers = await this.dataManager.all('SELECT * FROM users');
            const users = {};
            dbUsers.forEach(user => {
                const userSettings = JSON.parse(user.settings || '{}');
                users[user.chat_id] = {
                    username: userSettings.username || user.chat_id,
                    active: true,
                    addedAt: user.created_at,
                    lastActivity: user.updated_at
                };
            });

            // Get positions from user settings
            const positions = {};
            dbUsers.forEach(user => {
                const userSettings = JSON.parse(user.settings || '{}');
                if (userSettings.positions) {
                    positions[user.chat_id] = Object.values(userSettings.positions);
                }
            });

            // Get trade stats (placeholder - would need to implement in database)
            const tradeStats = { totalTrades: 0, successfulCopies: 0, failedCopies: 0, tradesUnder10Secs: "0.00" };

            const pnlData = [];

            for (const [userId, userData] of Object.entries(users)) {
                const userPositions = positions[userId] || [];
                
                const totalSpent = userPositions.reduce((sum, pos) => sum + (pos.solSpent || 0), 0);
                const totalValue = userPositions.reduce((sum, pos) => {
                    // Simplified calculation - would need current prices for accurate P&L
                    return sum + (pos.currentValue || pos.solSpent || 0);
                }, 0);

                const pnl = totalValue - totalSpent;
                const pnlPercentage = totalSpent > 0 ? ((pnl / totalSpent) * 100) : 0;

                const userPnl = {
                    userId: userId,
                    username: userData.username || 'Unknown',
                    totalSpent: totalSpent.toFixed(4),
                    totalValue: totalValue.toFixed(4),
                    pnl: pnl.toFixed(4),
                    pnlPercentage: pnlPercentage.toFixed(2),
                    positions: userPositions.length,
                    activePositions: userPositions.filter(pos => pos.active).length
                };

                pnlData.push(userPnl);
            }

            // Sort by P&L percentage (best performing first)
            pnlData.sort((a, b) => parseFloat(b.pnlPercentage) - parseFloat(a.pnlPercentage));

            return pnlData;
        } catch (error) {
            console.error('[ADMIN MANAGER] Error getting user P&L:', error);
            throw error;
        }
    }

    /**
     * Get system health metrics
     */
    async getSystemHealth() {
        try {
            const health = {
                timestamp: new Date().toISOString(),
                solanaConnection: 'Unknown',
                walletManager: 'Unknown',
                tradingEngine: 'Unknown',
                activeSubscriptions: 0,
                memoryUsage: process.memoryUsage(),
                uptime: process.uptime(),
                nodeVersion: process.version,
                platform: process.platform
            };

            // Check Solana connection
            try {
                const blockHeight = await this.solanaManager.connection.getBlockHeight();
                health.solanaConnection = 'Connected';
                health.latestBlockHeight = blockHeight;
            } catch (error) {
                health.solanaConnection = 'Disconnected';
                health.solanaError = error.message;
            }

            // Check wallet manager
            try {
                const keypairPacket = await this.walletManager.getPrimaryTradingKeypair();
                health.walletManager = keypairPacket ? 'Ready' : 'No Trading Wallet';
            } catch (error) {
                health.walletManager = 'Error';
                health.walletError = error.message;
            }

            // Check trading engine
            try {
                health.tradingEngine = this.tradingEngine ? 'Active' : 'Inactive';
                if (this.tradingEngine) {
                    health.activeSubscriptions = this.tradingEngine.activeSubscriptions?.size || 0;
                }
            } catch (error) {
                health.tradingEngine = 'Error';
                health.tradingError = error.message;
            }

            return health;
        } catch (error) {
            console.error('[ADMIN MANAGER] Error getting system health:', error);
            throw error;
        }
    }

    /**
     * Add new user (admin only)
     */
    async addUser(chatId, userId, username) {
        if (!this.isAdmin(chatId)) {
            throw new Error('Unauthorized: Admin access required');
        }

        try {
            // Check if user already exists
            const existingUser = await this.dataManager.getUser(userId);
            if (existingUser) {
                throw new Error(`User ${userId} already exists`);
            }

            // Create new user
            await this.dataManager.createUser(userId, {
                username: username,
                active: true,
                addedAt: new Date().toISOString(),
                lastActivity: new Date().toISOString(),
                addedBy: chatId
            });
            
            console.log(`[ADMIN MANAGER] User ${userId} (${username}) added by admin ${chatId}`);
            
            return {
                success: true,
                message: `User ${username} (${userId}) added successfully`
            };
        } catch (error) {
            console.error('[ADMIN MANAGER] Error adding user:', error);
            throw error;
        }
    }

    /**
     * Remove user (admin only)
     */
    async removeUser(chatId, userId) {
        if (!this.isAdmin(chatId)) {
            throw new Error('Unauthorized: Admin access required');
        }

        try {
            // Check if user exists
            const existingUser = await this.dataManager.getUser(userId);
            if (!existingUser) {
                throw new Error(`User ${userId} not found`);
            }

            const userSettings = JSON.parse(existingUser.settings || '{}');
            const username = userSettings.username || 'Unknown';
            
            // Remove user and all associated data
            await this.dataManager.deleteUser(userId);
            
            console.log(`[ADMIN MANAGER] User ${userId} (${username}) removed by admin ${chatId}`);
            
            return {
                success: true,
                message: `User ${username} (${userId}) removed successfully`
            };
        } catch (error) {
            console.error('[ADMIN MANAGER] Error removing user:', error);
            throw error;
        }
    }

    /**
     * Get detailed user information
     */
    async getUserDetails(userId) {
        try {
            // Get user from database
            const user = await this.dataManager.getUser(userId);
            if (!user) {
                throw new Error(`User ${userId} not found`);
            }

            const userSettings = JSON.parse(user.settings || '{}');
            const userData = {
                username: userSettings.username || userId,
                active: true,
                addedAt: user.created_at,
                lastActivity: user.updated_at
            };

            // Get user's traders
            const dbTraders = await this.dataManager.getTraders(userId);
            const userTraders = {};
            dbTraders.forEach(trader => {
                userTraders[trader.name] = {
                    wallet: trader.wallet,
                    active: trader.active === 1,
                    addedAt: trader.created_at
                };
            });

            // Get user's positions from settings
            const userPositions = userSettings.positions ? Object.values(userSettings.positions) : [];
            const userSolAmount = userSettings.solAmount || config.DEFAULT_SOL_TRADE_AMOUNT;

            const details = {
                userId: userId,
                username: userData.username || 'Unknown',
                active: userData.active || false,
                addedAt: userData.addedAt || 'Unknown',
                lastActivity: userData.lastActivity || 'Never',
                solAmount: userSolAmount,
                traders: Object.keys(userTraders).length,
                activeTraders: Object.values(userTraders).filter(t => t.active).length,
                positions: userPositions.length,
                totalSolSpent: userPositions.reduce((sum, pos) => sum + (pos.solSpent || 0), 0),
                traderList: Object.keys(userTraders),
                recentPositions: userPositions.slice(-5) // Last 5 positions
            };

            return details;
        } catch (error) {
            console.error('[ADMIN MANAGER] Error getting user details:', error);
            throw error;
        }
    }

    /**
     * Format statistics for Telegram display
     */
    formatStatistics(stats) {
        return `📊 *Bot Statistics*\n\n` +
               `👥 *Users*\n` +
               `• Total: ${stats.totalUsers}\n` +
               `• Active: ${stats.activeUsers}\n\n` +
               `🎯 *Traders*\n` +
               `• Total: ${stats.totalTraders}\n` +
               `• Active: ${stats.activeTraders}\n\n` +
               `💰 *Trading*\n` +
               `• Total Trades: ${stats.totalTrades}\n` +
               `• Success Rate: ${stats.successRate}%\n` +
               `• Avg Trade Time: ${stats.averageTradeTime}s\n\n` +
               `📈 *Positions*\n` +
               `• Total: ${stats.totalPositions}\n` +
               `• TVL: ${stats.totalValueLocked.toFixed(4)} SOL`;
    }

    /**
     * Format user activity for Telegram display
     */
    formatUserActivity(activity, page = 0, perPage = 5) {
        const start = page * perPage;
        const end = start + perPage;
        const pageActivity = activity.slice(start, end);
        const totalPages = Math.ceil(activity.length / perPage);

        let message = `👀 *User Activity* (Page ${page + 1}/${totalPages})\n\n`;

        pageActivity.forEach((user, index) => {
            message += `${index + 1}. *${escapeMarkdownV2(user.username)}*\n` +
                      `   ID: \`${user.userId}\`\n` +
                      `   Status: ${user.active ? '✅ Active' : '❌ Inactive'}\n` +
                      `   Traders: ${user.activeTraders}/${user.traders}\n` +
                      `   Positions: ${user.positions}\n` +
                      `   Spent: ${user.totalSolSpent.toFixed(4)} SOL\n` +
                      `   Last: ${user.lastActivity}\n\n`;
        });

        return { message, totalPages, currentPage: page };
    }

    /**
     * Format P&L data for Telegram display
     */
    formatPnlData(pnlData, page = 0, perPage = 5) {
        const start = page * perPage;
        const end = start + perPage;
        const pagePnl = pnlData.slice(start, end);
        const totalPages = Math.ceil(pnlData.length / perPage);

        let message = `💹 *User PnL* (Page ${page + 1}/${totalPages})\n\n`;

        pagePnl.forEach((user, index) => {
            const pnlColor = parseFloat(user.pnlPercentage) >= 0 ? '🟢' : '🔴';
            message += `${index + 1}. *${escapeMarkdownV2(user.username)}*\n` +
                      `   ${pnlColor} PnL: ${user.pnlPercentage}%\n` +
                      `   Spent: ${user.totalSpent} SOL\n` +
                      `   Value: ${user.totalValue} SOL\n` +
                      `   Positions: ${user.activePositions}/${user.positions}\n\n`;
        });

        return { message, totalPages, currentPage: page };
    }

    /**
     * Format system health for Telegram display
     */
    formatSystemHealth(health) {
        const uptimeHours = Math.floor(health.uptime / 3600);
        const uptimeMinutes = Math.floor((health.uptime % 3600) / 60);
        
        return `🏥 *System Health*\n\n` +
               `⏰ *Uptime*\n` +
               `• ${uptimeHours}h ${uptimeMinutes}m\n\n` +
               `🔗 *Connections*\n` +
               `• Solana: ${health.solanaConnection}\n` +
               `• Wallet: ${health.walletManager}\n` +
               `• Trading: ${health.tradingEngine}\n\n` +
               `📊 *Resources*\n` +
               `• Memory: ${(health.memoryUsage.heapUsed / 1024 / 1024).toFixed(2)} MB\n` +
               `• Subscriptions: ${health.activeSubscriptions}\n\n` +
               `🖥️ *System*\n` +
               `• Node: ${health.nodeVersion}\n` +
               `• Platform: ${health.platform}`;
    }
}

module.exports = AdminManager;
