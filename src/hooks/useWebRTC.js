// src/hooks/useWebRTC.js
import { useState, useEffect, useRef } from 'react';
import { CONFIG } from '../config';

export const useWebRTC = () => {
  // State management for component rendering and external access
  const [status, setStatus] = useState('disconnected');
  const [isListening, setIsListening] = useState(false);
  const [stream, setStream] = useState(null);
  
  // Persistent references that survive re-renders
  const peerConnection = useRef(null);
  const dataChannel = useRef(null);
  const mediaStream = useRef(null);
  const audioElement = useRef(null);
  const audioContext = useRef(null);
  const reconnectAttempts = useRef(0);
  const maxReconnectAttempts = 3;

  // Initialize the Web Audio API context with proper error handling
  const initializeAudioContext = async () => {
    try {
      if (!audioContext.current) {
        audioContext.current = new (window.AudioContext || window.webkitAudioContext)();
      }

      // Modern browsers require user interaction before allowing audio
      if (audioContext.current.state === 'suspended') {
        await audioContext.current.resume();
      }

      return audioContext.current;
    } catch (error) {
      console.error('Audio context initialization failed:', error);
      throw new Error('Failed to initialize audio system');
    }
  };

  // Set up microphone access and audio stream
  const initializeAudio = async () => {
    try {
      // Ensure audio context is ready first
      await initializeAudioContext();
      
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          ...CONFIG.WEBRTC.AUDIO_CONSTRAINTS,
          // Additional constraints for better voice quality
          sampleRate: 48000,
          channelCount: 1
        }
      });
      
      // Verify we have a valid audio track
      const audioTrack = stream.getAudioTracks()[0];
      if (!audioTrack || !audioTrack.enabled) {
        throw new Error('No valid audio track available');
      }

      // Store references and update state
      mediaStream.current = stream;
      setStream(stream);
      
      return stream;
    } catch (error) {
      console.error('Microphone access failed:', error);
      setStatus('error');
      throw new Error(`Microphone access failed: ${error.message}`);
    }
  };

  // Configure audio playback element
  const setupAudioPlayback = async () => {
    try {
      const audio = new Audio();
      audio.autoplay = true;
      audio.playsInline = true;
      
      // Add comprehensive error handling
      audio.onerror = (e) => {
        console.error('Audio playback error:', e);
        setStatus('error');
      };

      // Ensure audio context is ready
      await initializeAudioContext();
      
      audioElement.current = audio;
      return audio;
    } catch (error) {
      console.error('Audio playback setup failed:', error);
      throw error;
    }
  };

  // Main connection logic
  const connect = async () => {
    try {
      setStatus('connecting');
      
      // 1. Initialize audio systems
      await initializeAudioContext();
      const stream = await initializeAudio();
      const audio = await setupAudioPlayback();

      // 2. Get session token with retry logic
      const sessionData = await fetchSessionWithRetry();
      
      // 3. Create and configure WebRTC peer connection
      const pc = new RTCPeerConnection({ 
        iceServers: CONFIG.WEBRTC.ICE_SERVERS 
      });
      peerConnection.current = pc;

      // 4. Set up connection state monitoring
      setupConnectionMonitoring(pc);

      // 5. Add local audio track
      const audioTrack = stream.getAudioTracks()[0];
      if (!audioTrack) throw new Error('No audio track available');
      pc.addTrack(audioTrack, stream);

      // 6. Handle incoming audio
      pc.ontrack = async (event) => {
        if (event.track.kind === 'audio') {
          try {
            // Ensure audio context is ready
            await initializeAudioContext();
            
            // Mute local microphone while receiving
            if (mediaStream.current) {
              const localTrack = mediaStream.current.getAudioTracks()[0];
              localTrack.enabled = false;
              setIsListening(false);
            }

            // Set up remote audio stream
            const remoteStream = new MediaStream([event.track]);
            if (!remoteStream.getAudioTracks().length) {
              throw new Error('Remote stream has no audio tracks');
            }
            
            audio.srcObject = remoteStream;
            
            // Attempt playback with recovery
            try {
              await audio.play();
            } catch (playError) {
              console.error('Initial playback failed:', playError);
              // Attempt recovery by reinitializing audio
              await initializeAudioContext();
              await audio.play();
            }
            
            // Handle remote track ending
            event.track.onended = () => {
              if (mediaStream.current) {
                const localTrack = mediaStream.current.getAudioTracks()[0];
                localTrack.enabled = true;
                setIsListening(true);
              }
            };

          } catch (error) {
            console.error('Remote track handling error:', error);
            setStatus('error');
          }
        }
      };

      // 7. Set up data channel
      const dc = pc.createDataChannel('oai-events');
      dataChannel.current = dc;
      
      dc.onopen = () => {
        setStatus('connected');
        setIsListening(true);
        
        // Send initial configuration
        dc.send(JSON.stringify({
          type: 'response.create',
          response: {
            modalities: ['text', 'audio'],
            instructions: CONFIG.BIRD_BRAIN_PROMPT
          }
        }));
      };

      // Add message handler for data channel
      dc.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          console.log('Received WebRTC message:', data);
          
          // Log specific rate limit headers or errors if present
          if (data.error?.code === 429 || data.error?.type === 'rate_limit_error') {
            console.warn('Rate limit hit:', data.error);
          }
        } catch (error) {
          console.error('Error parsing WebRTC message:', error);
        }
      };

      // 8. Create and send offer
      const offer = await pc.createOffer({ offerToReceiveAudio: true });
      await pc.setLocalDescription(offer);

      // 9. Exchange SDP with server
      const sdpResponse = await fetch(CONFIG.API.REALTIME_ENDPOINT, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${sessionData.client_secret.value}`,
          'Content-Type': 'application/sdp'
        },
        body: offer.sdp
      });

      if (!sdpResponse.ok) {
        throw new Error(`SDP exchange failed: ${sdpResponse.status}`);
      }

      const answerSdp = await sdpResponse.text();
      await pc.setRemoteDescription({ 
        type: 'answer', 
        sdp: answerSdp 
      });

    } catch (error) {
      console.error('Connection failed:', error);
      setStatus('error');
      
      // Attempt reconnection if appropriate
      if (reconnectAttempts.current < maxReconnectAttempts) {
        reconnectAttempts.current++;
        console.log(`Attempting reconnection ${reconnectAttempts.current}/${maxReconnectAttempts}`);
        await new Promise(resolve => setTimeout(resolve, 2000));
        return connect();
      }
      
      throw error;
    }
  };

  // Helper function for session token fetching
  const fetchSessionWithRetry = async (retries = 3) => {
    for (let i = 0; i < retries; i++) {
      try {
        const response = await fetch(`${CONFIG.API.BASE_URL}${CONFIG.API.SESSION_ENDPOINT}`);
        if (!response.ok) throw new Error(`HTTP error: ${response.status}`);
        
        const data = await response.json();
        if (!data.client_secret?.value) {
          throw new Error('Invalid session response - missing client_secret');
        }
        
        return data;
      } catch (error) {
        if (i === retries - 1) throw error;
        await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
      }
    }
  };

  // Helper function for monitoring WebRTC connection state
  const setupConnectionMonitoring = (pc) => {
    pc.oniceconnectionstatechange = () => {
      console.log('ICE connection state:', pc.iceConnectionState);
      switch (pc.iceConnectionState) {
        case 'checking':
          setStatus('establishing connection...');
          break;
        case 'connected':
          setStatus('connected');
          reconnectAttempts.current = 0; // Reset counter on successful connection
          break;
        case 'disconnected':
          setStatus('disconnected');
          break;
        case 'failed':
          setStatus('connection failed');
          // Attempt recovery if under max attempts
          if (reconnectAttempts.current < maxReconnectAttempts) {
            connect();
          }
          break;
      }
    };
  };

  // Microphone mute toggle
  const toggleListening = () => {
    if (mediaStream.current) {
      const audioTrack = mediaStream.current.getAudioTracks()[0];
      audioTrack.enabled = !isListening;
      setIsListening(!isListening);
    }
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      // Stop all tracks
      mediaStream.current?.getTracks().forEach(track => track.stop());
      
      // Close WebRTC connections
      if (peerConnection.current) {
        peerConnection.current.close();
        peerConnection.current = null;
      }
      
      // Close audio context
      if (audioContext.current) {
        audioContext.current.close();
        audioContext.current = null;
      }
    };
  }, []);

  return {
    status,
    isListening,
    connect,
    toggleListening,
    stream
  };
};