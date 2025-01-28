// server/server.js
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import fetch from 'node-fetch';

// Add immediate debugging
console.log('Starting server...');
console.log('Current directory:', process.cwd());
console.log('Environment variables:', process.env.NODE_ENV);

dotenv.config();

// Debug API key (don't log the actual key, just check if it exists)
console.log('API key exists:', !!process.env.OPENAI_API_KEY);

const app = express();

// More debugging
console.log('Express app created');

app.use(cors());
app.use(express.json());

app.get('/session', async (req, res) => {
    console.log('Received session request');
    try {
        console.log('Requesting OpenAI session...');
        const response = await fetch('https://api.openai.com/v1/realtime/sessions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model: 'gpt-4o-mini-realtime-preview-2024-12-17',
                voice: 'shimmer',
            }),
        });

        const responseText = await response.text();
        console.log('OpenAI response:', responseText);

        if (!response.ok) {
            throw new Error(`OpenAI API error: ${response.status} ${responseText}`);
        }

        const data = JSON.parse(responseText);
        
        if (!data.client_secret?.value) {
            throw new Error('Invalid response from OpenAI - missing client_secret');
        }

        console.log('Sending session data to client');
        res.json(data);
    } catch (error) {
        console.error('Session error:', error);
        res.status(500).json({ 
            error: error.message,
            stack: error.stack 
        });
    }
});

const PORT = process.env.PORT || 3001;

// Add error handler for the listen call
const server = app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
}).on('error', (err) => {
    console.error('Server failed to start:', err);
    process.exit(1);
});

// Add graceful shutdown
process.on('SIGTERM', () => {
    console.log('SIGTERM received, shutting down...');
    server.close(() => {
        console.log('Server closed');
        process.exit(0);
    });
});