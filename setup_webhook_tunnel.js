const localtunnel = require('localtunnel');
const https = require('https');
const config = require('./config.js');

async function setupWebhookWithTunnel() {
    const token = config.BOT_TOKEN;
    const port = 3002;
    
    console.log(`🚀 Setting up webhook with tunnel for bot: ${token.substring(0, 10)}...`);
    
    try {
        // Create a tunnel to localhost:3002
        const tunnel = await localtunnel({ port: port });
        
        console.log(`✅ Tunnel created: ${tunnel.url}`);
        console.log(`📡 Local server: http://localhost:${port}`);
        console.log(`🌐 Public URL: ${tunnel.url}`);
        
        // Set up the webhook with Telegram
        const webhookUrl = `${tunnel.url}/webhook`;
        console.log(`🔗 Setting webhook URL: ${webhookUrl}`);
        
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
                console.log('📨 Webhook setup response:', data);
                try {
                    const response = JSON.parse(data);
                    if (response.ok) {
                        console.log('✅ Webhook set successfully!');
                        console.log(`🎯 Bot is now listening at: ${webhookUrl}`);
                        console.log('💡 Keep this script running to maintain the tunnel');
                        console.log('🛑 Press Ctrl+C to stop the tunnel');
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
        
        // Keep the tunnel alive
        tunnel.on('close', () => {
            console.log('🔌 Tunnel closed');
        });
        
        // Handle cleanup
        process.on('SIGINT', () => {
            console.log('\n🛑 Shutting down tunnel...');
            tunnel.close();
            process.exit(0);
        });
        
    } catch (error) {
        console.error('❌ Failed to create tunnel:', error.message);
    }
}

setupWebhookWithTunnel();
