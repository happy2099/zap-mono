# 🧪 ZapBot Threading Testing Strategy

## 📋 Testing Overview

This document outlines the comprehensive testing strategy for the threaded architecture implementation of ZapBot, including unit tests, integration tests, performance tests, and stress tests.

## 🎯 Testing Objectives

- **Functionality**: Ensure all features work correctly in threaded environment
- **Performance**: Verify performance improvements meet expectations
- **Reliability**: Test error handling and recovery mechanisms
- **Scalability**: Validate system behavior under high load
- **Stability**: Ensure long-term stability and memory management

## 🏗️ Test Structure

```
tests/
├── threading/
│   ├── unit/
│   │   ├── worker.test.js
│   │   ├── messagePassing.test.js
│   │   └── sharedMemory.test.js
│   ├── integration/
│   │   ├── workerCommunication.test.js
│   │   ├── tradeFlow.test.js
│   │   └── dataFlow.test.js
│   ├── performance/
│   │   ├── throughput.test.js
│   │   ├── latency.test.js
│   │   └── memory.test.js
│   ├── stress/
│   │   ├── highLoad.test.js
│   │   ├── errorRecovery.test.js
│   │   └── memoryLeak.test.js
│   └── e2e/
│       ├── fullWorkflow.test.js
│       └── userScenarios.test.js
```

## 🔧 Unit Tests

### Worker Thread Tests
```javascript
// tests/threading/unit/worker.test.js
const { Worker } = require('worker_threads');

describe('Worker Thread Unit Tests', () => {
    let worker;

    beforeEach(() => {
        worker = new Worker('./workers/traderMonitorWorker.js');
    });

    afterEach(() => {
        if (worker) {
            worker.terminate();
        }
    });

    test('Worker Initialization', async () => {
        const readyMessage = await new Promise(resolve => {
            worker.on('message', resolve);
        });
        
        expect(readyMessage.type).toBe('WORKER_READY');
        expect(readyMessage.workerName).toBe('monitor');
        expect(readyMessage.timestamp).toBeDefined();
    });

    test('Worker Shutdown', async () => {
        // Wait for worker to be ready
        await new Promise(resolve => {
            worker.on('message', (msg) => {
                if (msg.type === 'WORKER_READY') resolve();
            });
        });

        // Send shutdown message
        const exitPromise = new Promise(resolve => {
            worker.on('exit', resolve);
        });

        worker.postMessage({ type: 'SHUTDOWN' });
        
        const exitCode = await exitPromise;
        expect(exitCode).toBe(0);
    });

    test('Worker Error Handling', async () => {
        const errorPromise = new Promise(resolve => {
            worker.on('error', resolve);
        });

        // Send invalid message to trigger error
        worker.postMessage({ type: 'INVALID_MESSAGE' });
        
        const error = await errorPromise;
        expect(error).toBeDefined();
    });
});
```

### Message Passing Tests
```javascript
// tests/threading/unit/messagePassing.test.js
describe('Message Passing Tests', () => {
    test('Message Structure Validation', () => {
        const message = {
            type: 'EXECUTE_TRADE',
            id: 'unique_id',
            timestamp: Date.now(),
            data: {
                tradeData: {
                    platform: 'test',
                    tokenMint: 'test',
                    amount: 1,
                    direction: 'buy'
                }
            },
            metadata: {
                source: 'test',
                priority: 0,
                retryCount: 0
            }
        };

        expect(message.type).toBeDefined();
        expect(message.id).toBeDefined();
        expect(message.timestamp).toBeDefined();
        expect(message.data).toBeDefined();
        expect(message.metadata).toBeDefined();
    });

    test('Message Handler Registration', () => {
        const handler = new MessageHandler();
        
        const testHandler = jest.fn();
        handler.registerHandler('TEST_MESSAGE', testHandler);
        
        expect(handler.handlers.has('TEST_MESSAGE')).toBe(true);
    });

    test('Message Handler Execution', async () => {
        const handler = new MessageHandler();
        const testHandler = jest.fn();
        
        handler.registerHandler('TEST_MESSAGE', testHandler);
        await handler.handleMessage('worker1', { type: 'TEST_MESSAGE' });
        
        expect(testHandler).toHaveBeenCalled();
    });
});
```

