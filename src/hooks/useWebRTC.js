// src/hooks/useWebRTC.js
import { useState, useEffect, useRef } from 'react';
import { CONFIG } from '../config';

export const useWebRTC = () => {
  const [status, setStatus] = useState('disconnected');
  const [isListening, setIsListening] = useState(false);
  const [stream, setStream] = useState(null);
  
  const peerConnection = useRef(null);
  const dataChannel = useRef(null);
  const mediaStream = useRef(null);
  const audioElement = useRef(null);

  const initializeAudio = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: CONFIG.WEBRTC.AUDIO_CONSTRAINTS
      });
      mediaStream.current = stream;
      setStream(stream);  // Make stream available to components
      return stream;
    } catch (error) {
      console.error('Microphone access failed:', error);
      throw new Error('Microphone access failed');
    }
  };

  const setupAudioPlayback = () => {
    const audio = new Audio();
    audio.autoplay = true;
    audio.playsInline = true;
    audioElement.current = audio;
    return audio;
  };

  const connect = async () => {
    try {
      setStatus('connecting');
      
      const stream = await initializeAudio();
      const audio = setupAudioPlayback();
      
      console.log('Fetching session from:', `${CONFIG.API.BASE_URL}${CONFIG.API.SESSION_ENDPOINT}`);
      const sessionResponse = await fetch(`${CONFIG.API.BASE_URL}${CONFIG.API.SESSION_ENDPOINT}`);
      if (!sessionResponse.ok) {
        const errorText = await sessionResponse.text();
        console.error('Session response error:', errorText);
        throw new Error(`Failed to get session token: ${sessionResponse.status} ${errorText}`);
      }
      const data = await sessionResponse.json();
      
      if (!data.client_secret?.value) {
        throw new Error('Invalid session response - missing client_secret');
      }
      
      const pc = new RTCPeerConnection({ 
        iceServers: CONFIG.WEBRTC.ICE_SERVERS 
      });
      peerConnection.current = pc;

      // Add audio track
      const audioTrack = stream.getAudioTracks()[0];
      pc.addTrack(audioTrack, stream);

      // Handle incoming audio
      pc.ontrack = (event) => {
        if (event.track.kind === 'audio') {
          // Mute microphone while bird is speaking
          if (mediaStream.current) {
            const audioTrack = mediaStream.current.getAudioTracks()[0];
            audioTrack.enabled = false;
            setIsListening(false);
          }

          audio.srcObject = new MediaStream([event.track]);
          
          // Re-enable microphone when bird stops speaking
          event.track.onended = () => {
            if (mediaStream.current) {
              const audioTrack = mediaStream.current.getAudioTracks()[0];
              audioTrack.enabled = true;
              setIsListening(true);
            }
          };

          audio.play().catch(console.error);
        }
      };

      // Set up data channel
      const dc = pc.createDataChannel('oai-events');
      dataChannel.current = dc;
      
      dc.onopen = () => {
        setStatus('connected');
        setIsListening(true);  // Enable listening by default when connected
        dc.send(JSON.stringify({
          type: 'response.create',
          response: {
            modalities: ['text', 'audio'],
            instructions: CONFIG.BIRD_BRAIN_PROMPT
          }
        }));
      };

      // Create and send offer
      const offer = await pc.createOffer({ offerToReceiveAudio: true });
      await pc.setLocalDescription(offer);

      const sdpResponse = await fetch(`${CONFIG.API.REALTIME_ENDPOINT}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${data.client_secret.value}`,
          'Content-Type': 'application/sdp'
        },
        body: offer.sdp
      });

      const answerSdp = await sdpResponse.text();
      await pc.setRemoteDescription({ type: 'answer', sdp: answerSdp });
      
    } catch (error) {
      console.error('Connection failed:', error);
      setStatus('error');
      throw error;
    }
  };

  const toggleListening = () => {
    if (mediaStream.current) {
      const audioTrack = mediaStream.current.getAudioTracks()[0];
      audioTrack.enabled = !isListening;
      setIsListening(!isListening);
    }
  };

  useEffect(() => {
    return () => {
      mediaStream.current?.getTracks().forEach(track => track.stop());
      peerConnection.current?.close();
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