-- ZapBot Database Schema (SQLite)
-- Lightweight schema for 2 users, 4 traders max

-- Users table
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id INTEGER UNIQUE NOT NULL,
    first_name TEXT,
    last_name TEXT,
    telegram_username TEXT,
    is_active BOOLEAN DEFAULT 1,
    is_admin BOOLEAN DEFAULT 0,
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

-- User positions (for tracking token holdings)
CREATE TABLE IF NOT EXISTS user_positions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    token_mint TEXT NOT NULL,
    amount_raw TEXT NOT NULL,
    sol_spent REAL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id),
    UNIQUE(user_id, token_mint)
);

-- User wallets table
CREATE TABLE IF NOT EXISTS user_wallets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    label TEXT NOT NULL,
    public_key TEXT NOT NULL,
    private_key_encrypted TEXT,
    is_primary BOOLEAN DEFAULT 0,
    balance REAL DEFAULT 0.0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id),
    UNIQUE(user_id, public_key)
);

-- User trading settings
CREATE TABLE IF NOT EXISTS user_trading_settings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    sol_amount_per_trade REAL DEFAULT 0.01,
    primary_wallet_label TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id),
    UNIQUE(user_id)
);

-- Blackbox logging table for debugging and monitoring
CREATE TABLE IF NOT EXISTS blackbox_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    component TEXT NOT NULL,
    level TEXT NOT NULL DEFAULT 'INFO',
    message TEXT NOT NULL,
    data TEXT, -- JSON data for additional context
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_traders_user_wallet ON traders(user_id, wallet);
CREATE INDEX IF NOT EXISTS idx_trades_user_time ON trades(user_id, executed_at);
CREATE INDEX IF NOT EXISTS idx_trades_signature ON trades(signature);
CREATE INDEX IF NOT EXISTS idx_trades_status ON trades(status);
CREATE INDEX IF NOT EXISTS idx_user_positions_user_token ON user_positions(user_id, token_mint);
CREATE INDEX IF NOT EXISTS idx_user_trading_settings_user ON user_trading_settings(user_id);
CREATE INDEX IF NOT EXISTS idx_user_wallets_user ON user_wallets(user_id);

-- Blackbox logging indexes
CREATE INDEX IF NOT EXISTS idx_blackbox_component_time ON blackbox_logs(component, timestamp);
CREATE INDEX IF NOT EXISTS idx_blackbox_level_time ON blackbox_logs(level, timestamp);
