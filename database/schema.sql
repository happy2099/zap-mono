-- ZapBot Database Schema (SQLite)
-- Lightweight schema for 2 users, 4 traders max

-- Users table
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id TEXT UNIQUE NOT NULL,
    username TEXT,
    settings TEXT DEFAULT '{}',
    sol_amount REAL DEFAULT 0.001,
    is_admin BOOLEAN DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Wallets table (separate from users to avoid confusion)
CREATE TABLE IF NOT EXISTS wallets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    label TEXT NOT NULL,
    address TEXT NOT NULL,
    private_key TEXT,
    wallet_type TEXT DEFAULT 'trading', -- 'trading', 'funding', etc.
    is_primary BOOLEAN DEFAULT 0,
    balance REAL DEFAULT 0.0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id),
    UNIQUE(user_id, label)
);

-- Traders table
CREATE TABLE IF NOT EXISTS traders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    wallet TEXT NOT NULL,
    active BOOLEAN DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id),
    UNIQUE(user_id, wallet)
);

-- Trade history (for audit trail)
CREATE TABLE IF NOT EXISTS trades (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    trader_id INTEGER,
    signature TEXT UNIQUE NOT NULL,
    platform TEXT NOT NULL,
    token_mint TEXT NOT NULL,
    amount_raw TEXT NOT NULL,
    sol_spent REAL NOT NULL,
    status TEXT DEFAULT 'pending',
    executed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (trader_id) REFERENCES traders(id)
);

-- Trade statistics
CREATE TABLE IF NOT EXISTS trade_stats (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    total_trades INTEGER DEFAULT 0,
    successful_copies INTEGER DEFAULT 0,
    failed_copies INTEGER DEFAULT 0,
    trades_under_10secs INTEGER DEFAULT 0,
    percentage_under_10secs REAL DEFAULT 0.0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id),
    UNIQUE(user_id)
);

-- Withdrawal history
CREATE TABLE IF NOT EXISTS withdrawals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    amount REAL NOT NULL,
    signature TEXT,
    status TEXT DEFAULT 'pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
);

-- User positions (token holdings)
CREATE TABLE IF NOT EXISTS positions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    token_mint TEXT NOT NULL,
    amount_raw TEXT NOT NULL,
    sol_spent REAL NOT NULL,
    sold_amount_raw TEXT DEFAULT '0',
    buy_timestamp BIGINT,
    sell_timestamp BIGINT,
    status TEXT DEFAULT 'active',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id),
    UNIQUE(user_id, token_mint)
);

-- Saved addresses
CREATE TABLE IF NOT EXISTS saved_addresses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    label TEXT NOT NULL,
    address TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id),
    UNIQUE(user_id, label)
);

-- Processed pools (to avoid reprocessing)
CREATE TABLE IF NOT EXISTS processed_pools (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pool_address TEXT UNIQUE NOT NULL,
    processed_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_traders_user_wallet ON traders(user_id, wallet);
CREATE INDEX IF NOT EXISTS idx_trades_user_time ON trades(user_id, executed_at);
CREATE INDEX IF NOT EXISTS idx_trades_signature ON trades(signature);
CREATE INDEX IF NOT EXISTS idx_trades_status ON trades(status);
CREATE INDEX IF NOT EXISTS idx_positions_user_token ON positions(user_id, token_mint);
CREATE INDEX IF NOT EXISTS idx_positions_status ON positions(status);
CREATE INDEX IF NOT EXISTS idx_saved_addresses_user ON saved_addresses(user_id);
CREATE INDEX IF NOT EXISTS idx_processed_pools_address ON processed_pools(pool_address);
CREATE INDEX IF NOT EXISTS idx_users_admin ON users(is_admin);
CREATE INDEX IF NOT EXISTS idx_users_chat_id ON users(chat_id);
CREATE INDEX IF NOT EXISTS idx_wallets_user_id ON wallets(user_id);
CREATE INDEX IF NOT EXISTS idx_wallets_primary ON wallets(user_id, is_primary);
CREATE INDEX IF NOT EXISTS idx_wallets_label ON wallets(user_id, label);
