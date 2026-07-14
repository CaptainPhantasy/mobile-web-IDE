import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Glyph } from './Glyph';
import {
  FloydExperienceClient,
  formatFloydArtifact,
  normalizeFloydTranscript,
  normalizePendingPermissions,
  normalizePendingQuestions,
  type FloydDraftDivergence,
} from '../lib/floyd-experience';

type Props = {
  projectDir: string;
  openFiles: string[];
  draft: string;
  draftDivergence?: FloydDraftDivergence | null;
  selectedArtifactId?: string | null;
  selectedView?: string;
  pendingQuestions?: unknown[];
  pendingPermissions?: unknown[];
  modelRoute?: { provider: string | null; model: string | null };
  restoredSessionId?: string;
  restoredRunId?: string;
  onDraftChange: (draft: string) => void;
  onContextChange: (context: { sessionId: string | null; runId: string | null }) => void;
  onFileChanged?: (path: string) => void;
};
type Message = { role: 'user' | 'assistant' | 'system'; content: string };
type StreamEvent = { type: string; text?: string; error?: unknown; tool?: string; sessionId?: string; runId?: string };

function renderText(text: string) {
  return text.split('\n').map((line, index) => <span key={index}>{line}{index < text.split('\n').length - 1 && <br />}</span>);
}

function draftPreview(text: string | null): string {
  if (text === null) return '(remote draft unavailable)';
  if (!text) return '(empty)';
  return text.length > 160 ? `${text.slice(0, 160)}…` : text;
}

