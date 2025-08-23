#!/usr/bin/env node

// ==========================================
// ========== Legacy Cleanup & Analysis ==========
// ==========================================
// File: scripts/cleanup-legacy-analysis.js
// Description: Analyze and clean up legacy files and blackbox functionality

const fs = require('fs');
const path = require('path');

class LegacyCleanupAnalyzer {
    constructor() {
        this.analysis = {
            legacyFiles: [],
            blackboxUsage: {},
            traceLogs: [],
            recommendations: []
        };
    }

    async analyzeLegacyFiles() {
        console.log('🔍 Analyzing legacy files...\n');

        // Check for remaining legacy references
        const legacyPatterns = [
            { pattern: 'dataManager.js', description: 'Old file-based DataManager' },
            { pattern: 'legacy_zapbot.js', description: 'Legacy bot implementation' },
            { pattern: 'data/', description: 'Old JSON data directory' }
        ];

        for (const pattern of legacyPatterns) {
            const exists = fs.existsSync(pattern.pattern);
            this.analysis.legacyFiles.push({
                file: pattern.pattern,
                exists,
                description: pattern.description,
                status: exists ? '❌ STILL EXISTS' : '✅ REMOVED'
            });
        }

        // Check for references in code
        const filesToCheck = [
            'scripts/migrate-to-database.js',
            'scripts/debug.js',
            'scripts/cleanup-redundant-files.js'
        ];

        for (const file of filesToCheck) {
            if (fs.existsSync(file)) {
                const content = fs.readFileSync(file, 'utf8');
                if (content.includes('dataManager.js')) {
                    this.analysis.recommendations.push(`⚠️ ${file} still references dataManager.js`);
                }
            }
        }
    }

    async analyzeBlackboxFunctionality() {
        console.log('🔍 Analyzing blackbox (traceLogger) functionality...\n');

        // Check traceLogger usage
        const filesUsingTraceLogger = [
            'tradingEngine.js',
            'platformBuilders.js',
            'pumpFunPrebuilder.js',
            'unifiedPrebuilder.js'
        ];

        for (const file of filesUsingTraceLogger) {
            if (fs.existsSync(file)) {
                const content = fs.readFileSync(file, 'utf8');
                const traceLoggerCalls = (content.match(/traceLogger\./g) || []).length;
                this.analysis.blackboxUsage[file] = {
                    usesTraceLogger: traceLoggerCalls > 0,
                    callCount: traceLoggerCalls,
                    methods: this.extractTraceLoggerMethods(content)
                };
            }
        }

        // Check trace log files
        const tracesDir = path.join('logs', 'traces');
        if (fs.existsSync(tracesDir)) {
            const traceFiles = fs.readdirSync(tracesDir);
            this.analysis.traceLogs = {
                directory: tracesDir,
                fileCount: traceFiles.length,
                totalSize: this.calculateDirectorySize(tracesDir),
                recentFiles: traceFiles.slice(-5) // Last 5 files
            };
        }
    }

    extractTraceLoggerMethods(content) {
        const methods = [];
        const methodPattern = /traceLogger\.(\w+)/g;
        let match;
        while ((match = methodPattern.exec(content)) !== null) {
            if (!methods.includes(match[1])) {
                methods.push(match[1]);
            }
        }
        return methods;
    }

    calculateDirectorySize(dirPath) {
        let totalSize = 0;
        try {
            const files = fs.readdirSync(dirPath);
            for (const file of files) {
                const filePath = path.join(dirPath, file);
                const stats = fs.statSync(filePath);
                totalSize += stats.size;
            }
        } catch (error) {
            console.error('Error calculating directory size:', error);
        }
        return totalSize;
    }

    async generateRecommendations() {
        console.log('💡 Generating recommendations...\n');

        // Legacy file recommendations
        const existingLegacyFiles = this.analysis.legacyFiles.filter(f => f.exists);
        if (existingLegacyFiles.length > 0) {
            this.analysis.recommendations.push('🗑️ Remove remaining legacy files');
        }

        // Blackbox recommendations
        const totalTraceLoggerCalls = Object.values(this.analysis.blackboxUsage)
            .reduce((sum, usage) => sum + (usage.callCount || 0), 0);

        if (totalTraceLoggerCalls > 0) {
            this.analysis.recommendations.push('📊 Blackbox is actively used for debugging');
            
            if (this.analysis.traceLogs.fileCount > 100) {
                this.analysis.recommendations.push('⚠️ Large number of trace logs - consider cleanup');
            }
        } else {
            this.analysis.recommendations.push('❌ Blackbox not used - can be removed');
        }

        // Migration script recommendations
        if (fs.existsSync('scripts/migrate-to-database.js')) {
            this.analysis.recommendations.push('🔄 Migration script no longer needed - can be removed');
        }
    }

