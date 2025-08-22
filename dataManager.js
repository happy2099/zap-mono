// ==========================================
// ========== ZapBot DataManager ==========
// ==========================================
// File: dataManager.js
// Description: Handles all file system read/write operations for the bot.

const fs = require('fs/promises'); // CommonJS import for fs/promises
const path = require('path');     // CommonJS import for path

// Import all necessary file path and default constants from the config file (CommonJS import)
const {
    DATA_DIR,
    LOGS_DIR,
    SETTINGS_FILE,
    TRADERS_FILE,
    SOL_AMOUNTS_FILE,
    SAVED_ADDRESSES_FILE,
    TRADE_STATS_FILE,
    WITHDRAWAL_HISTORY_FILE,
    POSITIONS_FILE,
    USERS_FILE,
    WALLET_FILE,
    DEFAULT_SOL_TRADE_AMOUNT,
    MIN_SOL_AMOUNT_PER_TRADE,
    PROCESSED_POOLS_FILE,
} = require('./patches/config.js'); // Use .js extension for clarity, but not strictly needed with CommonJS

const BN = require('bn.js'); // <--- ADDED: Explicit import for BN.js library

// Import shortenAddress
const { shortenAddress } = require('./utils.js'); // Assuming shortenAddress is from utils.js

class DataManager { // No 'export' keyword here, will export at the end
    constructor() {
        this.userPositions = new Map();// Keep in-memory positions managed here
        console.log("DataManager initialized.");
    }

    // --- File System Initialization ---
    /**
     * Ensures necessary data/log directories exist and creates default files if missing.
     */
    async initFiles() {
        try {
            await fs.mkdir(DATA_DIR, { recursive: true });
            await fs.mkdir(LOGS_DIR, { recursive: true });

            const filesToCreate = {
                [TRADERS_FILE]: '{}',
                [USERS_FILE]: '{}',
                [SOL_AMOUNTS_FILE]: '{}',
                [SAVED_ADDRESSES_FILE]: '[]',
                [TRADE_STATS_FILE]: JSON.stringify({ totalTrades: 0, successfulCopies: 0, failedCopies: 0, tradesUnder10Secs: "0.00", percentageUnder10Secs: "0.00" }, null, 2),
                [WITHDRAWAL_HISTORY_FILE]: '[]',
                [SETTINGS_FILE]: JSON.stringify({ primaryCopyWalletLabel: null }, null, 2),
                [POSITIONS_FILE]: '{}',
            };

            for (const [file, content] of Object.entries(filesToCreate)) {
                try {
                    await fs.access(file);
                } catch (accessError) {
                    if (accessError.code === 'ENOENT') {
                        console.log(`DataManager: Initializing missing file: ${path.basename(file)}`);
                        await fs.writeFile(file, content, 'utf8');
                    } else {
                        throw accessError;
                    }
                }
            }
            console.log("DataManager: File system check complete.");
        } catch (e) {
            console.error(`DataManager: initFiles error: ${e.message}`);
            throw e;
        }
    }

    async loadProcessedPools() {
        if (await this.fileExists(PROCESSED_POOLS_FILE)) {
            const data = await fs.readFile(PROCESSED_POOLS_FILE, 'utf8');
            // We store it as an array in the file, but the bot uses a Set for performance.
            return new Set(JSON.parse(data));
        }
        return new Set(); // Return an empty set if the file doesn't exist.
    }

    async saveProcessedPools(processedPoolsSet) {
        // Convert the Set to an Array to make it JSON-serializable.
        const arrayToSave = Array.from(processedPoolsSet);
        await fs.writeFile(PROCESSED_POOLS_FILE, JSON.stringify(arrayToSave, null, 2), 'utf8');
    }


    async fileExists(filePath) {
        try {
            await fs.access(filePath); // fs.access checks if the file can be accessed.
            return true; // If it doesn't throw an error, the file exists.
        } catch (error) {
            // If it throws an error (specifically 'ENOENT' for "Error NO ENTry"), the file doesn't exist.
            if (error.code === 'ENOENT') {
                return false;
            }
            // For any other error, we should throw it so we know what's wrong.
            throw error;
        }
    }

