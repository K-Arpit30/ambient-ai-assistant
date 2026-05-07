"use client";
import { useEffect, useState, useRef } from "react";

interface TranscriptLine {
  id: number;
  speaker: "INTERVIEWER" | "INTERVIEWEE";
  text: string;
  timestamp: string;
}

interface Highlight {
  type: "insight" | "quote" | "decision" | "flag";
  content: string;
}

export default function InterviewPage() {
  const [transcriptLines, setTranscriptLines] = useState<TranscriptLine[]>([]);
  const [highlights, setHighlights] = useState<Highlight[]>([]);
  const [micActive, setMicActive] = useState(false);
  const [activeSpeaker, setActiveSpeaker] = useState<"INTERVIEWER" | "INTERVIEWEE">("INTERVIEWEE");
  const [analyzing, setAnalyzing] = useState(false);
  const [status, setStatus] = useState("DISCONNECTED");
  const [lineCounter, setLineCounter] = useState(0);

  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const micWsRef = useRef<WebSocket | null>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const ws = new WebSocket("ws://localhost:3001");
    ws.onopen = () => setStatus("CONNECTED");
    ws.onclose = () => setStatus("DISCONNECTED");
    return () => ws.close();
  }, []);

  // Auto-scroll transcript to bottom
  useEffect(() => {
    if (transcriptRef.current) {
      transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight;
    }
  }, [transcriptLines]);

  const toggleMic = async () => {
    if (micActive) {
      audioContextRef.current?.close();
      audioContextRef.current = null;
      mediaStreamRef.current?.getTracks().forEach(t => t.stop());
      mediaStreamRef.current = null;
      micWsRef.current?.close();
      micWsRef.current = null;
      setMicActive(false);
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;

      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      const audioContext = new AudioCtx({ sampleRate: 16000 });
      audioContextRef.current = audioContext;

      const ws = new WebSocket("ws://localhost:8005/ws/transcribe");
      micWsRef.current = ws;

      ws.onopen = () => {
        const source = audioContext.createMediaStreamSource(stream);
        const processor = audioContext.createScriptProcessor(4096, 1, 1);
        processor.onaudioprocess = (e) => {
          if (ws.readyState === WebSocket.OPEN) {
            const input = e.inputBuffer.getChannelData(0);
            const pcm16 = new Int16Array(input.length);
            for (let i = 0; i < input.length; i++) {
              const s = Math.max(-1, Math.min(1, input[i]));
              pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
            }
            ws.send(pcm16.buffer);
          }
        };
        source.connect(processor);
        processor.connect(audioContext.destination);
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === "transcript" && msg.text?.trim()) {
            const now = new Date();
            const timestamp = `${now.getHours().toString().padStart(2,"0")}:${now.getMinutes().toString().padStart(2,"0")}:${now.getSeconds().toString().padStart(2,"0")}`;
            setLineCounter(c => {
              const id = c + 1;
              setTranscriptLines(prev => [...prev, {
                id,
                speaker: activeSpeaker,
                text: msg.text.trim(),
                timestamp
              }]);
              return id;
            });
          }
        } catch {}
      };

      setMicActive(true);
    } catch (err) {
      console.error("Mic access denied:", err);
    }
  };

  const addManualLine = (text: string) => {
    if (!text.trim()) return;
    const now = new Date();
    const timestamp = `${now.getHours().toString().padStart(2,"0")}:${now.getMinutes().toString().padStart(2,"0")}:${now.getSeconds().toString().padStart(2,"0")}`;
    setLineCounter(c => {
      const id = c + 1;
      setTranscriptLines(prev => [...prev, { id, speaker: activeSpeaker, text: text.trim(), timestamp }]);
      return id;
    });
  };

  const handleAnalyze = async () => {
    if (transcriptLines.length === 0) return;
    setAnalyzing(true);

    const fullTranscript = transcriptLines
      .map(l => `[${l.timestamp}] ${l.speaker}: ${l.text}`)
      .join("\n");

    try {
      const res = await fetch("http://localhost:3001/api/agent/task", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "analyze_interview",
          payload: `You are a meticulous interview analyst. Extract key insights, decisions, important quotes, and flag any ambiguities from this interview transcript. Return a JSON array with objects of shape: {type: "insight"|"quote"|"decision"|"flag", content: string}. Only return the JSON array, no prose.\n\nTRANSCRIPT:\n${fullTranscript}`,
          url: "interview-analyzer"
        })
      });
      const data = await res.json();

      // Try to parse plan as JSON array
      try {
        const planText = data.plan || "";
        const jsonStart = planText.indexOf("[");
        const jsonEnd = planText.lastIndexOf("]") + 1;
        if (jsonStart !== -1 && jsonEnd > jsonStart) {
          const parsed: Highlight[] = JSON.parse(planText.slice(jsonStart, jsonEnd));
          setHighlights(parsed);
        } else {
          // Fallback: show raw response as a single insight
          setHighlights([{ type: "insight", content: planText }]);
        }
      } catch {
        setHighlights([{ type: "insight", content: data.plan || "Analysis complete." }]);
      }
    } catch (e) {
      console.error(e);
      setHighlights([{ type: "flag", content: "ERR_NETWORK: Could not connect to agent server." }]);
    }
    setAnalyzing(false);
  };

  const clearAll = () => {
    setTranscriptLines([]);
    setHighlights([]);
    setLineCounter(0);
  };

  const exportTranscript = () => {
    const lines = transcriptLines.map(l => `[${l.timestamp}] ${l.speaker}: ${l.text}`).join("\n");
    const highlightLines = highlights.map(h => `[${h.type.toUpperCase()}] ${h.content}`).join("\n");
    const content = `OPENCLAW INTERVIEW TRANSCRIPT\nGenerated: ${new Date().toISOString()}\n${"=".repeat(60)}\n\nFULL TRANSCRIPT:\n${lines}\n\n${"=".repeat(60)}\n\nEXTRACTED HIGHLIGHTS:\n${highlightLines}`;
    const blob = new Blob([content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `interview-transcript-${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const highlightColors: Record<Highlight["type"], { border: string; label: string; bg: string }> = {
    insight: { border: "#0A0A0A", label: "INSIGHT", bg: "#F5F2EB" },
    quote:   { border: "#E63946", label: "QUOTE",   bg: "#FFFFFF" },
    decision:{ border: "#0A0A0A", label: "DECISION", bg: "#0A0A0A" },
    flag:    { border: "#E63946", label: "FLAG",     bg: "#E63946" },
  };

  return (
    <main className="min-h-screen p-8 md:p-12 flex flex-col items-center">

      {/* Navigation */}
      <div className="w-full max-w-7xl mb-4">
        <a href="/" className="font-mono text-sm font-bold uppercase hover:text-[#E63946] transition-colors">
          ← BACK TO DASHBOARD
        </a>
      </div>

      {/* Header */}
      <div className="w-full max-w-7xl mb-10 border-b-[4px] border-[#0A0A0A] pb-6 flex flex-col md:flex-row justify-between items-end gap-6">
        <div>
          <h1 className="text-5xl md:text-6xl font-extrabold uppercase tracking-tight leading-none text-[#0A0A0A]">
            Interview<br />Transcriber
          </h1>
          <p className="font-mono text-sm text-[#4A4A4A] mt-3 uppercase tracking-widest">
            Verbatim Transcript · AI Insight Extraction
          </p>
        </div>
        <div className="flex flex-wrap gap-4 items-center">
          <div className="font-mono text-sm font-bold uppercase bg-[#FFFFFF] border-[4px] border-[#0A0A0A] p-3 brutal-shadow-sm flex items-center gap-3">
            <span>Daemon:</span>
            <span className={status === "CONNECTED" ? "text-green-600" : "text-[#E63946]"}>
              [{status}]
            </span>
          </div>
          <button onClick={exportTranscript} disabled={transcriptLines.length === 0} className="brutal-btn px-5 py-3 text-sm">
            EXPORT .TXT
          </button>
          <button onClick={clearAll} className="brutal-btn px-5 py-3 text-sm" style={{ borderColor: "#E63946", color: "#E63946" }}>
            CLEAR ALL
          </button>
        </div>
      </div>

      {/* Controls Bar */}
      <div className="w-full max-w-7xl mb-8 flex flex-wrap gap-4 items-center">
        {/* Speaker Toggle */}
        <div className="flex items-center brutal-border bg-[#FFFFFF] brutal-shadow-sm overflow-hidden">
          <button
            onClick={() => setActiveSpeaker("INTERVIEWER")}
            className={`px-6 py-3 font-mono text-sm font-bold uppercase border-r-[4px] border-[#0A0A0A] transition-colors ${activeSpeaker === "INTERVIEWER" ? "bg-[#0A0A0A] text-[#F5F2EB]" : "bg-[#FFFFFF] text-[#0A0A0A] hover:bg-[#F5F2EB]"}`}
          >
            Interviewer
          </button>
          <button
            onClick={() => setActiveSpeaker("INTERVIEWEE")}
            className={`px-6 py-3 font-mono text-sm font-bold uppercase transition-colors ${activeSpeaker === "INTERVIEWEE" ? "bg-[#0A0A0A] text-[#F5F2EB]" : "bg-[#FFFFFF] text-[#0A0A0A] hover:bg-[#F5F2EB]"}`}
          >
            Interviewee
          </button>
        </div>

        {/* Mic Button */}
        <button
          onClick={toggleMic}
          className={`brutal-btn px-6 py-3 text-sm flex items-center gap-2 ${micActive ? "bg-[#E63946] text-white" : ""}`}
          style={micActive ? { background: "#E63946", color: "#FFFFFF" } : {}}
        >
          {micActive ? "🔴 STOP RECORDING" : "🎙️ RECORD VOICE"}
        </button>

        {/* Manual Input */}
        <ManualInput onSubmit={addManualLine} />
      </div>

      {/* Main Grid */}
      <div className="w-full max-w-7xl grid grid-cols-1 lg:grid-cols-2 gap-10">

        {/* Full Transcript Panel */}
        <div className="flex flex-col">
          <div className="bg-[#0A0A0A] text-[#F5F2EB] font-mono p-4 font-bold uppercase text-base flex justify-between items-center border-[4px] border-[#0A0A0A]">
            <span>Full Transcript</span>
            <span className="text-[#4A4A4A] text-xs">{transcriptLines.length} LINES</span>
          </div>
          <div
            ref={transcriptRef}
            className="bg-[#FFFFFF] border-[4px] border-t-0 border-[#0A0A0A] brutal-shadow flex-1 overflow-y-auto"
            style={{ minHeight: "520px", maxHeight: "520px" }}
          >
            {transcriptLines.length === 0 ? (
              <div className="h-full flex items-center justify-center font-mono text-[#4A4A4A] text-center p-8">
                <div>
                  <p className="text-4xl mb-4">📄</p>
                  <p className="font-bold uppercase text-sm">Transcript is empty.</p>
                  <p className="text-xs mt-2">Activate the mic or type manually to begin.</p>
                </div>
              </div>
            ) : (
              <div className="p-6 space-y-1">
                {transcriptLines.map((line) => (
                  <div key={line.id} className="flex gap-3 py-3 border-b border-[#0A0A0A] border-opacity-10 group">
                    <span className="font-mono text-[10px] text-[#4A4A4A] pt-1 whitespace-nowrap shrink-0">
                      [{line.timestamp}]
                    </span>
                    <div className="flex-1">
                      <span className={`font-mono text-xs font-bold uppercase mr-3 ${
                        line.speaker === "INTERVIEWER" ? "text-[#0A0A0A]" : "text-[#E63946]"
                      }`}>
                        {line.speaker}:
                      </span>
                      <span className="text-base leading-relaxed">{line.text}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Highlights Panel */}
        <div className="flex flex-col">
          <div className="bg-[#E63946] text-[#FFFFFF] border-[4px] border-[#0A0A0A] font-mono p-4 font-bold uppercase text-base flex justify-between items-center">
            <span>AI Extracted Highlights</span>
            <button
              onClick={handleAnalyze}
              disabled={analyzing || transcriptLines.length === 0}
              className="brutal-btn px-4 py-2 text-xs"
              style={{ background: "#FFFFFF", color: "#0A0A0A", boxShadow: "none" }}
            >
              {analyzing ? "ANALYZING..." : "RUN ANALYSIS"}
            </button>
          </div>
          <div
            className="bg-[#F5F2EB] border-[4px] border-t-0 border-[#0A0A0A] brutal-shadow flex-1 overflow-y-auto"
            style={{ minHeight: "520px", maxHeight: "520px" }}
          >
            {highlights.length === 0 ? (
              <div className="h-full flex items-center justify-center font-mono text-[#4A4A4A] text-center p-8">
                <div>
                  <p className="text-4xl mb-4">🤖</p>
                  <p className="font-bold uppercase text-sm">No analysis yet.</p>
                  <p className="text-xs mt-2">Add transcript lines then click RUN ANALYSIS.</p>
                </div>
              </div>
            ) : (
              <div className="p-6 space-y-5">
                {highlights.map((h, i) => {
                  const cfg = highlightColors[h.type] || highlightColors.insight;
                  const isDark = h.type === "decision" || h.type === "flag";
                  return (
                    <div
                      key={i}
                      className="p-4 border-l-[8px] border-[2px] border-[#0A0A0A]"
                      style={{
                        borderLeftColor: cfg.border,
                        background: cfg.bg,
                        color: isDark ? "#F5F2EB" : "#0A0A0A"
                      }}
                    >
                      <div className="font-mono text-xs font-bold uppercase mb-2" style={{ opacity: 0.7 }}>
                        [{cfg.label}]
                      </div>
                      <p className="text-sm leading-relaxed font-medium">{h.content}</p>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

      </div>
    </main>
  );
}

// Small self-contained manual input component
function ManualInput({ onSubmit }: { onSubmit: (text: string) => void }) {
  const [value, setValue] = useState("");
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && value.trim()) {
      onSubmit(value);
      setValue("");
    }
  };
  return (
    <div className="flex flex-1 min-w-[220px]">
      <input
        type="text"
        value={value}
        onChange={e => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Type a line and press Enter..."
        className="flex-1 font-mono text-sm border-[4px] border-r-0 border-[#0A0A0A] px-4 py-3 bg-[#FFFFFF] text-[#0A0A0A] placeholder-[#4A4A4A] outline-none focus:border-[#E63946]"
        style={{ borderRadius: 0 }}
      />
      <button
        onClick={() => { if (value.trim()) { onSubmit(value); setValue(""); }}}
        className="brutal-btn px-4 py-3 text-sm border-l-0"
        style={{ boxShadow: "none" }}
      >
        ADD
      </button>
    </div>
  );
}
