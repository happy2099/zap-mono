const express = require('express');
const app = express();
const port = 3002;

// Middleware to parse JSON
app.use(express.json());

// Webhook endpoint
app.post('/webhook', (req, res) => {
    console.log('📨 Received webhook update:', JSON.stringify(req.body, null, 2));
    
    // Acknowledge receipt
    res.status(200).send('OK');
    
    // Process the update (this would normally be handled by your bot)
    const update = req.body;
    if (update.message) {
        console.log(`💬 Message from ${update.message.from.username || update.message.from.first_name}: ${update.message.text}`);
    }
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Start server
app.listen(port, () => {
    console.log(`🚀 Webhook server running on http://localhost:${port}`);
    console.log(`📡 Webhook endpoint: http://localhost:${port}/webhook`);
    console.log(`❤️ Health check: http://localhost:${port}/health`);
});

module.exports = app;
