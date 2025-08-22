# 🚀 ZapBot Threading Deployment & Monitoring Guide

## 📋 Deployment Overview

This document provides comprehensive guidance for deploying and monitoring the threaded version of ZapBot in production environments, including configuration, monitoring, and troubleshooting.

## 🎯 Deployment Objectives

- **Zero Downtime**: Seamless deployment with no service interruption
- **Performance Monitoring**: Real-time performance tracking and alerting
- **Scalability**: Easy scaling based on load requirements
- **Reliability**: Robust error handling and recovery mechanisms
- **Security**: Secure deployment with proper access controls

## 🏗️ Deployment Architecture

### Production Environment Setup
```
Production Server
├── Load Balancer (Nginx/HAProxy)
├── Application Layer
│   ├── Main Thread (Orchestrator)
│   ├── Worker Threads (7 workers)
│   └── Process Manager (PM2)
├── Monitoring Layer
│   ├── Metrics Collection (Prometheus)
│   ├── Logging (ELK Stack)
│   └── Alerting (Grafana)
└── Infrastructure
    ├── Database (PostgreSQL/Redis)
    ├── File Storage (S3/FS)
    └── Backup Systems
```

### Deployment Components
1. **Application Server**: Node.js with Worker Threads
2. **Process Manager**: PM2 for process management
3. **Load Balancer**: Nginx for request distribution
4. **Monitoring**: Prometheus + Grafana
5. **Logging**: ELK Stack (Elasticsearch, Logstash, Kibana)
6. **Database**: PostgreSQL for persistent data
7. **Cache**: Redis for high-frequency data

## 🔧 Deployment Configuration

### Environment Configuration
```bash
# .env.production
# Application
NODE_ENV=production
THREADING_ENABLED=true
PORT=3000

# Threading Configuration
MAX_WORKER_MEMORY=1GB
WORKER_RESTART_DELAY=5000
MAX_CONCURRENT_TRADES=50
MAX_QUEUE_SIZE=1000
HEARTBEAT_INTERVAL=30000

# Performance Tuning
TASK_TIMEOUT=30000
MAX_RETRIES=3
LOAD_BALANCING_ENABLED=true

# Shared Memory
SHARED_MEMORY_ENABLED=true
SHARED_BUFFER_SIZE=1048576
SHARED_BUFFER_COUNT=10

# Solana Configuration
RPC_URL=https://mainnet.helius-rpc.com/?api-key=YOUR_API_KEY
WS_URL=wss://mainnet.helius-rpc.com/?api-key=YOUR_API_KEY
SOLANA_TRACKER_API_KEY=YOUR_SOLANA_TRACKER_KEY

# Telegram Configuration
TELEGRAM_BOT_TOKEN=YOUR_BOT_TOKEN
ADMIN_CHAT_ID=YOUR_ADMIN_CHAT_ID

# Database Configuration
DATABASE_URL=postgresql://user:password@localhost:5432/zapbot
REDIS_URL=redis://localhost:6379

# Monitoring
PROMETHEUS_PORT=9090
GRAFANA_PORT=3001
ELASTICSEARCH_URL=http://localhost:9200
```

### PM2 Configuration
```javascript
// ecosystem.config.js
module.exports = {
  apps: [{
    name: 'zapbot-threaded',
    script: 'zapbot.js',
    instances: 1,
    exec_mode: 'cluster',
    env: {
      NODE_ENV: 'production',
      THREADING_ENABLED: 'true'
    },
    env_production: {
      NODE_ENV: 'production',
      THREADING_ENABLED: 'true'
    },
    // Process management
    max_memory_restart: '2G',
    min_uptime: '10s',
    max_restarts: 10,
    restart_delay: 4000,
    
    // Logging
    log_file: './logs/combined.log',
    out_file: './logs/out.log',
    error_file: './logs/error.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    
    // Monitoring
    pmx: true,
    monitoring: true,
    
    // Performance
    node_args: '--max-old-space-size=2048',
    
    // Security
    uid: 'zapbot',
    gid: 'zapbot'
  }],
  
  deploy: {
    production: {
      user: 'zapbot',
      host: 'your-server.com',
      ref: 'origin/main',
      repo: 'git@github.com:your-username/zapbot.git',
      path: '/var/www/zapbot',
      'pre-deploy-local': '',
      'post-deploy': 'npm install && pm2 reload ecosystem.config.js --env production',
      'pre-setup': ''
    }
  }
};
```

