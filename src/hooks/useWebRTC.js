import { useState, useEffect, useRef } from 'react';
import { CONFIG } from '../config';

export const useWebRTC = () => {
  // React state
  const [status, setStatus] = useState('disconnected');
  const [isListening, setIsListening] = useState(false);
  const [stream, setStream] = useState(null);
  const [audioContext, setAudioContext] = useState(null);

  // Persistent refs
  const peerConnection = useRef(null);
  const dataChannel = useRef(null);
  const mediaStream = useRef(null);
  const audioElement = useRef(null);
  const reconnectAttempts = useRef(0);
  const maxReconnectAttempts = 3;

  /**
   * Initialize a single AudioContext for the entire app.
   */
  const initializeAudioContext = async () => {
    if (audioContext) return audioContext; // reuse if already created
    try {
      const newCtx = new (window.AudioContext || window.webkitAudioContext)();
      if (newCtx.state === 'suspended') {
        await newCtx.resume();
      }
      setAudioContext(newCtx);
      return newCtx;
    } catch (error) {
      console.error('Audio context initialization failed:', error);
      setStatus('error');
      throw error;
    }
  };

  /**
   * Prompt user for mic access, store stream in state.
   */
  const initializeAudio = async () => {
    try {
      await initializeAudioContext();
      const localStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          ...CONFIG.WEBRTC.AUDIO_CONSTRAINTS,
          sampleRate: 48000,
          channelCount: 1,
        },
      });

      const audioTrack = localStream.getAudioTracks()[0];
      if (!audioTrack || !audioTrack.enabled) {
        throw new Error('No valid audio track available');
      }

      mediaStream.current = localStream;
      setStream(localStream);
      return localStream;
    } catch (error) {
      console.error('Microphone access failed:', error);
      setStatus('error');
      throw new Error(`Microphone access failed: ${error.message}`);
    }
  };

  /**
   * Create a hidden <audio> element for remote playback.
   */
  const setupAudioPlayback = async () => {
    try {
      const audio = new Audio();
      audio.autoplay = true;
      audio.playsInline = true;
      audio.onerror = (e) => {
        console.error('Audio playback error:', e);
        setStatus('error');
      };

      await initializeAudioContext();
      audioElement.current = audio;
      return audio;
    } catch (error) {
      console.error('Audio playback setup failed:', error);
      throw error;
    }
  };

  /**
   * Main connection logic with WebRTC + server handshake.
   */
  const connect = async () => {
    // Prevent double-connections if already connecting or connected
    if (status === 'connecting' || status === 'connected') {
      console.log('Already connecting or connected, ignoring connect() call.');
      return;
    }

    try {
      setStatus('connecting');

      const ctx = await initializeAudioContext();
      const localStream = await initializeAudio();
      const audioEl = await setupAudioPlayback();
      const sessionData = await fetchSessionWithRetry();

      // Create peer connection
      const pc = new RTCPeerConnection({
        iceServers: CONFIG.WEBRTC.ICE_SERVERS,
      });
      peerConnection.current = pc;

      // Monitor ICE states
      setupConnectionMonitoring(pc);

      // Add local audio track
      const audioTrack = localStream.getAudioTracks()[0];
      if (!audioTrack) throw new Error('No audio track available');
      pc.addTrack(audioTrack, localStream);

      // Handle remote track
      pc.ontrack = async (event) => {
        if (event.track.kind === 'audio') {
          try {
            // Assign the remote track to an <audio> element
            const remoteStream = new MediaStream([event.track]);
            audioEl.srcObject = remoteStream;

            // Attempt to play
            await audioEl.play();
          } catch (playError) {
            console.error('Remote audio playback failed:', playError);
            // Attempt recovery
            await ctx.resume().catch((resumeErr) =>
              console.error('Could not resume AudioContext:', resumeErr)
            );
            await audioEl.play().catch((finalErr) =>
              console.error('Still could not play audio:', finalErr)
            );
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
              instructions: CONFIG.BIRD_BRAIN_PROMPT,
            },
          })
        );
      };

      dc.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          console.log('Received WebRTC message:', data);
          // Handle errors or rate limits if needed
        } catch (err) {
          console.error('Error parsing WebRTC message:', err);
        }
      };

      // Create offer
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
        throw new Error(`SDP exchange failed: HTTP ${sdpResponse.status}`);
      }
      const answerSdp = await sdpResponse.text();
      await pc.setRemoteDescription({ type: 'answer', sdp: answerSdp });
    } catch (error) {
      console.error('Connection failed:', error);
      setStatus('error');

      // Attempt reconnection if under the max attempts
      if (reconnectAttempts.current < maxReconnectAttempts) {
        reconnectAttempts.current++;
        console.log(
          `Attempting reconnection (${reconnectAttempts.current}/${maxReconnectAttempts})...`
        );
        await new Promise((resolve) => setTimeout(resolve, 2000));
        return connect();
      }
    }
  };

  /**
   * Fetch session token with limited retries.
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
   * Monitor ICE connection states and update status accordingly.
   */
  const setupConnectionMonitoring = (pc) => {
    pc.oniceconnectionstatechange = () => {
      console.log('ICE connection state:', pc.iceConnectionState);
      switch (pc.iceConnectionState) {
        case 'checking':
          setStatus('establishing connection...');
          break;
        case 'connected':
          setStatus('connected');
          reconnectAttempts.current = 0; // reset on success
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
   * Toggle local mic on/off.
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
   * Cleanup when unmounting.
   */
  useEffect(() => {
    return () => {
      // Stop local tracks
      mediaStream.current?.getTracks().forEach((track) => track.stop());

      // Close peer connection
      if (peerConnection.current) {
        peerConnection.current.close();
        peerConnection.current = null;
      }

      // Close audio context if desired
      if (audioContext) {
        audioContext.close().catch((err) =>
          console.error('Error closing audio context:', err)
        );
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
