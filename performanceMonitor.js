// ==========================================
// File: performanceMonitor.js
// Description: Performance monitoring for ULTRA-LOW LATENCY LaserStream and Sender optimizations
// ==========================================

const fs = require('fs/promises');
const path = require('path');

class PerformanceMonitor {
    constructor() {
        this.metrics = {
            laserstream: {
                detectionLatency: [],
                totalDetections: 0,
                averageLatency: 0,
                ultraFastDetections: 0, // <100ms
                fastDetections: 0,      // <200ms
                slowDetections: 0       // >200ms
            },
            sender: {
                executionLatency: [],
                totalExecutions: 0,
                averageLatency: 0,
                ultraFastExecutions: 0, // <200ms
                fastExecutions: 0,      // <400ms
                slowExecutions: 0       // >400ms
            },
            overall: {
                totalCopyTrades: 0,
                averageTotalTime: 0,
                startTime: Date.now()
            }
        };
        
        this.logFile = path.join(process.env.LOGS_DIR || './logs', 'performance-metrics.json');
        this.maxHistorySize = 1000;
        
        console.log('[PERFORMANCE-MONITOR] 🚀 ULTRA-LOW LATENCY performance monitor initialized');
        console.log('[PERFORMANCE-MONITOR] ⚡ Target: <100ms detection + <200ms execution = <300ms total');
    }

    // Record LaserStream detection latency
    recordDetectionLatency(latency) {
        const { laserstream } = this.metrics;
        
        laserstream.detectionLatency.push({
            latency,
            timestamp: Date.now()
        });
        
        // Keep only recent history
        if (laserstream.detectionLatency.length > this.maxHistorySize) {
            laserstream.detectionLatency.shift();
        }
        
        laserstream.totalDetections++;
        
        // Categorize detection speed
        if (latency < 100) {
            laserstream.ultraFastDetections++;
            console.log(`[PERFORMANCE-MONITOR] ⚡ ULTRA-FAST DETECTION: ${latency}ms!`);
        } else if (latency < 200) {
            laserstream.fastDetections++;
            console.log(`[PERFORMANCE-MONITOR] 🚀 FAST DETECTION: ${latency}ms`);
        } else {
            laserstream.slowDetections++;
            console.log(`[PERFORMANCE-MONITOR] ⚠️ SLOW DETECTION: ${latency}ms`);
        }
        
        // Update average
        this.updateAverage('laserstream');
        
        // Log performance summary
        this.logDetectionSummary();
    }

    // Record Sender execution latency
    recordExecutionLatency(latency) {
        const { sender } = this.metrics;
        
        sender.executionLatency.push({
            latency,
            timestamp: Date.now()
        });
        
        // Keep only recent history
        if (sender.executionLatency.length > this.maxHistorySize) {
            sender.executionLatency.shift();
        }
        
        sender.totalExecutions++;
        
        // Categorize execution speed
        if (latency < 200) {
            sender.ultraFastExecutions++;
            console.log(`[PERFORMANCE-MONITOR] ⚡ ULTRA-FAST EXECUTION: ${latency}ms!`);
        } else if (latency < 400) {
            sender.fastExecutions++;
            console.log(`[PERFORMANCE-MONITOR] 🚀 FAST EXECUTION: ${latency}ms`);
        } else {
            sender.slowExecutions++;
            console.log(`[PERFORMANCE-MONITOR] ⚠️ SLOW EXECUTION: ${latency}ms`);
        }
        
        // Update average
        this.updateAverage('sender');
        
        // Log performance summary
        this.logExecutionSummary();
    }

