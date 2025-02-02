import { useRef, useState, useEffect } from 'react';
import { CONFIG } from '../config';

export const useWebSocketAudio = () => {
    // State variables
    const [status, setStatus] = useState('disconnected');
    const [isListening, setIsListening] = useState(false);
    const [birdPrompt, setBirdPrompt] = useState(CONFIG.BIRD_BRAIN_PROMPT);
    const [stream, setStream] = useState(null);

    // Refs for persistent variables
    const audioContextRef = useRef(null);
    const audioWebsocketRef = useRef(null);
    const transcriptWebsocketRef = useRef(null);
    const mediaStream = useRef(null);
    const audioElement = useRef(null);
    const reconnectAttempts = useRef(0);
    const maxReconnectAttempts = 3;
    const lastActivityTimestampRef = useRef(Date.now());
    const idleCheckIntervalRef = useRef(null);
    const idleTimeoutRef = useRef(null);
    const animationFrameRef = useRef(null);
    const localSourceRef = useRef(null);
    const localAnalyserRef = useRef(null);

    /**
     * Initializes or retrieves the AudioContext.
     * Ensures the context is resumed if in a suspended state.
     */
    const initializeAudioContext = async () => {
        if (audioContextRef.current) return audioContextRef.current;
        try {
            const newCtx = new (window.AudioContext || window.webkitAudioContext)();
            if (newCtx.state === 'suspended') {
                await newCtx.resume();
            }
            audioContextRef.current = newCtx;
            return newCtx;
        } catch (error) {
            console.error('AudioContext initialization failed:', error);
            setStatus('error');
            throw error;
        }
    };

    /**
     * Sets up an audio element for playback.
     */
    const setupAudioPlayback = async () => {
        const audio = new Audio();
        audio.autoplay = true;
        audio.playsInline = true;

        audio.onerror = (error) => {
            console.error('Audio playback error:', error);
            setStatus('error');
        };

        audioElement.current = audio;
        return audio;
    };

    /**
     * Initializes the microphone input stream.
     */
    const initializeAudio = async () => {
        const constraints = {
            audio: {
                ...CONFIG.WEBRTC.AUDIO_CONSTRAINTS, // reuse any audio constraints you have defined
            },
        };

        try {
            await initializeAudioContext();
            const localStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true
                }
            });
            const sourceNode = audioContextRef.current.createMediaStreamSource(localStream);
            const scriptProcessor = audioContextRef.current.createScriptProcessor(4096, 1, 1);
            scriptProcessor.onaudioprocess = (audioEvent) => {
                const inputBuffer = audioEvent.inputBuffer.getChannelData(0);
                const pcm16Buffer = float32ToInt16(inputBuffer);

                if (audioContextRef.current && audioWebsocketRef.current && audioWebsocketRef.current.readyState === WebSocket.OPEN) {
                    audioWebsocketRef.current.send(pcm16Buffer);
                }
            };
            sourceNode.connect(scriptProcessor);
            scriptProcessor.connect(audioContextRef.current.destination);
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

    const float32ToInt16 = (float32Array) => {
        const len = float32Array.length;
        const int16Array = new Int16Array(len);
        for (let i = 0; i < len; i++) {
            let s = Math.max(-1, Math.min(1, float32Array[i]));
            int16Array[i] = s < 0 ? s * 32768 : s * 32767;
        }
        return int16Array.buffer;
    }
    /**
     * Sends raw audio data to the server over WebSocket.
     * Expects the WebSocket to be open.
     */
    const sendAudioData = (audioData) => {
        if (transcriptWebsocketRef.current && transcriptWebsocketRef.current.readyState === WebSocket.OPEN) {
            // Here you might need to format your Float32Array (or other typed array)
            // into a transferable format (e.g. ArrayBuffer or JSON) that your server expects.
            // In this example we simply send the raw buffer.
            transcriptWebsocketRef.current.send(audioData.buffer);
        }
    };

    /**
     * Captures audio from the microphone and sends it over the WebSocket.
     */
    const startAudioCapture = () => {
        if (!audioContextRef.current) {
            console.error('AudioContext is not initialized.');
            return;
        }
        if (mediaStream.current) {
            // Create a ScriptProcessorNode for capturing audio data.
            // Note: ScriptProcessorNode is deprecated. Consider using AudioWorklet if possible.
            const audioProcessor = audioContextRef.current.createScriptProcessor(4096, 1, 1);
            localSourceRef.current = audioContextRef.current.createMediaStreamSource(mediaStream.current);
            localSourceRef.current.connect(audioProcessor);
            // Optionally, you can create a loopback by connecting the source to the destination.
            // Be cautious about feedback loops if using speakers.
            // localSourceRef.current.connect(audioContextRef.current.destination);
            audioProcessor.connect(audioContextRef.current.destination);

            audioProcessor.onaudioprocess = (event) => {
                const inputData = event.inputBuffer.getChannelData(0);
                // Copy the Float32Array so that we send a new instance every time.
                const audioData = new Float32Array(inputData);
                sendAudioData(audioData);
            };
        }
    };

    /**
     * Handles incoming messages from the server.
     */
    const handleServerMessage = (data) => {
        if (data.type === 'response.audio.delta') {
            const base64String = data.delta; // base64-encoded 16-bit PCM
            if (!base64String) return;
            const arrayBuf = base64ToArrayBuffer(base64String);
            playPCM16(arrayBuf);
        } else {
            console.log('Received message:', data);
        }
    };

    /**
     * Plays PCM 16-bit audio data received from the server.
     */
    let playbackTime = 0;
    const playPCM16 = (arrayBuffer) => {
        const audioCtx = audioContextRef.current;
        const uint8 = new Uint8Array(arrayBuffer);
        const sampleCount = uint8.length / 2;
        const serverSampleRate = 24000; // Adjust to your server's sample rate
        const audioBuffer = audioCtx.createBuffer(1, sampleCount, serverSampleRate);
        const floatChannel = audioBuffer.getChannelData(0);

        for (let i = 0; i < sampleCount; i++) {
            let sample = (uint8[2 * i + 1] << 8) | uint8[2 * i];
            if (sample >= 32768) sample -= 65536;
            floatChannel[i] = sample / 32768;
        }

        const chunkDuration = sampleCount / serverSampleRate;
        if (playbackTime < audioCtx.currentTime) {
            playbackTime = audioCtx.currentTime;
        }
        const source = audioCtx.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(audioCtx.destination);
        source.start(playbackTime);
        playbackTime += chunkDuration;
    };

    /**
     * Converts a Base64 string to an ArrayBuffer.
     */
    const base64ToArrayBuffer = (base64) => {
        const binaryString = atob(base64);
        const length = binaryString.length;
        const bytes = new Uint8Array(length);
        for (let i = 0; i < length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }
        return bytes.buffer;
    };

    /**
     * Begins the idle monitoring process.
     * If the connection is idle for a set period, the connection is restarted.
     */
    const startIdleMonitoring = () => {
        if (idleCheckIntervalRef.current) {
            clearInterval(idleCheckIntervalRef.current);
        }
        idleCheckIntervalRef.current = setInterval(() => {
            const idleTime = Date.now() - lastActivityTimestampRef.current;
            // Log idle time for debugging:
            // console.log('Idle time:', idleTime, 'ms');
            if (idleTime >= 120000) { // 2 minutes of inactivity
                console.log('2 minutes of inactivity. Closing connection...');
                disconnect();
                resetIdleTimer();
                setTimeout(() => {
                    console.log('Reconnecting with a fresh state...');
                    connect();
                }, 1000);
            }
        }, 10000); // Check every 10 seconds
    };

    /**
     * Resets the idle timer.
     */
    const resetIdleTimer = () => {
        lastActivityTimestampRef.current = Date.now();
        if (idleTimeoutRef.current) {
            clearTimeout(idleTimeoutRef.current);
            idleTimeoutRef.current = null;
        }
    };

    /**
     * Toggles the microphone on or off.
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
     * Optionally, route the local microphone to the local output.
     * Use with caution to avoid audio feedback.
     */
    const startLocalMonitoring = async () => {
        if (!audioContextRef.current) {
            console.error('AudioContext is not initialized.');
            return;
        }
        if (mediaStream.current) {
            const localSource = audioContextRef.current.createMediaStreamSource(mediaStream.current);
            localSource.connect(audioContextRef.current.destination);
        }
    };

    /**
     * Sets up local volume monitoring for the microphone.
     * This can be used to visualize the mic’s input level.
     */
    const setupLocalVolumeMonitoring = () => {
        if (!audioContextRef.current || !mediaStream.current) return;
        if (!localAnalyserRef.current) {
            localAnalyserRef.current = audioContextRef.current.createAnalyser();
            localAnalyserRef.current.fftSize = 256;
        }
        if (!localSourceRef.current) {
            localSourceRef.current = audioContextRef.current.createMediaStreamSource(mediaStream.current);
            localSourceRef.current.connect(localAnalyserRef.current);
        }
        const dataArray = new Uint8Array(localAnalyserRef.current.frequencyBinCount);
        const update = () => {
            localAnalyserRef.current.getByteFrequencyData(dataArray);
            const avg = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
            // For debugging or UI updates, you might log or set state here:
            // console.log('Local mic volume:', avg);
            animationFrameRef.current = requestAnimationFrame(update);
        };
        update();
    };

    /**
     * Establishes a WebSocket connection and sets up audio capture.
     */
    const connect = async () => {
        if (status === 'connecting' || status === 'connected') {
            console.log('Already connecting or connected');
            return;
        }

        try {
            setStatus('connecting');
            await initializeAudio();
            await setupAudioPlayback();

            const transcriptWs = new WebSocket('wss://78e3-2603-7000-8df0-77a0-48b1-c9db-28cd-1b87.ngrok-free.app/transcripts');
            transcriptWebsocketRef.current = transcriptWs;
            transcriptWs.onopen = () => {
                console.log('Transcript WebSocket connection established');
                setStatus('connected');
            };
            transcriptWs.onmessage = (event) => {
                const data = JSON.parse(event.data);

                switch (data.type) {
                    case 'transcript':
                        console.log(`You: ${data.text}`, 'transcript');
                        break;
                    case 'llm_response':
                        console.log(`Assistant: ${data.text}`, 'llm-response');
                        break;
                    case 'tts_response':
                        playAudio(data.audio);
                        break;
                    case 'error':
                        console.error('Server error:', data.text);
                        console.log(`Error: ${data.text}`, 'error');
                        break;
                    case 'session_updated':
                        console.log('Session updated:', data);
                        break;
                    default:
                        console.warn("Unknown message type:", data);
                }
            };
            transcriptWs.onclose = () => updateStatus('Disconnected');
            transcriptWs.onerror = (e) => {
                console.error("Transcript WebSocket error", e);
                updateStatus(transcriptStatus, 'Error');
            };

            const audioWs = new WebSocket('wss://78e3-2603-7000-8df0-77a0-48b1-c9db-28cd-1b87.ngrok-free.app/audio_in');
            audioWs.binaryType = "arraybuffer";
            audioWebsocketRef.current = audioWs;
            audioWs.onopen = () => {
                console.log('Audio input websocket connection established');
                setStatus('connected');
                setIsListening(true);
                // Start capturing audio once connected.
                startAudioCapture();
                // Optionally start local volume monitoring.
                setupLocalVolumeMonitoring();
                // Optionally start local monitoring (hear your own mic)
                // startLocalMonitoring();
                startIdleMonitoring();
                // Clear the ping interval when the connection closes.
                audioWs.onclose = () => clearInterval(pingInterval);
            };
            audioWs.onclose = () => {
                console.log("Audio WebSocket disconnected");
                setStatus('Disconnected');
            };
            audioWs.onerror = (e) => {
                console.error("Audio WebSocket error", e);
                setStatus('Error');
            };

            // Send periodic pings to keep the connection alive.
            // const pingInterval = setInterval(() => {
            //     if (ws.readyState === WebSocket.OPEN) {
            //         ws.send(JSON.stringify({ type: 'ping' }));
            //         console.log('Sent keep-alive ping.');
            //     }
            // }, 5000);

            audioWs.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    handleServerMessage(data);
                } catch (err) {
                    console.error('Error parsing WebSocket message:', err);
                }
            };

            audioWs.onerror = (error) => {
                console.error('WebSocket error:', error);
                setStatus('error');
            };

            audioWs.onclose = (event) => {
                console.log(`WebSocket closed: Code=${event.code}, Reason=${event.reason}`);
                if (reconnectAttempts.current < maxReconnectAttempts) {
                    reconnectAttempts.current++;
                    setTimeout(connect, 2000);
                }
            };
        } catch (error) {
            console.error('Connection failed:', error);
            setStatus('error');
            if (reconnectAttempts.current < maxReconnectAttempts) {
                reconnectAttempts.current++;
                console.log(`Attempting reconnection (${reconnectAttempts.current}/${maxReconnectAttempts})`);
                setTimeout(connect, 2000);
            }
        }
    };

    /**
     * Closes the connection and cleans up resources.
     */
    const disconnect = () => {
        console.log('Disconnecting...');

        if (idleCheckIntervalRef.current) {
            clearInterval(idleCheckIntervalRef.current);
            idleCheckIntervalRef.current = null;
        }
        if (idleTimeoutRef.current) {
            clearTimeout(idleTimeoutRef.current);
            idleTimeoutRef.current = null;
        }
        if (animationFrameRef.current) {
            cancelAnimationFrame(animationFrameRef.current);
            animationFrameRef.current = null;
        }
        if (mediaStream.current) {
            mediaStream.current.getTracks().forEach((track) => track.stop());
            mediaStream.current = null;
        }
        if (audioWebsocketRef.current) {
            websocketRef.current.close();
            websocketRef.current = null;
        }
        if (transcriptWebsocketRef.current) {
            transcriptWebsocketRef.current.close();
            transcriptWebsocketRef.current = null;
        }
        if (audioContextRef.current) {
            audioContextRef.current.close().catch((err) =>
                console.error('Error closing audio context:', err)
            );
            audioContextRef.current = null;
        }
        setStatus('disconnected');
        setIsListening(false);
        console.log('Disconnected successfully.');
    };

    // Cleanup on unmount.
    useEffect(() => {
        return () => {
            disconnect();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    return {
        wsStatus: status,
        wsIsListening: isListening,
        wsConnect: connect,
        wsDisconnect: disconnect,
        wsToggleListening: toggleListening,
        wsStream: stream,
        wsAudioContext: audioContextRef.current,
        wsBirdPrompt: birdPrompt,
        // Optionally, you can expose local monitoring functions:
        wsStartLocalMonitoring: startLocalMonitoring,
        wsSetupLocalVolumeMonitoring: setupLocalVolumeMonitoring,
    };
};
