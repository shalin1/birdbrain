// src/VoiceChat.jsx
import React, { useState, useEffect } from 'react';
import { useWebRTC } from './hooks/useWebRTC';
import { useWebSocketAudio } from './hooks/useWebsockets';
import { CONFIG } from './config';
import AudioMeter from './components/AudioMeter';

const VoiceChat = () => {
  const [customPrompt, setCustomPrompt] = useState('');
  const [connection, setConnection] = useState('webrtc');

  // Destructure values from the WebRTC hook.
  const {
    status,
    voice,
    setVoice,
    isListening,
    connect,
    stream,
    toggleListening,
    birdPrompt,
    updatePromptMidSession,
    audioContext,
    disconnect,
    temperature,
    setTemperature
  } = useWebRTC();

  // Destructure values from the WebSocket hook.
  const {
    wsStatus,
    wsIsListening,
    wsConnect,
    wsDisconnect,
    wsBirdPrompt,
    wsToggleListening,
    wsStream,
    wsAudioContext,
  } = useWebSocketAudio();

  // Use connection type to choose which status and prompt to display.
  const displayStatus = connection === 'webrtc' ? status : wsStatus;
  const displayBirdPrompt = connection === 'webrtc' ? birdPrompt : wsBirdPrompt;

  // New state for an editable version of the bird prompt.
  const [editableBirdPrompt, setEditableBirdPrompt] = useState(displayBirdPrompt);

  // Sync the editable text field with any changes to the prompt from the hook.
  useEffect(() => {
    setEditableBirdPrompt(displayBirdPrompt);
  }, [displayBirdPrompt]);

  // Handler to update the prompt as the user types.
  const handleEditableBirdPromptChange = (e) => {
    const newPrompt = e.target.value;
    setEditableBirdPrompt(newPrompt);
    if (connection === 'webrtc') {
      updatePromptMidSession(newPrompt);
    }
  };

  // Functions to initiate the connection.
  const connectToOpenAiRealtimeWebrtc = () => {
    setConnection('webrtc');
    connect();
  };

  const connectToOpenAiRealtimeWebsocket = () => {
    setConnection('websocket');
    wsConnect();
  };

  // Handle prompt updates based on the connection type.
  const handleUpdatePrompt = (prompt) => {
    if (connection === 'webrtc') {
      updatePromptMidSession(prompt);
    } else {
      // For WebSocket connections, prompt switching is not implemented.
      console.warn('Prompt switching is not implemented for WebSocket connections.');
    }
  };

  return (
    <div className="w-full min-h-screen bg-gray-900 text-white p-4">
      <div className="w-full max-w-md mx-auto bg-gray-800 rounded-lg shadow-xl p-4 space-y-4">
        {/* Header */}
        <div className="text-center">
          <h2 className="text-xl font-semibold mb-1">Professor Bird Brain's Lab</h2>
          <p className="text-gray-400 text-sm">
            Status: <span className="font-medium">{displayStatus}</span>
          </p>
        </div>

        {/* Connect buttons (shown only when both connections are disconnected) */}
        {status === 'disconnected' && wsStatus === 'disconnected' && (
          <>
            <button
              onClick={connectToOpenAiRealtimeWebrtc}
              className="w-full bg-blue-600 text-white px-4 py-3 rounded-md hover:bg-blue-700 transition-colors"
            >
              Connect to OpenAI Realtime via WebRTC
            </button>
            <button
              onClick={connectToOpenAiRealtimeWebsocket}
              className="w-full bg-yellow-500 text-white px-4 py-2 rounded-md hover:bg-yellow-600 transition-colors"
            >
              Connect to OpenAI Realtime via WebSocket
            </button>
          </>
        )}

        {/* Audio Meter and Microphone Toggle */}
        {(status === 'connected' || status === 'responding' || wsStatus === 'connected') && (
          <div className="space-y-4">
            <AudioMeter
              stream={stream || wsStream}
              isListening={connection === 'webrtc' ? isListening : wsIsListening}
              audioContext={audioContext || wsAudioContext}
            />
            {connection === 'webrtc' && (
              <button
                onClick={toggleListening}
                className={`w-full px-4 py-3 rounded-md transition-colors ${isListening ? 'bg-red-500 hover:bg-red-600' : 'bg-green-500 hover:bg-green-600'
                  } text-white`}
              >
                {isListening ? 'Mute Microphone' : 'Enable Microphone'}
              </button>
            )}
            {connection === 'websocket' && (
              <button
                onclick={wstogglelistening}
                classname={`w-full px-4 py-3 rounded-md transition-colors ${wsislistening ? 'bg-red-500 hover:bg-red-600' : 'bg-green-500 hover:bg-green-600'
                  } text-white`}
              >
                {wsislistening ? 'mute microphone' : 'enable microphone'}
              </button>
            )}
          </div>
        )}

        {/* Disconnect Button */}
        {(status === 'connected' || status === 'responding' || wsStatus === 'connected') && (
          <>
            {connection === 'webrtc' && (
              <button
                onClick={() => disconnect(true)}
                className="w-full bg-red-500 text-white px-4 py-2 rounded-md hover:bg-red-600 transition-colors"
              >
                Disconnect
              </button>
            )}
            {connection === 'websocket' && (
              <button
                onClick={wsDisconnect}
                className="w-full bg-red-500 text-white px-4 py-2 rounded-md hover:bg-red-600 transition-colors"
              >
                Disconnect
              </button>
            )}
          </>
        )}

        {/* Prompt Switching (only available for WebRTC) */}
        {connection === 'webrtc' ? (
          <div className="space-y-2">
            <h3 className="font-semibold text-sm text-gray-300">Switch Prompt Mode</h3>
            <button
              onClick={() => handleUpdatePrompt(CONFIG.BIRD_BRAIN_PROMPT)}
              className="w-full bg-gray-500 text-white px-4 py-2 rounded-md hover:bg-gray-600 transition-colors"
            >
              Default
            </button>
            <button
              onClick={() => handleUpdatePrompt(CONFIG.BIRD_BRAIN_PROMPT_DISMISSIVE)}
              className="w-full bg-yellow-500 text-white px-4 py-2 rounded-md hover:bg-yellow-600 transition-colors"
            >
              Dismissive
            </button>
            <button
              onClick={() => handleUpdatePrompt(CONFIG.BIRD_BRAIN_PROMPT_GAMEMASTER)}
              className="w-full bg-purple-500 text-white px-4 py-2 rounded-md hover:bg-purple-600 transition-colors"
            >
              Game Master
            </button>
            <button
              onClick={() => handleUpdatePrompt(CONFIG.BIRD_BRAIN_PROMPT_NARC_MODE)}
              className="w-full bg-red-500 text-white px-4 py-2 rounded-md hover:bg-red-600 transition-colors"
            >
              Narc Mode
            </button>
            <button
              onClick={() => handleUpdatePrompt(CONFIG.BIRD_BRAIN_PROMPT_EXTRA_RUDE)}
              className="w-full bg-red-500 text-white px-4 py-2 rounded-md hover:bg-red-600 transition-colors"
            >
              Extra Rude
            </button>
            <button
              onClick={() => handleUpdatePrompt(CONFIG.BIRD_BRAIN_PROMPT_PSYCHEDELIC)}
              className="w-full bg-red-500 text-white px-4 py-2 rounded-md hover:bg-red-600 transition-colors"
            >
              Psychedelic
            </button>
            <button
              onClick={() => handleUpdatePrompt(CONFIG.BIRD_BRAIN_PROMPT_LOVEBURN)}
              className="w-full bg-red-500 text-white px-4 py-2 rounded-md hover:bg-red-600 transition-colors"
            >
              The poet
            </button>
            <button
              onClick={() => handleUpdatePrompt(CONFIG.BIRD_BRAIN_PROMPT_RAVE_SHAMAN)}
              className="w-full bg-red-500 text-white px-4 py-2 rounded-md hover:bg-red-600 transition-colors"
            >
              Rave Shaman
            </button>
            <button
              onClick={() => handleUpdatePrompt(CONFIG.BIRD_BRAIN_PROMPT_COSTUME_INSPECTOR)}
              className="w-full bg-red-500 text-white px-4 py-2 rounded-md hover:bg-red-600 transition-colors"
            >
              Costume Inspector
            </button>
            <button
              onClick={() => handleUpdatePrompt(CONFIG.BIRD_BRAIN_PROMPT_FOOD_SCOUT)}
              className="w-full bg-red-500 text-white px-4 py-2 rounded-md hover:bg-red-600 transition-colors"
            >
              Food Scout
            </button>
            <button
              onClick={() => handleUpdatePrompt(CONFIG.BIRD_BRAIN_PROMPT_MORNING_MOTIVATOR)}
              className="w-full bg-red-500 text-white px-4 py-2 rounded-md hover:bg-red-600 transition-colors"
            >
              Morning Motivator
            </button>
            <button
              onClick={() => handleUpdatePrompt(CONFIG.BIRD_BRAIN_PROMPT_LOVEBURN)}
              className="w-full bg-red-500 text-white px-4 py-2 rounded-md hover:bg-red-600 transition-colors"
            >
              The poet
            </button>
            <button
              onClick={() => handleUpdatePrompt(CONFIG.BIRD_BRAIN_PROMPT_DANCE_INSTRUCTOR)}
              className="w-full bg-red-500 text-white px-4 py-2 rounded-md hover:bg-red-600 transition-colors"
            >
              Dance Instructor
            </button>
            <button
              onClick={() => handleUpdatePrompt(CONFIG.BIRD_BRAIN_PROMPT_CONSPIRACY_DJ)}
              className="w-full bg-red-500 text-white px-4 py-2 rounded-md hover:bg-red-600 transition-colors"
            >
              Conspiracy DJ
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            <h3 className="font-semibold text-sm text-gray-300">Switch Prompt Mode</h3>
            <p className="text-gray-400 text-sm">
              Prompt switching is not available for WebSocket connections.
            </p>
          </div>
        )}
        {/* Voice Selector */}
        {status === 'disconnected' &&
          <div className="space-y-2">
            <h3 className="font-semibold text-sm text-gray-300">Voice</h3>
            <select value={voice} onChange={(e) => setVoice(e.target.value)} className="w-full">
              <option value="alloy">Alloy</option>
              <option value="ash">Ash</option>
              <option value="ballad">Ballad</option>
              <option value="coral">Coral</option>
              <option value="echo">Echo</option>
              <option value="sage">Sage</option>
              <option value="shimmer">Shimmer</option>
              <option value="verse">Verse</option>
            </select>
          </div>
        }
        {/* Temperature Slider */}
        <div className="p-4 max-w-md mx-auto">
          <label htmlFor="temperature" className="block mb-2 font-semibold">
            Temperature: {temperature}
          </label>
          <input
            id="temperature"
            type="range"
            min="0.6"
            max="1.2"
            step="0.1"
            value={temperature}
            onChange={(e) => setTemperature(parseFloat(e.target.value))}
            className="w-full"
          />
        </div>
        {/* Editable Current Prompt Display */}
        <div className="text-sm text-gray-400 pt-2">
          <label className="font-semibold">Current Prompt:</label>
          <textarea
            rows={35}  // Increased number of rows for a bigger display
            className="w-full mt-1 p-2 border border-gray-700 rounded bg-gray-900 text-gray-300"
            style={{ width: '100%' }}
            value={editableBirdPrompt}
            onChange={handleEditableBirdPromptChange}
            disabled={connection !== 'webrtc'}
          />
        </div>
      </div>
    </div>
  );
};

export default VoiceChat;