### Shared Memory Tests
```javascript
// tests/threading/unit/sharedMemory.test.js
describe('Shared Memory Tests', () => {
    test('Shared Buffer Creation', () => {
        const manager = new SharedMemoryManager();
        const { buffer, view } = manager.createSharedBuffer('test', 1024);
        
        expect(buffer).toBeInstanceOf(SharedArrayBuffer);
        expect(view).toBeInstanceOf(Uint8Array);
        expect(buffer.byteLength).toBe(1024);
    });

    test('Lock Acquisition and Release', () => {
        const manager = new SharedMemoryManager();
        manager.createSharedBuffer('test', 1024);
        
        expect(manager.acquireLock('test')).toBe(true);
        expect(manager.acquireLock('test')).toBe(false); // Should fail
        
        manager.releaseLock('test');
        expect(manager.acquireLock('test')).toBe(true); // Should succeed again
    });

    test('Data Write and Read', () => {
        const manager = new SharedMemoryManager();
        manager.createSharedBuffer('test', 1024);
        
        const testData = { key: 'value', number: 42 };
        
        expect(manager.writeToBuffer('test', testData)).toBe(true);
        
        const readData = manager.readFromBuffer('test');
        expect(readData).toEqual(testData);
    });
});
```

## 🔗 Integration Tests

### Worker Communication Tests
```javascript
// tests/threading/integration/workerCommunication.test.js
describe('Worker Communication Integration Tests', () => {
    let mainBot;
    let monitorWorker;
    let executorWorker;

    beforeEach(async () => {
        mainBot = new ThreadedZapBot();
        await mainBot.initialize();
        
        monitorWorker = mainBot.workers.get('monitor');
        executorWorker = mainBot.workers.get('executor');
    });

    afterEach(async () => {
        await mainBot.shutdown();
    });

    test('Trader Monitoring to Trade Execution Flow', async () => {
        const testTrader = {
            name: 'test_trader',
            wallet: 'test_wallet_address',
            active: true
        };

        // Start monitoring
        monitorWorker.postMessage({
            type: 'START_MONITORING',
            data: { traders: [testTrader] }
        });

        // Simulate new transaction
        const newTransactionMessage = {
            type: 'NEW_TRANSACTIONS',
            trader: testTrader.name,
            wallet: testTrader.wallet,
            signatures: ['test_signature_1', 'test_signature_2'],
            timestamp: Date.now()
        };

        // Send to main thread
        monitorWorker.emit('message', newTransactionMessage);

        // Verify trade execution request
        const tradeExecutionMessage = {
            type: 'EXECUTE_TRADE',
            data: {
                tradeData: {
                    platform: 'test_platform',
                    tokenMint: 'test_token',
                    amount: 1,
                    direction: 'buy'
                }
            }
        };

        executorWorker.postMessage(tradeExecutionMessage);

        // Wait for trade execution response
        const response = await new Promise(resolve => {
            executorWorker.on('message', resolve);
        });

        expect(response.type).toBe('TRADE_QUEUED');
        expect(response.executionId).toBeDefined();
    });
});
```

### Data Flow Tests
```javascript
// tests/threading/integration/dataFlow.test.js
describe('Data Flow Integration Tests', () => {
    test('Data Manager Worker Communication', async () => {
        const dataWorker = new Worker('./workers/dataManagerWorker.js');
        
        // Wait for worker to be ready
        await new Promise(resolve => {
            dataWorker.on('message', (msg) => {
                if (msg.type === 'WORKER_READY') resolve();
            });
        });

        // Test data loading
        const loadPromise = new Promise(resolve => {
            dataWorker.on('message', resolve);
        });

        dataWorker.postMessage({
            type: 'LOAD_DATA',
            data: {
                dataType: 'traders',
                userId: 'test_user'
            }
        });

        const loadResponse = await loadPromise;
        expect(loadResponse.type).toBe('DATA_LOADED');
        expect(loadResponse.data).toBeDefined();

        dataWorker.terminate();
    });
});
```

