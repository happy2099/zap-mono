#!/usr/bin/env node

// ==========================================
// ====== ZapBot Startup Script =============
// ==========================================
// File: start.js
// Description: Startup script that can launch threaded or legacy ZapBot

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Get current directory for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Parse command line arguments
const args = process.argv.slice(2);
const isThreaded = args.includes('--threading') || args.includes('-t');

console.log('🚀 Starting ZapBot...');
console.log(`📊 Mode: ${isThreaded ? 'Threaded' : 'Legacy'}`);

// Check if required files exist
const legacyFile = path.join(__dirname, 'zapbot.js');
const threadedFile = path.join(__dirname, 'threadedZapBot.js');

if (isThreaded) {
    if (!fs.existsSync(threadedFile)) {
        console.error('❌ Threaded ZapBot file not found:', threadedFile);
        console.error('Please ensure threadedZapBot.js exists in the project root.');
        process.exit(1);
    }
    
    console.log('✅ Threaded ZapBot file found');
    
    // Load and start threaded version
    try {
        const { default: ThreadedZapBot } = await import('./threadedZapBot.js');
        const bot = new ThreadedZapBot();
        
        // Handle graceful shutdown
        process.on('SIGINT', async () => {
            console.log('\n🛑 Received SIGINT, shutting down gracefully...');
            await bot.shutdown();
            process.exit(0);
        });
        
        process.on('SIGTERM', async () => {
            console.log('\n🛑 Received SIGTERM, shutting down gracefully...');
            await bot.shutdown();
            process.exit(0);
        });
        
        // Initialize and start the bot
        await bot.initialize();
        console.log('🎉 Threaded ZapBot is now running!');
        
    } catch (error) {
        console.error('❌ Failed to start Threaded ZapBot:', error);
        process.exit(1);
    }
} else {
    if (!fs.existsSync(legacyFile)) {
        console.error('❌ Legacy ZapBot file not found:', legacyFile);
        console.error('Please ensure zapbot.js exists in the project root.');
        process.exit(1);
    }
    
    console.log('✅ Legacy ZapBot file found');
    
    // Load and start legacy version
    try {
        await import('./zapbot.js');
        console.log('🎉 Legacy ZapBot is now running!');
    } catch (error) {
        console.error('❌ Failed to start Legacy ZapBot:', error);
        process.exit(1);
    }
}

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
    console.error('💥 Uncaught Exception:', error);
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('💥 Unhandled Rejection at:', promise, 'reason:', reason);
    process.exit(1);
});
