// test_connection.js - Test LaserStream connection

const { subscribe, CommitmentLevel } = require('helius-laserstream');

const config = {
    laserstreamGrpcUrl: "laserstream.helius.xyz:443",
    heliusApiKey: "b9a69ad0-d823-429e-8c18-7cbea0e31769"
};

const run = async () => {
    try {
        console.log("🔌 Testing LaserStream connection...");
        
        const stream = await subscribe(
            { apiKey: config.heliusApiKey, endpoint: config.laserstreamGrpcUrl },
            { "test-stream": { accountIncludes: ["11111111111111111111111111111111"], vote: false, failed: false } },
            CommitmentLevel.PROCESSED,
            async (update) => {
                console.log("✅ Connection successful! Received transaction:", update.transaction?.signature);
            },
            (err) => { 
                console.error("❌ Connection error:", err); 
            }
        );
        
        console.log("✅ LaserStream connected successfully!");
        console.log("🎯 Waiting for any transactions...");
        
    } catch (e) {
        console.error("❌ Failed to connect:", e.message);
    }
};

run();
