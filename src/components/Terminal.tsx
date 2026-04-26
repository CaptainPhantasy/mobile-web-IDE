// Multi-pane terminal deck. Each pane owns its own xterm + WS + PTY
// session (see TerminalPane). The deck owns the array of panes, the
// tab strip, and persistence of the pane list across reloads.
//
// External API is unchanged from the prior single-pane Terminal.tsx —
// App.tsx keeps rendering <Terminal projectDir=… /> and gets a deck.

import { useCallback, useEffect, useState } from 'react';
import TerminalPane, { PaneStatus } from './TerminalPane';

type Props = {
  projectDir: string;
  // Retained for prop compatibility with prior Terminal.tsx callers.
  author?: { name: string; email: string };
  onRun?: (path: string) => void;
};

type Pane = {
  paneKey: string;
  title: string;
  killSignal: number;
};

const DECK_KEY_PREFIX = 'mwide:pty:deck:';
const MAX_PANES = 8;

function deckKey(projectDir: string): string {
  return `${DECK_KEY_PREFIX}${projectDir}`;
}

function loadDeck(projectDir: string): Pane[] {
  try {
    const raw = localStorage.getItem(deckKey(projectDir));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((p): p is { paneKey: string; title: string } =>
        p && typeof p.paneKey === 'string' && typeof p.title === 'string',
      )
      .map((p) => ({ paneKey: p.paneKey, title: p.title, killSignal: 0 }));
  } catch {
    return [];
  }
}

function saveDeck(projectDir: string, panes: Pane[]): void {
  try {
    const slim = panes.map(({ paneKey, title }) => ({ paneKey, title }));
    localStorage.setItem(deckKey(projectDir), JSON.stringify(slim));
  } catch { /* quota / private mode */ }
}

function newPaneKey(): string {
  return `p_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`;
}

function defaultTitle(index: number): string {
  return `shell ${index + 1}`;
}

function statusDot(status: PaneStatus | undefined): string {
  switch (status) {
    case 'live':       return '●';
    case 'resumed':    return '↺';
    case 'connecting': return '◌';
    case 'closed':     return '○';
    case 'error':      return '✕';
    default:           return '◌';
  }
}

export default function Terminal({ projectDir }: Props) {
  const [panes, setPanes] = useState<Pane[]>(() => {
    const stored = loadDeck(projectDir);
    if (stored.length > 0) return stored;
    return [{ paneKey: newPaneKey(), title: defaultTitle(0), killSignal: 0 }];
  });
  const [activeKey, setActiveKey] = useState<string>(() => {
    const stored = loadDeck(projectDir);
    return (stored[0]?.paneKey) || '';
  });
  const [statusByPane, setStatusByPane] = useState<Record<string, PaneStatus>>({});

  useEffect(() => {
    if (!activeKey && panes.length > 0) setActiveKey(panes[0].paneKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panes.length === 0]);

  useEffect(() => {
    saveDeck(projectDir, panes);
  }, [panes, projectDir]);

  const addPane = useCallback(() => {
    setPanes((prev) => {
      if (prev.length >= MAX_PANES) return prev;
      const next: Pane = {
        paneKey: newPaneKey(),
        title: defaultTitle(prev.length),
        killSignal: 0,
      };
      setActiveKey(next.paneKey);
      return [...prev, next];
    });
  }, []);

  const closePane = useCallback((paneKey: string) => {
    setPanes((prev) => {
      const idx = prev.findIndex((p) => p.paneKey === paneKey);
      if (idx < 0) return prev;
      const updated = prev.map((p, i) =>
        i === idx ? { ...p, killSignal: p.killSignal + 1 } : p,
      );
      const next = updated.filter((_, i) => i !== idx);
      if (activeKey === paneKey && next.length > 0) {
        const neighbor = next[Math.min(idx, next.length - 1)];
        setActiveKey(neighbor.paneKey);
      }
      if (next.length === 0) {
        const seed: Pane = {
          paneKey: newPaneKey(),
          title: defaultTitle(0),
          killSignal: 0,
        };
        setActiveKey(seed.paneKey);
        return [seed];
      }
      return next;
    });
    setStatusByPane((prev) => {
      if (!(paneKey in prev)) return prev;
      const copy = { ...prev };
      delete copy[paneKey];
      return copy;
    });
  }, [activeKey]);

  const onPaneStatus = useCallback((paneKey: string, status: PaneStatus) => {
    setStatusByPane((prev) =>
      prev[paneKey] === status ? prev : { ...prev, [paneKey]: status },
    );
  }, []);

  return (
    <div className="terminal-deck" style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <div className="terminal-tabs" role="tablist" aria-label="Terminal panes">
        {panes.map((p) => {
          const status = statusByPane[p.paneKey];
          const dot = statusDot(status);
          const active = p.paneKey === activeKey;
          return (
            <div
              key={p.paneKey}
              role="tab"
              aria-selected={active}
              className={'terminal-tab' + (active ? ' active' : '')}
              onClick={() => setActiveKey(p.paneKey)}
            >
              <span className="terminal-tab-dot" aria-hidden="true">{dot}</span>
              <span className="terminal-tab-title">{p.title}</span>
              {panes.length > 1 && (
                <button
                  className="terminal-tab-close"
                  aria-label={`Close ${p.title}`}
                  onClick={(e) => { e.stopPropagation(); closePane(p.paneKey); }}
                >
                  ×
                </button>
              )}
            </div>
          );
        })}
        <button
          className="terminal-tab-new"
          aria-label="New terminal pane"
          onClick={addPane}
          disabled={panes.length >= MAX_PANES}
          title={panes.length >= MAX_PANES ? `Max ${MAX_PANES} panes` : 'New pane'}
        >
          +
        </button>
      </div>

      <div className="terminal-deck-body" style={{ flex: 1, minHeight: 0, position: 'relative', display: 'flex' }}>
        {panes.map((p) => (
          <TerminalPane
            key={p.paneKey}
            paneKey={p.paneKey}
            projectDir={projectDir}
            isVisible={p.paneKey === activeKey}
            killSignal={p.killSignal}
            onStatusChange={(s) => onPaneStatus(p.paneKey, s)}
          />
        ))}
      </div>
    </div>
  );
}
