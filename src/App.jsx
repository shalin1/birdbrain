import React, { useState, useEffect, useRef } from 'react';
import { Mic, MicOff } from 'lucide-react';
import { useWebRTC } from './hooks/useWebRTC';

/**
 * AudioMeter
 * 
 * Displays volume bars based on the provided audio `stream`.
 * Relies on the external AudioContext passed from props.
 */
const AudioMeter = ({ stream, isListening, audioContext }) => {
  const [volume, setVolume] = useState(0);
  const analyserRef = useRef(null);
  const sourceRef = useRef(null);
  const animationFrameRef = useRef(null);

  useEffect(() => {
    // Cleanup function to stop volume analysis
    const cleanup = () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      if (sourceRef.current) {
        sourceRef.current.disconnect();
        sourceRef.current = null;
      }
      analyserRef.current = null;
    };

    // If we don't have a valid stream or we're not "listening," zero out
    if (!stream || !isListening || !audioContext) {
      setVolume(0);
      cleanup();
      return;
    }

    try {
      // Create analyser if not already available
      if (!analyserRef.current) {
        analyserRef.current = audioContext.createAnalyser();
        analyserRef.current.fftSize = 1024;
        analyserRef.current.smoothingTimeConstant = 0.8;
      }

      // Create a MediaStreamSource if none exists yet
      if (!sourceRef.current) {
        sourceRef.current = audioContext.createMediaStreamSource(stream);
        sourceRef.current.connect(analyserRef.current);
      }

      const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);

      const updateVolume = () => {
        if (!analyserRef.current) return;
        analyserRef.current.getByteFrequencyData(dataArray);

        // Focus on the lower ~40% frequency range (roughly speech)
        const speechRange = dataArray.slice(0, Math.floor(dataArray.length * 0.4));
        const sum = speechRange.reduce((acc, val) => acc + val, 0);
        const averageVolume = sum / speechRange.length;

        // Normalize and apply mild power curve
        const normalizedVolume = Math.pow(averageVolume / 128, 1.2);

        // Smooth transitions
        setVolume((prev) => prev * 0.6 + normalizedVolume * 0.4);

        animationFrameRef.current = requestAnimationFrame(updateVolume);
      };

      updateVolume();

      // Cleanup on effect re-run or component unmount
      return cleanup;
    } catch (error) {
      console.error('AudioMeter: Error setting up audio analysis', error);
      cleanup();
    }
  }, [stream, isListening, audioContext]);

  return (
    <div className="flex items-center space-x-2 bg-gray-100 p-3 rounded-lg">
      {/* Microphone icon */}
      <div className="flex-shrink-0">
        {isListening ? (
          <Mic className="w-6 h-6 text-green-500" />
        ) : (
          <MicOff className="w-6 h-6 text-red-500" />
        )}
      </div>

      {/* Volume Bars */}
      <div className="relative flex h-20 items-end gap-0.5 bg-gray-200 p-1">
        {[...Array(16)].map((_, i) => {
          // Additional scaling for each bar
          const barScale = 0.3 + ((i + 1) / 16) * 0.7;
          // Another small power transform for a more dramatic look
          const smoothedVolume = Math.pow(volume, 1.5);
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

/**
 * VoiceChat
 * 
 * Provides:
 *  - Connection to a remote WebRTC server
 *  - Local microphone streaming
 *  - A volume meter (AudioMeter)
 *  - UI for connecting/disconnecting/muting
 */
const VoiceChat = () => {
  const {
    status,
    isListening,
    connect,
    toggleListening,
    stream,
    audioContext,
  } = useWebRTC();

  useEffect(() => {
    console.log('VoiceChat: status or listening changed', {
      status,
      isListening,
      hasStream: !!stream,
    });
  }, [status, isListening, stream]);

  // Helper to display user-friendly status text
  const renderStatusText = () => {
    switch (status) {
      case 'connecting':
        return 'Connecting to Bird Brain...';
      case 'connected':
        return 'Ready to squawk!';
      case 'disconnected':
        return 'Disconnected';
      case 'error':
        return 'An error occurred. Please try again.';
      default:
        return status;
    }
  };

  return (
    <div className="w-full max-w-md mx-auto p-6">
      <div className="bg-white rounded-lg shadow-xl p-6 space-y-4">
        <div className="text-center">
          <h2 className="text-xl font-semibold mb-2">Professor Bird Brain's Lab</h2>
          <p className="text-gray-600 mb-4">{renderStatusText()}</p>
        </div>

        {/* Connect button if not connected */}
        {status === 'disconnected' && (
          <button
            onClick={connect}
            className="w-full bg-blue-500 text-white px-4 py-3 rounded-lg hover:bg-blue-600 transition-colors"
          >
            Connect to Bird Brain
          </button>
        )}

        {/* Show meter + mute/unmute if connected */}
        {status === 'connected' && (
          <div className="space-y-4">
            <AudioMeter
              stream={stream}
              isListening={isListening}
              audioContext={audioContext}
            />
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
