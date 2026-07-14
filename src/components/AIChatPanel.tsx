import { useCallback, useEffect, useRef, useState } from 'react';
import { Glyph } from './Glyph';

type Props = { projectDir: string; openFiles: string[]; onFileChanged?: (path: string) => void };
type Message = { role: 'user' | 'assistant' | 'system'; content: string };
type StreamEvent = { type: string; text?: string; error?: unknown; tool?: string; sessionId?: string };

function renderText(text: string) {
  return text.split('\n').map((line, index) => <span key={index}>{line}{index < text.split('\n').length - 1 && <br />}</span>);
}

/** Natural-language coding partner. Floyd Core owns routing, tools and state. */
function AIChatPanel({ projectDir, openFiles }: Props) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [streamText, setStreamText] = useState('');
  const [health, setHealth] = useState<'checking' | 'ready' | 'offline'>('checking');
  const [sessionId, setSessionId] = useState<string>();
  const [events, setEvents] = useState<string[]>([]);
  const abortRef = useRef<AbortController | undefined>(undefined);
  const logRef = useRef<HTMLDivElement>(null);

  const checkHealth = useCallback(async () => {
    try {
      const response = await fetch('/api/floyd/health');
      setHealth(response.ok ? 'ready' : 'offline');
    } catch { setHealth('offline'); }
  }, []);

  useEffect(() => { void checkHealth(); const timer = setInterval(checkHealth, 5000); return () => clearInterval(timer); }, [checkHealth]);
  useEffect(() => { logRef.current?.scrollTo({ top: logRef.current.scrollHeight }); }, [messages, streamText, events]);
  useEffect(() => () => abortRef.current?.abort(), []);

  const newConversation = useCallback(() => {
    abortRef.current?.abort();
    setMessages([]); setStreamText(''); setEvents([]); setSessionId(undefined); setStreaming(false);
  }, []);

  const send = useCallback(async () => {
    const prompt = input.trim();
    if (!prompt || streaming || health !== 'ready') return;
    const controller = new AbortController();
    abortRef.current = controller;
    setInput(''); setStreaming(true); setStreamText(''); setEvents([]);
    setMessages((prior) => [...prior, { role: 'user', content: prompt }]);
    let accumulated = '';
    try {
      const response = await fetch('/api/floyd/stream', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ projectDir, message: prompt, sessionId }), signal: controller.signal,
      });
      if (!response.ok || !response.body) throw new Error(`Floyd Core returned HTTP ${response.status}: ${await response.text()}`);
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true }).replace(/\r\n?/g, '\n');
          const frames = buffer.split('\n\n'); buffer = frames.pop() || '';
          for (const frame of frames) {
            const raw = frame.split('\n').filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trimStart()).join('\n');
            if (!raw) continue;
            const event = JSON.parse(raw) as StreamEvent;
            if (event.sessionId) setSessionId(event.sessionId);
            if (event.type === 'token' && event.text) { accumulated += event.text; setStreamText(accumulated); }
            else if (event.type === 'tool_call') setEvents((prior) => [...prior, `Tool: ${event.tool || 'unknown'}`]);
            else if (event.type === 'error') throw new Error(typeof event.error === 'string' ? event.error : JSON.stringify(event.error));
          }
        }
      } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
      if (accumulated) setMessages((prior) => [...prior, { role: 'assistant', content: accumulated }]);
    } catch (error) {
      if (!controller.signal.aborted) setMessages((prior) => [...prior, { role: 'system', content: error instanceof Error ? error.message : String(error) }]);
    } finally { if (!controller.signal.aborted) { setStreaming(false); setStreamText(''); } }
  }, [health, input, projectDir, sessionId, streaming]);

  return <div className="panel ai-panel">
    <div className="panel-header"><span className="panel-title">Floyd Coding Partner</span><div className="panel-actions">
      <span className={`ai-status-dot ${health === 'ready' ? 'ready' : 'nokey'}`} title={`Floyd Core: ${health}`} />
      <button className="icon-btn" onClick={newConversation} title="New Core session"><Glyph name="plus" /></button>
    </div></div>
    <div className="ai-provider-badge"><span className="ai-provider-name">Floyd Core</span><span className="ai-model-name">OpenCode SDK</span><span className="ai-badge-spacer" /><span>{openFiles.length} open files</span></div>
    <div className="ai-log" ref={logRef}>
      {!messages.length && !streaming && <div className="ai-empty"><p>Describe a coding outcome in natural language.</p><p className="muted small">The current folder is the workspace. Routing, tools, permissions and durable state belong to Floyd Core.</p></div>}
      {messages.map((message, index) => <div key={index} className={`ai-msg ai-msg-${message.role === 'system' ? 'assistant' : message.role}`}><div className="ai-msg-avatar"><Glyph name={message.role === 'user' ? 'collab' : message.role === 'system' ? 'err' : 'ai'} /></div><div className="ai-msg-content">{renderText(message.content)}</div></div>)}
      {events.map((event, index) => <div key={`event-${index}`} className="ai-tool-card"><div className="ai-tool-header"><Glyph name="ext" /><span className="ai-tool-name">{event}</span></div></div>)}
      {streaming && <div className="ai-msg ai-msg-assistant"><div className="ai-msg-avatar"><Glyph name="ai" /></div><div className="ai-msg-content streaming">{streamText ? renderText(streamText) : 'Working'}<span className="ai-cursor">|</span></div></div>}
    </div>
    <div className="ai-input-area"><textarea className="ai-input" value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void send(); } }} placeholder={health === 'ready' ? 'Describe the coding outcome...' : 'Floyd Core is offline'} disabled={streaming || health !== 'ready'} rows={2} /><button className="ai-send-btn" onClick={() => void send()} disabled={streaming || health !== 'ready' || !input.trim()} title="Send"><Glyph name={streaming ? 'spinner' : 'rocket'} /></button></div>
  </div>;
}

export default AIChatPanel;
