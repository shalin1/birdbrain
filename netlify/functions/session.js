// netlify/functions/session.js
import fetch from 'node-fetch';

export const handler = async (event, context) => {
    try {
        console.log('Requesting OpenAI session...');
        const response = await fetch('https://api.openai.com/v1/realtime/sessions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model: 'gpt-4o-realtime-preview-2024-12-17',
                voice: 'shimmer',
            }),
        });

        const responseText = await response.text();
        console.log('OpenAI response:', responseText);

        if (!response.ok) {
            throw new Error(`OpenAI API error: ${response.status} ${responseText}`);
        }

        // Parse the response text as JSON
        const data = JSON.parse(responseText);
        
        // Validate the response has the expected structure
        if (!data.client_secret?.value) {
            throw new Error('Invalid response from OpenAI - missing client_secret');
        }

        console.log('Sending session data to client');
        return {
            statusCode: 200,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': 'Content-Type',
                'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
            },
            body: JSON.stringify(data)
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