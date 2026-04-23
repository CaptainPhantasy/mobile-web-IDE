// AI Chat Panel — multi-provider LLM assistant with agentic tool-use.
//
// Provides:
//   - Chat message list (user + assistant + tool-call visualisation)
//   - Input area for natural language prompts
//   - Provider settings (API key, model, base URL)
//   - Streaming token display
//   - Tool call/result expandable cards
//   - Test Connection button
//   - Debug mode checkbox for verbose error output

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Provider,
  ChatMessage,
  ToolCall,
  ToolResult,
  BUILTIN_PROVIDERS,
  loadProviders,
  saveProviders,
  getActiveProviderId,
  setActiveProviderId,
  runAgenticLoop,
  testProvider,
  TestResult,
  listConfiguredProviders,
} from '../lib/llm';
import { setVaultKey, deleteVaultKey } from '../lib/vault';
import { Glyph } from './Glyph';

type Props = {
  projectDir: string;
  openFiles: string[];
  onFileChanged?: (path: string) => void;
};

// ─── Sub-components ──────────────────────────────────────────────────────

function ToolCallCard({ call, result }: { call: ToolCall; result?: ToolResult }) {
  const [open, setOpen] = useState(false);
  const name = call.function.name;
  let args: Record<string, unknown> = {};
  try { args = JSON.parse(call.function.arguments); } catch {}

  return (
    <div className="ai-tool-card" onClick={() => setOpen((o) => !o)}>
      <div className="ai-tool-header">
        <span className="ai-tool-icon"><Glyph name="ext" /></span>
        <span className="ai-tool-name">{name}</span>
        {result && (
          <span className={result.success ? 'ai-tool-ok' : 'ai-tool-err'}>
            <Glyph name={result.success ? 'ok' : 'err'} />
          </span>
        )}
      </div>
      {open && (
        <div className="ai-tool-body">
          <div className="ai-tool-args">
            {Object.entries(args).map(([k, v]) => (
              <div key={k} className="ai-tool-arg">
                <span className="ai-tool-key">{k}:</span>
                <span className="ai-tool-val">
                  {typeof v === 'string' && v.length > 200
                    ? v.slice(0, 200) + '…'
                    : String(v)}
                </span>
              </div>
            ))}
          </div>
          {result && (
            <pre className="ai-tool-result">{result.content.slice(0, 1000)}</pre>
          )}
        </div>
      )}
    </div>
  );
}

