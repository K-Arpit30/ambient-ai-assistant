import { useEffect, useState } from 'react';
import './index.css';

function App() {
  const [status, setStatus] = useState('CONNECTING');
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    const ws = new WebSocket('ws://localhost:3001');
    ws.onopen = () => setStatus('ONLINE');
    ws.onclose = () => setStatus('OFFLINE');
    ws.onerror = () => setStatus('ERROR');
    return () => ws.close();
  }, []);

  const handleSummarize = () => {
    setIsProcessing(true);
    setError(null);
    setSuccess(false);

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const activeTab = tabs[0];
      
      // Prevent running on chrome:// or restricted URLs
      if (!activeTab || !activeTab.id || activeTab.url?.startsWith('chrome://')) {
        setError("RESTRICTED_URL: Cannot read this page.");
        setIsProcessing(false);
        return;
      }

      chrome.tabs.sendMessage(activeTab.id, { type: 'EXTRACT_CONTENT' }, (response) => {
        if (chrome.runtime.lastError || !response) {
          console.error(chrome.runtime.lastError);
          setError("ERR_NO_CONTENT: Refresh the page.");
          setIsProcessing(false);
          return;
        }

        if (response && response.content) {
          fetch('http://localhost:3001/api/agent/task', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'summarize',
              payload: response.content,
              url: activeTab.url
            })
          })
          .then(res => {
            if (!res.ok) throw new Error("Server error");
            return res.json();
          })
          .then(_data => {
            setSuccess(true);
            setIsProcessing(false);
          })
          .catch(_err => {
            setError("ERR_NETWORK: Daemon unreachable.");
            setIsProcessing(false);
          });
        }
      });
    });
  };

  return (
    <div style={{ 
      padding: '24px', 
      width: '320px', 
      background: 'var(--color-base)',
      border: 'var(--border-thick)'
    }}>
      
      {/* Header */}
      <div style={{
        borderBottom: 'var(--border-thin)',
        paddingBottom: '16px',
        marginBottom: '24px'
      }}>
        <h1 style={{ 
          margin: 0, 
          fontSize: '24px', 
          fontWeight: 800,
          textTransform: 'uppercase',
          letterSpacing: '-1px',
          lineHeight: 1
        }}>
          OpenClaw<br/>Agent
        </h1>
      </div>

      {/* Status Bar */}
      <div style={{ 
        background: 'var(--color-surface)', 
        border: 'var(--border-thin)',
        padding: '12px', 
        marginBottom: '24px', 
        fontFamily: 'var(--font-mono)',
        fontSize: '12px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        boxShadow: 'var(--shadow-brutal)'
      }}>
        <span style={{ fontWeight: 700, textTransform: 'uppercase' }}>Sys.Status:</span>
        <span style={{ 
          color: status === 'ONLINE' ? '#10B981' : 'var(--color-accent)',
          fontWeight: 700 
        }}>
          [{status}]
        </span>
      </div>

      {/* Primary Action */}
      <button 
        className="btn-brutal"
        onClick={handleSummarize}
        disabled={isProcessing || status !== 'ONLINE'}
        style={{
          width: '100%',
          padding: '16px',
          fontSize: '14px',
          display: 'block'
        }}
      >
        {isProcessing ? 'PROCESSING...' : 'SUMMARIZE PAGE'}
      </button>

      {/* Alerts */}
      {error && (
        <div style={{ 
          background: 'var(--color-surface)',
          border: 'var(--border-thin)',
          borderLeft: '8px solid var(--color-accent)',
          marginTop: '24px', 
          padding: '12px',
          fontFamily: 'var(--font-mono)',
          fontSize: '11px',
          fontWeight: 700,
          color: 'var(--color-text-primary)'
        }}>
          {error}
        </div>
      )}

      {success && (
        <div style={{ 
          background: 'var(--color-surface)',
          border: 'var(--border-thin)',
          borderLeft: '8px solid #10B981',
          marginTop: '24px', 
          padding: '12px',
          fontFamily: 'var(--font-mono)',
          fontSize: '11px',
          fontWeight: 700,
          color: 'var(--color-text-primary)'
        }}>
          TASK DISPATCHED SUCCESS
        </div>
      )}

    </div>
  );
}

export default App;
