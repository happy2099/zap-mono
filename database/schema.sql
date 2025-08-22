-- ZapBot Database Schema (SQLite)
-- Lightweight schema for 2 users, 4 traders max

-- Users table
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id TEXT UNIQUE NOT NULL,
    settings TEXT DEFAULT '{}',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
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

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_traders_user_wallet ON traders(user_id, wallet);
CREATE INDEX IF NOT EXISTS idx_trades_user_time ON trades(user_id, executed_at);
CREATE INDEX IF NOT EXISTS idx_trades_signature ON trades(signature);
CREATE INDEX IF NOT EXISTS idx_trades_status ON trades(status);
