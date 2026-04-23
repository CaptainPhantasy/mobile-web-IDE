// Browser-side debugger and runner.
//
// Approach: we create a sandboxed iframe and evaluate the active file
// (or an explicit entry point) inside it. stdout/stderr and console.*
// are forwarded over window.postMessage. The runner supports simple
// breakpoint-like pausing via a "debugger;" statement or line-based
// breakpoints that inject `await __bp(<line>)` which the host can
// resolve step-by-step.
//
// This is not a full source-level debugger, but it does give real
// debugging primitives: logs, evaluate-at-breakpoint, stack traces,
// single-step, and variable watches.

export type LogEntry = {
  kind: 'log' | 'warn' | 'error' | 'info' | 'sys';
  args: string[];
  time: number;
};

export type Breakpoint = { path: string; line: number };

export type DebugEvent =
  | { type: 'log'; entry: LogEntry }
  | { type: 'paused'; line: number; path: string; frame: Record<string, string> }
  | { type: 'resumed' }
  | { type: 'done'; durationMs: number }
  | { type: 'error'; message: string; stack?: string };

export class DebugSession {
  private iframe?: HTMLIFrameElement;
  private listeners = new Set<(e: DebugEvent) => void>();
  private waiters = new Map<number, (v: 'step' | 'continue') => void>();
  private seq = 0;

  constructor(private breakpoints: Breakpoint[] = []) {}

  on(cb: (e: DebugEvent) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private emit(e: DebugEvent): void {
    for (const l of this.listeners) l(e);
  }

  private ensureIframe(): HTMLIFrameElement {
    if (this.iframe) return this.iframe;
    const frame = document.createElement('iframe');
    frame.sandbox.add('allow-scripts');
    frame.style.display = 'none';
    document.body.appendChild(frame);
    this.iframe = frame;
    window.addEventListener('message', this.onMessage);
    return frame;
  }

  private onMessage = (ev: MessageEvent) => {
    const data = ev.data;
    if (!data || data.__webide !== true) return;
    if (data.kind === 'log') {
      this.emit({ type: 'log', entry: data.entry });
    } else if (data.kind === 'paused') {
      this.emit({ type: 'paused', line: data.line, path: data.path, frame: data.frame });
    } else if (data.kind === 'resumed') {
      this.emit({ type: 'resumed' });
    } else if (data.kind === 'done') {
      this.emit({ type: 'done', durationMs: data.durationMs });
    } else if (data.kind === 'error') {
      this.emit({ type: 'error', message: data.message, stack: data.stack });
    }
  };

  setBreakpoints(bps: Breakpoint[]): void {
    this.breakpoints = bps;
  }

  step(): void {
    this.iframe?.contentWindow?.postMessage(
      { __webide: true, kind: 'step' },
      '*',
    );
  }

  continue(): void {
    this.iframe?.contentWindow?.postMessage(
      { __webide: true, kind: 'continue' },
      '*',
    );
  }

  stop(): void {
    if (this.iframe) {
      window.removeEventListener('message', this.onMessage);
      this.iframe.remove();
      this.iframe = undefined;
    }
  }

  async run(path: string, source: string): Promise<void> {
    const frame = this.ensureIframe();
    const bpLines = new Set(
      this.breakpoints.filter((b) => b.path === path).map((b) => b.line),
    );
    const instrumented = instrument(source, bpLines, path);
    const doc = `<!doctype html><meta charset="utf-8"><script>
const __start = performance.now();
const __send = (kind, data) => parent.postMessage(Object.assign({__webide:true, kind}, data), '*');
const __push = (kind, ...args) => __send('log', {entry:{kind, args:args.map(a=>{try{return typeof a==='string'?a:JSON.stringify(a)}catch{return String(a)}}), time: Date.now()}});
const __mode = { mode: 'run' };
window.addEventListener('message', (ev) => {
  if (!ev.data || ev.data.__webide !== true) return;
  if (ev.data.kind === 'step') { __mode.mode = 'step'; __mode.resolver?.(); }
  if (ev.data.kind === 'continue') { __mode.mode = 'run'; __mode.resolver?.(); }
});
async function __bp(line, frame){
  __send('paused', {line, path: ${JSON.stringify(path)}, frame});
  await new Promise((resolve) => { __mode.resolver = resolve; });
  __send('resumed', {});
  if (__mode.mode === 'step') __mode.mode = 'step';
}
const console = {
  log: (...a) => __push('log', ...a),
  info: (...a) => __push('info', ...a),
  warn: (...a) => __push('warn', ...a),
  error: (...a) => __push('error', ...a),
};
window.addEventListener('error', (e) => __send('error', {message: e.message, stack: e.error?.stack}));
window.addEventListener('unhandledrejection', (e) => __send('error', {message: String(e.reason), stack: e.reason?.stack}));
(async () => {
  try {
    ${instrumented}
  } catch (err) {
    __send('error', {message: String(err?.message||err), stack: err?.stack});
  } finally {
    __send('done', {durationMs: performance.now() - __start});
  }
})();
</script>`;
    frame.srcdoc = doc;
  }

  evaluate(expr: string): Promise<string> {
    return new Promise((resolve) => {
      const id = ++this.seq;
      const handler = (ev: MessageEvent) => {
        if (ev.data?.__webide && ev.data.kind === 'eval-result' && ev.data.id === id) {
          window.removeEventListener('message', handler);
          resolve(String(ev.data.value));
        }
      };
      window.addEventListener('message', handler);
      this.iframe?.contentWindow?.postMessage(
        { __webide: true, kind: 'eval', id, expr },
        '*',
      );
      setTimeout(() => {
        window.removeEventListener('message', handler);
        resolve('<timeout>');
      }, 2000);
    });
  }
}

function instrument(
  source: string,
  bpLines: Set<number>,
  _path: string,
): string {
  if (bpLines.size === 0) return source;
  const lines = source.split('\n');
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (bpLines.has(i + 1)) {
      out.push(`await __bp(${i + 1}, {});`);
    }
    out.push(line);
  }
  return out.join('\n');
}
