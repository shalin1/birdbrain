import { useRef, useState } from 'react';
import { CONFIG } from '../config';

export const useWebSocketAudio = () => {
    const [status, setStatus] = useState('disconnected');
    const [isListening, setIsListening] = useState(false);
    const [birdPrompt, setBirdPrompt] = useState(CONFIG.BIRD_BRAIN_PROMPT);
  
    const audioContextRef = useRef(null);
    const websocketRef = useRef(null);
    const mediaStream = useRef(null);
    const audioElement = useRef(null);
    const reconnectAttempts = useRef(0);
    const maxReconnectAttempts = 3;
    const lastActivityTimestampRef = useRef(Date.now());
    const idleCheckIntervalRef = useRef(null);
    const idleTimeoutRef = useRef(null);
    const animationFrameRef = useRef(null);
    const localSourceRef = useRef(null);

    const initializeAudioContext = async () => {
        if (audioContextRef.current) return audioContextRef.current;
        try {
          const newCtx = new (window.AudioContext || window.webkitAudioContext)();
          if (newCtx.state === 'suspended') {
            await newCtx.resume();
          }
          audioContextRef.current = newCtx;
          return newCtx;
        } catch (error) {
          console.error('AudioContext initialization failed:', error);
          setStatus('error');
          throw error;
        }
      };

      const setupAudioPlayback = async () => {
        const audio = new Audio();
        audio.autoplay = true;
        audio.playsInline = true;

        // Error handling for audio playback
        audio.onerror = (error) => {
          console.error('Audio playback error:', error);
          setStatus('error');
        };
      
        audioElement.current = audio;
        return audio;
      };
       
    const initializeAudio = async () => {
        const constraints = {
          audio: {
            ...CONFIG.WEBRTC.AUDIO_CONSTRAINTS,
          },
        };
    
        try {
          await initializeAudioContext();
          const localStream = await navigator.mediaDevices.getUserMedia(constraints);
          const audioTrack = localStream.getAudioTracks()[0];
          if (!audioTrack || !audioTrack.enabled) {
            throw new Error('No valid audio track available');
          }
          mediaStream.current = localStream;
          return localStream;
        } catch (err) {
          console.error('Microphone access failed:', err);
          setStatus('error');
          throw err;
        }
    };

    const connect = async () => {
        if (status === 'connecting' || status === 'connected') {
          console.log('Already connecting or connected');
          return;
        }
    
        try {
          setStatus('connecting');
          await initializeAudio();
          await setupAudioPlayback();
    
          console.log(import.meta.env.VITE_OPENAI_API_KEY,'OPENAI_API_KEY');
          const ws = new WebSocket(CONFIG.API.REALTIME_ENDPOINT_WS, [
            "realtime",
            // Auth
            "openai-insecure-api-key." + import.meta.env.VITE_OPENAI_API_KEY, 
            // Beta protocol, required
            "openai-beta.realtime-v1"
          ]);
          websocketRef.current = ws;
    
          ws.onopen = async () => {
            console.log('WebSocket connection established');
            setStatus('connected');
            startAudioCapture();
            setIsListening(true);
            startIdleMonitoring();
            const event = {
                type: "response.create",
                response: {
                  modalities: ["audio", "text"],
                  instructions: "Give me a haiku about code.",
                }
            }
            ws.send(JSON.stringify(event));
          };
    
          ws.onmessage = (event) => {
            const data = JSON.parse(event.data);
            handleServerMessage(data);
          };
    
          ws.onerror = (error) => {
            console.error('WebSocket error:', error);
            setStatus('error');
          };
    
          ws.onclose = () => {
            console.log('WebSocket connection closed');
            setStatus('disconnected');
            if (reconnectAttempts.current < maxReconnectAttempts) {
              reconnectAttempts.current++;
              setTimeout(connect, 2000);
            }
          };
        } catch (error) {
          console.error('Connection failed:', error);
          setStatus('error');
          if (reconnectAttempts.current < maxReconnectAttempts) {
            reconnectAttempts.current++;
            console.log(`Attempting reconnection (${reconnectAttempts.current}/${maxReconnectAttempts})`);
            setTimeout(connect, 2000);
          }
        }
      };

      const sendAudioData = (audioData) => {
        if (websocketRef.current && websocketRef.current.readyState === WebSocket.OPEN) {
          websocketRef.current.send(audioData);
        }
      };
    
    const startAudioCapture = () => {
        if (!audioContextRef.current) {
            console.error('AudioContext is not initialized.');
            return;
          }
        if (mediaStream.current) {
          const audioTrack = mediaStream.current.getAudioTracks()[0];
          const audioProcessor = audioContextRef.current.createScriptProcessor(4096, 1, 1);
          localSourceRef.current = audioContextRef.current.createMediaStreamSource(mediaStream.current);
          localSourceRef.current.connect(audioProcessor);
          audioProcessor.connect(audioContextRef.current.destination);
    
          audioProcessor.onaudioprocess = (event) => {
            const inputData = event.inputBuffer.getChannelData(0);
            const audioData = new Float32Array(inputData);
            sendAudioData(audioData);
          };
        }
      };

      const handleServerMessage = (data) => {
        if (data.type === 'response.audio.delta') {
          const base64String = data.delta; // base64-encoded 16-bit PCM
          if (!base64String) return;
      
          // Convert to raw bytes
          const arrayBuf = base64ToArrayBuffer(base64String);
          // Interpret as 16-bit PCM
          playPCM16(arrayBuf);
        } else {
          console.log('Received message:', data);
        }
      };

// Just a global or module-level var to track next available playback time
let playbackTime = 0;

function playPCM16(arrayBuffer) {
  const audioCtx = audioContextRef.current;
  const uint8 = new Uint8Array(arrayBuffer);
  const sampleCount = uint8.length / 2;

  const serverSampleRate = 24000; // confirm your real rate
  const audioBuffer = audioCtx.createBuffer(1, sampleCount, serverSampleRate);
  const floatChannel = audioBuffer.getChannelData(0);

  for (let i = 0; i < sampleCount; i++) {
    let sample = (uint8[2*i + 1] << 8) | uint8[2*i];
    if (sample >= 32768) sample -= 65536;
    floatChannel[i] = sample / 32768;
  }

  // Calculate chunk duration in seconds
  const chunkDuration = sampleCount / serverSampleRate;

  // If we've never scheduled anything yet or if clock has caught up, start now
  if (playbackTime < audioCtx.currentTime) {
    playbackTime = audioCtx.currentTime;
  }

  const source = audioCtx.createBufferSource();
  source.buffer = audioBuffer;
  source.connect(audioCtx.destination);

  // Schedule chunk to begin exactly at 'playbackTime'
  source.start(playbackTime);

  // Move the 'playbackTime' forward by the chunk length
  playbackTime += chunkDuration;
}

            
// 1. Convert the base64 delta string to an ArrayBuffer
function base64ToArrayBuffer(base64) {
    const binaryString = atob(base64);
    const length = binaryString.length;
    const bytes = new Uint8Array(length);
    for (let i = 0; i < length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
  }
  
    
  const playAudio = async (arrayBuffer) => {
    console.log(arrayBuffer,'arrayBuffer')
    try {
      // decodeAudioData returns a decoded AudioBuffer
      const decodedData = await audioContextRef.current.decodeAudioData(arrayBuffer);
      const source = audioContextRef.current.createBufferSource();
      source.buffer = decodedData;
      source.connect(audioContextRef.current.destination);
      source.start();
    } catch (err) {
      console.error("decodeAudioData error:", err);
    }
  };
  

      const startIdleMonitoring = () => {
        if (idleCheckIntervalRef.current) {
          clearInterval(idleCheckIntervalRef.current);
        }
      
        idleCheckIntervalRef.current = setInterval(() => {
          const idleTime = Date.now() - lastActivityTimestampRef.current;
          console.log('Idle time:', idleTime, 'ms');
      
          if (idleTime >= 120000) {
            console.log('2 minutes of inactivity. Closing connection...');
            disconnect();
            resetIdleTimer();
      
            setTimeout(() => {
              console.log('Reconnecting with a fresh state...');
              connect();
            }, 1000);
          }
        }, 10000); // Check every 10 seconds
      };
      
      const resetIdleTimer = () => {
        lastActivityTimestampRef.current = Date.now();
        if (idleTimeoutRef.current) {
          clearTimeout(idleTimeoutRef.current);
          idleTimeoutRef.current = null;
        }
      };
      
      const disconnect = () => {
        console.log('Disconnecting...');
      
        if (idleCheckIntervalRef.current) {
          clearInterval(idleCheckIntervalRef.current);
          idleCheckIntervalRef.current = null;
        }
        if (idleTimeoutRef.current) {
          clearTimeout(idleTimeoutRef.current);
          idleTimeoutRef.current = null;
        }
        if (animationFrameRef.current) {
          cancelAnimationFrame(animationFrameRef.current);
          animationFrameRef.current = null;
        }
        if (mediaStream.current) {
          mediaStream.current.getTracks().forEach((track) => track.stop());
          mediaStream.current = null;
        }
        if (websocketRef.current) {
          websocketRef.current.close();
          websocketRef.current = null;
        }
        if (audioContextRef.current) {
          audioContextRef.current.close().catch((err) =>
            console.error('Error closing audio context:', err)
          );
          audioContextRef.current = null;
        }
      
        setStatus('disconnected');
        setIsListening(false);
        console.log('Disconnected successfully.');
      };

      return {
        status,
        isListening,
        connect,
        disconnect,
        // toggleListening,
        // updatePromptMidSession,
        birdPrompt,
      };
                 
 }
      