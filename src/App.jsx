// src/VoiceChat.jsx
import React from 'react';
import { useWebRTC } from './hooks/useWebRTC';
import { CONFIG } from './config';
import AudioMeter from './components/AudioMeter'; // or inline

const VoiceChat = () => {
  const {
    status,
    isListening,
    connect,
    toggleListening,
    stream,
    audioContext,
    birdPrompt,
    updatePromptMidSession,
  } = useWebRTC();

  const switchToDismissivePrompt = () => {
    updatePromptMidSession(CONFIG.BIRD_BRAIN_PROMPT_DISMISSIVE);
  };

  const switchToCuriousPrompt = () => {
    updatePromptMidSession(CONFIG.BIRD_BRAIN_PROMPT);
  };

  return (
    <div className="w-full max-w-md mx-auto p-6">
      <div className="bg-white rounded-lg shadow-xl p-6 space-y-4">

        {/* Status / Title */}
        <div className="text-center">
          <h2 className="text-xl font-semibold mb-2">Professor Bird Brain's Lab</h2>
          <p className="text-gray-600 mb-4">Status: {status}</p>
        </div>

        {/* Connect button if not connected */}
        {status === 'disconnected' && (
          <button
            onClick={connect}
            className="w-full bg-blue-500 text-white px-4 py-3 rounded-lg hover:bg-blue-600 transition-colors"
          >
            Connect
          </button>
        )}

        {/* If connected, show meter + mute toggle */}
        {status === 'connected' && (
          <div className="space-y-4">
            <AudioMeter stream={stream} isListening={isListening} audioContext={audioContext} />

            <button
              onClick={toggleListening}
              className={`w-full px-4 py-3 rounded-lg transition-colors ${
                isListening ? 'bg-red-500' : 'bg-green-500'
              } text-white`}
            >
              {isListening ? 'Mute Microphone' : 'Enable Microphone'}
            </button>
          </div>
        )}

        {/* Prompt Switch Buttons (works mid-session) */}
        <div className="flex gap-2">
          <button
            onClick={switchToDismissivePrompt}
            className="flex-1 bg-yellow-500 text-white px-4 py-2 rounded-md hover:bg-yellow-600 transition-colors"
          >
            Switch to Dismissive Bird
          </button>

          <button
            onClick={switchToCuriousPrompt}
            className="flex-1 bg-gray-400 text-white px-4 py-2 rounded-md hover:bg-gray-500 transition-colors"
          >
            Switch to Curious Bird
          </button>
        </div>

        {/* Optional: Display current prompt in UI */}
        <div className="text-xs text-gray-500 pt-2">
          <strong>Current Prompt:</strong>
          <pre>{birdPrompt}</pre>
        </div>
      </div>
    </div>
  );
};

export default VoiceChat;
