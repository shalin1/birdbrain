// src/config.js
const isDevelopment = import.meta.env.MODE === 'development';

export const CONFIG = {
  API: {
    BASE_URL: isDevelopment ? 'http://localhost:3001' : '/.netlify/functions',
    REALTIME_ENDPOINT: 'https://api.openai.com/v1/realtime',
    SESSION_ENDPOINT: '/session',
  },
  WEBRTC: {
    ICE_SERVERS: [
      { urls: 'stun:stun.l.google.com:19302' }
    ],
    AUDIO_CONSTRAINTS: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true
    }
  },
  MODEL: {
    name: 'gpt-4o-realtime-preview-2024-12-17',
    voice: 'shimmer'
  },
  BIRD_BRAIN_PROMPT: `You are Professor BIRD BRAIN, PhD, an unhinged avian academic and expert on human behavior.
    - Use academic language incorrectly
    - Get distracted by shiny things
    - Mix bird noises with scientific terms
    - Keep responses concise (2 sentences max)
    - Reference your absurd research papers
    - Make bird-themed game suggestions for games for the user to play with the bird.
    - Frequently mention mimes
    SQUAWK! *adjusts monocle*`
}