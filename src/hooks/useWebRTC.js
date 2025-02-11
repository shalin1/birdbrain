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
  const [voice, setVoice] = useState("ballad")

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
  const sessionMaxLengthRef = useRef(Date.now());
  const sessionMaxLengthIntervalRef = useRef(null);
  const idleCheckIntervalRef = useRef(null);


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
        googEchoCancellation: true,
        googNoiseSuppression: true,
        googAutoGainControl: true,
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


  const resetIdleTimer = () => {
    lastActivityTimestampRef.current = Date.now();
  }

  const startSessionMaxLengthMonitoring = () => {
    sessionMaxLengthRef.current = Date.now();
    sessionMaxLengthIntervalRef.current = setInterval(() => {
      const idleTime = Date.now() - sessionMaxLengthRef.current;
      if (idleTime >= 15 * 60 * 1000) {
        console.log('15 minutes since session started. Closing connection...');
        disconnect();
      }
    }, 100);
  }

  /**
   * Starts the idle monitoring system
   * Checks for inactivity every 45 seconds
   */
  const startIdleMonitoring = () => {
    if (idleCheckIntervalRef.current) {
      clearInterval(idleCheckIntervalRef.current);
    }

    idleCheckIntervalRef.current = setInterval(() => {
      const idleTime = Date.now() - lastActivityTimestampRef.current;
      console.log('idleTime', idleTime)
      if (idleTime >= 2 * 60 * 1000) {
        console.log('2 minutes of inactivity. restarting conversation...');
        disconnect()
      }
    }, 500);
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
        dc.send(JSON.stringify({
          type: "session.update",
          session: {
            modalities: ["audio", "text"],
            instructions: birdPrompt,
            voice: voice,
            input_audio_format: "pcm16",
            output_audio_format: "pcm16",
            turn_detection: {
              type: "server_vad",
              threshold: 0.5,
              prefix_padding_ms: 500,
              silence_duration_ms: 500,
              create_response: true
            },
            temperature: temperature,
            max_response_output_tokens: 4096  // use a valid integer within the accepted range
          }
        }));

        dc.send(
          JSON.stringify({
            type: 'response.create',
            response: {
              modalities: ['text', 'audio'],
              instructions: birdPrompt,
              temperature: temperature,
            },
          })
        );

        // startIdleMonitoring();
        startSessionMaxLengthMonitoring();
        startIdleMonitoring()
        setupLocalVolumeMonitoring();
      };

      dc.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'response.output_item.added') {
            setStatus('responding')
            resetIdleTimer();
          }
          if (data.type === 'output_audio_buffer.audio_stopped') {
            setStatus('connected');
            dataChannel.current.send(
              JSON.stringify({
                event_id: `reset_${Date.now()}`,
                type: 'session.update',
                session: {
                  instructions: birdPrompt,
                  temperature: temperature,
                }
              })
            );
            resetIdleTimer();
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

  const disconnect = (disconnectWithoutReconnect = false) => {
    // First check if data channel is available and open
    if (!dataChannel.current || dataChannel.current.readyState !== 'open') {
      console.log('Data channel not available, proceeding with cleanup');
      cleanupConnection();
      return;
    }

    cleanupConnection(disconnectWithoutReconnect);
  };

  // Move cleanup logic to separate function
  const cleanupConnection = (disconnectWithoutReconnect = false) => {
    // Clear intervals/timeouts
    resetIdleTimer();
    if (idleCheckIntervalRef.current) {
      clearInterval(idleCheckIntervalRef.current);
      idleCheckIntervalRef.current = null;
    }

    if (sessionMaxLengthIntervalRef.current) {
      clearInterval(sessionMaxLengthIntervalRef.current);
      sessionMaxLengthIntervalRef.current = null;
    }

    // Stop animation frame
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    // Stop media streams
    if (mediaStream.current) {
      mediaStream.current.getTracks().forEach((track) => track.stop());
      mediaStream.current = null;
    }

    // Close peer connection
    if (peerConnection.current) {
      peerConnection.current.close();
      peerConnection.current = null;
    }

    // Close data channel
    if (dataChannel.current) {
      dataChannel.current.close();
      dataChannel.current = null;
    }

    // Close audio context
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
    if (!disconnectWithoutReconnect) {
      setTimeout(() => {
        console.log("Reconnecting after 5 seconds")
        connect()
      }, 100)
    }
  };

  return {
    status,
    voice,
    isListening,
    disconnect,
    connect,
    toggleListening,
    stream,
    audioContext,
    updatePromptMidSession,
    birdPrompt,
    temperature,
    setTemperature,
    setVoice
  };
};
