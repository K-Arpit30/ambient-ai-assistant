import asyncio
import queue
import numpy as np
import sounddevice as sd
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from faster_whisper import WhisperModel
from dotenv import load_dotenv

load_dotenv()

app = FastAPI()

# Initialize Faster-Whisper Model (Local OpenClaw AI)
model_size = "tiny.en" 
print(f"[OpenClaw AI] Loading local CPU Whisper model '{model_size}'...")
model = WhisperModel(model_size, device="cpu", compute_type="int8")
print("[OpenClaw AI] Model loaded successfully.")

# Thread-safe queue for audio chunks
audio_queue = queue.Queue()

def audio_callback(indata, frames, time, status):
    """Called by sounddevice for each block of audio."""
    if status:
        pass
    audio_queue.put(indata.copy())

# Connected Node Server clients
active_connections = []

@app.websocket("/ws/transcribe")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    active_connections.append(websocket)
    print(f"[OpenClaw Daemon] Node server connected for transcripts. Active: {len(active_connections)}")
    try:
        while True:
            # Keep connection alive
            await websocket.receive_text()
    except WebSocketDisconnect:
        active_connections.remove(websocket)
        print("[OpenClaw Daemon] Node server disconnected.")

def run_transcription(audio_np):
    """Runs the heavy transcription on the CPU."""
    # We turn off condition_on_previous_text because we are feeding independent 3s chunks
    segments, info = model.transcribe(audio_np, beam_size=5, language="en", condition_on_previous_text=False)
    return "".join([segment.text for segment in segments]).strip()

async def transcribe_loop():
    print("[OpenClaw Daemon] Hooking into OS Microphone...")
    
    samplerate = 16000
    blocksize = samplerate * 4 # 4-second chunks
    
    try:
        stream = sd.InputStream(samplerate=samplerate, channels=1, dtype='float32', blocksize=blocksize, callback=audio_callback)
        with stream:
            print("[OpenClaw Daemon] Microphone active. Listening locally...")
            while True:
                if not audio_queue.empty():
                    audio_chunk = audio_queue.get()
                    audio_np = audio_chunk.flatten()
                    
                    # Check for silence to save CPU (simple RMS threshold)
                    rms = np.sqrt(np.mean(audio_np**2))
                    if rms > 0.005: 
                        try:
                            # Offload inference to a thread to avoid blocking the WebSocket loop
                            text = await asyncio.to_thread(run_transcription, audio_np)
                            if text:
                                print(f"[You]: {text}")
                                # Broadcast to connected Node servers
                                for conn in active_connections:
                                    try:
                                        await conn.send_json({"type": "transcript", "text": text})
                                    except Exception as e:
                                        pass
                        except Exception as e:
                            print(f"[OpenClaw AI] Error: {e}")
                
                await asyncio.sleep(0.05)
    except Exception as e:
        print(f"[OpenClaw Daemon] Failed to access microphone: {e}")

@app.on_event("startup")
async def startup_event():
    # Start the continuous background listening task
    asyncio.create_task(transcribe_loop())

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8005)
