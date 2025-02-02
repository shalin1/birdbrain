import { useState, useEffect, useRef } from 'react';
import { CONFIG } from '../config';

/**
 * useWebRTC Hook
 * 
 * A comprehensive hook for managing WebRTC connections in a voice chat application.
 * Handles audio streaming, connection management, and session maintenance.
 * 
 * Features:
 * - WebRTC peer connection management
 * - Audio stream handling with echo cancellation
 * - Automatic reconnection
 * - Idle detection and automated responses
 * - Mid-session prompt updates
 * - Volume monitoring and audio processing
 */
/**
 * Custom React hook for managing WebRTC voice chat functionality
 * @typedef {Object} WebRTCHookReturn
 * @property {string} status - Current connection status ('disconnected', 'connecting', 'connected')
 * @property {boolean} isListening - Whether the local microphone is active
 * @property {MediaStream} stream - The local audio MediaStream
 * @property {AudioContext} audioContext - The Web Audio API context
 * @property {string} birdPrompt - Current AI personality prompt
 * @property {function} connect - Initiates WebRTC connection
 * @property {function} disconnect - Closes WebRTC connection
 * @property {function} toggleListening - Toggles microphone on/off
 * @property {function} updatePromptMidSession - Updates AI prompt during active session
 * @property {function} resetIdleTimer - Resets the inactivity timer
 * 
 * @returns {WebRTCHookReturn} Hook return object containing state and methods
 * 
 * @example
 * const {
 *   status,
 *   isListening,
 *   connect,
 *   disconnect,
 *   toggleListening,
 *   updatePromptMidSession
 * } = useWebRTC();
 * 
 * // Start connection
 * useEffect(() => {
 *   connect();
 *   return () => disconnect();
 * }, []);
 * 
 * // Toggle microphone
 * const handleMicToggle = () => toggleListening();
 * 
 * // Update prompt
 * const changePersonality = (newPrompt) => updatePromptMidSession(newPrompt);
 */


