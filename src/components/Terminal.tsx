// Integrated terminal — xterm.js frontend talking to a node-pty backend
// over /ws/pty. Inherits the host shell (usually zsh) so .zshrc, Starship,
// aliases, and $FLOYD_MODE all behave exactly as in a fresh iTerm2 tab.

import { useEffect, useRef, useState } from 'react';
import { Terminal as XTerm, ITheme } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { Glyph } from './Glyph';

type Props = {
  projectDir: string;
  author: { name: string; email: string };
  onRun?: (path: string) => void;
};

// Palette — the same tokens as tokens.css, duplicated because xterm
// needs hex literals at boot. Keep in sync.
const THEME: ITheme = {
  foreground: '#e6edf3',
  background: '#0a0d11',
  cursor:     '#A8255A',
  cursorAccent: '#0a0d11',
  selectionBackground: 'rgba(95, 253, 255, 0.22)',
  selectionForeground: undefined,
  black:         '#14191E',
  red:           '#DC7974',
  green:         '#57E690',
  yellow:        '#FCE49B',
  blue:          '#A6AAF1',
  magenta:       '#A8255A',
  cyan:          '#5FFDFF',
  white:         '#e6edf3',
  brightBlack:   '#6e7681',
  brightRed:     '#DC7974',
  brightGreen:   '#57E690',
  brightYellow:  '#FCE49B',
  brightBlue:    '#A6AAF1',
  brightMagenta: '#E07DE0',
  brightCyan:    '#5FFDFF',
  brightWhite:   '#ffffff',
};

type Status = 'connecting' | 'live' | 'closed' | 'error';

export default function Terminal({ projectDir }: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<XTerm | null>(null);
  const wsRef   = useRef<WebSocket | null>(null);
  const [status, setStatus] = useState<Status>('connecting');
  const [info, setInfo] = useState<{ pid?: number; shell?: string }>({});

  useEffect(() => {
    if (!hostRef.current) return;
    // `cancelled` guards against React StrictMode's double-mount: the first
    // effect's cleanup will flip this before the second effect runs, so any
    // late WS events from the first connection no-op rather than clobbering
    // the newer session's state.
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

    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${proto}//${location.host}/ws/pty`);
    wsRef.current = ws;

    ws.onopen = () => {
      if (cancelled) return;
      const { cols, rows } = term;
      ws.send(JSON.stringify({ type: 'open', cols, rows, cwd: projectDir }));
    };
    ws.onmessage = (ev) => {
      if (cancelled) return;
      let msg: { type: string; [k: string]: unknown };
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg.type === 'ready') {
        setStatus('live');
        setInfo({ pid: msg.pid as number, shell: msg.shell as string });
      } else if (msg.type === 'out' && typeof msg.data === 'string') {
        term.write(msg.data);
      } else if (msg.type === 'exit') {
        setStatus('closed');
        term.write(`\r\n\x1b[2m[session ended — code ${msg.code}]\x1b[0m\r\n`);
      }
    };
    ws.onerror = () => {
      if (cancelled) return;
      setStatus('error');
    };
    ws.onclose = () => {
      if (cancelled) return;
      setStatus((s) => (s === 'error' ? 'error' : 'closed'));
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
      } catch { /* not mounted */ }
    });
    ro.observe(hostRef.current);

    const onWinResize = () => {
      try {
        fit.fit();
        const { cols, rows } = term;
        if (ws.readyState === ws.OPEN) {
          ws.send(JSON.stringify({ type: 'resize', cols, rows }));
        }
      } catch { /* noop */ }
    };
    window.addEventListener('resize', onWinResize);

    return () => {
      cancelled = true;
      onData.dispose();
      ro.disconnect();
      window.removeEventListener('resize', onWinResize);
      try { ws.close(); } catch { /* noop */ }
      term.dispose();
      termRef.current = null;
    };
  }, [projectDir]);

  const focus = () => termRef.current?.focus();

  const statusLabel =
    status === 'live' ? 'live'
    : status === 'connecting' ? 'connecting…'
    : status === 'closed' ? 'closed'
    : 'error';

  return (
    <div className="terminal" onClick={focus}>
      <div className="terminal-bar">
        <Glyph name="terminal" />
        <span>pty</span>
        <span className="term-session">
          {info.shell ? info.shell.split('/').pop() : '—'}
          {info.pid ? ` · pid ${info.pid}` : ''}
        </span>
        <span className="term-spacer" />
        <span className={'term-state' + (status === 'live' ? '' : ' off')}>
          {statusLabel}
        </span>
      </div>
      <div className="terminal-host" ref={hostRef} />
    </div>
  );
}
