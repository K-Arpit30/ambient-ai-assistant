/**
 * OpenClaw Background Service Worker (MV3)
 *
 * Responsibilities:
 * 1. Manages the Chrome Offscreen Document (the only way to access mic in MV3 background).
 * 2. Receives raw audio chunks from the offscreen document.
 * 3. Forwards audio to the local Node server → Groq Whisper Large V3 API.
 * 4. Auto-starts mic capture when the extension is installed/restarted.
 */

const OFFSCREEN_URL = chrome.runtime.getURL('offscreen.html');
const SERVER_TRANSCRIBE_URL = 'http://localhost:3001/api/transcribe';

// --- Offscreen Document Management ---

async function hasOffscreenDocument(): Promise<boolean> {
  const contexts = await (chrome as any).runtime.getContexts?.({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [OFFSCREEN_URL],
  }) ?? [];
  return contexts.length > 0;
}

async function ensureOffscreenDocument() {
  if (await hasOffscreenDocument()) return;
  await (chrome as any).offscreen.createDocument({
    url: OFFSCREEN_URL,
    reasons: ['USER_MEDIA'],
    justification: 'Ambient meeting transcription using microphone.',
  });
}

async function startAmbientCapture() {
  await ensureOffscreenDocument();
  chrome.runtime.sendMessage({ type: 'START_CAPTURE' });
  console.log('[OpenClaw BG] Ambient mic capture started.');
}

async function stopAmbientCapture() {
  chrome.runtime.sendMessage({ type: 'STOP_CAPTURE' });
}

// --- Auto-start on install/startup ---

chrome.runtime.onInstalled.addListener(() => {
  console.log('[OpenClaw] Extension installed. Starting ambient capture...');
  startAmbientCapture();
});

chrome.runtime.onStartup.addListener(() => {
  console.log('[OpenClaw] Browser started. Resuming ambient capture...');
  startAmbientCapture();
});

// --- Message Router ---

chrome.runtime.onMessage.addListener((message, _sender, _sendResponse) => {

  // Final transcript received from Deepgram (via offscreen document) → forward to Node server
  if (message.type === 'FINAL_TRANSCRIPT') {
    forwardTranscript(message.text);
    return;
  }

  // Mic error from offscreen document
  if (message.type === 'MIC_ERROR') {
    console.error('[OpenClaw BG] Mic error from offscreen:', message.error);
    return;
  }

  // Manual toggle from popup UI
  if (message.type === 'TOGGLE_MIC') {
    if (message.active) {
      startAmbientCapture();
    } else {
      stopAmbientCapture();
    }
    return;
  }

  // Page summarize action from popup
  if (message.type === 'SUMMARIZE_PAGE') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const activeTab = tabs[0];
      if (activeTab?.id) {
        chrome.tabs.sendMessage(activeTab.id, { type: 'EXTRACT_CONTENT' }, (response) => {
          if (response?.content) {
            fetch('http://localhost:3001/api/agent/task', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                action: 'summarize',
                payload: response.content,
                url: activeTab.url
              })
            }).catch(err => console.error('[OpenClaw BG] Server unreachable:', err));
          }
        });
      }
    });
  }
});

// --- Transcript Forwarding ---

async function forwardTranscript(text: string) {
  try {
    await fetch('http://localhost:3001/api/ambient/log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
  } catch (err) {
    // Silently fail if server is offline — never interrupt background process
    console.warn('[OpenClaw BG] Server offline, dropping transcript.');
  }
}
