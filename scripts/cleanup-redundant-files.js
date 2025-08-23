#!/usr/bin/env node

// ==========================================
// ========== Redundant Files Cleanup ==========
// ==========================================
// File: scripts/cleanup-redundant-files.js
// Description: Clean up redundant database manager files

const fs = require('fs');
const path = require('path');

class RedundantFilesCleanup {
    constructor() {
        this.filesToRemove = [];
        this.filesToKeep = [];
        this.backupDir = './backup_redundant_files';
    }

    async createBackup() {
        console.log('📦 Creating backup of files to be removed...');
        
        if (!fs.existsSync(this.backupDir)) {
            fs.mkdirSync(this.backupDir, { recursive: true });
        }

        for (const file of this.filesToRemove) {
            if (fs.existsSync(file)) {
                const backupPath = path.join(this.backupDir, path.basename(file));
                fs.copyFileSync(file, backupPath);
                console.log(`✅ Backed up: ${file} -> ${backupPath}`);
            }
        }
    }

    async removeRedundantFiles() {
        console.log('\n🗑️ Removing redundant files...');
        
        for (const file of this.filesToRemove) {
            if (fs.existsSync(file)) {
                try {
                    fs.unlinkSync(file);
                    console.log(`✅ Removed: ${file}`);
                } catch (error) {
                    console.error(`❌ Failed to remove ${file}:`, error.message);
                }
            } else {
                console.log(`⚠️ File not found: ${file}`);
            }
        }
    }

    async analyzeRedundancy() {
        console.log('🔍 Analyzing redundant files...\n');

        // Files that are now redundant after database migration
        this.filesToRemove = [
            './dataManager.js',                    // Old file-based DataManager
            './legacy_zapbot.js',                  // Legacy bot using old DataManager
            './data/',                             // Old JSON data directory
        ];

        // Files to keep (current implementation)
        this.filesToKeep = [
            './database/databaseManager.js',       // Core database manager
            './database/databaseDataManager.js',   // Database-backed data manager
            './database/schema.sql',               // Database schema
            './zapbot.js',                         // Current bot implementation
            './start.js',                          // Current startup script
        ];

        console.log('📋 Files to be removed (redundant):');
        for (const file of this.filesToRemove) {
            const exists = fs.existsSync(file);
            const size = exists ? fs.statSync(file).size : 0;
            console.log(`   ${exists ? '✅' : '❌'} ${file} (${size} bytes)`);
        }

        console.log('\n📋 Files to keep (current implementation):');
        for (const file of this.filesToKeep) {
            const exists = fs.existsSync(file);
            const size = exists ? fs.statSync(file).size : 0;
            console.log(`   ${exists ? '✅' : '❌'} ${file} (${size} bytes)`);
        }
    }

    async checkDependencies() {
        console.log('\n🔗 Checking dependencies...');
        
        const filesToCheck = [
            './zapbot.js',
            './start.js',
            './telegramUi.js',
            './adminManager.js'
        ];

        for (const file of filesToCheck) {
            if (fs.existsSync(file)) {
                const content = fs.readFileSync(file, 'utf8');
                
                // Check for old DataManager imports
                if (content.includes("require('./dataManager.js')") || 
                    content.includes("require('./dataManager')")) {
                    console.log(`⚠️ ${file} still references old dataManager.js`);
                }
                
                // Check for DatabaseDataManager imports
                if (content.includes("DatabaseDataManager")) {
                    console.log(`✅ ${file} uses DatabaseDataManager`);
                }
            }
        }
    }

    async runCleanup() {
        console.log('🚀 Starting redundant files cleanup...\n');
        
        try {
            await this.analyzeRedundancy();
            await this.checkDependencies();
            
            console.log('\n' + '='.repeat(60));
            console.log('SUMMARY:');
            console.log('='.repeat(60));
            console.log(`📦 Files to backup and remove: ${this.filesToRemove.length}`);
            console.log(`💾 Files to keep: ${this.filesToKeep.length}`);
            console.log('='.repeat(60));
            
            const readline = require('readline');
            const rl = readline.createInterface({
                input: process.stdin,
                output: process.stdout
            });

            rl.question('\n❓ Do you want to proceed with the cleanup? (y/N): ', async (answer) => {
                if (answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes') {
                    await this.createBackup();
                    await this.removeRedundantFiles();
                    console.log('\n🎉 Cleanup completed successfully!');
                    console.log(`📦 Backup created in: ${this.backupDir}`);
                } else {
                    console.log('\n❌ Cleanup cancelled by user.');
                }
                rl.close();
            });
            
        } catch (error) {
            console.error('❌ Cleanup failed:', error);
        }
    }
}

// Run cleanup if called directly
if (require.main === module) {
    const cleanup = new RedundantFilesCleanup();
    cleanup.runCleanup();
}

module.exports = { RedundantFilesCleanup };
