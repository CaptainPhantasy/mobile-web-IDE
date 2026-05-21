// Multi-pane terminal deck with launcher profiles + vault-injected env.
// Each pane owns its own xterm + WS + PTY session (see TerminalPane).
// The deck owns:
//   - the array of panes (persisted across reloads)
//   - the tab strip
//   - the profile picker that determines what command spawns when "+" is hit
//
// External API is unchanged: App.tsx renders <Terminal projectDir=… />.

import { useCallback, useEffect, useState } from 'react';
import TerminalPane, { PaneStatus, PaneProfile, VaultEnvSpec } from './TerminalPane';

type Props = {
  projectDir: string;
  // Retained for prop compatibility with prior Terminal.tsx callers.
  author?: { name: string; email: string };
  onRun?: (path: string) => void;
};

type Pane = {
  paneKey: string;
  /** Stored profile snapshot. Re-sent on every render; the server only
   *  applies it on first spawn (when no sessionId is in localStorage),
   *  so this is also what survives reloads. */
  profile: PaneProfile;
  killSignal: number;
};

const DECK_KEY_PREFIX = 'mwide:pty:deck:';
const MAX_PANES = 8;

// ---------------------------------------------------------------------------
// Built-in launcher profiles. Paths are absolute so the spawn doesn't depend
// on PATH being correct in non-interactive contexts. Vault keys are the
// `id` field in ~/.config/mwide-vault.json. If a key is absent from the
// vault the env var simply isn't set — graceful degradation, no error.
// ---------------------------------------------------------------------------

const ANTHROPIC_VAULT: VaultEnvSpec = { id: 'anthropic', envVar: 'ANTHROPIC_API_KEY' };
const OPENAI_VAULT:    VaultEnvSpec = { id: 'openai',    envVar: 'OPENAI_API_KEY' };

type ProfileTemplate = PaneProfile & { id: string };

const PROFILE_TEMPLATES: ProfileTemplate[] = [
  {
    id: 'plain',
    title: 'shell',
  },
  {
    id: 'claude',
    title: 'claude',
    command: '/Users/douglastalley/.local/bin/claude',
    vaultEnv: [ANTHROPIC_VAULT],
  },
  {
    id: 'floyd',
    title: 'floyd',
    command: '/Users/douglastalley/.bun/bin/floyd',
    vaultEnv: [ANTHROPIC_VAULT, OPENAI_VAULT],
  },
  {
    id: 'floyd-10x',
    title: 'floyd-10x',
    command: '/opt/homebrew/bin/floyd-10x',
    vaultEnv: [ANTHROPIC_VAULT, OPENAI_VAULT],
  },
  {
    id: 'superfloyd',
    title: 'superfloyd',
    command: '/opt/homebrew/bin/superfloyd',
    vaultEnv: [ANTHROPIC_VAULT, OPENAI_VAULT],
  },
];

function defaultProfile(): PaneProfile {
  // The first pane is always plain shell — keeps the workflow predictable.
  const plain = PROFILE_TEMPLATES.find((p) => p.id === 'plain');
  return plain
    ? { title: plain.title, command: plain.command, args: plain.args, vaultEnv: plain.vaultEnv }
    : { title: 'shell' };
}

// ---------------------------------------------------------------------------
// Persistence helpers.
// ---------------------------------------------------------------------------

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
      .filter((p): p is { paneKey: string; profile?: PaneProfile; title?: string } =>
        p && typeof p === 'object' && typeof (p as { paneKey?: unknown }).paneKey === 'string',
      )
      .map((p) => {
        // Forward-compat with the Phase 1 shape that stored only `title`.
        const profile: PaneProfile = (p as { profile?: PaneProfile }).profile
          ?? { title: typeof p.title === 'string' ? p.title : 'shell' };
        return { paneKey: p.paneKey, profile, killSignal: 0 };
      });
  } catch {
    return [];
  }
}

function saveDeck(projectDir: string, panes: Pane[]): void {
  try {
    const slim = panes.map(({ paneKey, profile }) => ({ paneKey, profile }));
    localStorage.setItem(deckKey(projectDir), JSON.stringify(slim));
  } catch { /* quota / private mode */ }
}

