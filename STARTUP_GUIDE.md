# 🚀 ZapBot Startup Guide

## Prerequisites

### 1. Install Dependencies
```bash
npm install
```

### 2. Environment Setup
Create a `.env` file in the root directory with the following variables:

```env
# Telegram Bot Configuration
TELEGRAM_BOT_TOKEN=your_telegram_bot_token_here
ADMIN_CHAT_ID=your_admin_chat_id_here

# Solana Network Configuration (Helius)
RPC_URL=https://mainnet.helius-rpc.com/?api-key=your_helius_api_key_here
WS_URL=wss://mainnet.helius-rpc.com/?api-key=your_helius_api_key_here

# Wallet Configuration
PUBLIC_KEY=your_wallet_public_key_here
PRIVATE_KEY=your_wallet_private_key_here

# API Keys
SHYFT_API_KEY=your_shyft_api_key_here
SOLANA_TRACKER_API_KEY=your_solana_tracker_api_key_here

# Redis Configuration (for flight data)
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=

# Jito MEV Protection (optional)
JITO_BLOCK_ENGINE_URL=https://ny.block-engine.jito.wtf
MEV_PROTECTION_ENABLED=true
USE_MOCK_JITO=false
JITO_TIP_ACCOUNT=96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5
JITO_DEFAULT_TIP_LAMPORTS=10000
JITO_MAX_TIP_LAMPORTS=1000000

# Priority Fees
PRIORITY_FEE_LOW=5000
PRIORITY_FEE_NORMAL=10000
PRIORITY_FEE_MEDIUM=50000
PRIORITY_FEE_HIGH=250000
PRIORITY_FEE_ULTRA=1000000

# Bot Operation Mode
FORCE_POLLING_MODE=false

# Pump.fun API Endpoints
PUMP_FUN_API_ENDPOINTS=https://client-api-2-74b1891ee9f9.herokuapp.com/coins/,https://api.pump.fun/coins/
```

### 3. Install Redis (for flight data)
```bash
# Ubuntu/Debian
sudo apt update
sudo apt install redis-server

# macOS
brew install redis

# Start Redis
sudo systemctl start redis-server  # Linux
brew services start redis          # macOS
```

## 🚀 Starting the Bot

### Option 1: New Architecture (Recommended)
```bash
# Start with database and Redis
npm start

# Development mode with auto-restart
npm run dev
```

### Option 2: Legacy Mode
```bash
# Start legacy version (JSON files only)
npm run start:legacy

# Development mode
npm run dev:legacy
```

### Option 3: Threaded Mode (Future)
```bash
# Start threaded version
npm run start:threaded

# Development mode
npm run dev:threaded
```

## 🔍 Health Check

Once running, check the bot's health:
```bash
curl http://localhost:3001/health
```

Expected response:
```json
{
  "status": "healthy",
  "timestamp": "2024-01-01T00:00:00.000Z",
  "services": {
    "database": "healthy",
    "redis": "healthy"
  }
}
```

## 📊 Monitoring

### Logs
- Application logs: `zapbot.log`
- Live logs: `live_logs.txt`
- Trace logs: `logs/traces/`

### Database
- SQLite database: `database/zapbot.db`
- Schema: `database/schema.sql`

### Redis
- Flight data with TTL
- Real-time positions
- Transaction cache
- Trade queue

## 🛠️ Troubleshooting

### Common Issues

1. **Redis Connection Failed**
   ```bash
   # Check if Redis is running
   redis-cli ping
   # Should return: PONG
   ```

2. **Database Permission Error**
   ```bash
   # Ensure write permissions
   chmod 755 database/
   ```

3. **Helius API Key Invalid**
   - Verify your Helius API key
   - Check rate limits
   - Ensure mainnet access

4. **Telegram Bot Token Invalid**
   - Verify bot token with @BotFather
   - Check bot permissions

### Debug Mode
```bash
# Enable debug logging
DEBUG=* npm start
```

## 🔧 Configuration

### Helius RPC Settings
- **Premium Plan**: 1000 requests/second
- **Enhanced APIs**: Enhanced Transaction Parsing, Token Metadata
- **WebSocket**: Real-time transaction monitoring

### Performance Tuning
- **Database**: SQLite with WAL mode
- **Redis**: 512MB memory limit
- **TTL**: 15-30 minutes for flight data
- **Concurrency**: 10 concurrent trades max

## 📈 Performance Metrics

### Expected Performance
- **30-40 tokens/second** processing
- **2 trades/user/second** execution
- **<10 second** copy trade latency
- **99.9%** uptime with Helius

### Monitoring Commands
```bash
# Check Redis memory usage
redis-cli info memory

# Check database size
ls -lh database/zapbot.db

# Monitor application logs
tail -f zapbot.log
```

## 🚨 Emergency Procedures

### Graceful Shutdown
```bash
# Send SIGTERM
pkill -TERM -f "node start.js"

# Or use Ctrl+C in terminal
```

### Force Restart
```bash
# Kill all Node processes
pkill -f "node"

# Restart
npm start
```

### Data Backup
```bash
# Backup database
cp database/zapbot.db database/zapbot.db.backup

# Backup Redis (if needed)
redis-cli BGSAVE
```

## 🎯 Next Steps

1. **Test with small amounts** first
2. **Monitor logs** for any errors
3. **Verify trader monitoring** is working
4. **Check copy trade execution** speed
5. **Scale up** gradually

## 📞 Support

- **Logs**: Check `zapbot.log` for detailed error messages
- **Health**: Use `/health` endpoint for system status
- **Metrics**: Monitor Redis and database performance