### Nginx Configuration
```nginx
# /etc/nginx/sites-available/zapbot
upstream zapbot_backend {
    server 127.0.0.1:3000;
    keepalive 32;
}

server {
    listen 80;
    server_name your-domain.com;
    
    # Redirect to HTTPS
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name your-domain.com;
    
    # SSL Configuration
    ssl_certificate /etc/letsencrypt/live/your-domain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/your-domain.com/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-RSA-AES256-GCM-SHA512:DHE-RSA-AES256-GCM-SHA512:ECDHE-RSA-AES256-GCM-SHA384:DHE-RSA-AES256-GCM-SHA384;
    ssl_prefer_server_ciphers off;
    
    # Security Headers
    add_header X-Frame-Options DENY;
    add_header X-Content-Type-Options nosniff;
    add_header X-XSS-Protection "1; mode=block";
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    
    # Rate Limiting
    limit_req_zone $binary_remote_addr zone=api:10m rate=10r/s;
    limit_req zone=api burst=20 nodelay;
    
    # Main Application
    location / {
        proxy_pass http://zapbot_backend;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 86400;
    }
    
    # Health Check
    location /health {
        access_log off;
        return 200 "healthy\n";
        add_header Content-Type text/plain;
    }
    
    # Metrics Endpoint
    location /metrics {
        proxy_pass http://zapbot_backend;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
    
    # Static Files
    location /static/ {
        alias /var/www/zapbot/static/;
        expires 1y;
        add_header Cache-Control "public, immutable";
    }
}
```

## 📊 Monitoring Setup

### Prometheus Configuration
```yaml
# /etc/prometheus/prometheus.yml
global:
  scrape_interval: 15s
  evaluation_interval: 15s

rule_files:
  - "zapbot_rules.yml"

scrape_configs:
  - job_name: 'zapbot'
    static_configs:
      - targets: ['localhost:3000']
    metrics_path: '/metrics'
    scrape_interval: 5s
    
  - job_name: 'node-exporter'
    static_configs:
      - targets: ['localhost:9100']
        
  - job_name: 'postgres-exporter'
    static_configs:
      - targets: ['localhost:9187']
        
  - job_name: 'redis-exporter'
    static_configs:
      - targets: ['localhost:9121']

alerting:
  alertmanagers:
    - static_configs:
        - targets:
          - localhost:9093
```

### Prometheus Rules
```yaml
# /etc/prometheus/zapbot_rules.yml
groups:
  - name: zapbot
    rules:
      # High CPU Usage
      - alert: HighCPUUsage
        expr: rate(process_cpu_seconds_total[5m]) * 100 > 80
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "High CPU usage detected"
          description: "CPU usage is above 80% for 5 minutes"
          
      # High Memory Usage
      - alert: HighMemoryUsage
        expr: (process_resident_memory_bytes / container_memory_usage_bytes) * 100 > 85
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "High memory usage detected"
          description: "Memory usage is above 85% for 5 minutes"
          
      # Worker Thread Down
      - alert: WorkerThreadDown
        expr: zapbot_worker_status == 0
        for: 1m
        labels:
          severity: critical
        annotations:
          summary: "Worker thread is down"
          description: "A worker thread has stopped responding"
          
      # High Error Rate
      - alert: HighErrorRate
        expr: rate(zapbot_errors_total[5m]) > 0.1
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "High error rate detected"
          description: "Error rate is above 0.1 errors per second"
          
      # Low Throughput
      - alert: LowThroughput
        expr: rate(zapbot_trades_processed_total[5m]) < 1
        for: 10m
        labels:
          severity: warning
        annotations:
          summary: "Low trade throughput detected"
          description: "Trade processing rate is below 1 per second"
```

### Grafana Dashboard
```json
{
  "dashboard": {
    "title": "ZapBot Threading Dashboard",
    "panels": [
      {
        "title": "Worker Thread Status",
        "type": "stat",
        "targets": [
          {
            "expr": "zapbot_worker_status",
            "legendFormat": "{{worker_name}}"
          }
        ]
      },
      {
        "title": "Trade Processing Rate",
        "type": "graph",
        "targets": [
          {
            "expr": "rate(zapbot_trades_processed_total[5m])",
            "legendFormat": "Trades/sec"
          }
        ]
      },
      {
        "title": "Memory Usage by Worker",
        "type": "graph",
        "targets": [
          {
            "expr": "zapbot_worker_memory_bytes",
            "legendFormat": "{{worker_name}}"
          }
        ]
      },
      {
        "title": "Error Rate",
        "type": "graph",
        "targets": [
          {
            "expr": "rate(zapbot_errors_total[5m])",
            "legendFormat": "Errors/sec"
          }
        ]
      },
      {
        "title": "Message Queue Depth",
        "type": "graph",
        "targets": [
          {
            "expr": "zapbot_queue_depth",
            "legendFormat": "{{queue_name}}"
          }
        ]
      }
    ]
  }
}
```

## 📈 Performance Monitoring