function newPaneKey(): string {
  return `p_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`;
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

// ---------------------------------------------------------------------------
// Component.
// ---------------------------------------------------------------------------

export default function Terminal({ projectDir }: Props) {
  const [panes, setPanes] = useState<Pane[]>(() => {
    const stored = loadDeck(projectDir);
    if (stored.length > 0) return stored;
    return [{ paneKey: newPaneKey(), profile: defaultProfile(), killSignal: 0 }];
  });
  const [activeKey, setActiveKey] = useState<string>(() => {
    const stored = loadDeck(projectDir);
    return (stored[0]?.paneKey) || '';
  });
  const [statusByPane, setStatusByPane] = useState<Record<string, PaneStatus>>({});
  const [pickerOpen, setPickerOpen] = useState(false);

  useEffect(() => {
    if (!activeKey && panes.length > 0) setActiveKey(panes[0].paneKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panes.length === 0]);

  useEffect(() => {
    saveDeck(projectDir, panes);
  }, [panes, projectDir]);

  // Close the picker on outside click / Escape.
  useEffect(() => {
    if (!pickerOpen) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setPickerOpen(false);
    };
    const onClick = (e: MouseEvent): void => {
      const target = e.target as HTMLElement | null;
      if (!target?.closest('.terminal-tab-new-wrap')) setPickerOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClick);
    };
  }, [pickerOpen]);

  const addPane = useCallback((tpl: ProfileTemplate) => {
    setPanes((prev) => {
      if (prev.length >= MAX_PANES) return prev;
      const next: Pane = {
        paneKey: newPaneKey(),
        profile: {
          title: tpl.title,
          command: tpl.command,
          args: tpl.args,
          vaultEnv: tpl.vaultEnv,
        },
        killSignal: 0,
      };
      setActiveKey(next.paneKey);
      return [...prev, next];
    });
    setPickerOpen(false);
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
          profile: defaultProfile(),
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

  const atMax = panes.length >= MAX_PANES;

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
              data-profile={p.profile.title}
              onClick={() => setActiveKey(p.paneKey)}
            >
              <span className="terminal-tab-dot" aria-hidden="true">{dot}</span>
              <span className="terminal-tab-title">{p.profile.title}</span>
              {panes.length > 1 && (
                <button
                  className="terminal-tab-close"
                  aria-label={`Close ${p.profile.title}`}
                  onClick={(e) => { e.stopPropagation(); closePane(p.paneKey); }}
                >
                  ×
                </button>
              )}
            </div>
          );
        })}

        <div className="terminal-tab-new-wrap" style={{ position: 'relative' }}>
          <button
            className="terminal-tab-new"
            aria-label="New terminal pane"
            aria-haspopup="menu"
            aria-expanded={pickerOpen}
            onClick={() => !atMax && setPickerOpen((o) => !o)}
            disabled={atMax}
            title={atMax ? `Max ${MAX_PANES} panes` : 'New pane (pick profile)'}
          >
            +
          </button>
          {pickerOpen && (
            <div className="terminal-profile-picker" role="menu">
              {PROFILE_TEMPLATES.map((tpl) => (
                <button
                  key={tpl.id}
                  role="menuitem"
                  className="terminal-profile-option"
                  onClick={() => addPane(tpl)}
                >
                  <span className="terminal-profile-option-name">{tpl.title}</span>
                  {tpl.command && (
                    <span className="terminal-profile-option-meta">
                      {basename(tpl.command)}
                      {tpl.vaultEnv && tpl.vaultEnv.length > 0 ? ` · ${tpl.vaultEnv.length} key${tpl.vaultEnv.length === 1 ? '' : 's'}` : ''}
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="terminal-deck-body" style={{ flex: 1, minHeight: 0, position: 'relative', display: 'flex' }}>
        {panes.map((p) => (
          <TerminalPane
            key={p.paneKey}
            paneKey={p.paneKey}
            projectDir={projectDir}
            isVisible={p.paneKey === activeKey}
            profile={p.profile}
            killSignal={p.killSignal}
            onStatusChange={(s) => onPaneStatus(p.paneKey, s)}
          />
        ))}
      </div>
    </div>
  );
}

function basename(p: string): string {
  const i = p.lastIndexOf('/');
  return i >= 0 ? p.slice(i + 1) : p;
}
