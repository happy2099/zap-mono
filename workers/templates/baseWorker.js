import { parentPort, workerData } from 'worker_threads';

class BaseWorker {
    constructor() {
        this.workerName = workerData.workerName;
        this.isShuttingDown = false;
        this.messageHandlers = new Map();
    }

    async initialize() {
        this.setupMessageHandlers();
        this.signalReady();
    }

    setupMessageHandlers() {
        this.registerHandler('SHUTDOWN', this.handleShutdown.bind(this));
        this.registerHandler('PING', this.handlePing.bind(this));
    }

    registerHandler(messageType, handler) {
        this.messageHandlers.set(messageType, handler);
    }

    async handleMessage(message) {
        const handler = this.messageHandlers.get(message.type);
        if (handler) {
            await handler(message);
        }
    }

    signalReady() {
        parentPort.postMessage({
            type: 'WORKER_READY',
            workerName: this.workerName,
            timestamp: Date.now()
        });
    }

    async handleShutdown() {
        this.isShuttingDown = true;
        await this.cleanup();
        process.exit(0);
    }

    async handlePing() {
        parentPort.postMessage({
            type: 'PONG',
            workerName: this.workerName,
            timestamp: Date.now()
        });
    }

    async cleanup() {
        // Override in subclasses
    }
}

export default BaseWorker;