### Custom Metrics
```javascript
// monitoring/metrics.js
const prometheus = require('prom-client');

class MetricsCollector {
    constructor() {
        this.registry = new prometheus.Registry();
        
        // Worker status metrics
        this.workerStatus = new prometheus.Gauge({
            name: 'zapbot_worker_status',
            help: 'Worker thread status (1 = running, 0 = stopped)',
            labelNames: ['worker_name']
        });
        
        // Trade processing metrics
        this.tradesProcessed = new prometheus.Counter({
            name: 'zapbot_trades_processed_total',
            help: 'Total number of trades processed',
            labelNames: ['worker_name', 'status']
        });
        
        // Error metrics
        this.errors = new prometheus.Counter({
            name: 'zapbot_errors_total',
            help: 'Total number of errors',
            labelNames: ['worker_name', 'error_type']
        });
        
        // Queue depth metrics
        this.queueDepth = new prometheus.Gauge({
            name: 'zapbot_queue_depth',
            help: 'Current queue depth',
            labelNames: ['queue_name']
        });
        
        // Memory usage metrics
        this.workerMemory = new prometheus.Gauge({
            name: 'zapbot_worker_memory_bytes',
            help: 'Memory usage per worker',
            labelNames: ['worker_name']
        });
        
        // Latency metrics
        this.messageLatency = new prometheus.Histogram({
            name: 'zapbot_message_latency_seconds',
            help: 'Message passing latency',
            labelNames: ['message_type'],
            buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1]
        });
        
        // Register metrics
        this.registry.registerMetric(this.workerStatus);
        this.registry.registerMetric(this.tradesProcessed);
        this.registry.registerMetric(this.errors);
        this.registry.registerMetric(this.queueDepth);
        this.registry.registerMetric(this.workerMemory);
        this.registry.registerMetric(this.messageLatency);
    }
    
    recordWorkerStatus(workerName, status) {
        this.workerStatus.set({ worker_name: workerName }, status);
    }
    
    recordTradeProcessed(workerName, status) {
        this.tradesProcessed.inc({ worker_name: workerName, status: status });
    }
    
    recordError(workerName, errorType) {
        this.errors.inc({ worker_name: workerName, error_type: errorType });
    }
    
    recordQueueDepth(queueName, depth) {
        this.queueDepth.set({ queue_name: queueName }, depth);
    }
    
    recordWorkerMemory(workerName, memoryBytes) {
        this.workerMemory.set({ worker_name: workerName }, memoryBytes);
    }
    
    recordMessageLatency(messageType, latencySeconds) {
        this.messageLatency.observe({ message_type: messageType }, latencySeconds);
    }
    
    async getMetrics() {
        return await this.registry.metrics();
    }
}

module.exports = MetricsCollector;
```

### Health Check Endpoint
```javascript
// health/healthCheck.js
class HealthChecker {
    constructor(bot) {
        this.bot = bot;
        this.checks = new Map();
    }
    
    addCheck(name, checkFunction) {
        this.checks.set(name, checkFunction);
    }
    
    async performHealthCheck() {
        const results = {};
        const startTime = Date.now();
        
        for (const [name, check] of this.checks) {
            try {
                const result = await check();
                results[name] = {
                    status: 'healthy',
                    data: result,
                    timestamp: Date.now()
                };
            } catch (error) {
                results[name] = {
                    status: 'unhealthy',
                    error: error.message,
                    timestamp: Date.now()
                };
            }
        }
        
        const overallStatus = Object.values(results).every(r => r.status === 'healthy') ? 'healthy' : 'unhealthy';
        
        return {
            status: overallStatus,
            checks: results,
            timestamp: startTime,
            uptime: process.uptime()
        };
    }
    
    // Built-in health checks
    async checkWorkers() {
        const workerStatuses = {};
        for (const [name, worker] of this.bot.workers) {
            workerStatuses[name] = this.bot.workerStates.get(name);
        }
        return workerStatuses;
    }
    
    async checkDatabase() {
        // Check database connectivity
        const result = await this.bot.dataManager.ping();
        return { connected: result };
    }
    
    async checkSolanaConnection() {
        // Check Solana RPC connection
        const version = await this.bot.solanaManager.connection.getVersion();
        return { version: version };
    }
    
    async checkMemoryUsage() {
        const usage = process.memoryUsage();
        return {
            heapUsed: usage.heapUsed,
            heapTotal: usage.heapTotal,
            external: usage.external,
            rss: usage.rss
        };
    }
}

module.exports = HealthChecker;
```

## 🚀 Deployment Scripts