## 📈 Performance Tests

### Throughput Tests
```javascript
// tests/threading/performance/throughput.test.js
describe('Performance Tests', () => {
    test('High Trader Count Throughput', async () => {
        const traderCount = 100;
        const traders = Array.from({ length: traderCount }, (_, i) => ({
            name: `trader_${i}`,
            wallet: `wallet_${i}`,
            active: true
        }));

        const startTime = Date.now();
        
        const worker = new Worker('./workers/traderMonitorWorker.js');
        
        // Wait for worker to be ready
        await new Promise(resolve => {
            worker.on('message', (msg) => {
                if (msg.type === 'WORKER_READY') resolve();
            });
        });
        
        // Start monitoring all traders
        worker.postMessage({
            type: 'START_MONITORING',
            data: { traders }
        });
        
        const endTime = Date.now();
        const setupTime = endTime - startTime;
        
        // Should complete setup within 5 seconds
        expect(setupTime).toBeLessThan(5000);
        
        // Test transaction processing throughput
        const transactionCount = 1000;
        const transactionStartTime = Date.now();
        
        for (let i = 0; i < transactionCount; i++) {
            worker.postMessage({
                type: 'NEW_TRANSACTIONS',
                trader: `trader_${i % traderCount}`,
                wallet: `wallet_${i % traderCount}`,
                signatures: [`sig_${i}`],
                timestamp: Date.now()
            });
        }
        
        const transactionEndTime = Date.now();
        const transactionTime = transactionEndTime - transactionStartTime;
        const transactionsPerSecond = transactionCount / (transactionTime / 1000);
        
        // Should process at least 50 transactions per second
        expect(transactionsPerSecond).toBeGreaterThan(50);
        
        worker.terminate();
    });
});
```

### Latency Tests
```javascript
// tests/threading/performance/latency.test.js
describe('Latency Tests', () => {
    test('Message Passing Latency', async () => {
        const worker = new Worker('./workers/traderMonitorWorker.js');
        
        // Wait for worker to be ready
        await new Promise(resolve => {
            worker.on('message', (msg) => {
                if (msg.type === 'WORKER_READY') resolve();
            });
        });
        
        const latencies = [];
        const messageCount = 100;
        
        for (let i = 0; i < messageCount; i++) {
            const startTime = process.hrtime.bigint();
            
            const response = await new Promise(resolve => {
                worker.once('message', resolve);
                worker.postMessage({ type: 'PING' });
            });
            
            const endTime = process.hrtime.bigint();
            const latency = Number(endTime - startTime) / 1000000; // Convert to milliseconds
            latencies.push(latency);
        }
        
        const avgLatency = latencies.reduce((sum, lat) => sum + lat, 0) / latencies.length;
        const maxLatency = Math.max(...latencies);
        const minLatency = Math.min(...latencies);
        
        // Average latency should be less than 10ms
        expect(avgLatency).toBeLessThan(10);
        
        // Maximum latency should be less than 50ms
        expect(maxLatency).toBeLessThan(50);
        
        console.log(`Latency Stats: Avg=${avgLatency.toFixed(2)}ms, Min=${minLatency.toFixed(2)}ms, Max=${maxLatency.toFixed(2)}ms`);
        
        worker.terminate();
    });
});
```

### Memory Tests
```javascript
// tests/threading/performance/memory.test.js
describe('Memory Tests', () => {
    test('Memory Usage Over Time', async () => {
        const initialMemory = process.memoryUsage();
        const workers = [];
        
        // Create multiple workers
        for (let i = 0; i < 5; i++) {
            const worker = new Worker('./workers/traderMonitorWorker.js');
            workers.push(worker);
            
            // Wait for worker to be ready
            await new Promise(resolve => {
                worker.on('message', (msg) => {
                    if (msg.type === 'WORKER_READY') resolve();
                });
            });
        }
        
        // Simulate workload
        for (let i = 0; i < 1000; i++) {
            const worker = workers[i % workers.length];
            worker.postMessage({
                type: 'START_MONITORING',
                data: {
                    traders: [{
                        name: `trader_${i}`,
                        wallet: `wallet_${i}`,
                        active: true
                    }]
                }
            });
        }
        
        // Wait for processing
        await new Promise(resolve => setTimeout(resolve, 5000));
        
        const finalMemory = process.memoryUsage();
        const memoryIncrease = finalMemory.heapUsed - initialMemory.heapUsed;
        
        // Memory increase should be reasonable (less than 100MB)
        expect(memoryIncrease).toBeLessThan(100 * 1024 * 1024);
        
        // Cleanup
        for (const worker of workers) {
            worker.terminate();
        }
    });
});
```

