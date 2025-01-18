import { useWebRTC } from './hooks/useWebRTC';

const VoiceChat = () => {
  const { status, isListening, connect, toggleListening } = useWebRTC();

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
          <button
            onClick={toggleListening}
            className={`w-full px-4 py-3 rounded-lg transition-colors ${
              isListening 
                ? 'bg-red-500 hover:bg-red-600' 
                : 'bg-green-500 hover:bg-green-600'
            } text-white`}
          >
            {isListening ? 'Stop Squawking' : 'Start Squawking'}
          </button>
        )}
      </div>
    </div>
  );
};

export default VoiceChat;