    // --- Positions Management ---
   async loadPositions() {
        try {
            const data = await fs.readFile(POSITIONS_FILE, 'utf8');
            if (data.trim().length < 2) {
                this.userPositions = new Map();
                return;
            }

            const reviver = (key, value) => (typeof value === 'string' && /^-?\d+n$/.test(value) ? BigInt(value.slice(0, -1)) : value);
            const parsedObject = JSON.parse(data, reviver);

            // Reconstruct the nested Map structure
            const loadedUserPositions = new Map();
            for (const chatId in parsedObject) {
                const userPositionMap = new Map(Object.entries(parsedObject[chatId]));
                loadedUserPositions.set(chatId, userPositionMap);
            }
            this.userPositions = loadedUserPositions;

            console.log(`DataManager: Loaded positions for ${this.userPositions.size} users.`);

        } catch (error) {
            if (error.code === 'ENOENT') {
                console.log("DataManager: positions.json not found. Starting with empty positions map.");
            } else {
                console.error(`DataManager: Error loading positions. Starting fresh.`, error);
            }
            this.userPositions = new Map();
        }
    }
 async savePositions() {
        try {
            const replacer = (key, value) => (typeof value === 'bigint' ? value.toString() + 'n' : value);
            
            // Convert the nested Map structure into a plain object for JSON
            const positionsObject = {};
            for (const [chatId, userPositionMap] of this.userPositions.entries()) {
                positionsObject[chatId] = Object.fromEntries(userPositionMap);
            }
            
            const jsonString = JSON.stringify(positionsObject, replacer, 2);
            await fs.writeFile(POSITIONS_FILE, jsonString, 'utf8');

        } catch (error) {
            console.error(`DataManager: Failed to save positions:`, error);
        }
    }

 async recordBuyPosition(chatId, mintAddress, amountRaw, solSpent) {
    const userChatIdStr = String(chatId);
    
    // Get or create the map for this specific user
    if (!this.userPositions.has(userChatIdStr)) {
        this.userPositions.set(userChatIdStr, new Map());
    }
    const userPositionMap = this.userPositions.get(userChatIdStr);

    try {
        const amountToStore = BigInt(amountRaw);
        const existingPosition = userPositionMap.get(mintAddress);

        if (existingPosition) {
            console.log(`[PositionTracking-${userChatIdStr}] Accumulating position for ${shortenAddress(mintAddress)}.`);
            existingPosition.amountRaw += amountToStore;
            existingPosition.solSpent += solSpent;
            userPositionMap.set(mintAddress, existingPosition);
        } else {
            userPositionMap.set(mintAddress, {
                amountRaw: amountToStore,
                solSpent: solSpent,
                soldAmountRaw: 0n,
                buyTimestamp: Date.now()
            });
        }
        await this.savePositions();
    } catch (error) {
        console.error(`[PositionTracking-${userChatIdStr}] Error recording buy for ${mintAddress}:`, error);
    }
}

   getUserSellDetails(chatId, tokenMintAddress) {
    const userPositionMap = this.userPositions.get(String(chatId));
    if (!userPositionMap) return null; // User has no positions at all

    const position = userPositionMap.get(tokenMintAddress);
    if (position && position.amountRaw > 0n) {
        return {
            amountToSellBN: new BN(position.amountRaw.toString()),
            originalSolSpent: position.solSpent
        };
    }
    return null;
}

    async updatePositionAfterSell(chatId, mintAddress, amountSoldRaw) {
    const userChatIdStr = String(chatId);
    const userPositionMap = this.userPositions.get(userChatIdStr);
    if (!userPositionMap) {
        console.warn(`[PositionTracking-${userChatIdStr}] Cannot update sell for ${shortenAddress(mintAddress)}: user has no positions.`);
        return;
    }

    const position = userPositionMap.get(mintAddress);
    if (!position) {
        console.warn(`[PositionTracking-${userChatIdStr}] Cannot update sell for ${shortenAddress(mintAddress)}: position not found.`);
        return;
    }

    const amountSold = BigInt(amountSoldRaw);
    position.amountRaw -= amountSold;
    position.soldAmountRaw = (position.soldAmountRaw || 0n) + amountSold;
    position.sellTimestamp = Date.now();

    if (position.amountRaw <= 0n) {
        position.amountRaw = 0n; // Clamp to zero
    }
    
    userPositionMap.set(mintAddress, position);
    await this.savePositions();
}

