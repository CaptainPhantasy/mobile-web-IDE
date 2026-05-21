// Single terminal pane: one xterm.js view bound to one PTY session over WS.
// The pane persists its sessionId in localStorage so reloading the page
// reattaches to the running shell instead of spawning a fresh one.

import { useEffect, useRef, useState } from 'react';
import { Terminal as XTerm, ITheme } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';

export type PaneStatus = 'connecting' | 'live' | 'resumed' | 'closed' | 'error';

/** Vault entry → environment variable mapping. The id refers to a key in
 *  ~/.config/mwide-vault.json; the server reads the value and injects it
 *  into the spawned PTY's env as `envVar`. Values never round-trip back
 *  to the client. */
export type VaultEnvSpec = { id: string; envVar: string };

/** Profile data sent on the *first* open for a pane. Once a sessionId is
 *  stored in localStorage (i.e. a session is alive on the server), profile
 *  is ignored on resume — the existing shell + env are reused. */
export type PaneProfile = {
  /** Human label shown in the tab. */
  title: string;
  /** Absolute path or PATH-resolvable executable. Omit for a plain shell. */
  command?: string;
  /** Arguments passed to `command`. */
  args?: string[];
  /** Vault keys to inject as env vars before spawn. */
  vaultEnv?: VaultEnvSpec[];
};

type Props = {
  paneKey: string;
  projectDir: string;
  isVisible: boolean;
  /** First-launch configuration. Ignored on resume. */
  profile?: PaneProfile;
  onStatusChange?: (status: PaneStatus) => void;
  onSessionId?: (sessionId: string) => void;
  killSignal?: number;
};


const THEME: ITheme = {
  foreground: '#e6edf3',
  background: '#0a0d11',
  cursor: '#A8255A',
  cursorAccent: '#0a0d11',
  selectionBackground: 'rgba(95, 253, 255, 0.22)',
  selectionForeground: undefined,
  black: '#14191E',
  red: '#DC7974',
  green: '#57E690',
  yellow: '#FCE49B',
  blue: '#A6AAF1',
  magenta: '#A8255A',
  cyan: '#5FFDFF',
  white: '#e6edf3',
  brightBlack: '#6e7681',
  brightRed: '#DC7974',
  brightGreen: '#57E690',
  brightYellow: '#FCE49B',
  brightBlue: '#A6AAF1',
  brightMagenta: '#E07DE0',
  brightCyan: '#5FFDFF',
  brightWhite: '#ffffff',
};

function ssKey(paneKey: string, projectDir: string): string {
  return `mwide:pty:${projectDir}:${paneKey}`;
}

function readStoredSessionId(paneKey: string, projectDir: string): string | null {
  try { return localStorage.getItem(ssKey(paneKey, projectDir)); }
  catch { return null; }
}

function writeStoredSessionId(paneKey: string, projectDir: string, id: string): void {
  try { localStorage.setItem(ssKey(paneKey, projectDir), id); }
  catch { /* private mode / quota */ }
}

function clearStoredSessionId(paneKey: string, projectDir: string): void {
  try { localStorage.removeItem(ssKey(paneKey, projectDir)); }
  catch { /* */ }
}

