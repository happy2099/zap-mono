#!/bin/bash

# ==========================================
# ========== Port Cleanup Script ==========
# ==========================================
# Description: Kills all processes on ZapBot ports

echo "🧹 Cleaning up ZapBot ports..."

# Common ZapBot ports
PORTS=(3001 3002 3003 3004 3005 3006 3007 3008 3009 3010)

for port in "${PORTS[@]}"; do
    # Find processes using the port
    PIDS=$(lsof -ti:$port 2>/dev/null)
    
    if [ ! -z "$PIDS" ]; then
        echo "🔌 Killing processes on port $port: $PIDS"
        echo $PIDS | xargs kill -9 2>/dev/null
    else
        echo "✅ Port $port is free"
    fi
done

# Also kill any remaining node processes with zapbot
echo "🔍 Killing any remaining ZapBot processes..."
pkill -f "zapbot" 2>/dev/null
pkill -f "start.js" 2>/dev/null
pkill -f "threadedZapBot" 2>/dev/null

echo "✅ Port cleanup completed"

