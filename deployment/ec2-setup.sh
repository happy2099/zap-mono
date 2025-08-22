#!/bin/bash
# ==========================================
# ========== ZapBot EC2 Setup Script ==========
# ==========================================
# File: deployment/ec2-setup.sh
# Description: Automated EC2 setup for ZapBot with SQLite and Redis

set -e

echo "🚀 Starting ZapBot EC2 Setup..."

# Configuration
APP_NAME="zapbot"
APP_USER="zapbot"
APP_DIR="/opt/zapbot"
LOG_DIR="/var/log/zapbot"
DATA_DIR="/opt/zapbot/data"
REDIS_PORT=6379
NODE_VERSION="18.x"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Update system
print_status "Updating system packages..."
sudo apt-get update
sudo apt-get upgrade -y

# Install essential packages
print_status "Installing essential packages..."
sudo apt-get install -y curl wget git build-essential software-properties-common

# Install Node.js
print_status "Installing Node.js $NODE_VERSION..."
curl -fsSL https://deb.nodesource.com/setup_$NODE_VERSION | sudo -E bash -
sudo apt-get install -y nodejs

# Verify Node.js installation
NODE_VERSION_INSTALLED=$(node --version)
print_status "Node.js installed: $NODE_VERSION_INSTALLED"

# Install Redis
print_status "Installing Redis..."
sudo apt-get install -y redis-server

# Configure Redis
print_status "Configuring Redis..."
sudo cp /etc/redis/redis.conf /etc/redis/redis.conf.backup

# Update Redis configuration for better performance
sudo tee -a /etc/redis/redis.conf > /dev/null <<EOF

# ZapBot Redis Configuration
maxmemory 512mb
maxmemory-policy allkeys-lru
save 900 1
save 300 10
save 60 10000
tcp-keepalive 300
timeout 0
tcp-backlog 511
EOF

# Start and enable Redis
sudo systemctl enable redis-server
sudo systemctl restart redis-server

# Verify Redis is running
if sudo systemctl is-active --quiet redis-server; then
    print_status "Redis is running successfully"
else
    print_error "Redis failed to start"
    exit 1
fi

# Create application user
print_status "Creating application user..."
sudo useradd -r -s /bin/false -d $APP_DIR $APP_USER || true

# Create directories
print_status "Creating application directories..."
sudo mkdir -p $APP_DIR $LOG_DIR $DATA_DIR
sudo chown -R $APP_USER:$APP_USER $APP_DIR $LOG_DIR $DATA_DIR

# Install PM2 globally
print_status "Installing PM2..."
sudo npm install -g pm2

# Create PM2 ecosystem file
print_status "Creating PM2 ecosystem configuration..."
sudo tee $APP_DIR/ecosystem.config.js > /dev/null <<EOF
module.exports = {
  apps: [{
    name: 'zapbot',
    script: 'zapbot.js',
    cwd: '$APP_DIR',
    instances: 1,
    exec_mode: 'cluster',
    env: {
      NODE_ENV: 'production',
      THREADING_ENABLED: 'true',
      REDIS_HOST: 'localhost',
      REDIS_PORT: $REDIS_PORT,
      DATA_DIR: '$DATA_DIR',
      LOGS_DIR: '$LOG_DIR'
    },
    // Process management
    max_memory_restart: '1G',
    min_uptime: '10s',
    max_restarts: 10,
    restart_delay: 4000,
    
    // Logging
    log_file: '$LOG_DIR/combined.log',
    out_file: '$LOG_DIR/out.log',
    error_file: '$LOG_DIR/error.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    
    // Performance
    node_args: '--max-old-space-size=1024',
    
    // Security
    uid: '$APP_USER',
    gid: '$APP_USER'
  }]
};
EOF

# Create systemd service for PM2
print_status "Creating systemd service for PM2..."
sudo tee /etc/systemd/system/pm2-$APP_USER.service > /dev/null <<EOF
[Unit]
Description=PM2 process manager
Documentation=https://pm2.keymetrics.io/
After=network.target

