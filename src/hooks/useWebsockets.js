import { useRef, useState } from 'react';
import { CONFIG } from '../config';

export const useWebSocketAudio = () => {
    const [status, setStatus] = useState('disconnected');
    const [isListening, setIsListening] = useState(false);
    const [audioContext, setAudioContext] = useState(null);
    const [birdPrompt, setBirdPrompt] = useState(CONFIG.BIRD_BRAIN_PROMPT);
  
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
        if (audioContext) return audioContext;
        try {
          const newCtx = new (window.AudioContext || window.webkitAudioContext)();
          if (newCtx.state === 'suspended') {
            await newCtx.resume();
          }
          setAudioContext(newCtx);
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
          await initializeAudioContext();
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
        if (!audioContext) {
            console.error('AudioContext is not initialized.');
            return;
          }
        if (mediaStream.current) {
          const audioTrack = mediaStream.current.getAudioTracks()[0];
          const audioProcessor = audioContext.createScriptProcessor(4096, 1, 1);
          localSourceRef.current = audioContext.createMediaStreamSource(mediaStream.current);
          localSourceRef.current.connect(audioProcessor);
          audioProcessor.connect(audioContext.destination);
    
          audioProcessor.onaudioprocess = (event) => {
            const inputData = event.inputBuffer.getChannelData(0);
            const audioData = new Float32Array(inputData);
            sendAudioData(audioData);
          };
        }
      };

      const handleServerMessage = (data) => {
        if (data.type === 'audio') {
          const audioBuffer = new Float32Array(data.audio);
          playAudio(audioBuffer);
        } else {
          console.log('Received message:', data);
        }
      };
    
      const playAudio = async (audioBuffer) => {
        const buffer = audioContext.createBuffer(1, audioBuffer.length, audioContext.sampleRate);
        buffer.copyToChannel(audioBuffer, 0);
        const source = audioContext.createBufferSource();
        source.buffer = buffer;
        source.connect(audioContext.destination);
        source.start();
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
        if (audioContext) {
          audioContext.close().catch((err) =>
            console.error('Error closing audio context:', err)
          );
          setAudioContext(null);
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
      