### Deployment Script
```bash
#!/bin/bash
# deploy.sh

set -e

echo "🚀 Starting ZapBot Threaded Deployment..."

# Configuration
APP_NAME="zapbot-threaded"
DEPLOY_PATH="/var/www/zapbot"
BACKUP_PATH="/var/backups/zapbot"
LOG_PATH="/var/log/zapbot"

# Create directories
sudo mkdir -p $DEPLOY_PATH $BACKUP_PATH $LOG_PATH

# Backup current version
if [ -d "$DEPLOY_PATH/current" ]; then
    echo "📦 Creating backup..."
    sudo cp -r $DEPLOY_PATH/current $BACKUP_PATH/backup-$(date +%Y%m%d-%H%M%S)
fi

# Pull latest code
echo "📥 Pulling latest code..."
cd $DEPLOY_PATH
sudo git pull origin main

# Install dependencies
echo "📦 Installing dependencies..."
sudo npm ci --production

# Run database migrations
echo "🗄️ Running database migrations..."
sudo npm run migrate

# Build application
echo "🔨 Building application..."
sudo npm run build

# Restart application
echo "🔄 Restarting application..."
sudo pm2 reload ecosystem.config.js --env production

# Health check
echo "🏥 Performing health check..."
sleep 10
curl -f http://localhost:3000/health || {
    echo "❌ Health check failed!"
    exit 1
}

echo "✅ Deployment completed successfully!"
```

### Rollback Script
```bash
#!/bin/bash
# rollback.sh

set -e

echo "🔄 Starting rollback..."

# Configuration
APP_NAME="zapbot-threaded"
DEPLOY_PATH="/var/www/zapbot"
BACKUP_PATH="/var/backups/zapbot"

# Get latest backup
LATEST_BACKUP=$(ls -t $BACKUP_PATH/backup-* | head -1)

if [ -z "$LATEST_BACKUP" ]; then
    echo "❌ No backup found!"
    exit 1
fi

echo "📦 Rolling back to: $LATEST_BACKUP"

# Stop application
sudo pm2 stop $APP_NAME

# Restore from backup
sudo rm -rf $DEPLOY_PATH/current
sudo cp -r $LATEST_BACKUP $DEPLOY_PATH/current

# Restart application
sudo pm2 start ecosystem.config.js --env production

# Health check
echo "🏥 Performing health check..."
sleep 10
curl -f http://localhost:3000/health || {
    echo "❌ Health check failed!"
    exit 1
}

echo "✅ Rollback completed successfully!"
```

## 🔍 Troubleshooting

### Common Issues

#### 1. Worker Thread Crashes
```bash
# Check worker status
pm2 logs zapbot-threaded --lines 100

# Check worker memory usage
pm2 monit

# Restart specific worker
pm2 restart zapbot-threaded
```

#### 2. High Memory Usage
```bash
# Check memory usage
free -h
ps aux | grep node

# Check for memory leaks
node --inspect zapbot.js

# Restart with increased memory
pm2 restart zapbot-threaded --max-memory-restart 3G
```

#### 3. Database Connection Issues
```bash
# Check database connectivity
psql $DATABASE_URL -c "SELECT 1;"

# Check connection pool
curl http://localhost:3000/health

# Restart database
sudo systemctl restart postgresql
```

#### 4. Performance Issues
```bash
# Check CPU usage
htop

# Check disk I/O
iotop

# Check network usage
iftop

# Profile application
node --prof zapbot.js
```

### Log Analysis
```bash
# View real-time logs
tail -f /var/log/zapbot/combined.log

# Search for errors
grep -i error /var/log/zapbot/error.log

# Check worker-specific logs
grep "worker_name" /var/log/zapbot/combined.log

# Analyze performance
grep "latency\|throughput" /var/log/zapbot/combined.log
```

## 📊 Performance Optimization

### Tuning Parameters
```javascript
// config/performance.js
module.exports = {
    // Worker configuration
    workers: {
        maxConcurrentTrades: 50,
        maxQueueSize: 1000,
        workerRestartDelay: 5000,
        heartbeatInterval: 30000
    },
    
    // Memory management
    memory: {
        maxHeapSize: '2GB',
        gcInterval: 30000,
        memoryThreshold: 0.8
    },
    
    // Network optimization
    network: {
        connectionPoolSize: 10,
        requestTimeout: 30000,
        retryAttempts: 3
    },
    
    // Database optimization
    database: {
        connectionLimit: 20,
        acquireTimeout: 60000,
        timeout: 60000
    }
};
```

### Monitoring Alerts
```yaml
# /etc/prometheus/alerts.yml
groups:
  - name: zapbot_alerts
    rules:
      - alert: ZapBotDown
        expr: up{job="zapbot"} == 0
        for: 1m
        labels:
          severity: critical
        annotations:
          summary: "ZapBot is down"
          
      - alert: HighErrorRate
        expr: rate(zapbot_errors_total[5m]) > 0.1
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "High error rate detected"
          
      - alert: LowThroughput
        expr: rate(zapbot_trades_processed_total[5m]) < 1
        for: 10m
        labels:
          severity: warning
        annotations:
          summary: "Low trade throughput"
```

This comprehensive deployment guide ensures a robust, scalable, and well-monitored production environment for the threaded ZapBot architecture.