[Service]
Type=forking
User=$APP_USER
WorkingDirectory=$APP_DIR
PIDFile=$APP_DIR/.pm2/pm2.pid
Restart=on-failure

ExecStart=/usr/bin/pm2 resurrect
ExecReload=/usr/bin/pm2 reload all
ExecStop=/usr/bin/pm2 kill

[Install]
WantedBy=multi-user.target
EOF

# Enable and start PM2 service
sudo systemctl enable pm2-$APP_USER
sudo systemctl start pm2-$APP_USER

# Create logrotate configuration
print_status "Setting up log rotation..."
sudo tee /etc/logrotate.d/zapbot > /dev/null <<EOF
$LOG_DIR/*.log {
    daily
    missingok
    rotate 7
    compress
    delaycompress
    notifempty
    create 644 $APP_USER $APP_USER
    postrotate
        systemctl reload pm2-$APP_USER
    endscript
}
EOF

# Create firewall rules (if UFW is enabled)
if command -v ufw &> /dev/null; then
    print_status "Configuring firewall..."
    sudo ufw allow ssh
    sudo ufw allow 3000/tcp  # If you have a web interface
    sudo ufw --force enable
fi

# Create monitoring script
print_status "Creating monitoring script..."
sudo tee $APP_DIR/monitor.sh > /dev/null <<EOF
#!/bin/bash
# ZapBot Monitoring Script

LOG_FILE="$LOG_DIR/monitor.log"
DATE=\$(date '+%Y-%m-%d %H:%M:%S')

# Check if ZapBot is running
if pm2 list | grep -q "zapbot.*online"; then
    echo "\$DATE - ZapBot is running" >> \$LOG_FILE
else
    echo "\$DATE - ZapBot is down, restarting..." >> \$LOG_FILE
    pm2 restart zapbot
fi

# Check Redis
if systemctl is-active --quiet redis-server; then
    echo "\$DATE - Redis is running" >> \$LOG_FILE
else
    echo "\$DATE - Redis is down, restarting..." >> \$LOG_FILE
    sudo systemctl restart redis-server
fi

# Check disk space
DISK_USAGE=\$(df / | awk 'NR==2 {print \$5}' | sed 's/%//')
if [ \$DISK_USAGE -gt 80 ]; then
    echo "\$DATE - WARNING: Disk usage is \$DISK_USAGE%" >> \$LOG_FILE
fi

# Check memory usage
MEM_USAGE=\$(free | awk 'NR==2{printf "%.0f", \$3*100/\$2}')
if [ \$MEM_USAGE -gt 80 ]; then
    echo "\$DATE - WARNING: Memory usage is \$MEM_USAGE%" >> \$LOG_FILE
fi
EOF

sudo chmod +x $APP_DIR/monitor.sh
sudo chown $APP_USER:$APP_USER $APP_DIR/monitor.sh

# Add monitoring to crontab
print_status "Setting up monitoring cron job..."
(crontab -l 2>/dev/null; echo "*/5 * * * * $APP_DIR/monitor.sh") | crontab -

# Create backup script
print_status "Creating backup script..."
sudo tee $APP_DIR/backup.sh > /dev/null <<EOF
#!/bin/bash
# ZapBot Backup Script

BACKUP_DIR="/opt/backups/zapbot"
DATE=\$(date +%Y%m%d_%H%M%S)

# Create backup directory
mkdir -p \$BACKUP_DIR

# Backup database
cp $DATA_DIR/zapbot.db \$BACKUP_DIR/zapbot_\$DATE.db

# Backup logs (last 7 days)
find $LOG_DIR -name "*.log" -mtime -7 -exec cp {} \$BACKUP_DIR/ \;

# Compress backup
tar -czf \$BACKUP_DIR/zapbot_backup_\$DATE.tar.gz -C \$BACKUP_DIR .

