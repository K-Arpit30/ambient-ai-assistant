/**
 * OpenClaw Offscreen Audio Capture (Deepgram WebSocket)
 *
 * This script runs in a hidden Chrome Offscreen Document.
 * It connects to Deepgram's real-time WebSocket API and streams
 * audio chunks continuously for zero-latency transcription.
 */

let mediaRecorder: MediaRecorder | null = null;
let deepgramSocket: WebSocket | null = null;
let stream: MediaStream | null = null;

async function startCapture() {
  try {
    // 1. Fetch the Deepgram API Key from our local Node Server
    const response = await fetch('http://localhost:3001/api/deepgram/token');
    if (!response.ok) throw new Error('Failed to fetch Deepgram token from server');
    const { token } = await response.json();

    // 2. Request Microphone Access
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        sampleRate: 16000,
        echoCancellation: true,
        noiseSuppression: true,
      }
    });

    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : 'audio/webm';

    // 3. Open Deepgram WebSocket
    deepgramSocket = new WebSocket('wss://api.deepgram.com/v1/listen?model=nova-2&punctuate=true&interim_results=false', [
      'token',
      token,
    ]);

    deepgramSocket.onopen = () => {
      console.log('[OpenClaw Offscreen] Deepgram WebSocket Connected.');
      
      // 4. Start recording and send chunks every 250ms
      mediaRecorder = new MediaRecorder(stream!, { mimeType });
      
      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0 && deepgramSocket?.readyState === WebSocket.OPEN) {
          deepgramSocket.send(event.data);
        }
      };

      mediaRecorder.start(250); // timeslice: 250ms chunks sent to WS
    };

    deepgramSocket.onmessage = (message) => {
      const received = JSON.parse(message.data);
      const transcript = received.channel?.alternatives[0]?.transcript;
      
      if (transcript && transcript.trim().length > 0) {
        // Send final transcript to Background script
        chrome.runtime.sendMessage({
          type: 'FINAL_TRANSCRIPT',
          text: transcript.trim()
        });
      }
    };

    deepgramSocket.onclose = () => {
      console.log('[OpenClaw Offscreen] Deepgram WebSocket Closed.');
      if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop();
      }
    };

    deepgramSocket.onerror = (error) => {
      console.error('[OpenClaw Offscreen] Deepgram WebSocket Error:', error);
    };

  } catch (err) {
    console.error('[OpenClaw Offscreen] Capture failed:', err);
    chrome.runtime.sendMessage({ type: 'MIC_ERROR', error: String(err) });
  }
}

function stopCapture() {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
  }
  if (deepgramSocket) {
    deepgramSocket.close();
    deepgramSocket = null;
  }
  if (stream) {
    stream.getTracks().forEach(t => t.stop());
    stream = null;
  }
  console.log('[OpenClaw Offscreen] Capture stopped.');
}

// Listen for commands from background service worker
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'START_CAPTURE') startCapture();
  if (message.type === 'STOP_CAPTURE') stopCapture();
});
