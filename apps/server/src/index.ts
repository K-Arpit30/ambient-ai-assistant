import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { OpenClawAgent } from '@openclaw/agent';
import Groq from 'groq-sdk';
import { toFile } from 'groq-sdk';
import { createClient } from '@deepgram/sdk';

dotenv.config();

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });
const agent = new OpenClawAgent();

// Connect to Ambient Python Daemon
function connectToAmbientDaemon() {
  const ambientWs = new WebSocket('ws://localhost:8005/ws/transcribe');
  
  ambientWs.on('open', () => {
    console.log('Connected to Ambient Whisper Daemon');
  });

  ambientWs.on('message', async (data) => {
    try {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'transcript') {
        const logMessage = `[Ambient Transcript]: ${msg.text}`;
        console.log(logMessage);
        
        // Broadcast to dashboard
        wss.clients.forEach(client => {
          if (client.readyState === 1) {
            // Send log message
            client.send(JSON.stringify({ message: logMessage, type: 'ambient' }));
            // Send actual transcript for the Live Feed
            client.send(JSON.stringify({ type: 'transcript', text: msg.text }));
          }
        });

        // Feed text to agent memory
        await agent.observe(`[Meeting Transcript]: ${msg.text}`);
      }
    } catch (e) {
      console.error('Failed to parse ambient daemon message', e);
    }
  });

  ambientWs.on('close', () => {
    console.log('Lost connection to Ambient Daemon. Retrying in 5s...');
    setTimeout(connectToAmbientDaemon, 5000);
  });
  
  ambientWs.on('error', () => {
    // Suppress error spam when daemon is down
  });
}

connectToAmbientDaemon();

app.use(cors());
app.use(express.json({ limit: '10mb' })); // Large limit for base64 audio chunks

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
// GET /api/deepgram/token — Provides the local Deepgram key to the extension for direct WebSocket connection
app.get('/api/deepgram/token', (req, res) => {
  if (!process.env.DEEPGRAM_API_KEY) {
    return res.status(500).json({ error: 'Deepgram API key not configured on server.' });
  }
  // Since OpenClaw is a local desktop assistant, it's safe to pass the key to our own local extension
  res.json({ token: process.env.DEEPGRAM_API_KEY });
});

// POST /api/ambient/log — Receives final transcripts from the Deepgram WebSocket (via extension)
app.post('/api/ambient/log', async (req, res) => {
  const { text } = req.body;
  if (!text) return res.status(400).json({ error: 'No text provided' });

  console.log(`[Deepgram Transcript] ${text}`);

  // Broadcast to all connected Dashboard clients
  const logMessage = `[Meeting] ${text}`;
  wss.clients.forEach(client => {
    if (client.readyState === 1) {
      client.send(JSON.stringify({ type: 'transcript', message: logMessage, text }));
    }
  });

  // Feed into agent memory for task extraction
  await agent.observe(`[Meeting Transcript]: ${text}`);
  res.json({ status: 'ok' });
});

// (Deprecated) POST /api/transcribe — Receives base64 audio from Chrome Extension
app.post('/api/transcribe', async (req, res) => {
  const { audio, mimeType } = req.body;
  if (!audio) return res.status(400).json({ error: 'No audio provided' });

  try {
    // Decode base64 back to binary buffer
    const buffer = Buffer.from(audio, 'base64');
    
    // Determine file extension from mimeType
    const ext = mimeType?.includes('webm') ? 'webm' : 'wav';
    const filename = `chunk.${ext}`;

    // Send to Groq Whisper Large V3 — most accurate open-source STT model
    const transcription = await groq.audio.transcriptions.create({
      file: await toFile(buffer, filename, { type: mimeType || 'audio/webm' }),
      model: 'whisper-large-v3',
      language: 'en',
      response_format: 'json',
    });

    const text = transcription.text?.trim();
    if (!text) return res.json({ status: 'ok', text: '' });

    console.log(`[Whisper] ${text}`);

    // Broadcast to all connected Dashboard clients
    const logMessage = `[Meeting] ${text}`;
    wss.clients.forEach(client => {
      if (client.readyState === 1) {
        client.send(JSON.stringify({ type: 'transcript', message: logMessage, text }));
      }
    });

    // Feed into agent memory for task extraction
    await agent.observe(`[Meeting Transcript]: ${text}`);

    res.json({ status: 'ok', text });
  } catch (err: any) {
    console.error('[Whisper API Error]', err?.message || err);
    res.status(500).json({ error: 'Transcription failed', detail: err?.message });
  }
});

const HEARTBEAT_FILE = path.join(__dirname, '../../../HEARTBEAT.md');

// REST API
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

app.post('/api/agent/task', async (req, res) => {
  const { action, payload, url } = req.body;
  const logMessage = `[Agent] Received task: ${action} from ${url || 'unknown'}`;
  console.log(logMessage);
  
  // Broadcast to dashboard
  wss.clients.forEach(client => {
    if (client.readyState === 1) client.send(JSON.stringify({ message: logMessage }));
  });

  await agent.observe(`User requested ${action} on ${url || 'unknown page'}. Payload: ${payload}`);
  const plan = await agent.plan();

  const planMessage = `[Agent] Plan: ${plan}`;
  wss.clients.forEach(client => {
    if (client.readyState === 1) client.send(JSON.stringify({ message: planMessage }));
  });

  res.json({ status: 'task_accepted', plan });
});

app.post('/api/agent/extract-tasks', async (req, res) => {
  console.log('[Agent] Extracting tasks from context...');
  const tasks = await agent.extractTasks();
  res.json({ status: 'ok', tasks });
});

app.post('/api/agent/reset', async (req, res) => {
  console.log('[Agent] Resetting session...');
  agent.reset();
  res.json({ status: 'ok', message: 'Session reset' });
});

// WebSocket for live updates
wss.on('connection', (ws) => {
  console.log('Client connected to WebSocket');
  ws.send(JSON.stringify({ type: 'hello', message: 'Connected to OpenClaw Server' }));

  ws.on('message', (message) => {
    console.log('received: %s', message);
  });
});

// Daemon Loop
let lastMemoryLength = 0;

setInterval(async () => {
  const time = new Date().toISOString();
  const content = `# Agent Heartbeat\n\nThis file is used by the background daemon to record health checks and autonomous cycle states.\n\n- **Status**: ONLINE\n- **Last Check-in**: ${time}\n- **Next Cycle**: ${new Date(Date.now() + 10000).toISOString()}\n- **Current Task**: Idle`;
  
  try {
    fs.writeFileSync(HEARTBEAT_FILE, content);
    // Broadcast heartbeat to WS clients
    wss.clients.forEach(client => {
      if (client.readyState === 1) { // WebSocket.OPEN
        client.send(JSON.stringify({ type: 'heartbeat', time }));
      }
    });

    // Check for live questions if memory grew
    const currentMemoryLength = agent.getMemoryLength();
    if (currentMemoryLength > lastMemoryLength && new Date().getSeconds() % 30 < 10) { 
       lastMemoryLength = currentMemoryLength;
       const qs = await agent.generateLiveQuestions();
       if (qs && qs.length > 0) {
         wss.clients.forEach(client => {
           if (client.readyState === 1) client.send(JSON.stringify({ type: 'live_questions', questions: qs }));
         });
       }
    }

  } catch (err) {
    console.error('Failed to write heartbeat file or generate questions', err);
  }
}, 10000);

const PORT = process.env.PORT || 3001;

server.listen(PORT, () => {
  console.log(`OpenClaw Server running on http://localhost:${PORT}`);
});