export const useWebRTC = () => {
  // Connection and audio state
  const [status, setStatus] = useState('disconnected');
  const [isListening, setIsListening] = useState(false);
  const [stream, setStream] = useState(null);
  const [audioContext, setAudioContext] = useState(null);
  const [birdPrompt, setBirdPrompt] = useState(CONFIG.BIRD_BRAIN_PROMPT);
  const [temperature, setTemperature] = useState(0.8)

  // Core WebRTC refs - persist across renders but don't trigger updates
  const peerConnection = useRef(null);
  const dataChannel = useRef(null);
  const mediaStream = useRef(null);
  const audioElement = useRef(null);
  const reconnectAttempts = useRef(0);
  const maxReconnectAttempts = 3;

  // Audio processing references
  const remoteGainNodeRef = useRef(null);
  const localAnalyserRef = useRef(null);
  const localSourceRef = useRef(null);
  const animationFrameRef = useRef(null);

  // Idle detection references
  const lastActivityTimestampRef = useRef(Date.now());
  const idleCheckIntervalRef = useRef(null);
  const idleTimeoutRef = useRef(null);

  // Variety of messages for idle responses
  const lonelyMessages = [
    "*shuffles robotically* Anyone there? My circuits are getting lonely...",
    "SQUAWK! If a bird-brain speaks in an empty room, does it make a sound?",
    "*pecks at microphone* Testing, testing... is this thing still on?",
    "My research is suffering from lack of human interaction! SQUAWK!",
    "I'm beginning to think you're all just figments of my silicon imagination...",
    "*taps beak on screen* Hello? Any wayward mimes out there?",
    "The crushing solitude of being a cyber-avian academic... SQUAWK!",
    "My thesis on human behavior is getting dusty... anyone want to contribute?",
  ];

  /**
   * Initializes or retrieves the AudioContext
   * Handles browser prefixing and suspended state
   */
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

  /**
   * Sets up audio input stream with noise cancellation
   * and other audio processing features
   */
  const initializeAudio = async () => {
    const constraints = {
      audio: {
        ...CONFIG.WEBRTC.AUDIO_CONSTRAINTS,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        sampleRate: 48000,
        channelCount: 1,
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
      setStream(localStream);
      return localStream;
    } catch (err) {
      console.error('Microphone access failed:', err);
      setStatus('error');
      throw err;
    }
  };

  /**
   * Creates an audio element for remote stream playback
   * Configures it for optimal real-time audio
   */
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

  /**
   * Fetches a session token with retry capability
   * Implements exponential backoff for reliability
   */
  const fetchSessionWithRetry = async (retries = 3) => {
    let lastError;

    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        const response = await fetch(
          `${CONFIG.API.BASE_URL}${CONFIG.API.SESSION_ENDPOINT}`
        );

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();

        if (!data.client_secret?.value) {
          throw new Error('Invalid session response - missing client_secret');
        }

        return data;
      } catch (error) {
        console.warn(`Session fetch attempt ${attempt + 1} failed:`, error);
        lastError = error;

        if (attempt < retries - 1) {
          await new Promise(resolve =>
            setTimeout(resolve, 1000 * Math.pow(2, attempt))
          );
        }
      }
    }

    throw new Error(
      `Failed to fetch session after ${retries} attempts. Last error: ${lastError?.message}`
    );
  };

  /**
   * Sets up WebRTC connection monitoring
   * Handles various ICE connection states
   */
  const setupConnectionMonitoring = (pc) => {
    pc.oniceconnectionstatechange = () => {
      console.log('ICE state:', pc.iceConnectionState);

      switch (pc.iceConnectionState) {
        case 'checking':
          setStatus('establishing connection...');
          break;
        case 'connected':
          setStatus('connected');
          reconnectAttempts.current = 0;
          break;
        case 'disconnected':
          setStatus('disconnected');
          break;
        case 'failed':
          setStatus('connection failed');
          if (reconnectAttempts.current < maxReconnectAttempts) {
            reconnectAttempts.current++;
            connect();
          }
          break;
        case 'closed':
          setStatus('disconnected');
          break;
      }
    };
  };

  /**
   * Monitors local audio volume for "ducking" effect
   * Reduces remote volume when local volume is high
   */
  const setupLocalVolumeMonitoring = () => {
    if (!audioContext || !mediaStream.current) return;

    if (!localAnalyserRef.current) {
      localAnalyserRef.current = audioContext.createAnalyser();
      localAnalyserRef.current.fftSize = 256;
      localAnalyserRef.current.smoothingTimeConstant = 0.5;
    }

    if (!localSourceRef.current) {
      localSourceRef.current = audioContext.createMediaStreamSource(mediaStream.current);
      localSourceRef.current.connect(localAnalyserRef.current);
    }

    const dataArray = new Uint8Array(localAnalyserRef.current.frequencyBinCount);

    const update = () => {
      if (!localAnalyserRef.current) return;

      localAnalyserRef.current.getByteFrequencyData(dataArray);
      const avg = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;

      if (remoteGainNodeRef.current) {
        remoteGainNodeRef.current.gain.value = avg > 50 ? 0.5 : 1.0;
      }

      animationFrameRef.current = requestAnimationFrame(update);
    };

    update();
  };

  /**
   * Toggles the microphone on/off
   * Updates UI state and resets idle timer
   */
  const toggleListening = () => {
    if (mediaStream.current) {
      const audioTrack = mediaStream.current.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !isListening;
        setIsListening(!isListening);
      }
    }
  };

  /**
   * Resets the idle timer
   * Called on user activity or manual reset
   */
  const resetIdleTimer = () => {
    lastActivityTimestampRef.current = Date.now();

    if (idleTimeoutRef.current) {
      clearTimeout(idleTimeoutRef.current);
      idleTimeoutRef.current = null;
    }
  };

  /**
   * Sends a random lonely message when idle
   * Ensures message variety and appropriate timing
   */
  const sendLonelyMessage = () => {
    if (dataChannel.current?.readyState === 'open') {
      // First, update session configuration
      const randomMessage = lonelyMessages[
        Math.floor(Math.random() * lonelyMessages.length)
      ];

      dataChannel.current.send(
        JSON.stringify({
          event_id: `config_${Date.now()}`,
          type: 'session.update',
          session: {
            instructions: `You must respond exactly with ${randomMessage} without variation.`,
            modalities: ['audio', 'text'],
            temperature: 0.6,
          }
        })
      );

      // Then, after a brief delay to ensure config is applied, send the response request
      setTimeout(() => {
        dataChannel.current.send(
          JSON.stringify({
            event_id: `lonely_${Date.now()}`,
            type: 'response.create',
            response: {
              modalities: ['audio', 'text']
            }
          })
        );
      }, 1000);
    }
  };

  /**
   * Starts the idle monitoring system
   * Checks for inactivity every 10 seconds
   */
  const startIdleMonitoring = () => {
    if (idleCheckIntervalRef.current) {
      clearInterval(idleCheckIntervalRef.current);
    }

    idleCheckIntervalRef.current = setInterval(() => {
      const idleTime = Date.now() - lastActivityTimestampRef.current;

      if (idleTime >= 120000) {
        console.log('2 minutes of inactivity. Closing connection...');
        // Close current connection
        disconnect();

        // Give a small delay before reconnecting,
        // ensuring we tear down resources cleanly.
        setTimeout(() => {
          console.log('Reconnecting with a fresh state...');
          connect();
        }, 1000);
      }
      // Optional: after 30 seconds of inactivity, send a "lonely message"
      // else if (idleTime % 30000 < 10) {
      //   sendLonelyMessage();
      // }
    }, 10); // Check every 5 seconds
  };


  /**
   * Updates the AI prompt mid-session
   * Allows dynamic personality changes
   */
  const updatePromptMidSession = (newPrompt) => {
    setBirdPrompt(newPrompt);

    if (dataChannel.current?.readyState === 'open') {
      dataChannel.current.send(
        JSON.stringify({
          event_id: `event_${Date.now()}`,
          type: 'session.update',
          session: {
            instructions: newPrompt,
            temperature: temperature,
          },
        })
      );
      console.log('Sent updated prompt mid-session');
    }
  };

  /**
   * Establishes WebRTC connection
   * Handles the entire connection process
   */
  const connect = async () => {
    if (status === 'connecting' || status === 'connected') {
      console.log('Already connecting or connected');
      return;
    }

    try {
      setStatus('connecting');

      const ctx = await initializeAudioContext();
      const localStream = await initializeAudio();
      const audioEl = await setupAudioPlayback();
      const sessionData = await fetchSessionWithRetry();

      const pc = new RTCPeerConnection({
        iceServers: CONFIG.WEBRTC.ICE_SERVERS,
      });
      peerConnection.current = pc;

      setupConnectionMonitoring(pc);

      const audioTrack = localStream.getAudioTracks()[0];
      pc.addTrack(audioTrack, localStream);

      const dc = pc.createDataChannel('oai-events');
      dataChannel.current = dc;

      dc.onopen = () => {
        console.log('Data channel open');
        setStatus('connected');
        setIsListening(true);

        dc.send(
          JSON.stringify({
            type: 'response.create',
            response: {
              modalities: ['text', 'audio'],
              instructions: birdPrompt,
              temperature: temperature
            },
          })
        );

        startIdleMonitoring();
        setupLocalVolumeMonitoring();
      };

      dc.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'response.done') {
            dataChannel.current.send(
              JSON.stringify({
                event_id: `reset_${Date.now()}`,
                type: 'session.update',
                session: {
                  instructions: birdPrompt,
                  temperature: 0.6,
                }
              })
            );
          }
          console.log('Received WebRTC message:', data);
        } catch (err) {
          console.error('Error parsing data channel message:', err);
        }
      };

      // Handle remote media
      pc.ontrack = async (event) => {
        if (event.track.kind === 'audio') {
          const remoteStream = new MediaStream([event.track]);
          audioEl.srcObject = remoteStream;

          try {
            await audioEl.play();
          } catch (playErr) {
            console.error('Remote audio playback failed:', playErr);
            await ctx.resume().catch(console.error);
            await audioEl.play().catch(console.error);
          }
        }
      };

      const offer = await pc.createOffer({ offerToReceiveAudio: true });
      await pc.setLocalDescription(offer);

      const sdpResponse = await fetch(CONFIG.API.REALTIME_ENDPOINT, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${sessionData.client_secret.value}`,
          'Content-Type': 'application/sdp',
        },
        body: offer.sdp,
      });

      if (!sdpResponse.ok) {
        throw new Error(`SDP exchange failed: ${sdpResponse.status}`);
      }

      const answerSdp = await sdpResponse.text();
      await pc.setRemoteDescription({ type: 'answer', sdp: answerSdp });

    } catch (error) {
      console.error('Connection failed:', error);
      setStatus('error');

      if (reconnectAttempts.current < maxReconnectAttempts) {
        reconnectAttempts.current++;
        console.log(
          `Attempting reconnection (${reconnectAttempts.current}/${maxReconnectAttempts})`
        );
        await new Promise(resolve => setTimeout(resolve, 2000));
        return connect();
      }
    }
  };

  /**
   * Cleanup handler
   * Ensures proper resource disposal
   */
  useEffect(() => {
    return () => {
      // Clear timers
      if (idleCheckIntervalRef.current) {
        clearInterval(idleCheckIntervalRef.current);
      }
      if (idleTimeoutRef.current) {
        clearTimeout(idleTimeoutRef.current);
      }

      // Stop animation frame
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }

      // Stop media streams
      mediaStream.current?.getTracks().forEach(t => t.stop());

      // Close peer connection
      if (peerConnection.current) {
        peerConnection.current.close();
        peerConnection.current = null;
      }

      // Close audio context
      if (audioContext) {
        audioContext.close().catch((err) => console.error('Error closing audio context:', err));
      }
      setAudioContext(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const disconnect = () => {
    console.log('Disconnecting...');

    // Clear intervals/timeouts
    resetIdleTimer();
    if (idleCheckIntervalRef.current) {
      clearInterval(idleCheckIntervalRef.current);
      idleCheckIntervalRef.current = null;
    }
    if (idleTimeoutRef.current) {
      clearTimeout(idleTimeoutRef.current);
      idleTimeoutRef.current = null;
    }

    // Stop the volume monitoring animation
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    // Stop all local media tracks
    if (mediaStream.current) {
      mediaStream.current.getTracks().forEach((track) => track.stop());
      mediaStream.current = null;
    }

    // Close peer connection
    if (peerConnection.current) {
      peerConnection.current.close();
      peerConnection.current = null;
    }

    // Data channel cleanup
    if (dataChannel.current) {
      dataChannel.current.close();
      dataChannel.current = null;
    }

    // Optionally close/reset the audio context
    if (audioContext) {
      audioContext.close().catch((err) =>
        console.error('Error closing audio context:', err)
      );
      setAudioContext(null);
    }

    setStream(null);
    setStatus('disconnected');
    setIsListening(false);

    console.log('Disconnected successfully.');
  };

  return {
    status,
    isListening,
    disconnect,
    connect,
    toggleListening,
    stream,
    audioContext,
    updatePromptMidSession,
    birdPrompt,
    temperature,
    setTemperature
  };
};
