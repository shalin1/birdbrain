import { useState, useEffect, useRef } from 'react';
import { CONFIG } from '../config';

/**
 * useWebRTC
 *
 * Manages:
 *  - WebRTC peer connection
 *  - Local/remote audio streams
 *  - Browser-provided echo cancellation & noise suppression
 *  - (Optional) "ducking" logic to reduce remote volume when local mic is loud
 */
export const useWebRTC = () => {
  const [status, setStatus] = useState('disconnected');
  const [isListening, setIsListening] = useState(false);
  const [stream, setStream] = useState(null);

  // We'll store one shared AudioContext for both local & remote processing
  const [audioContext, setAudioContext] = useState(null);
  const [birdPrompt, setBirdPrompt] = useState(CONFIG.BIRD_BRAIN_PROMPT);
  // "ducking": gain node for remote audio, if we want to auto-lower volume
  const remoteGainNodeRef = useRef(null);

  const peerConnection = useRef(null);
  const dataChannel = useRef(null);
  const mediaStream = useRef(null);
  const audioElement = useRef(null);

  const reconnectAttempts = useRef(0);
  const maxReconnectAttempts = 3;

  // We’ll store an analyser node and a small script to measure local mic volume
  const localAnalyserRef = useRef(null);
  const localSourceRef = useRef(null);
  const animationFrameRef = useRef(null);

  /**
   * Initialize or reuse a single AudioContext.
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
      console.error('AudioContext init failed:', error);
      setStatus('error');
      throw error;
    }
  };

  /**
   * Get mic access with built-in echo cancellation, noise suppression, etc.
   */
  const initializeAudio = async () => {
    const constraints = {
      audio: {
        ...CONFIG.WEBRTC.AUDIO_CONSTRAINTS,
        // Turn on built-in browser DSP
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
   * Create or reuse a hidden audio element for remote playback, and optionally,
   * route that audio through a GainNode for "ducking" or volume adjustments.
   */
  const setupAudioPlayback = async () => {
    const audio = new Audio();
    audio.autoplay = true;
    audio.playsInline = true;
    audio.onerror = (e) => {
      console.error('Remote audio playback error:', e);
      setStatus('error');
    };

    await initializeAudioContext();

    audioElement.current = audio;
    return audio;
  };

  /**
   * Connect to server via WebRTC.
   */
  const connect = async () => {
    if (status === 'connecting' || status === 'connected') {
      console.log('Already connecting or connected, skipping connect()');
      return;
    }
    try {
      setStatus('connecting');

      const ctx = await initializeAudioContext();
      const localStream = await initializeAudio();
      const audioEl = await setupAudioPlayback();
      const sessionData = await fetchSessionWithRetry();

      // Create PeerConnection
      const pc = new RTCPeerConnection({
        iceServers: CONFIG.WEBRTC.ICE_SERVERS,
      });
      peerConnection.current = pc;

      // Monitor ICE states
      setupConnectionMonitoring(pc);

      // Add local tracks
      const audioTrack = localStream.getAudioTracks()[0];
      pc.addTrack(audioTrack, localStream);

      // Optionally set up remote GainNode for ducking
      if (!remoteGainNodeRef.current) {
        remoteGainNodeRef.current = ctx.createGain();
        remoteGainNodeRef.current.gain.value = 1.0; // default to full volume
        remoteGainNodeRef.current.connect(ctx.destination);
      }

      // Handle remote track
      pc.ontrack = async (event) => {
        if (event.track.kind === 'audio') {
          // Create a remote stream for the track
          const remoteStream = new MediaStream([event.track]);

          // Route the remote stream to our audio element
          audioEl.srcObject = remoteStream;

          // Also route the remote stream to the remoteGainNode if you prefer
          // This is optional but allows us to do advanced gain manipulation in Web Audio
          const remoteSource = ctx.createMediaStreamSource(remoteStream);
          remoteSource.connect(remoteGainNodeRef.current); // now the browser won't auto-play this, we might rely on the <audio> or the node

          // Attempt playback
          try {
            await audioEl.play();
          } catch (playErr) {
            console.error('Remote audio playback failed:', playErr);
            // Attempt to resume context & play again
            await ctx.resume().catch((resumeErr) => {
              console.error('Could not resume audio context:', resumeErr);
            });
            await audioEl.play().catch((finalErr) => {
              console.error('Still could not play audio:', finalErr);
            });
          }
        }
      };

      // Data channel
      const dc = pc.createDataChannel('oai-events');
      dataChannel.current = dc;
      dc.onopen = () => {
        console.log('Data channel open');
        setStatus('connected');
        setIsListening(true);

        // Example initial message
        dc.send(
          JSON.stringify({
            type: 'response.create',
            response: {
              modalities: ['text', 'audio'],
              instructions: birdPrompt,
            },
          })
        );

        // Start local mic volume monitoring for optional "ducking"
        setupLocalVolumeMonitoring();
      };
      dc.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          console.log('Received WebRTC message:', data);
          // handle data...
        } catch (err) {
          console.error('Error parsing data channel message:', err);
        }
      };

      // Create + Send Offer
      const offer = await pc.createOffer({ offerToReceiveAudio: true });
      await pc.setLocalDescription(offer);

      // Exchange SDP with server
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

      // Retry logic
      if (reconnectAttempts.current < maxReconnectAttempts) {
        reconnectAttempts.current++;
        console.log(
          `Attempting reconnection (${reconnectAttempts.current}/${maxReconnectAttempts})`
        );
        await new Promise((resolve) => setTimeout(resolve, 2000));
        return connect();
      }
      // else give up
    }
  };

  /**
   * Microphone volume monitoring to implement "ducking":
   * If local volume is high, lower remote gain a bit to reduce feedback.
   * You can customize thresholds, timing, etc.
   */
  const setupLocalVolumeMonitoring = () => {
    if (!audioContext || !mediaStream.current) return;

    // Create an analyser node to measure local mic volume
    if (!localAnalyserRef.current) {
      localAnalyserRef.current = audioContext.createAnalyser();
      localAnalyserRef.current.fftSize = 256;
      localAnalyserRef.current.smoothingTimeConstant = 0.5;
    }

    // Create or reuse a source node for the local mic
    if (!localSourceRef.current) {
      localSourceRef.current = audioContext.createMediaStreamSource(mediaStream.current);
      localSourceRef.current.connect(localAnalyserRef.current);
    }

    const dataArray = new Uint8Array(localAnalyserRef.current.frequencyBinCount);

    const update = () => {
      if (!localAnalyserRef.current) return;

      localAnalyserRef.current.getByteFrequencyData(dataArray);
      const avg = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
      // Normalized range is roughly 0-255 for getByteFrequencyData
      // We'll pick an arbitrary threshold. Tweak as needed.
      const threshold = 50;

      // If local voice is quite loud, reduce remote gain to 0.5; otherwise 1.0
      if (remoteGainNodeRef.current) {
        if (avg > threshold) {
          remoteGainNodeRef.current.gain.value = 0.5;
        } else {
          remoteGainNodeRef.current.gain.value = 1.0;
        }
      }

      animationFrameRef.current = requestAnimationFrame(update);
    };

    update();
  };

  /**
   * Helper function for session token fetching with retries.
   */
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
        await new Promise((resolve) => setTimeout(resolve, 1000 * (i + 1)));
      }
    }
  };

  /**
   * ICE state change monitoring.
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
        default:
          break;
      }
    };
  };

  /**
   * Toggle local mic track on/off.
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
   * Allows us to send a new "update" message to the server **without** reconnecting.
   * This can be used to change the system instructions or conversation context.
   */
  const updatePromptMidSession = (newPrompt) => {
    // Update local state
    setBirdPrompt(newPrompt);

    // Send new instructions over the data channel
    // The server must recognize "response.update" (or your chosen type)
    // and apply it as the new system instructions.
    if (dataChannel.current && dataChannel.current.readyState === 'open') {
      dataChannel.current.send(
        JSON.stringify({
          type: 'response.update',
          response: {
            instructions: newPrompt,
          },
        })
      );
      console.log('Sent updated prompt mid-session');
    } else {
      console.warn('Data channel not open; cannot update prompt mid-session');
    }
  };


  /**
   * Cleanup
   */
  useEffect(() => {
    return () => {
      // Stop any running animation frames
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }

      // Stop local tracks
      mediaStream.current?.getTracks().forEach((t) => t.stop());

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

  return {
    status,
    isListening,
    connect,
    toggleListening,
    stream,
    audioContext,
  };
};
