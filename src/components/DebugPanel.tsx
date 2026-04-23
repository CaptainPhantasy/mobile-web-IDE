// Debugger UI: toggles breakpoints per-line, runs the active file in a
// sandboxed iframe via lib/debugger, shows logs, and lets you step or
// continue when paused.

import { useEffect, useRef, useState } from 'react';
import {
  Breakpoint,
  DebugEvent,
  DebugSession,
  LogEntry,
} from '../lib/debugger';
import { Glyph } from './Glyph';

type Props = {
  activePath?: string;
  getActiveSource: () => string;
  breakpoints: Breakpoint[];
  onToggleBreakpoint: (bp: Breakpoint) => void;
};

export default function DebugPanel({
  activePath,
  getActiveSource,
  breakpoints,
  onToggleBreakpoint,
}: Props) {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [paused, setPaused] = useState<{ line: number; path: string } | null>(null);
  const [running, setRunning] = useState(false);
  const sessRef = useRef<DebugSession | null>(null);
  const [bpInput, setBpInput] = useState('');

  useEffect(() => {
    const sess = new DebugSession(breakpoints);
    sessRef.current = sess;
    const off = sess.on((e: DebugEvent) => {
      if (e.type === 'log') setLogs((l) => [...l, e.entry]);
      else if (e.type === 'paused') setPaused({ line: e.line, path: e.path });
      else if (e.type === 'resumed') setPaused(null);
      else if (e.type === 'done') {
        setRunning(false);
        setLogs((l) => [
          ...l,
          { kind: 'sys', args: [`done in ${e.durationMs.toFixed(1)}ms`], time: Date.now() },
        ]);
      } else if (e.type === 'error')
        setLogs((l) => [
          ...l,
          { kind: 'error', args: [e.message, e.stack || ''], time: Date.now() },
        ]);
    });
    return () => {
      off();
      sess.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    sessRef.current?.setBreakpoints(breakpoints);
  }, [breakpoints]);

  function run() {
    if (!activePath) return;
    setLogs([]);
    setRunning(true);
    sessRef.current?.run(activePath, getActiveSource());
  }

  function addBp() {
    if (!bpInput || !activePath) return;
    const line = Number(bpInput);
    if (!Number.isFinite(line)) return;
    onToggleBreakpoint({ path: activePath, line });
    setBpInput('');
  }

  return (
    <div className="panel debug-panel">
      <div className="panel-header">
        <div className="panel-title">Run and Debug</div>
      </div>
      <div className="debug-controls">
        <button onClick={run} disabled={!activePath || running}>▶ Run</button>
        <button onClick={() => sessRef.current?.step()} disabled={!paused}>Step</button>
        <button onClick={() => sessRef.current?.continue()} disabled={!paused}>Continue</button>
        <button onClick={() => sessRef.current?.stop()} disabled={!running}>Stop</button>
      </div>
      <div className="bp-section">
        <div className="debug-subtitle">Breakpoints</div>
        <div className="row">
          <input
            placeholder="line #"
            value={bpInput}
            onChange={(e) => setBpInput(e.target.value)}
            type="number"
          />
          <button onClick={addBp} disabled={!activePath}>Toggle</button>
        </div>
        <div className="bp-list">
          {breakpoints.map((bp) => (
            <div key={bp.path + bp.line} className="bp-row">
              <span>{bp.path}:{bp.line}</span>
              <button onClick={() => onToggleBreakpoint(bp)}><Glyph name="close" /></button>
            </div>
          ))}
          {breakpoints.length === 0 && (
            <div className="muted">No breakpoints set.</div>
          )}
        </div>
      </div>
      <div className="bp-section">
        <div className="debug-subtitle">
          {paused ? `⏸ Paused at ${paused.path}:${paused.line}` : 'Console'}
        </div>
        <div className="debug-log">
          {logs.map((l, i) => (
            <pre key={i} className={'log-line log-' + l.kind}>
              {l.args.join(' ')}
            </pre>
          ))}
        </div>
      </div>
    </div>
  );
}
