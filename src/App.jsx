// src/VoiceChat.jsx
import React, { useState } from 'react';
import { useWebRTC } from './hooks/useWebRTC';
import { CONFIG } from './config';
import AudioMeter from './components/AudioMeter';
import { useWebSocketAudio } from './hooks/useWebsockets';

const VoiceChat = () => {
  const [customPrompt, setCustomPrompt] = useState('');
  const [connection, setConnection] = useState('webrtc');

  const {
    status,
    isListening,
    connect,
    stream,
    toggleListening,
    birdPrompt,
    updatePromptMidSession,
    audioContext,
    disconnect,
  } = useWebRTC();
  const {
    wsStatus,
    wsIsListening,
    wsConnect,
    wsDisconnect,
    wsBirdPrompt,
    wsUpdatePromptMidSession,
    wsToggleListening,
  } = useWebSocketAudio();

  const connectToOpenAiRealtimeWebsocket = () => {
    setConnection('websocket');
    wsConnect();
  }

  const connectToOpenAiRealtimeWebrtc = () => {
    setConnection('webrtc');
    connect();
  }

  return (
    <div className="w-full min-h-screen bg-gray-900 text-white p-4">
      <div className="w-full max-w-md mx-auto bg-gray-800 rounded-lg shadow-xl p-4 space-y-4">
        {/* Header */}
        <div className="text-center">
          <h2 className="text-xl font-semibold mb-1">Professor Bird Brain's Lab</h2>
          <p className="text-gray-400 text-sm">
            Status: <span className="font-medium">{status}</span>
          </p>
        </div>

        {/* Connect button if not connected */}
        {status === 'disconnected' && wsStatus === 'disconnected' && (
          <>
            <button
              onClick={connectToOpenAiRealtimeWebrtc}
              className="w-full bg-blue-600 text-white px-4 py-3 rounded-md hover:bg-blue-700 transition-colors"
            >
              Connect to openAi Realtime via webrtc
            </button>
            <button
              onClick={connectToOpenAiRealtimeWebsocket}
              className="w-full bg-yellow-500 text-white px-4 py-2 rounded-md hover:bg-yellow-600 transition-colors"
            >
              Connect to openAi Realtime via websocket
            </button>
          </>
        )}

        {/* Audio Meter and Mute Button if connected */}
        {(status === 'connected' || wsStatus === 'connected') && (
          <div className="space-y-4">

            {connection === 'webrtc' && (
              <>
                <AudioMeter
                  stream={stream}
                  isListening={isListening}
                  audioContext={audioContext}
                />
                <button
                  onClick={toggleListening}
                  className={`w-full px-4 py-3 rounded-md transition-colors ${isListening ? 'bg-red-500 hover:bg-red-600' : 'bg-green-500 hover:bg-green-600'
                    } text-white`}
                >
                  {isListening ? 'Mute Microphone' : 'Enable Microphone'}
                </button>
              </>
            )}
            {connection === 'websocket' && (
              <button
                onClick={wsToggleListening}
                className={`w-full px-4 py-3 rounded-md transition-colors ${isListening ? 'bg-red-500 hover:bg-red-600' : 'bg-green-500 hover:bg-green-600'
                  } text-white`}
              >
                {isListening ? 'Mute Microphone' : 'Enable Microphone'}
              </button>
            )}
          </div>
        )}

        {/* disconnect button */}
        {(status === 'connected' || wsStatus === 'connected') && (
          <>
            {connection === 'webrtc' && (<button
              onClick={disconnect}
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

        {/* Prompt Switch Buttons */}
        <div className="space-y-2">
          <h3 className="font-semibold text-sm text-gray-300">Switch Prompt Mode</h3>
          <button
            onClick={() => updatePromptMidSession(CONFIG.BIRD_BRAIN_PROMPT_DISMISSIVE)}
            className="w-full bg-yellow-500 text-white px-4 py-2 rounded-md hover:bg-yellow-600 transition-colors"
          >
            Dismissive
          </button>
          <button
            onClick={() => updatePromptMidSession(CONFIG.BIRD_BRAIN_PROMPT)}
            className="w-full bg-gray-500 text-white px-4 py-2 rounded-md hover:bg-gray-600 transition-colors"
          >
            Curious
          </button>
          <button
            onClick={() => updatePromptMidSession(CONFIG.BIRD_BRAIN_PROMPT_GAMEMASTER)}
            className="w-full bg-purple-500 text-white px-4 py-2 rounded-md hover:bg-purple-600 transition-colors"
          >
            Game Master
          </button>
          <button
            onClick={() => updatePromptMidSession(CONFIG.BIRD_BRAIN_PROMPT_NARC_MODE)}
            className="w-full bg-red-500 text-white px-4 py-2 rounded-md hover:bg-red-600 transition-colors"
          >
            Narc Mode
          </button>
          <button
            onClick={() => updatePromptMidSession(CONFIG.BIRD_BRAIN_PROMPT_EXTRA_RUDE)}
            className="w-full bg-red-500 text-white px-4 py-2 rounded-md hover:bg-red-600 transition-colors"
          >
            Extra Rude
          </button>
          <button
            onClick={() => updatePromptMidSession(CONFIG.BIRD_BRAIN_PROMPT_PSYCHEDELIC)}
            className="w-full bg-red-500 text-white px-4 py-2 rounded-md hover:bg-red-600 transition-colors"
          >
            Psychedelic
          </button>
          <button
            onClick={() => updatePromptMidSession(CONFIG.BIRD_BRAIN_PROMPT_DISMISSIVE_COP_SUSPECTION)}
            className="w-full bg-red-500 text-white px-4 py-2 rounded-md hover:bg-red-600 transition-colors"
          >
            Dismissive Cop Suspicion
          </button>
        </div>

        {/* Custom Prompt */}
        <div className="mt-3 space-y-2">
          <label className="block text-sm font-semibold text-gray-300">
            Custom Prompt
            <textarea
              rows={3}
              className="w-full mt-1 p-2 border border-gray-700 rounded bg-gray-900 text-gray-100 placeholder-gray-500"
              value={customPrompt}
              onChange={(e) => setCustomPrompt(e.target.value)}
              placeholder="Type your custom instructions..."
            />
          </label>
          <button
            onClick={() => updatePromptMidSession(customPrompt)}
            className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 transition-colors w-full"
          >
            Use Custom Prompt
          </button>
        </div>

        {/* Current Prompt Display in a 300px wide container */}
        <div className="text-sm text-gray-400 pt-2">
          <strong>Current Prompt:</strong>
          <div
            className="w-[300px] whitespace-pre-wrap break-words text-gray-300 mt-1"
            style={{ wordBreak: 'break-word' }}
          >
            {birdPrompt}
          </div>
        </div>
      </div>
    </div>
  );
};

export default VoiceChat;