    async displayAnalysis() {
        console.log('📊 Analysis Results:\n');

        // Legacy Files
        console.log('🗂️ Legacy Files:');
        for (const file of this.analysis.legacyFiles) {
            console.log(`   ${file.status} ${file.file} - ${file.description}`);
        }

        // Blackbox Usage
        console.log('\n📊 Blackbox (TraceLogger) Usage:');
        for (const [file, usage] of Object.entries(this.analysis.blackboxUsage)) {
            if (usage.usesTraceLogger) {
                console.log(`   ✅ ${file}: ${usage.callCount} calls (${usage.methods.join(', ')})`);
            } else {
                console.log(`   ❌ ${file}: Not used`);
            }
        }

        // Trace Logs
        if (this.analysis.traceLogs.fileCount > 0) {
            console.log('\n📁 Trace Logs:');
            console.log(`   📂 Directory: ${this.analysis.traceLogs.directory}`);
            console.log(`   📄 File Count: ${this.analysis.traceLogs.fileCount}`);
            console.log(`   💾 Total Size: ${(this.analysis.traceLogs.totalSize / 1024 / 1024).toFixed(2)} MB`);
            console.log(`   📅 Recent Files: ${this.analysis.traceLogs.recentFiles.length} files`);
        }

        // Recommendations
        console.log('\n💡 Recommendations:');
        for (const rec of this.analysis.recommendations) {
            console.log(`   ${rec}`);
        }
    }

    async cleanupLegacyFiles() {
        console.log('\n🗑️ Cleaning up legacy files...\n');

        // Remove migration script
        if (fs.existsSync('scripts/migrate-to-database.js')) {
            try {
                fs.unlinkSync('scripts/migrate-to-database.js');
                console.log('✅ Removed: scripts/migrate-to-database.js');
            } catch (error) {
                console.error('❌ Failed to remove migration script:', error.message);
            }
        }

        // Update debug script
        const debugScriptPath = 'scripts/debug.js';
        if (fs.existsSync(debugScriptPath)) {
            try {
                let content = fs.readFileSync(debugScriptPath, 'utf8');
                content = content.replace(/['"]dataManager\.js['"]/, 'null // Removed');
                content = content.replace(/['"]data['"]/, 'null // Removed');
                fs.writeFileSync(debugScriptPath, content);
                console.log('✅ Updated: scripts/debug.js (removed legacy references)');
            } catch (error) {
                console.error('❌ Failed to update debug script:', error.message);
            }
        }
    }

    async cleanupTraceLogs() {
        console.log('\n🗑️ Cleaning up trace logs...\n');

        const tracesDir = path.join('logs', 'traces');
        if (fs.existsSync(tracesDir)) {
            const traceFiles = fs.readdirSync(tracesDir);
            
            if (traceFiles.length > 50) {
                console.log(`⚠️ Found ${traceFiles.length} trace log files`);
                console.log('💡 Consider keeping only recent logs for debugging');
                
                // Keep only the last 10 files
                const filesToKeep = traceFiles.slice(-10);
                const filesToRemove = traceFiles.slice(0, -10);
                
                for (const file of filesToRemove) {
                    try {
                        fs.unlinkSync(path.join(tracesDir, file));
                        console.log(`   🗑️ Removed: ${file}`);
                    } catch (error) {
                        console.error(`   ❌ Failed to remove ${file}:`, error.message);
                    }
                }
                
                console.log(`✅ Kept ${filesToKeep.length} recent trace logs`);
            } else {
                console.log(`✅ Trace logs manageable (${traceFiles.length} files)`);
            }
        }
    }

    async runAnalysis() {
        console.log('🚀 Starting Legacy Cleanup & Analysis...\n');
        
        try {
            await this.analyzeLegacyFiles();
            await this.analyzeBlackboxFunctionality();
            await this.generateRecommendations();
            await this.displayAnalysis();
            
            console.log('\n' + '='.repeat(60));
            console.log('SUMMARY:');
            console.log('='.repeat(60));
            
            const totalLegacyFiles = this.analysis.legacyFiles.filter(f => f.exists).length;
            const totalTraceLoggerCalls = Object.values(this.analysis.blackboxUsage)
                .reduce((sum, usage) => sum + (usage.callCount || 0), 0);
            
            console.log(`📁 Legacy Files: ${totalLegacyFiles} remaining`);
            console.log(`📊 Blackbox Calls: ${totalTraceLoggerCalls} total`);
            console.log(`📄 Trace Logs: ${this.analysis.traceLogs.fileCount || 0} files`);
            console.log(`💡 Recommendations: ${this.analysis.recommendations.length} items`);
            
            // Ask user what to do
            const readline = require('readline');
            const rl = readline.createInterface({
                input: process.stdin,
                output: process.stdout
            });

            rl.question('\n❓ What would you like to do?\n' +
                '1. Clean up legacy files only\n' +
                '2. Clean up trace logs only\n' +
                '3. Clean up both\n' +
                '4. Just analyze (no cleanup)\n' +
                'Enter choice (1-4): ', async (answer) => {
                
                switch (answer) {
                    case '1':
                        await this.cleanupLegacyFiles();
                        break;
                    case '2':
                        await this.cleanupTraceLogs();
                        break;
                    case '3':
                        await this.cleanupLegacyFiles();
                        await this.cleanupTraceLogs();
                        break;
                    case '4':
                        console.log('\n✅ Analysis complete. No cleanup performed.');
                        break;
                    default:
                        console.log('\n❌ Invalid choice. No cleanup performed.');
                }
                
                rl.close();
            });
            
        } catch (error) {
            console.error('❌ Analysis failed:', error);
        }
    }
}

// Run analysis if called directly
if (require.main === module) {
    const analyzer = new LegacyCleanupAnalyzer();
    analyzer.runAnalysis();
}

module.exports = { LegacyCleanupAnalyzer };
