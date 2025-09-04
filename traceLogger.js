// ==========================================
// File: traceLogger.js
// Description: Operation Black Box - The Flight Data Recorder
// ==========================================

const fs = require('fs/promises');
const path = require('path');

// Safely get config with fallback
let config;
try {
    config = require('./config.js');
} catch (error) {
    console.warn('[TraceLogger] Could not load config, using default LOGS_DIR');
    config = { LOGS_DIR: './logs' };
}

let TRACE_DIR = path.join(config.LOGS_DIR || './logs', 'traces');

// Ensure TRACE_DIR is always a valid string
if (!TRACE_DIR || typeof TRACE_DIR !== 'string') {
    console.error('[TraceLogger] CRITICAL: TRACE_DIR is not properly defined, using default');
    TRACE_DIR = './logs/traces';
}

// ===== [START] TIMESTAMP HELPER ===== //
function getFormattedTimestamp() {
    const d = new Date();
    const year = d.getFullYear();
    const month = (d.getMonth() + 1).toString().padStart(2, '0');
    const day = d.getDate().toString().padStart(2, '0');
    const hour = d.getHours().toString().padStart(2, '0');
    const minute = d.getMinutes().toString().padStart(2, '0');
    const second = d.getSeconds().toString().padStart(2, '0');
    return `${year}${month}${day}_${hour}${minute}${second}`;
}
// ===== [END] TIMESTAMP HELPER ===== //

class TraceLogger {
    constructor() {
        // Ensure the directory exists on startup
        this._ensureDirectoryExists();
    }

    async _ensureDirectoryExists() {
        try {
            await fs.mkdir(TRACE_DIR, { recursive: true });
        } catch (err) {
            console.error('[TraceLogger] CRITICAL: Could not create trace log directory:', err);
            // Don't throw - just log the error and continue
        }
    }

    /**
     * Helper method to find trace file by signature
     */
    async _findTraceFileBySignature(signature) {
        if (!signature) return null;
        try {
            const files = await fs.readdir(TRACE_DIR);
            // Find a file that contains the signature substring
            const matchingFile = files.find(f => f.includes(signature.substring(0, 8)));
            return matchingFile ? path.join(TRACE_DIR, matchingFile) : null;
        } catch (error) {
            console.error('[TraceLogger] Error searching for trace file:', error);
            return null;
        }
    }

    /**
     * Initiates a new trace log with human-readable filename
     */
    async initTrace(signature, traderWallet, userChatId) {
        if (!signature) {
            console.warn('[TraceLogger] Aborting trace: No signature provided.');
            return;
        }

        const fileName = `${getFormattedTimestamp()}-${userChatId}-${signature.substring(0, 8)}.json`;
        const logFilePath = path.join(TRACE_DIR, fileName);

        const initialData = {
            traceVersion: '1.1',
            signature: signature,
            traderWallet: traderWallet,
            userChatId: userChatId,
            timestamp_start: new Date().toISOString(),
            steps: [],
            finalOutcome: 'PENDING'
        };

        try {
            await fs.writeFile(logFilePath, JSON.stringify(initialData, this.censorAndStringifyReplacer(), 2));
            console.log(`[BLACK BOX] Trace initiated: ${fileName}`);
        } catch (error) {
            console.error(`[TraceLogger] Failed to initiate trace:`, error);
        }
    }

    /**
     * Appends a new step to the trace log
     */
    async appendTrace(signature, stepName, data) {
        if (!signature) return;

        const logFilePath = await this._findTraceFileBySignature(signature);
        if (!logFilePath) {
            console.error(`[TraceLogger] Cannot append trace. File not found for signature: ${signature}`);
            return;
        }

        try {
            const content = await fs.readFile(logFilePath, 'utf8');
            const traceData = JSON.parse(content);

            traceData.steps.push({
                step: stepName,
                timestamp: new Date().toISOString(),
                ...data
            });

            await fs.writeFile(logFilePath, JSON.stringify(traceData, this.censorAndStringifyReplacer(), 2));
        } catch (error) {
            console.error(`[TraceLogger] Failed to append step '${stepName}':`, error);
        }
    }

    /**
     * Records the final outcome of the trade attempt
     */
    async recordOutcome(signature, status, reason) {
        if (!signature) return;

        const logFilePath = await this._findTraceFileBySignature(signature);
        if (!logFilePath) {
            console.error(`[TraceLogger] Cannot record outcome. File not found for signature: ${signature}`);
            return;
        }

        try {
            const content = await fs.readFile(logFilePath, 'utf8');
            const traceData = JSON.parse(content);

            traceData.finalOutcome = status;
            traceData.finalReason = reason;
            traceData.timestamp_end = new Date().toISOString();

            await fs.writeFile(logFilePath, JSON.stringify(traceData, this.censorAndStringifyReplacer(), 2));
            console.log(`[BLACK BOX] Outcome recorded: ${path.basename(logFilePath)} - ${status}`);
        } catch (error) {
            console.error(`[TraceLogger] Failed to record final outcome:`, error);
        }
    }

    /**
     * Censors sensitive data in logs
     */
    censorAndStringifyReplacer() {
        const seen = new WeakSet();
        return (key, value) => {
            if (key === 'keypair' || key === 'signer' || key === 'privateKey') {
                return '[CENSORED]';
            }
            if (typeof value === 'object' && value !== null) {
                if (seen.has(value)) return '[Circular]';
                seen.add(value);
                if (value.constructor?.name === 'PublicKey') {
                    return `PublicKey(${value.toBase58()})`;
                }
                if (value.constructor?.name === 'Connection') {
                    return `Connection(${value.rpcEndpoint})`;
                }
            }
            return value;
        };
    }
}

module.exports = new TraceLogger();