    // Record complete copy trade cycle
    recordCopyTradeCycle(detectionLatency, executionLatency) {
        const { overall } = this.metrics;
        
        const totalTime = detectionLatency + executionLatency;
        overall.totalCopyTrades++;
        
        console.log(`[PERFORMANCE-MONITOR] 🎯 COPY TRADE CYCLE COMPLETE:`);
        console.log(`[PERFORMANCE-MONITOR]   - Detection: ${detectionLatency}ms`);
        console.log(`[PERFORMANCE-MONITOR]   - Execution: ${executionLatency}ms`);
        console.log(`[PERFORMANCE-MONITOR]   - Total: ${totalTime}ms`);
        
        // Check if we meet ultra-fast targets
        if (totalTime < 300) {
            console.log(`[PERFORMANCE-MONITOR] ⚡ ULTRA-FAST TARGET ACHIEVED: ${totalTime}ms total!`);
        } else if (totalTime < 500) {
            console.log(`[PERFORMANCE-MONITOR] 🚀 FAST TARGET ACHIEVED: ${totalTime}ms total`);
        } else {
            console.log(`[PERFORMANCE-MONITOR] ⚠️ Above target: ${totalTime}ms total`);
        }
        
        // Update overall average
        this.updateOverallAverage(totalTime);
    }

    // Update average latency for a component
    updateAverage(component) {
        const { metrics } = this;
        const data = metrics[component].executionLatency || metrics[component].detectionLatency;
        
        if (data.length > 0) {
            const sum = data.reduce((acc, item) => acc + item.latency, 0);
            metrics[component].averageLatency = sum / data.length;
        }
    }

    // Update overall average
    updateOverallAverage(totalTime) {
        const { overall } = this.metrics;
        
        if (overall.totalCopyTrades === 1) {
            overall.averageTotalTime = totalTime;
        } else {
            overall.averageTotalTime = (overall.averageTotalTime * (overall.totalCopyTrades - 1) + totalTime) / overall.totalCopyTrades;
        }
    }

    // Log detection performance summary
    logDetectionSummary() {
        const { laserstream } = this.metrics;
        const { totalDetections, ultraFastDetections, fastDetections, slowDetections, averageLatency } = laserstream;
        
        if (totalDetections % 10 === 0) { // Log every 10 detections
            console.log(`[PERFORMANCE-MONITOR] 📊 DETECTION SUMMARY:`);
            console.log(`[PERFORMANCE-MONITOR]   - Total: ${totalDetections}`);
            console.log(`[PERFORMANCE-MONITOR]   - Ultra-fast (<100ms): ${ultraFastDetections} (${((ultraFastDetections/totalDetections)*100).toFixed(1)}%)`);
            console.log(`[PERFORMANCE-MONITOR]   - Fast (<200ms): ${fastDetections} (${((fastDetections/totalDetections)*100).toFixed(1)}%)`);
            console.log(`[PERFORMANCE-MONITOR]   - Slow (>200ms): ${slowDetections} (${((slowDetections/totalDetections)*100).toFixed(1)}%)`);
            console.log(`[PERFORMANCE-MONITOR]   - Average: ${averageLatency.toFixed(1)}ms`);
        }
    }

    // Log execution performance summary
    logExecutionSummary() {
        const { sender } = this.metrics;
        const { totalExecutions, ultraFastExecutions, fastExecutions, slowExecutions, averageLatency } = sender;
        
        if (totalExecutions % 10 === 0) { // Log every 10 executions
            console.log(`[PERFORMANCE-MONITOR] 📊 EXECUTION SUMMARY:`);
            console.log(`[PERFORMANCE-MONITOR]   - Total: ${totalExecutions}`);
            console.log(`[PERFORMANCE-MONITOR]   - Ultra-fast (<200ms): ${ultraFastExecutions} (${((ultraFastExecutions/totalExecutions)*100).toFixed(1)}%)`);
            console.log(`[PERFORMANCE-MONITOR]   - Fast (<400ms): ${fastExecutions} (${((fastExecutions/totalExecutions)*100).toFixed(1)}%)`);
            console.log(`[PERFORMANCE-MONITOR]   - Slow (>400ms): ${slowExecutions} (${((slowExecutions/totalExecutions)*100).toFixed(1)}%)`);
            console.log(`[PERFORMANCE-MONITOR]   - Average: ${averageLatency.toFixed(1)}ms`);
        }
    }