/** Natural-language coding partner. Floyd Core owns routing, tools and state. */
function AIChatPanel({
  projectDir,
  openFiles,
  draft,
  draftDivergence,
  selectedArtifactId,
  selectedView,
  pendingQuestions = [],
  pendingPermissions = [],
  modelRoute,
  restoredSessionId,
  restoredRunId,
  onDraftChange,
  onContextChange,
}: Props) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [streamText, setStreamText] = useState('');
  const [health, setHealth] = useState<'checking' | 'ready' | 'offline'>('checking');
  const [sessionId, setSessionId] = useState<string | undefined>(restoredSessionId);
  const [runId, setRunId] = useState<string | undefined>(restoredRunId);
  const [events, setEvents] = useState<string[]>([]);
  const [artifact, setArtifact] = useState<{ id: string; content?: string; error?: string } | null>(null);
  const [questionAnswers, setQuestionAnswers] = useState<Record<string, string>>({});
  const [interactionBusy, setInteractionBusy] = useState<string | null>(null);
  const [interactionError, setInteractionError] = useState<string | null>(null);
  const [deliveredInteractions, setDeliveredInteractions] = useState<Set<string>>(() => new Set());
  const abortRef = useRef<AbortController | undefined>(undefined);
  const transcriptAbortRef = useRef<AbortController | undefined>(undefined);
  const artifactAbortRef = useRef<AbortController | undefined>(undefined);
  const interactionAbortRef = useRef<AbortController | undefined>(undefined);
  const transcriptGenerationRef = useRef(0);
  const artifactGenerationRef = useRef(0);
  const contextGenerationRef = useRef(0);
  const logRef = useRef<HTMLDivElement>(null);
  const experienceClient = useMemo(() => new FloydExperienceClient(), []);
  const questions = useMemo(() => normalizePendingQuestions(pendingQuestions), [pendingQuestions]);
  const permissions = useMemo(() => normalizePendingPermissions(pendingPermissions), [pendingPermissions]);

  const checkHealth = useCallback(async () => {
    try {
      const response = await fetch('/api/floyd/health');
      setHealth(response.ok ? 'ready' : 'offline');
    } catch { setHealth('offline'); }
  }, []);

  useEffect(() => { void checkHealth(); const timer = setInterval(checkHealth, 5000); return () => clearInterval(timer); }, [checkHealth]);
  useEffect(() => { logRef.current?.scrollTo({ top: logRef.current.scrollHeight }); }, [messages, streamText, events]);
  useEffect(() => () => {
    abortRef.current?.abort();
    transcriptAbortRef.current?.abort();
    artifactAbortRef.current?.abort();
    interactionAbortRef.current?.abort();
  }, []);
  useEffect(() => {
    if (streaming) return;
    setSessionId(restoredSessionId);
    setRunId(restoredRunId);
  }, [restoredRunId, restoredSessionId, streaming]);

  // A fresh Core attach yields the durable, run-scoped provider transcript.
  // Generation and abort guards prevent a slow prior selection from replacing
  // the conversation for a newer run.
  useEffect(() => {
    const generation = ++transcriptGenerationRef.current;
    transcriptAbortRef.current?.abort();
    const controller = new AbortController();
    transcriptAbortRef.current = controller;
    if (!restoredSessionId || !restoredRunId || streaming) return () => controller.abort();
    setMessages([]);
    void experienceClient.transcript(restoredSessionId, restoredRunId, controller.signal).then((snapshot) => {
      if (controller.signal.aborted || generation !== transcriptGenerationRef.current) return;
      if (snapshot.session_id !== restoredSessionId || snapshot.run_id !== restoredRunId) return;
      setMessages(normalizeFloydTranscript(snapshot.messages));
    }).catch((error) => {
      if (controller.signal.aborted || generation !== transcriptGenerationRef.current) return;
      setMessages([{ role: 'system', content: `Transcript unavailable: ${error instanceof Error ? error.message : String(error)}` }]);
    });
    return () => {
      controller.abort();
      if (transcriptAbortRef.current === controller) transcriptAbortRef.current = undefined;
    };
  }, [experienceClient, restoredRunId, restoredSessionId, streaming]);

  useEffect(() => {
    const generation = ++artifactGenerationRef.current;
    artifactAbortRef.current?.abort();
    setArtifact(selectedArtifactId ? { id: selectedArtifactId } : null);
    if (!selectedArtifactId) return;
    const controller = new AbortController();
    artifactAbortRef.current = controller;
    void experienceClient.artifact(selectedArtifactId, controller.signal).then((payload) => {
      if (controller.signal.aborted || generation !== artifactGenerationRef.current) return;
      setArtifact({ id: selectedArtifactId, content: formatFloydArtifact(payload) });
    }).catch((error) => {
      if (controller.signal.aborted || generation !== artifactGenerationRef.current) return;
      setArtifact({ id: selectedArtifactId, error: error instanceof Error ? error.message : String(error) });
    });
    return () => controller.abort();
  }, [experienceClient, restoredRunId, restoredSessionId, selectedArtifactId]);

  useEffect(() => {
    contextGenerationRef.current += 1;
    interactionAbortRef.current?.abort();
    interactionAbortRef.current = undefined;
    setInteractionBusy(null);
    setInteractionError(null);
    setDeliveredInteractions(new Set());
    setQuestionAnswers({});
  }, [restoredRunId, restoredSessionId]);

  const newConversation = useCallback(() => {
    abortRef.current?.abort();
    transcriptAbortRef.current?.abort();
    artifactAbortRef.current?.abort();
    interactionAbortRef.current?.abort();
    transcriptGenerationRef.current += 1;
    setMessages([]); setStreamText(''); setEvents([]); setSessionId(undefined); setRunId(undefined); setStreaming(false);
    onContextChange({ sessionId: null, runId: null });
  }, [onContextChange]);

  const answerQuestion = useCallback(async (requestId: string, promptCount: number) => {
    if (!restoredSessionId || !restoredRunId) {
      setInteractionError('Cannot answer: the restored Floyd session or run is missing.');
      return;
    }
    const answers = Array.from({ length: promptCount }, (_, index) => (
      questionAnswers[`${requestId}:${index}`]?.split('\n').map((answer) => answer.trim()).filter(Boolean) || []
    ));
    if (answers.some((answer) => !answer.length)) {
      setInteractionError('Answer every prompt before submitting this question.');
      return;
    }
    interactionAbortRef.current?.abort();
    const controller = new AbortController();
    interactionAbortRef.current = controller;
    const generation = contextGenerationRef.current;
    setInteractionBusy(`question:${requestId}`);
    setInteractionError(null);
    try {
      await experienceClient.answerQuestion(restoredSessionId, restoredRunId, requestId, answers, controller.signal);
      if (controller.signal.aborted || generation !== contextGenerationRef.current) return;
      setDeliveredInteractions((current) => new Set(current).add(`question:${requestId}`));
    } catch (error) {
      if (controller.signal.aborted || generation !== contextGenerationRef.current) return;
      setInteractionError(error instanceof Error ? error.message : String(error));
    } finally {
      if (!controller.signal.aborted && generation === contextGenerationRef.current) setInteractionBusy(null);
    }
  }, [experienceClient, questionAnswers, restoredRunId, restoredSessionId]);

  const decidePermission = useCallback(async (requestId: string, reply: 'once' | 'always' | 'reject') => {
    if (!restoredSessionId || !restoredRunId) {
      setInteractionError('Cannot decide: the restored Floyd session or run is missing.');
      return;
    }
    interactionAbortRef.current?.abort();
    const controller = new AbortController();
    interactionAbortRef.current = controller;
    const generation = contextGenerationRef.current;
    setInteractionBusy(`permission:${requestId}`);
    setInteractionError(null);
    try {
      await experienceClient.decidePermission(restoredSessionId, restoredRunId, requestId, reply, controller.signal);
      if (controller.signal.aborted || generation !== contextGenerationRef.current) return;
      setDeliveredInteractions((current) => new Set(current).add(`permission:${requestId}`));
    } catch (error) {
      if (controller.signal.aborted || generation !== contextGenerationRef.current) return;
      setInteractionError(error instanceof Error ? error.message : String(error));
    } finally {
      if (!controller.signal.aborted && generation === contextGenerationRef.current) setInteractionBusy(null);
    }
  }, [experienceClient, restoredRunId, restoredSessionId]);

  const send = useCallback(async () => {
    const prompt = draft.trim();
    if (!prompt || streaming || health !== 'ready') return;
    const controller = new AbortController();
    abortRef.current = controller;
    onDraftChange(''); setStreaming(true); setStreamText(''); setEvents([]);
    setMessages((prior) => [...prior, { role: 'user', content: prompt }]);
    let accumulated = '';
    try {
      const response = await fetch('/api/floyd/stream', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ projectDir, message: prompt, sessionId, runId }), signal: controller.signal,
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
            if (event.sessionId) {
              setSessionId(event.sessionId);
              setRunId(event.runId);
              onContextChange({ sessionId: event.sessionId, runId: event.runId || null });
            }
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
  }, [draft, health, onContextChange, onDraftChange, projectDir, runId, sessionId, streaming]);

  return <div className="panel ai-panel">
    <div className="panel-header"><span className="panel-title">Floyd Coding Partner</span><div className="panel-actions">
      <span className={`ai-status-dot ${health === 'ready' ? 'ready' : 'nokey'}`} title={`Floyd Core: ${health}`} />
      <button className="icon-btn" onClick={newConversation} title="New Core session"><Glyph name="plus" /></button>
    </div></div>
    <div className="ai-provider-badge">
      <span className="ai-provider-name">{modelRoute?.provider || 'Floyd Core'}</span>
      <span className="ai-model-name">{modelRoute?.model || 'Core-selected model'}</span>
      <span className="ai-badge-spacer" />
      <span>{openFiles.length} open files</span>
    </div>
    <div className="ai-log" ref={logRef}>
      {artifact && <section className="ai-experience-card" aria-label="Selected Floyd artifact">
        <div className="ai-experience-title">Selected artifact</div>
        <div className="ai-experience-meta">{artifact.id} · {selectedView || 'portable view'}</div>
        {artifact.error
          ? <div className="panel-error" role="alert">{artifact.error}</div>
          : <pre className="ai-artifact-content">{artifact.content ?? 'Loading artifact…'}</pre>}
      </section>}
      {questions.map((request) => <section className="ai-experience-card" key={`question:${request.id}`}>
        <div className="ai-experience-title">Floyd needs an answer</div>
        {request.prompts.map((prompt, index) => <div className="ai-question" key={`${request.id}:${index}`}>
          <label htmlFor={`question-${request.id}-${index}`}>{prompt.prompt}</label>
          {prompt.options.length > 0 && <div className="ai-choice-row">{prompt.options.map((option) => <button
            type="button"
            key={option}
            disabled={interactionBusy !== null || deliveredInteractions.has(`question:${request.id}`)}
            onClick={() => setQuestionAnswers((current) => {
              const key = `${request.id}:${index}`;
              if (!prompt.multiple) return { ...current, [key]: option };
              const selected = (current[key] || '').split('\n').filter(Boolean);
              return { ...current, [key]: selected.includes(option) ? selected.filter((item) => item !== option).join('\n') : [...selected, option].join('\n') };
            })}
          >{option}</button>)}</div>}
          <textarea
            id={`question-${request.id}-${index}`}
            value={questionAnswers[`${request.id}:${index}`] || ''}
            onChange={(event) => setQuestionAnswers((current) => ({ ...current, [`${request.id}:${index}`]: event.target.value }))}
            disabled={interactionBusy !== null || deliveredInteractions.has(`question:${request.id}`)}
            placeholder={prompt.multiple ? 'One answer per line' : 'Type an answer'}
            rows={prompt.multiple ? 3 : 2}
          />
        </div>)}
        <button
          type="button"
          onClick={() => void answerQuestion(request.id, request.prompts.length)}
          disabled={interactionBusy !== null || deliveredInteractions.has(`question:${request.id}`)}
        >{deliveredInteractions.has(`question:${request.id}`) ? 'Answer delivered' : 'Submit answer'}</button>
      </section>)}
      {permissions.map((request) => <section className="ai-experience-card" key={`permission:${request.id}`}>
        <div className="ai-experience-title">Permission required</div>
        <div>{request.action}</div>
        {request.resources.length > 0 && <div className="ai-experience-meta">{request.resources.join(' · ')}</div>}
        <div className="ai-choice-row">
          <button type="button" disabled={interactionBusy !== null || deliveredInteractions.has(`permission:${request.id}`)} onClick={() => void decidePermission(request.id, 'once')}>Allow once</button>
          <button type="button" disabled={interactionBusy !== null || deliveredInteractions.has(`permission:${request.id}`)} onClick={() => void decidePermission(request.id, 'always')}>Always allow</button>
          <button type="button" disabled={interactionBusy !== null || deliveredInteractions.has(`permission:${request.id}`)} onClick={() => void decidePermission(request.id, 'reject')}>Reject</button>
        </div>
        {deliveredInteractions.has(`permission:${request.id}`) && <div className="ai-experience-meta">Decision delivered to Floyd Core.</div>}
      </section>)}
      {interactionError && <div className="panel-error" role="alert">{interactionError}</div>}
      {!artifact && !questions.length && !permissions.length && !messages.length && !streaming && <div className="ai-empty"><p>Describe a coding outcome in natural language.</p><p className="muted small">The current folder is the workspace. Routing, tools, permissions and durable state belong to Floyd Core.</p></div>}
      {messages.map((message, index) => <div key={index} className={`ai-msg ai-msg-${message.role === 'system' ? 'assistant' : message.role}`}><div className="ai-msg-avatar"><Glyph name={message.role === 'user' ? 'collab' : message.role === 'system' ? 'err' : 'ai'} /></div><div className="ai-msg-content">{renderText(message.content)}</div></div>)}
      {events.map((event, index) => <div key={`event-${index}`} className="ai-tool-card"><div className="ai-tool-header"><Glyph name="ext" /><span className="ai-tool-name">{event}</span></div></div>)}
      {streaming && <div className="ai-msg ai-msg-assistant"><div className="ai-msg-avatar"><Glyph name="ai" /></div><div className="ai-msg-content streaming">{streamText ? renderText(streamText) : 'Working'}<span className="ai-cursor">|</span></div></div>}
    </div>
    {draftDivergence && <div className="panel-error" role="alert">
      <div>Draft conflict: your local draft is retained and remains unsent.</div>
      <div>Local: {draftPreview(draftDivergence.local)}</div>
      <div>Core: {draftPreview(draftDivergence.remote)}</div>
    </div>}
    <div className="ai-input-area"><textarea className="ai-input" value={draft} onChange={(event) => onDraftChange(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void send(); } }} placeholder={health === 'ready' ? 'Describe the coding outcome...' : 'Floyd Core is offline'} disabled={streaming || health !== 'ready'} rows={2} /><button className="ai-send-btn" onClick={() => void send()} disabled={streaming || health !== 'ready' || !draft.trim()} title="Send"><Glyph name={streaming ? 'spinner' : 'rocket'} /></button></div>
  </div>;
}

export default AIChatPanel;
