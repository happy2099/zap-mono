const https = require('https');
const config = require('./config.js');

async function setupWebhook() {
    const token = config.BOT_TOKEN;
    const webhookUrl = config.WEBHOOK_URL;
    
    console.log(`Setting up webhook for bot: ${token.substring(0, 10)}...`);
    console.log(`Webhook URL: ${webhookUrl}`);
    
    const postData = JSON.stringify({
        url: webhookUrl,
        allowed_updates: ['message', 'callback_query']
    });
    
    const options = {
        hostname: 'api.telegram.org',
        port: 443,
        path: `/bot${token}/setWebhook`,
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(postData)
        }
    };
    
    const req = https.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
            console.log('Webhook setup response:', data);
            try {
                const response = JSON.parse(data);
                if (response.ok) {
                    console.log('✅ Webhook set successfully!');
                } else {
                    console.log('❌ Webhook setup failed:', response.description);
                }
            } catch (e) {
                console.log('❌ Failed to parse response:', data);
            }
        });
    });
    
    req.on('error', (err) => {
        console.log('❌ Request error:', err.message);
    });
    
    req.write(postData);
    req.end();
}

setupWebhook();