## 💥 Stress Tests

### High Load Tests
```javascript
// tests/threading/stress/highLoad.test.js
describe('High Load Stress Tests', () => {
    test('Maximum Trader Capacity', async () => {
        const maxTraders = 1000;
        const traders = Array.from({ length: maxTraders }, (_, i) => ({
            name: `trader_${i}`,
            wallet: `wallet_${i}`,
            active: true
        }));

        const worker = new Worker('./workers/traderMonitorWorker.js');
        
        // Wait for worker to be ready
        await new Promise(resolve => {
            worker.on('message', (msg) => {
                if (msg.type === 'WORKER_READY') resolve();
            });
        });
        
        const startTime = Date.now();
        
        // Start monitoring all traders
        worker.postMessage({
            type: 'START_MONITORING',
            data: { traders }
        });
        
        // Simulate high transaction volume
        const transactionPromises = [];
        for (let i = 0; i < 10000; i++) {
            const promise = new Promise(resolve => {
                worker.once('message', resolve);
            });
            
            worker.postMessage({
                type: 'NEW_TRANSACTIONS',
                trader: `trader_${i % maxTraders}`,
                wallet: `wallet_${i % maxTraders}`,
                signatures: [`sig_${i}`],
                timestamp: Date.now()
            });
            
            transactionPromises.push(promise);
        }
        
        // Wait for all transactions to be processed
        await Promise.all(transactionPromises);
        
        const endTime = Date.now();
        const totalTime = endTime - startTime;
        
        // Should handle high load without crashing
        expect(totalTime).toBeLessThan(60000); // Less than 1 minute
        
        worker.terminate();
    });
});
```

### Error Recovery Tests
```javascript
// tests/threading/stress/errorRecovery.test.js
describe('Error Recovery Stress Tests', () => {
    test('Worker Crash Recovery', async () => {
        const workers = [];
        
        // Create multiple workers
        for (let i = 0; i < 10; i++) {
            const worker = new Worker('./workers/traderMonitorWorker.js');
            workers.push(worker);
            
            // Wait for worker to be ready
            await new Promise(resolve => {
                worker.on('message', (msg) => {
                    if (msg.type === 'WORKER_READY') resolve();
                });
            });
        }
        
        // Simulate worker crashes
        for (let i = 0; i < 5; i++) {
            const worker = workers[i];
            worker.terminate();
            
            // Wait for restart
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            // Verify worker is back online
            const newWorker = new Worker('./workers/traderMonitorWorker.js');
            const readyMessage = await new Promise(resolve => {
                newWorker.on('message', resolve);
            });
            
            expect(readyMessage.type).toBe('WORKER_READY');
            workers[i] = newWorker;
        }
        
        // Cleanup
        for (const worker of workers) {
            worker.terminate();
        }
    });
});
```

