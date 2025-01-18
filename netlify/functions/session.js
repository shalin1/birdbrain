// netlify/functions/session.js
const https = require('https');

exports.handler = async function(event, context) {
    try {
        const response = await new Promise((resolve, reject) => {
            const options = {
                hostname: 'api.openai.com',
                path: '/v1/realtime/sessions',
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
                    'Content-Type': 'application/json',
                }
            };

            const req = https.request(options, (res) => {
                let data = '';
                
                res.on('data', (chunk) => {
                    data += chunk;
                });
                
                res.on('end', () => {
                    resolve({
                        statusCode: res.statusCode,
                        body: data,
                        headers: res.headers
                    });
                });
            });

            req.on('error', (error) => {
                reject(error);
            });

            req.write(JSON.stringify({
                model: 'gpt-4o-realtime-preview-2024-12-17',
                voice: 'shimmer',
            }));
            
            req.end();
        });

        if (response.statusCode !== 200) {
            throw new Error(`OpenAI API error: ${response.statusCode} ${response.body}`);
        }

        return {
            statusCode: 200,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': 'Content-Type',
                'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
            },
            body: response.body
        };
    } catch (error) {
        console.error('Session error:', error);
        return {
            statusCode: 500,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            body: JSON.stringify({ 
                error: error.message,
                stack: error.stack 
            })
        };
    }
};