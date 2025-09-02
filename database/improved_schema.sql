-- ==========================================
-- IMPROVED ZapBot Database Schema
-- ==========================================
-- Normalized schema with proper table separation

-- Users table (simplified)
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id TEXT UNIQUE NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- User wallets table (separate from settings)
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
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE(user_id, public_key)
);

-- User trading settings table
CREATE TABLE IF NOT EXISTS user_trading_settings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    sol_amount REAL DEFAULT 0.1,
    max_trades_per_day INTEGER DEFAULT 10,
    risk_level TEXT DEFAULT 'medium',
    auto_stop_loss REAL DEFAULT 0.0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE(user_id)
);

-- User positions table (for P&L tracking)
CREATE TABLE IF NOT EXISTS user_positions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    token_mint TEXT NOT NULL,
    token_symbol TEXT,
    amount_raw TEXT NOT NULL,
    sol_spent REAL NOT NULL,
    current_value REAL DEFAULT 0.0,
    entry_price REAL,
    current_price REAL DEFAULT 0.0,
    pnl REAL DEFAULT 0.0,
    is_active BOOLEAN DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE(user_id, token_mint)
);

-- Traders table (unchanged - this is good)
CREATE TABLE IF NOT EXISTS traders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    wallet TEXT NOT NULL,
    active BOOLEAN DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE(user_id, wallet)
);

-- Trade history (unchanged - this is good)
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
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (trader_id) REFERENCES traders(id) ON DELETE SET NULL
);

-- Trade statistics (unchanged - this is good)
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
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE(user_id)
);

-- Withdrawal history (unchanged - this is good)
CREATE TABLE IF NOT EXISTS withdrawals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    amount REAL NOT NULL,
    signature TEXT,
    status TEXT DEFAULT 'pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- ==========================================
-- PERFORMANCE INDEXES
-- ==========================================

-- User indexes
CREATE INDEX IF NOT EXISTS idx_users_chat_id ON users(chat_id);

-- Wallet indexes
CREATE INDEX IF NOT EXISTS idx_user_wallets_user_id ON user_wallets(user_id);
CREATE INDEX IF NOT EXISTS idx_user_wallets_primary ON user_wallets(user_id, is_primary);
CREATE INDEX IF NOT EXISTS idx_user_wallets_public_key ON user_wallets(public_key);

-- Trading settings indexes
CREATE INDEX IF NOT EXISTS idx_user_trading_settings_user_id ON user_trading_settings(user_id);

-- Position indexes
CREATE INDEX IF NOT EXISTS idx_user_positions_user_id ON user_positions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_positions_active ON user_positions(user_id, is_active);
CREATE INDEX IF NOT EXISTS idx_user_positions_token ON user_positions(token_mint);

-- Trader indexes
CREATE INDEX IF NOT EXISTS idx_traders_user_wallet ON traders(user_id, wallet);
CREATE INDEX IF NOT EXISTS idx_traders_active ON traders(user_id, active);

-- Trade indexes
CREATE INDEX IF NOT EXISTS idx_trades_user_time ON trades(user_id, executed_at);
CREATE INDEX IF NOT EXISTS idx_trades_signature ON trades(signature);
CREATE INDEX IF NOT EXISTS idx_trades_status ON trades(status);
CREATE INDEX IF NOT EXISTS idx_trades_token ON trades(token_mint);

-- ==========================================
-- VIEWS FOR COMMON QUERIES
-- ==========================================

-- User summary view
CREATE VIEW IF NOT EXISTS user_summary AS
SELECT 
    u.id,
    u.chat_id,
    uts.sol_amount,
    uw.label as primary_wallet_label,
    uw.public_key as primary_wallet_address,
    COUNT(t.id) as trader_count,
    COUNT(CASE WHEN t.active = 1 THEN 1 END) as active_traders,
    COALESCE(SUM(up.current_value), 0) as total_portfolio_value,
    COALESCE(SUM(up.pnl), 0) as total_pnl
FROM users u
LEFT JOIN user_trading_settings uts ON u.id = uts.user_id
LEFT JOIN user_wallets uw ON u.id = uw.user_id AND uw.is_primary = 1
LEFT JOIN traders t ON u.id = t.user_id
LEFT JOIN user_positions up ON u.id = up.user_id AND up.is_active = 1
GROUP BY u.id, u.chat_id, uts.sol_amount, uw.label, uw.public_key;

-- Active positions view
CREATE VIEW IF NOT EXISTS active_positions AS
SELECT 
    u.chat_id,
    up.token_mint,
    up.token_symbol,
    up.amount_raw,
    up.sol_spent,
    up.current_value,
    up.pnl,
    up.entry_price,
    up.current_price
FROM users u
JOIN user_positions up ON u.id = up.user_id
WHERE up.is_active = 1;
