import React, { useState, useEffect, useRef } from 'react';
import { Mic, MicOff } from 'lucide-react';

const AudioMeter = ({ stream, isListening, audioContext }) => {
  const [volume, setVolume] = useState(0);
  const analyserRef = useRef(null);
  const sourceRef = useRef(null);
  const animationRef = useRef(null);

  useEffect(() => {
    const cleanup = () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
      if (sourceRef.current) {
        sourceRef.current.disconnect();
        sourceRef.current = null;
      }
      analyserRef.current = null;
    };

    // If no stream or not listening, reset volume and cleanup
    if (!stream || !isListening || !audioContext) {
      setVolume(0);
      cleanup();
      return;
    }

    try {
      // Create or reuse an analyser
      if (!analyserRef.current) {
        analyserRef.current = audioContext.createAnalyser();
        analyserRef.current.fftSize = 1024;
        analyserRef.current.smoothingTimeConstant = 0.8;
      }

      // Hook the stream to the analyser if not already
      if (!sourceRef.current) {
        sourceRef.current = audioContext.createMediaStreamSource(stream);
        sourceRef.current.connect(analyserRef.current);
      }

      const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);

      const update = () => {
        if (!analyserRef.current) return;
        analyserRef.current.getByteFrequencyData(dataArray);
        // Simplistic speech range ~ 0-40% of the frequencies
        const speechRange = dataArray.slice(0, Math.floor(dataArray.length * 0.4));
        const avg = speechRange.reduce((a, b) => a + b, 0) / speechRange.length;

        // Nonlinear scaling
        const normalized = Math.pow(avg / 128, 1.2);

        // Smooth transitions
        setVolume((prev) => prev * 0.6 + normalized * 0.4);

        animationRef.current = requestAnimationFrame(update);
      };
      update();

      return cleanup;
    } catch (err) {
      console.error('AudioMeter error:', err);
      cleanup();
    }
  }, [stream, isListening, audioContext]);

  return (
    <div className="flex items-center space-x-2 bg-gray-100 p-3 rounded-lg">
      <div className="flex-shrink-0">
        {isListening ? <Mic className="w-6 h-6 text-green-500" /> : <MicOff className="w-6 h-6 text-red-500" />}
      </div>

      <div className="relative flex h-20 items-end gap-0.5 bg-gray-200 p-1">
        {[...Array(16)].map((_, i) => {
          const barScale = 0.3 + ((i + 1) / 16) * 0.7;
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

      {/* Debug readout */}
      <div className="text-xs text-gray-500 ml-2">{volume.toFixed(2)}</div>
    </div>
  );
};

export default AudioMeter;