 getUserPositions(chatId) {
        const userChatIdStr = String(chatId);
        return this.userPositions.get(userChatIdStr) || new Map();
    }

    // --- Traders Management ---
 async loadTraders(chatId = null) {
    let fullData = { user_traders: {} };
    try {
        const data = await fs.readFile(TRADERS_FILE, 'utf8');
        const parsed = JSON.parse(data);
        if (typeof parsed === 'object' && parsed !== null && parsed.user_traders) {
            fullData = parsed;
        }
    } catch (error) {
        if (error.code !== 'ENOENT') console.error(`DataManager: Error loading traders:`, error);
    }

    if (chatId) {
        // If a specific user is asking, return ONLY their traders.
        return fullData.user_traders[String(chatId)] || {};
    }
    // If no user is specified (admin call), return the ENTIRE structure.
    return fullData;
}
async saveTraders(chatId, userTradersObject) {
    if (!chatId) throw new Error("A chatId is required to save traders.");
    if (typeof userTradersObject !== 'object' || userTradersObject === null) {
        throw new Error("Attempted to save non-object as a user's traders data.");
    }

    // Load the entire syndicate structure first.
    const allData = await this.loadTraders(); // This gets { user_traders: {...} }

    // Update only the specific user's section.
    allData.user_traders[String(chatId)] = userTradersObject;

    // Save the entire updated structure back to the file.
    await fs.writeFile(TRADERS_FILE, JSON.stringify(allData, null, 2), 'utf8');
}

    async loadUsers() {
        try {
            const data = await fs.readFile(USERS_FILE, 'utf8');
            return JSON.parse(data);
        } catch (error) {
            console.error('DataManager: Error loading users.json:', error);
            return {}; // Return empty object on error
        }
    }

    async saveUsers(users) {
        try {
            await fs.writeFile(USERS_FILE, JSON.stringify(users, null, 2), 'utf8');
        } catch (error) {
            console.error('DataManager: Error saving users.json:', error);
            throw error;
        }
    }

    // --- Settings Management ---
    async loadSettings() {
        // The default structure now includes a place for user-specific settings.
        const defaultSettings = { userSettings: {} }; 
        try {
            const data = await fs.readFile(SETTINGS_FILE, 'utf8');
            const parsed = JSON.parse(data);
            
            // We now expect an object that might contain 'userSettings'.
            if (typeof parsed === 'object' && parsed !== null) {
                // Ensure the 'userSettings' key exists and is an object.
                if (typeof parsed.userSettings !== 'object' || parsed.userSettings === null) {
                    parsed.userSettings = {};
                }
                return parsed; // Return the whole structure, e.g., { userSettings: { '123': {...} } }
            } else {
                return { ...defaultSettings };
            }
        } catch (error) {
            if (error.code === 'ENOENT') return { ...defaultSettings };
            console.error(`DataManager: Error loading settings:`, error);
            return { ...defaultSettings };
        }
    }

