import React, { useState, useEffect, useRef } from 'react';
import { useWebRTC } from './hooks/useWebRTC';
import { Mic, MicOff } from 'lucide-react';

const AudioMeter = ({ stream, isListening }) => {
  const [volume, setVolume] = useState(0);
  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const animationFrameRef = useRef(null);
  const sourceRef = useRef(null);
  
  // Initialize audio context and analyzer
  useEffect(() => {
    console.log('AudioMeter: Stream changed', { stream, isListening });
    
    if (!stream || !isListening) {
      console.log('AudioMeter: No stream or not listening');
      setVolume(0);
      return;
    }

    try {
      // Create AudioContext if it doesn't exist
      if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)();
        console.log('AudioMeter: Created new AudioContext');
      }

      // Create Analyzer if it doesn't exist
      if (!analyserRef.current) {
        analyserRef.current = audioContextRef.current.createAnalyser();
        analyserRef.current.fftSize = 1024;
        analyserRef.current.smoothingTimeConstant = 0.8;
        console.log('AudioMeter: Created new Analyser');
      }

      // Connect the stream
      if (!sourceRef.current) {
        sourceRef.current = audioContextRef.current.createMediaStreamSource(stream);
        sourceRef.current.connect(analyserRef.current);
        console.log('AudioMeter: Connected stream to analyser');
      }

      const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);

      const updateVolume = () => {
        if (!analyserRef.current) return;
        
        analyserRef.current.getByteFrequencyData(dataArray);
        
        // Focus on the frequency range most relevant to speech
        const speechRange = dataArray.slice(0, Math.floor(dataArray.length * 0.4));
        const values = speechRange.reduce((acc, val) => acc + val, 0);
        const averageVolume = values / speechRange.length;
        
        // Apply non-linear scaling for better dynamics
        const normalizedVolume = Math.pow(averageVolume / 128, 1.2);
        
        // Smooth the transitions
        setVolume(prev => prev * 0.6 + normalizedVolume * 0.4);
        animationFrameRef.current = requestAnimationFrame(updateVolume);
      };

      console.log('AudioMeter: Starting volume updates');
      updateVolume();

      return () => {
        if (animationFrameRef.current) {
          cancelAnimationFrame(animationFrameRef.current);
        }
        if (sourceRef.current) {
          sourceRef.current.disconnect();
          sourceRef.current = null;
        }
        console.log('AudioMeter: Cleaned up');
      };
    } catch (error) {
      console.error('AudioMeter: Error setting up audio analysis:', error);
    }
  }, [stream, isListening]);

  const bars = Array(16).fill(0);
  
  return (
    <div className="flex items-center space-x-2 bg-gray-100 p-3 rounded-lg">
      <div className="flex-shrink-0">
        {isListening ? (
          <Mic className="w-6 h-6 text-green-500" />
        ) : (
          <MicOff className="w-6 h-6 text-red-500" />
        )}
      </div>
      
      <div className="relative flex h-20 items-end gap-0.5 bg-gray-200 p-1">
        {[...Array(16)].map((_, i) => {
          // Progressive scaling for a more interesting visualization
          const barScale = 0.3 + ((i + 1) / 16) * 0.7;
          // Smooth the volume with exponential scaling
          const smoothedVolume = Math.pow(volume, 1.5);
          // Calculate height with minimum and progressive scaling
          const height = Math.max(2, Math.min(70, smoothedVolume * 70 * barScale));
          
          return (
            <div 
              key={i}
              className="absolute bottom-1"
              style={{
                height: `${height}px`,
                width: '6px',
                backgroundColor: 'rgb(34, 197, 94)',
                transition: 'all 100ms ease-out',
                left: `${i * 8 + 4}px`,
              }}
            />
          );
        })}
      </div>
      
      {/* Debug display */}
      <div className="text-xs text-gray-500 ml-2">
        {volume.toFixed(2)}
      </div>
    </div>
  );
};

const VoiceChat = () => {
  const { status, isListening, connect, toggleListening, stream } = useWebRTC();
  
  useEffect(() => {
    console.log('VoiceChat: Status or listening changed', { 
      status, 
      isListening,
      hasStream: !!stream 
    });
  }, [status, isListening, stream]);

  return (
    <div className="w-full max-w-md mx-auto p-6">
      <div className="bg-white rounded-lg shadow-xl p-6 space-y-4">
        <div className="text-center">
          <h2 className="text-xl font-semibold mb-2">
            Professor Bird Brain's Lab
          </h2>
          <p className="text-gray-600 mb-4">
            {status === 'connected' ? 'Ready to squawk!' : status}
          </p>
        </div>

        {status === 'disconnected' && (
          <button
            onClick={connect}
            className="w-full bg-blue-500 text-white px-4 py-3 rounded-lg hover:bg-blue-600 transition-colors"
          >
            Connect to Bird Brain
          </button>
        )}

        {status === 'connected' && (
          <div className="space-y-4">
            <AudioMeter stream={stream} isListening={isListening} />
            <button
              onClick={toggleListening}
              className={`w-full px-4 py-3 rounded-lg transition-colors ${
                isListening 
                  ? 'bg-red-500 hover:bg-red-600' 
                  : 'bg-green-500 hover:bg-green-600'
              } text-white`}
            >
              {isListening ? 'Mute Microphone' : 'Enable Microphone'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default VoiceChat;