export default function TerminalPane({
  paneKey,
  projectDir,
  isVisible,
  profile,
  onStatusChange,
  onSessionId,
  killSignal,
}: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<XTerm | null>(null);
  const fitRef  = useRef<FitAddon | null>(null);
  const wsRef   = useRef<WebSocket | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const [status, setStatus] = useState<PaneStatus>('connecting');
  const [info, setInfo] = useState<{ pid?: number; shell?: string }>({});

  useEffect(() => {
    if (!hostRef.current) return;
    let cancelled = false;

    const term = new XTerm({
      theme: THEME,
      fontFamily: "'JetBrains Mono', Monaco, ui-monospace, monospace",
      fontSize: 13,
      fontWeight: '400',
      fontWeightBold: '600',
      lineHeight: 1.3,
      letterSpacing: 0,
      cursorBlink: true,
      cursorStyle: 'bar',
      cursorWidth: 2,
      allowProposedApi: true,
      scrollback: 5000,
      convertEol: false,
      drawBoldTextInBrightColors: true,
      macOptionIsMeta: true,
    });
    const fit = new FitAddon();
    const links = new WebLinksAddon();
    term.loadAddon(fit);
    term.loadAddon(links);
    term.open(hostRef.current);
    try { fit.fit(); } catch { /* not yet sized */ }

    termRef.current = term;
    fitRef.current = fit;

    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${proto}//${location.host}/ws/pty`);
    wsRef.current = ws;

    const updateStatus = (s: PaneStatus): void => {
      setStatus(s);
      onStatusChange?.(s);
    };

    ws.onopen = () => {
      if (cancelled) return;
      const { cols, rows } = term;
      const stored = readStoredSessionId(paneKey, projectDir);
      // Profile fields are honored only on a fresh create. If `stored` is
      // present, the server will resume the existing PTY and silently
      // ignore command/args/vaultEnv (they applied at original spawn time).
      const openMsg: Record<string, unknown> = {
        type: 'open',
        sessionId: stored || undefined,
        cols, rows,
        cwd: projectDir,
      };
      if (!stored && profile) {
        if (profile.command) openMsg.command = profile.command;
        if (profile.args && profile.args.length > 0) openMsg.args = profile.args;
        if (profile.vaultEnv && profile.vaultEnv.length > 0) {
          openMsg.vaultEnv = profile.vaultEnv;
        }
      }
      ws.send(JSON.stringify(openMsg));
    };

    ws.onmessage = (ev) => {
      if (cancelled) return;
      let msg: { type: string; [k: string]: unknown };
      try { msg = JSON.parse(ev.data); } catch { return; }

      switch (msg.type) {
        case 'ready': {
          const sid = String(msg.sessionId || '');
          const resumed = !!msg.resumed;
          if (sid) {
            sessionIdRef.current = sid;
            writeStoredSessionId(paneKey, projectDir, sid);
            onSessionId?.(sid);
          }
          setInfo({ pid: msg.pid as number | undefined, shell: msg.shell as string | undefined });
          updateStatus(resumed ? 'resumed' : 'live');
          break;
        }
        case 'replay': {
          if (typeof msg.data === 'string') term.write(msg.data);
          break;
        }
        case 'out': {
          if (typeof msg.data === 'string') term.write(msg.data);
          break;
        }
        case 'kicked': {
          term.write('\r\n\x1b[2m[session taken over by another client]\x1b[0m\r\n');
          updateStatus('closed');
          break;
        }
        case 'exit': {
          const code = typeof msg.code === 'number' ? msg.code : -1;
          term.write(`\r\n\x1b[2m[session ended — code ${code}]\x1b[0m\r\n`);
          clearStoredSessionId(paneKey, projectDir);
          sessionIdRef.current = null;
          updateStatus('closed');
          break;
        }
      }
    };

    ws.onerror = () => {
      if (!cancelled) updateStatus('error');
    };
    ws.onclose = () => {
      if (cancelled) return;
      setStatus((prev) => (prev === 'error' ? 'error' : 'closed'));
    };

    const onData = term.onData((data) => {
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({ type: 'in', data }));
      }
    });

    const ro = new ResizeObserver(() => {
      try {
        fit.fit();
        const { cols, rows } = term;
        if (ws.readyState === ws.OPEN) {
          ws.send(JSON.stringify({ type: 'resize', cols, rows }));
        }
      } catch { /* unmounted */ }
    });
    ro.observe(hostRef.current);

    const onWinResize = (): void => {
      try {
        fit.fit();
        const { cols, rows } = term;
        if (ws.readyState === ws.OPEN) {
          ws.send(JSON.stringify({ type: 'resize', cols, rows }));
        }
      } catch { /* */ }
    };
    window.addEventListener('resize', onWinResize);

    return () => {
      cancelled = true;
      onData.dispose();
      ro.disconnect();
      window.removeEventListener('resize', onWinResize);
      try { ws.close(); } catch { /* */ }
      try { term.dispose(); } catch { /* */ }
      termRef.current = null;
      fitRef.current = null;
      wsRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paneKey, projectDir]);

  useEffect(() => {
    if (!isVisible) return;
    const t = setTimeout(() => {
      try {
        fitRef.current?.fit();
        const term = termRef.current;
        const ws = wsRef.current;
        if (term && ws && ws.readyState === ws.OPEN) {
          ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
        }
      } catch { /* */ }
    }, 0);
    return () => clearTimeout(t);
  }, [isVisible]);

  useEffect(() => {
    if (!killSignal) return;
    const ws = wsRef.current;
    if (ws && ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify({ type: 'kill' }));
    }
    clearStoredSessionId(paneKey, projectDir);
    sessionIdRef.current = null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [killSignal]);

  return (
    <div
      className="terminal-pane"
      style={{ display: isVisible ? 'flex' : 'none', flex: 1, minHeight: 0 }}
      data-status={status}
      data-pid={info.pid ? String(info.pid) : ''}
    >
      <div ref={hostRef} className="terminal-host" style={{ flex: 1, minHeight: 0 }} />
    </div>
  );
}