   async saveSettings(settings) {
        try {
            // Validate the top-level structure.
            if (typeof settings !== 'object' || settings === null || typeof settings.userSettings !== 'object') {
                throw new Error("DataManager: Attempted to save invalid settings data. Must have a 'userSettings' object.");
            }
            await fs.writeFile(SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf8');
        } catch (error) {
            console.error(`DataManager: Error saving settings:`, error);
            throw error;
        }
    }

    // --- Other Data Files ---
       async loadSolAmounts() {
        try {
            const data = await fs.readFile(SOL_AMOUNTS_FILE, 'utf8');
            const parsed = JSON.parse(data);
            if (typeof parsed === 'object' && parsed !== null) {
                return parsed;
            }
        } catch (error) {
            // If file doesn't exist or is corrupt, return an empty object.
            // The logic in telegramUi will handle the default value.
        }
        return {}; // Return empty object on any failure
    }

    async saveSolAmounts(amounts) {
        try {
            if (typeof amounts !== 'object' || amounts === null) throw new Error("Invalid amounts object.");
            await fs.writeFile(SOL_AMOUNTS_FILE, JSON.stringify(amounts, null, 2), 'utf8');
        } catch (error) {
            console.error('DataManager: Error saving SOL amounts:', error);
            throw error;
        }
    }

    async loadSavedAddresses() {
        try {
            const data = await fs.readFile(SAVED_ADDRESSES_FILE, 'utf8');
            return Array.isArray(JSON.parse(data)) ? JSON.parse(data) : [];
        } catch (error) {
            if (error.code === 'ENOENT') return [];
            console.error('DataManager: Error loading saved addresses:', error);
            return [];
        }
    }

    async saveSavedAddresses(addresses) {
        try {
            if (!Array.isArray(addresses)) throw new Error("Saved addresses must be an array.");
            await fs.writeFile(SAVED_ADDRESSES_FILE, JSON.stringify(addresses, null, 2), 'utf8');
        } catch (error) {
            console.error('DataManager: Error saving saved addresses:', error);
            throw error;
        }
    }

    async loadTradeStats() {
        const defaultStats = { totalTrades: 0, successfulCopies: 0, failedCopies: 0, tradesUnder10Secs: "0.00", percentageUnder10Secs: "0.00" };
        try {
            const data = await fs.readFile(TRADE_STATS_FILE, 'utf8');
            const parsed = JSON.parse(data);
            return { ...defaultStats, ...(typeof parsed === 'object' && parsed !== null ? parsed : {}) };
        } catch (error) {
            if (error.code === 'ENOENT') return { ...defaultStats };
            console.error('DataManager: Error loading trade stats:', error);
            return { ...defaultStats };
        }
    }

    async saveTradeStats(stats) {
        try {
            if (typeof stats !== 'object' || stats === null) throw new Error("Invalid stats object.");
            await fs.writeFile(TRADE_STATS_FILE, JSON.stringify(stats, null, 2), 'utf8');
        } catch (error) {
            console.error('DataManager: Error saving trade stats:', error);
            throw error;
        }
    }

    async recordWithdrawal(data) {
        try {
            let history = [];
            try {
                history = JSON.parse(await fs.readFile(WITHDRAWAL_HISTORY_FILE, 'utf8'));
                if (!Array.isArray(history)) history = [];
            } catch (e) {
                if (e.code !== 'ENOENT') console.error("DataManager: Read withdrawal history error:", e);
            }
            history.push(data);
            if (history.length > 100) history = history.slice(-100);
            await fs.writeFile(WITHDRAWAL_HISTORY_FILE, JSON.stringify(history, null, 2), 'utf8');
        } catch (error) {
            console.error('DataManager: Error recording withdrawal:', error);
            throw error;
        }
    }

    /**
     * Resets all data by deleting the data files.
     */
    async deleteAllDataFiles() {
        console.log("DataManager: Deleting all configuration and data files...");
        const filesToDelete = [
            TRADERS_FILE, SOL_AMOUNTS_FILE, SAVED_ADDRESSES_FILE, TRADE_STATS_FILE,
            WITHDRAWAL_HISTORY_FILE, SETTINGS_FILE, POSITIONS_FILE, WALLET_FILE
        ];
        for (const file of filesToDelete) {
            try {
                await fs.unlink(file);
            } catch (e) {
                if (e.code !== 'ENOENT') console.warn(`DataManager: Could not delete ${path.basename(file)}: ${e.message}`);
            }
        }
        this.botPositions = new Map(); // Also clear in-memory data
        console.log("DataManager: All data files cleared.");
    }
    
}

// CommonJS Export
module.exports = { DataManager };