    // Get comprehensive performance report
    getPerformanceReport() {
        const { laserstream, sender, overall } = this.metrics;
        const uptime = Date.now() - overall.startTime;
        
        return {
            timestamp: new Date().toISOString(),
            uptime: {
                total: uptime,
                hours: Math.floor(uptime / (1000 * 60 * 60)),
                minutes: Math.floor((uptime % (1000 * 60 * 60)) / (1000 * 60))
            },
            laserstream: {
                totalDetections: laserstream.totalDetections,
                averageLatency: laserstream.averageLatency.toFixed(1),
                ultraFastRate: laserstream.totalDetections > 0 ? ((laserstream.ultraFastDetections / laserstream.totalDetections) * 100).toFixed(1) : 0,
                fastRate: laserstream.totalDetections > 0 ? ((laserstream.fastDetections / laserstream.totalDetections) * 100).toFixed(1) : 0,
                performance: this.getPerformanceGrade(laserstream.averageLatency, 100) // Target: <100ms
            },
            sender: {
                totalExecutions: sender.totalExecutions,
                averageLatency: sender.averageLatency.toFixed(1),
                ultraFastRate: sender.totalExecutions > 0 ? ((sender.ultraFastExecutions / sender.totalExecutions) * 100).toFixed(1) : 0,
                fastRate: sender.totalExecutions > 0 ? ((sender.fastExecutions / sender.totalExecutions) * 100).toFixed(1) : 0,
                performance: this.getPerformanceGrade(sender.averageLatency, 200) // Target: <200ms
            },
            overall: {
                totalCopyTrades: overall.totalCopyTrades,
                averageTotalTime: overall.averageTotalTime.toFixed(1),
                performance: this.getPerformanceGrade(overall.averageTotalTime, 300) // Target: <300ms total
            }
        };
    }

    // Get performance grade
    getPerformanceGrade(averageLatency, target) {
        if (averageLatency < target * 0.8) return 'A+'; // Excellent
        if (averageLatency < target) return 'A';        // Good
        if (averageLatency < target * 1.2) return 'B'; // Acceptable
        if (averageLatency < target * 1.5) return 'C'; // Needs improvement
        return 'D'; // Poor
    }

    // Save metrics to file
    async saveMetrics() {
        try {
            const report = this.getPerformanceReport();
            await fs.writeFile(this.logFile, JSON.stringify(report, null, 2));
            console.log(`[PERFORMANCE-MONITOR] 💾 Metrics saved to ${this.logFile}`);
        } catch (error) {
            console.error('[PERFORMANCE-MONITOR] ❌ Failed to save metrics:', error);
        }
    }

    // Load metrics from file
    async loadMetrics() {
        try {
            if (await fs.access(this.logFile).then(() => true).catch(() => false)) {
                const data = await fs.readFile(this.logFile, 'utf8');
                const savedMetrics = JSON.parse(data);
                console.log(`[PERFORMANCE-MONITOR] 📂 Loaded saved metrics from ${this.logFile}`);
                return savedMetrics;
            }
        } catch (error) {
            console.warn('[PERFORMANCE-MONITOR] ⚠️ Could not load saved metrics:', error);
        }
        return null;
    }

    // Start periodic metrics saving
    startPeriodicSaving(intervalMs = 60000) { // Save every minute
        setInterval(async () => {
            await this.saveMetrics();
        }, intervalMs);
        
        console.log(`[PERFORMANCE-MONITOR] 🔄 Periodic saving started (every ${intervalMs/1000}s)`);
    }

    // Get real-time performance status
    getRealTimeStatus() {
        const report = this.getPerformanceReport();
        
        console.log(`[PERFORMANCE-MONITOR] 📊 REAL-TIME STATUS:`);
        console.log(`[PERFORMANCE-MONITOR]   - Uptime: ${report.uptime.hours}h ${report.uptime.minutes}m`);
        console.log(`[PERFORMANCE-MONITOR]   - LaserStream: ${report.laserstream.averageLatency}ms (${report.laserstream.performance})`);
        console.log(`[PERFORMANCE-MONITOR]   - Sender: ${report.sender.averageLatency}ms (${report.sender.performance})`);
        console.log(`[PERFORMANCE-MONITOR]   - Overall: ${report.overall.averageTotalTime}ms (${report.overall.performance})`);
        
        return report;
    }
}

// Create singleton instance
const performanceMonitor = new PerformanceMonitor();

// Export for use in other modules
module.exports = performanceMonitor;