function Markdownish({ text }: { text: string }) {
  // Very lightweight "markdown" renderer for code blocks + inline code + bold.
  const parts: React.ReactNode[] = [];
  let key = 0;
  const blocks = text.split(/(```[\s\S]*?```)/g);

  for (const block of blocks) {
    if (block.startsWith('```')) {
      const inner = block.slice(3, -3);
      const firstNewline = inner.indexOf('\n');
      const lang = firstNewline > 0 ? inner.slice(0, firstNewline).trim() : '';
      const code = firstNewline > 0 ? inner.slice(firstNewline + 1) : inner;
      parts.push(
        <pre key={key++} className="ai-code-block">
          {lang && <div className="ai-code-lang">{lang}</div>}
          <code>{code}</code>
        </pre>,
      );
    } else {
      // Inline formatting
      const segments = block.split(/(`[^`\n]+`)/g);
      for (const seg of segments) {
        if (seg.startsWith('`') && seg.endsWith('`')) {
          parts.push(<code key={key++} className="ai-inline-code">{seg.slice(1, -1)}</code>);
        } else {
          // Bold
          const boldParts = seg.split(/(\*\*[^*]+\*\*)/g);
          for (const bp of boldParts) {
            if (bp.startsWith('**') && bp.endsWith('**')) {
              parts.push(<strong key={key++}>{bp.slice(2, -2)}</strong>);
            } else {
              // Newlines → <br>
              const lines = bp.split('\n');
              lines.forEach((line, i) => {
                parts.push(<span key={key++}>{line}</span>);
                if (i < lines.length - 1) parts.push(<br key={key++} />);
              });
            }
          }
        }
      }
    }
  }
  return <>{parts}</>;
}

// ─── Settings Panel ──────────────────────────────────────────────────────

function SettingsPanel({
  providers,
  activeId,
  onSelect,
  onUpdate,
  onTest,
  testResult,
  testing,
  hasKey,
  onKeyChange,
  onKeyDelete,
}: {
  providers: Provider[];
  activeId: string;
  onSelect: (id: string) => void;
  onUpdate: (provider: Provider) => void;
  onTest: () => void;
  testResult: TestResult | null;
  testing: boolean;
  hasKey: Set<string>;
  onKeyChange: (providerId: string, newKey: string) => void;
  onKeyDelete: (providerId: string) => void;
}) {
  const active = providers.find((p) => p.id === activeId);
  const [keyDraft, setKeyDraft] = useState('');
  useEffect(() => { setKeyDraft(''); }, [activeId]);
  const keyConfigured = !!active && hasKey.has(active.id);

  return (
    <div className="ai-settings">
      <div className="panel-header">
        <span className="panel-title">Provider Settings</span>
      </div>
      <div className="ai-settings-body">
        <label className="ai-label">Provider</label>
        <select
          value={activeId}
          onChange={(e) => onSelect(e.target.value)}
          className="ai-select"
        >
          {providers.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>

        {active && (
          <>
            <label className="ai-label">
              API Key {keyConfigured && <span className="ai-key-ok" title="Stored in server vault"><Glyph name="ok" /> vaulted</span>}
            </label>
            <div className="row">
              <input
                type="password"
                placeholder={keyConfigured ? '•••• replace key' : 'sk-…'}
                value={keyDraft}
                onChange={(e) => setKeyDraft(e.target.value)}
                onBlur={() => {
                  if (!active) return;
                  const k = keyDraft.trim();
                  if (k.length > 0) {
                    onKeyChange(active.id, k);
                    setKeyDraft('');
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    (e.target as HTMLInputElement).blur();
                  }
                }}
              />
              {keyConfigured && (
                <button
                  onClick={() => active && onKeyDelete(active.id)}
                  title="Remove key from vault"
                >
                  <Glyph name="trash" />
                </button>
              )}
            </div>

            <label className="ai-label">Model</label>
            <input
              type="text"
              placeholder="gpt-4o"
              value={active.model}
              onChange={(e) => onUpdate({ ...active, model: e.target.value })}
            />

            <label className="ai-label">Base URL</label>
            <input
              type="text"
              placeholder="https://api.openai.com/v1"
              value={active.baseUrl}
              onChange={(e) => onUpdate({ ...active, baseUrl: e.target.value })}
            />

            <label className="ai-label">Max Tokens</label>
            <input
              type="number"
              value={active.maxTokens || 4096}
              onChange={(e) => onUpdate({ ...active, maxTokens: Number(e.target.value) || 4096 })}
            />

            {/* Test Connection Button */}
            <button
              className="ai-test-btn"
              onClick={onTest}
              disabled={testing || (!keyConfigured && !keyDraft.trim()) || !active.baseUrl || !active.model}
            >
              {testing ? 'TESTING…' : 'TEST CONNECTION'}
            </button>

            {/* Test Result */}
            {testResult && (
              <div className={`ai-test-result ${testResult.ok ? 'ok' : 'err'}`}>
                <div className="ai-test-status">
                  <Glyph name={testResult.ok ? 'ok' : 'err'} color={testResult.ok ? 'var(--c-green)' : 'var(--c-red)'} />
                  {' '}{testResult.ok ? 'Connection OK' : 'Connection Failed'}
                  {testResult.responseTime != null && (
                    <span className="ai-test-time"> ({testResult.responseTime}ms)</span>
                  )}
                </div>
                {testResult.ok && testResult.model && (
                  <div className="ai-test-detail">Model: {testResult.model}</div>
                )}
                {testResult.error && (
                  <pre className="ai-test-error">{testResult.error}</pre>
                )}
                {testResult.url && (
                  <div className="ai-test-detail muted small">URL: {testResult.url}</div>
                )}
                {testResult.snippet && (
                  <details>
                    <summary className="muted small">Raw response</summary>
                    <pre className="ai-test-snippet">{testResult.snippet}</pre>
                  </details>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────

export default function AIChatPanel({ projectDir, openFiles, onFileChanged }: Props) {
  const [providers, setProviders] = useState<Provider[]>(BUILTIN_PROVIDERS);
  const [activeProviderId, setActiveId] = useState('openai');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [toolResults, setToolResults] = useState<Record<string, ToolResult>>({});
  const [toolCallsInMsg, setToolCallsInMsg] = useState<Record<number, ToolCall[]>>({});
  const [streamingText, setStreamingText] = useState('');
  const [debug, setDebug] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [testing, setTesting] = useState(false);
  /** Provider IDs that currently have a key in the server-side vault. */
  const [vaultedIds, setVaultedIds] = useState<Set<string>>(new Set());

  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const refreshVault = useCallback(async () => {
    try {
      setVaultedIds(await listConfiguredProviders());
    } catch {
      setVaultedIds(new Set());
    }
  }, []);

  // ── Load persisted state ──
  useEffect(() => {
    (async () => {
      const [saved, activeId] = await Promise.all([
        loadProviders(),
        getActiveProviderId(),
      ]);
      setProviders(saved);
      setActiveId(activeId);
      // loadProviders() migrates any legacy in-IDB keys into the vault.
      // Refresh our local mirror after that.
      await refreshVault();
    })();
  }, [refreshVault]);

  // ── Auto-scroll ──
  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [messages, streamingText, toolResults]);

  // ── Save providers on change ──
  const updateProvider = useCallback(
    (updated: Provider) => {
      setProviders((prev) => {
        const next = prev.map((p) => (p.id === updated.id ? updated : p));
        saveProviders(next);
        return next;
      });
      // Clear stale test result when config changes
      setTestResult(null);
    },
    [],
  );

  /** Send a new key to the server vault. Client never persists it. */
  const setProviderKey = useCallback(async (id: string, key: string) => {
    const ok = await setVaultKey(id, key);
    if (ok) {
      setVaultedIds((prev) => {
        const next = new Set(prev);
        next.add(id);
        return next;
      });
      setTestResult(null);
    }
  }, []);

  /** Remove a key from the vault. */
  const deleteProviderKey = useCallback(async (id: string) => {
    const ok = await deleteVaultKey(id);
    if (ok) {
      setVaultedIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      setTestResult(null);
    }
  }, []);

  const selectProvider = useCallback(async (id: string) => {
    setActiveId(id);
    await setActiveProviderId(id);
    setTestResult(null);
  }, []);

  // ── Test Connection ──
  const handleTest = useCallback(async () => {
    const provider = providers.find((p) => p.id === activeProviderId);
    if (!provider) return;
    setTesting(true);
    setTestResult(null);
    try {
      const result = await testProvider(provider);
      setTestResult(result);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setTestResult({ ok: false, error: `Unexpected error: ${msg}` });
    } finally {
      setTesting(false);
    }
  }, [providers, activeProviderId]);

  // ── Send message ──
  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || streaming) return;

    const provider = providers.find((p) => p.id === activeProviderId);
    if (!provider) return;
    if (!vaultedIds.has(provider.id)) {
      setShowSettings(true);
      return;
    }

    const userMsg: ChatMessage = { role: 'user', content: text };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput('');
    setStreaming(true);
    setStreamingText('');
    setToolCallsInMsg({});
    setToolResults({});

    const msgIndexStart = newMessages.length; // assistant msg will be at this index
    const newToolCalls: Record<number, ToolCall[]> = {};
    const newToolResults: Record<string, ToolResult> = {};

    try {
      const finalMessages = await runAgenticLoop(
        provider,
        projectDir,
        newMessages,
        openFiles,
        {
          onToken(t) {
            setStreamingText((prev) => prev + t);
          },
          onToolCall(call) {
            const msgIdx = msgIndexStart;
            if (!newToolCalls[msgIdx]) newToolCalls[msgIdx] = [];
            newToolCalls[msgIdx].push(call);
            setToolCallsInMsg({ ...newToolCalls });
          },
          onToolResult(callId, result) {
            newToolResults[callId] = result;
            setToolResults({ ...newToolResults });
            // Notify parent that files may have changed
            if (result.success && onFileChanged) {
              onFileChanged('.');
            }
          },
          onError(error) {
            setMessages((prev) => [
              ...prev,
              { role: 'assistant', content: `Error: ${error}` },
            ]);
          },
          onComplete(allMsgs) {
            // The streaming text has already been accumulated; move it to messages
            setStreamingText('');
            setMessages(allMsgs);
          },
        },
        debug,
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: `Error: ${msg}` },
      ]);
    } finally {
      setStreaming(false);
    }
  }, [input, streaming, providers, activeProviderId, messages, projectDir, openFiles, onFileChanged, debug]);

  // ── Keyboard shortcut ──
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    },
    [sendMessage],
  );

  // ── New conversation ──
  const newConversation = useCallback(() => {
    setMessages([]);
    setStreamingText('');
    setToolCallsInMsg({});
    setToolResults({});
  }, []);

  const activeProvider = providers.find((p) => p.id === activeProviderId);

  return (
    <div className="panel ai-panel">
      {/* Header */}
      <div className="panel-header">
        <span className="panel-title">AI Assistant</span>
        <div className="panel-actions">
          <button
            className="icon-btn"
            onClick={newConversation}
            title="New conversation"
            disabled={streaming}
          >
            <Glyph name="plus" />
          </button>
          <button
            className="icon-btn"
            onClick={() => setShowSettings((s) => !s)}
            title="Provider settings"
          >
            <Glyph name="ext" />
          </button>
        </div>
      </div>

      {/* Provider badge */}
      <div className="ai-provider-badge">
        <span className={`ai-status-dot ${streaming ? 'streaming' : (activeProvider && vaultedIds.has(activeProvider.id)) ? 'ready' : 'nokey'}`} />
        <span className="ai-provider-name">{activeProvider?.name || 'No provider'}</span>
        <span className="ai-model-name">{activeProvider?.model || ''}</span>
        <span className="ai-badge-spacer" />
        <label className="ai-debug-toggle" title="Debug mode: show full errors and request details">
          <input
            type="checkbox"
            checked={debug}
            onChange={(e) => setDebug(e.target.checked)}
          />
          <span className="ai-debug-label">Debug</span>
        </label>
      </div>

      {/* Settings (collapsible) */}
      {showSettings && (
        <SettingsPanel
          providers={providers}
          activeId={activeProviderId}
          onSelect={selectProvider}
          onUpdate={updateProvider}
          onTest={handleTest}
          testResult={testResult}
          testing={testing}
          hasKey={vaultedIds}
          onKeyChange={setProviderKey}
          onKeyDelete={deleteProviderKey}
        />
      )}

      {/* Debug info panel */}
      {debug && activeProvider && (
        <div className="ai-debug-panel">
          <div className="ai-debug-row">
            <span className="ai-debug-key">Provider:</span>
            <span className="ai-debug-val">{activeProvider.id} ({activeProvider.type})</span>
          </div>
          <div className="ai-debug-row">
            <span className="ai-debug-key">Base URL:</span>
            <span className="ai-debug-val">{activeProvider.baseUrl || '(none)'}</span>
          </div>
          <div className="ai-debug-row">
            <span className="ai-debug-key">Model:</span>
            <span className="ai-debug-val">{activeProvider.model || '(none)'}</span>
          </div>
          <div className="ai-debug-row">
            <span className="ai-debug-key">API Key:</span>
            <span className="ai-debug-val">{vaultedIds.has(activeProvider.id) ? '(vaulted — server-side)' : '(none)'}</span>
          </div>
          <div className="ai-debug-row">
            <span className="ai-debug-key">Endpoint:</span>
            <span className="ai-debug-val">
              {activeProvider.type === 'anthropic'
                ? `${activeProvider.baseUrl.replace(/\/+$/, '')}/messages`
                : `${activeProvider.baseUrl.replace(/\/+$/, '')}/chat/completions`}
            </span>
          </div>
        </div>
      )}

      {/* Messages */}
      <div className="ai-log" ref={logRef}>
        {messages.length === 0 && !streaming && (
          <div className="ai-empty">
            <p>Ask me to read, write, refactor, or explain code.</p>
            <p className="muted small">Configure a provider with <Glyph name="ext" /> to get started.</p>
          </div>
        )}
        {messages.map((msg, i) => {
          if (msg.role === 'system') return null;

          if (msg.role === 'user') {
            return (
              <div key={i} className="ai-msg ai-msg-user">
                <div className="ai-msg-avatar"><Glyph name="collab" /></div>
                <div className="ai-msg-content">{msg.content}</div>
              </div>
            );
          }

          // assistant message
          const calls = toolCallsInMsg[i] || msg.tool_calls || [];
          return (
            <div key={i} className="ai-msg ai-msg-assistant">
              <div className="ai-msg-avatar"><Glyph name="ai" /></div>
              <div className="ai-msg-body">
                {msg.content && (
                  <div className="ai-msg-content">
                    <Markdownish text={msg.content} />
                  </div>
                )}
                {calls.map((tc) => (
                  <ToolCallCard
                    key={tc.id}
                    call={tc}
                    result={toolResults[tc.id]}
                  />
                ))}
              </div>
            </div>
          );
        })}

        {/* Streaming indicator */}
        {streaming && streamingText && (
          <div className="ai-msg ai-msg-assistant">
            <div className="ai-msg-avatar"><Glyph name="ai" /></div>
            <div className="ai-msg-body">
              <div className="ai-msg-content streaming">
                <Markdownish text={streamingText} />
                <span className="ai-cursor">▌</span>
              </div>
            </div>
          </div>
        )}
        {streaming && !streamingText && (
          <div className="ai-msg ai-msg-assistant">
            <div className="ai-msg-avatar"><Glyph name="ai" /></div>
            <div className="ai-msg-body">
              <div className="ai-msg-content muted">Thinking…</div>
            </div>
          </div>
        )}
      </div>

      {/* Input */}
      <div className="ai-input-area">
        <textarea
          ref={inputRef}
          className="ai-input"
          placeholder={
            (activeProvider && vaultedIds.has(activeProvider.id))
              ? 'Ask me anything about your code…'
              : 'Set up a provider first (settings)'
          }
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={streaming || !(activeProvider && vaultedIds.has(activeProvider.id))}
          rows={2}
        />
        <button
          className="ai-send-btn"
          onClick={sendMessage}
          disabled={streaming || !input.trim() || !(activeProvider && vaultedIds.has(activeProvider.id))}
          title="Send (Enter)"
        >
          <Glyph name={streaming ? 'spinner' : 'rocket'} />
        </button>
      </div>
    </div>
  );
}