# Clean old backups (keep last 7 days)
find \$BACKUP_DIR -name "*.tar.gz" -mtime +7 -delete

echo "Backup completed: \$BACKUP_DIR/zapbot_backup_\$DATE.tar.gz"
EOF

sudo chmod +x $APP_DIR/backup.sh
sudo chown $APP_USER:$APP_USER $APP_DIR/backup.sh

# Add backup to crontab (daily at 2 AM)
(crontab -l 2>/dev/null; echo "0 2 * * * $APP_DIR/backup.sh") | crontab -

# Create health check endpoint
print_status "Creating health check script..."
sudo tee $APP_DIR/health-check.js > /dev/null <<EOF
const http = require('http');

const server = http.createServer((req, res) => {
    if (req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            status: 'healthy',
            timestamp: new Date().toISOString(),
            uptime: process.uptime()
        }));
    } else {
        res.writeHead(404);
        res.end('Not Found');
    }
});

server.listen(3001, () => {
    console.log('Health check server running on port 3001');
});
EOF

# Create deployment script
print_status "Creating deployment script..."
sudo tee $APP_DIR/deploy.sh > /dev/null <<EOF
#!/bin/bash
# ZapBot Deployment Script

set -e

echo "🚀 Starting ZapBot deployment..."

# Pull latest code
git pull origin main

# Install dependencies
npm ci --production

# Run database migrations
node database/migrate.js

# Restart application
pm2 reload ecosystem.config.js

# Health check
sleep 10
if curl -f http://localhost:3001/health; then
    echo "✅ Deployment completed successfully!"
else
    echo "❌ Health check failed!"
    exit 1
fi
EOF

sudo chmod +x $APP_DIR/deploy.sh
sudo chown $APP_USER:$APP_USER $APP_DIR/deploy.sh

# Set up environment variables
print_status "Setting up environment variables..."
sudo tee $APP_DIR/.env > /dev/null <<EOF
# ZapBot Environment Configuration
NODE_ENV=production
THREADING_ENABLED=true

# Database
DATA_DIR=$DATA_DIR
LOGS_DIR=$LOG_DIR

# Redis
REDIS_HOST=localhost
REDIS_PORT=$REDIS_PORT

# Solana
RPC_URL=https://mainnet.helius-rpc.com/?api-key=YOUR_API_KEY
WS_URL=wss://mainnet.helius-rpc.com/?api-key=YOUR_API_KEY

# Telegram
TELEGRAM_BOT_TOKEN=YOUR_BOT_TOKEN
ADMIN_CHAT_ID=YOUR_ADMIN_CHAT_ID

# Performance
MAX_WORKER_MEMORY=1GB
WORKER_RESTART_DELAY=5000
MAX_CONCURRENT_TRADES=50
MAX_QUEUE_SIZE=1000
HEARTBEAT_INTERVAL=30000
EOF

sudo chown $APP_USER:$APP_USER $APP_DIR/.env

# Final setup
print_status "Finalizing setup..."

# Set proper permissions
sudo chown -R $APP_USER:$APP_USER $APP_DIR
sudo chmod -R 755 $APP_DIR

# Create symbolic link for easy access
sudo ln -sf $APP_DIR /home/ubuntu/zapbot

print_status "EC2 setup completed successfully!"
print_status "Next steps:"
echo "1. Clone your ZapBot repository to $APP_DIR"
echo "2. Update the .env file with your API keys"
echo "3. Run: cd $APP_DIR && npm install"
echo "4. Run: pm2 start ecosystem.config.js"
echo "5. Monitor with: pm2 monit"

print_status "Useful commands:"
echo "- View logs: pm2 logs zapbot"
echo "- Monitor: pm2 monit"
echo "- Restart: pm2 restart zapbot"
echo "- Status: pm2 status"
echo "- Health check: curl http://localhost:3001/health"

print_status "Setup completed! 🎉"