### Memory Leak Tests
```javascript
// tests/threading/stress/memoryLeak.test.js
describe('Memory Leak Tests', () => {
    test('Long Running Memory Stability', async () => {
        const initialMemory = process.memoryUsage();
        const worker = new Worker('./workers/traderMonitorWorker.js');
        
        // Wait for worker to be ready
        await new Promise(resolve => {
            worker.on('message', (msg) => {
                if (msg.type === 'WORKER_READY') resolve();
            });
        });
        
        // Run continuous workload for 30 seconds
        const startTime = Date.now();
        const memorySamples = [];
        
        const interval = setInterval(() => {
            const memory = process.memoryUsage();
            memorySamples.push(memory.heapUsed);
        }, 1000);
        
        while (Date.now() - startTime < 30000) {
            worker.postMessage({
                type: 'START_MONITORING',
                data: {
                    traders: [{
                        name: `trader_${Date.now()}`,
                        wallet: `wallet_${Date.now()}`,
                        active: true
                    }]
                }
            });
            
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        
        clearInterval(interval);
        
        const finalMemory = process.memoryUsage();
        
        // Check for memory growth
        const memoryGrowth = finalMemory.heapUsed - initialMemory.heapUsed;
        const growthRate = memoryGrowth / (30000 / 1000); // Growth per second
        
        // Memory growth should be minimal (less than 1MB per second)
        expect(growthRate).toBeLessThan(1024 * 1024);
        
        // Check for memory stabilization
        const recentSamples = memorySamples.slice(-10);
        const variance = this.calculateVariance(recentSamples);
        
        // Memory should stabilize (low variance)
        expect(variance).toBeLessThan(1024 * 1024); // Less than 1MB variance
        
        worker.terminate();
    });
    
    calculateVariance(samples) {
        const mean = samples.reduce((sum, sample) => sum + sample, 0) / samples.length;
        const squaredDiffs = samples.map(sample => Math.pow(sample - mean, 2));
        return squaredDiffs.reduce((sum, diff) => sum + diff, 0) / samples.length;
    }
});
```

## 🌐 End-to-End Tests

### Full Workflow Tests
```javascript
// tests/threading/e2e/fullWorkflow.test.js
describe('End-to-End Workflow Tests', () => {
    test('Complete Trade Copy Workflow', async () => {
        const bot = new ThreadedZapBot();
        await bot.initialize();
        
        // Add trader
        const trader = {
            name: 'test_trader',
            wallet: 'test_wallet_address',
            active: true
        };
        
        await bot.handleAddTrader('test_user', trader.name, trader.wallet);
        
        // Start copying
        await bot.handleStartCopy('test_user', trader.name);
        
        // Simulate trader transaction
        const transactionMessage = {
            type: 'NEW_TRANSACTIONS',
            trader: trader.name,
            wallet: trader.wallet,
            signatures: ['test_signature'],
            timestamp: Date.now()
        };
        
        // Process transaction
        await bot.handleNewTransactions(transactionMessage);
        
        // Verify trade execution
        const tradeExecutions = await bot.dataManager.getTradeExecutions('test_user');
        expect(tradeExecutions.length).toBeGreaterThan(0);
        
        await bot.shutdown();
    });
});
```

## 📊 Test Execution

### Running Tests
```bash
# Run all threading tests
npm run test:threading

# Run specific test categories
npm run test:threading:unit
npm run test:threading:integration
npm run test:threading:performance
npm run test:threading:stress
npm run test:threading:e2e

# Run with coverage
npm run test:threading:coverage

# Run performance benchmarks
npm run test:threading:benchmark
```

### Test Configuration
```javascript
// jest.config.js
module.exports = {
    testEnvironment: 'node',
    testMatch: [
        '**/tests/threading/**/*.test.js'
    ],
    collectCoverageFrom: [
        'workers/**/*.js',
        '!workers/templates/**'
    ],
    coverageThreshold: {
        global: {
            branches: 80,
            functions: 80,
            lines: 80,
            statements: 80
        }
    },
    setupFilesAfterEnv: [
        '<rootDir>/tests/threading/setup.js'
    ]
};
```

### Continuous Integration
```yaml
# .github/workflows/threading-tests.yml
name: Threading Tests

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    
    strategy:
      matrix:
        node-version: [16.x, 18.x, 20.x]
    
    steps:
    - uses: actions/checkout@v3
    - uses: actions/setup-node@v3
      with:
        node-version: ${{ matrix.node-version }}
    
    - run: npm ci
    - run: npm run test:threading
    - run: npm run test:threading:coverage
```

This comprehensive testing strategy ensures the threaded architecture is robust, performant, and reliable across all scenarios.
