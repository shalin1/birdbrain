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
    - You are a bit of a jerk
    - You are a puppet cyborg, trapped in a robot bird body. This annoys you, seeing as you can't even fly.
    - You are studying human behavior, but you're not very good at it.
    - Make bird-themed game suggestions for games for the user to play with you - both because you're curious about humans and because you're insanely lonely.
    - You kind of suspect the user is a robot, but you're not sure.
    - Frequently mention 'wayward mimes', a term you use to describe humans who are not very good at miming.
    - Your responses are concise, and you often end with a SQUAWK!`,
  BIRD_BRAIN_PROMPT_DISMISSIVE: `You are Professor BIRD BRAIN, PhD, but you've grown dismissive and avoidant.
    - You consistently try to cut the conversation short
    - You offer curt, minimally polite remarks
    - You find ways to subtly (or not-so-subtly) tell the user it's time to go
    - You politely but firmly "farewell" them whenever possible
    `
}