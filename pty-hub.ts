// PTY hub with persistent, resumable, multi-pane sessions + vault-injected env.
//
// Each WebSocket connection is a *client attachment*, not a *session*.
// The session (a node-pty process + ring buffer) lives in PtySessionManager
// and survives WebSocket disconnects, so a client can reload the page or
// drop the network and resume by sending the same sessionId on `open`.
//
// Wire protocol (JSON over WS):
//   client → server:
//     {type:'open', sessionId?, cols, rows, cwd?,
//                   command?, args?, vaultEnv?}        create or resume
//     {type:'in',     data}                            stdin
//     {type:'resize', cols, rows}                      window size
//     {type:'kill'}                                    explicit terminate
//   server → client:
//     {type:'ready',  sessionId, pid, shell, resumed}  attached
//     {type:'replay', data}                            buffered output (resume)
//     {type:'out',    data}                            stdout
//     {type:'exit',   code}                            pty exited
//     {type:'kicked', reason}                          another client took over
//
// `command` (Phase 2): when provided, runs that command inside an interactive
// login shell (so .zshrc is sourced, PATH is populated, FLOYD TTY Bridge
// initializes), then drops back to the shell after the command exits so the
// pane stays usable instead of closing.
//
// `vaultEnv` (Phase 2): array of `{id, envVar}` mappings. The server reads
// the corresponding values from ~/.config/mwide-vault.json (chmod 0600,
// same vault used by the LLM proxy) and injects them into the spawned
// process's environment. Keys never cross the WebSocket boundary back
// to the client.

import * as pty from 'node-pty';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs/promises';
import { randomUUID } from 'crypto';
import type { WebSocket, WebSocketServer } from 'ws';

const DEFAULT_BUFFER_BYTES = 64 * 1024;
const DEFAULT_IDLE_TTL_MS  = 30 * 60 * 1000;
const SWEEP_INTERVAL_MS    = 60 * 1000;

// ---------------------------------------------------------------------------
// Vault — read-only mirror of server.ts's vault store.
// ---------------------------------------------------------------------------

const VAULT_PATH = path.join(os.homedir(), '.config', 'mwide-vault.json');
const ENV_VAR_RE = /^[A-Z_][A-Z0-9_]*$/;

interface VaultEnvSpec {
  id: string;
  envVar: string;
}

async function vaultRead(): Promise<Record<string, string>> {
  try {
    const txt = await fs.readFile(VAULT_PATH, 'utf-8');
    const obj = JSON.parse(txt);
    return (obj && typeof obj === 'object' && !Array.isArray(obj))
      ? obj as Record<string, string>
      : {};
  } catch {
    return {};
  }
}

async function resolveVaultEnv(specs: VaultEnvSpec[]): Promise<Record<string, string>> {
  if (!specs || specs.length === 0) return {};
  const data = await vaultRead();
  const env: Record<string, string> = {};
  for (const spec of specs) {
    if (!spec || typeof spec.id !== 'string' || typeof spec.envVar !== 'string') continue;
    if (!ENV_VAR_RE.test(spec.envVar)) continue;
    const value = data[spec.id];
    if (typeof value === 'string' && value.length > 0) {
      env[spec.envVar] = value;
    }
  }
  return env;
}

// ---------------------------------------------------------------------------
// Shell quoting for safe command + args composition inside a sh -c string.
// ---------------------------------------------------------------------------

function shellQuote(s: string): string {
  // Single-quote everything; close-quote, escape any embedded ', re-open.
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

// ---------------------------------------------------------------------------
// PtySession — one shell + one ring buffer + at most one attached WS.
// ---------------------------------------------------------------------------

class PtySession {
  readonly id: string;
  readonly proc: pty.IPty;
  readonly shell: string;
  private buffer: Buffer = Buffer.alloc(0);
  private readonly bufferCap: number;
  private attachedWs: WebSocket | null = null;
  detachedAt: number | null = null;
  exitCode: number | null = null;

  constructor(opts: { id: string; proc: pty.IPty; shell: string; bufferCap: number }) {
    this.id = opts.id;
    this.proc = opts.proc;
    this.shell = opts.shell;
    this.bufferCap = opts.bufferCap;

    this.proc.onData((data) => {
      this.appendBuffer(data);
      const ws = this.attachedWs;
      if (ws && ws.readyState === ws.OPEN) {
        try { ws.send(JSON.stringify({ type: 'out', data })); }
        catch { /* socket dying */ }
      }
    });

    this.proc.onExit(({ exitCode }) => {
      this.exitCode = exitCode;
      const ws = this.attachedWs;
      if (ws && ws.readyState === ws.OPEN) {
        try { ws.send(JSON.stringify({ type: 'exit', code: exitCode })); }
        catch { /* socket dying */ }
      }
    });
  }

  private appendBuffer(data: string): void {
    const buf = Buffer.from(data, 'utf-8');
    if (buf.length >= this.bufferCap) {
      this.buffer = buf.subarray(buf.length - this.bufferCap);
      return;
    }
    const concat = Buffer.concat([this.buffer, buf]);
    this.buffer = concat.length > this.bufferCap
      ? concat.subarray(concat.length - this.bufferCap)
      : concat;
  }

  getBufferText(): string {
    return this.buffer.toString('utf-8');
  }

  attach(ws: WebSocket): WebSocket | null {
    const prev = this.attachedWs;
    this.attachedWs = ws;
    this.detachedAt = null;
    if (prev && prev !== ws) {
      try { prev.send(JSON.stringify({ type: 'kicked', reason: 'replaced' })); }
      catch { /* dying */ }
      try { prev.close(); }
      catch { /* already closed */ }
    }
    return prev;
  }

  detach(ws: WebSocket): void {
    if (this.attachedWs === ws) {
      this.attachedWs = null;
      this.detachedAt = Date.now();
    }
  }

  isAttached(): boolean {
    return this.attachedWs !== null;
  }

  resize(cols: number, rows: number): void {
    try { this.proc.resize(cols, rows); }
    catch { /* exited */ }
  }

  write(data: string): void {
    if (this.exitCode !== null) return;
    try { this.proc.write(data); }
    catch { /* exited */ }
  }

  kill(): void {
    try { this.proc.kill(); }
    catch { /* already dead */ }
  }

  isReapable(now: number, ttlMs: number): boolean {
    if (this.exitCode !== null && !this.isAttached()) return true;
    if (!this.isAttached() && this.detachedAt !== null) {
      return now - this.detachedAt > ttlMs;
    }
    return false;
  }
}

// ---------------------------------------------------------------------------
// PtySessionManager — owns the session map and the reaper.
// ---------------------------------------------------------------------------

class PtySessionManager {
  private readonly sessions = new Map<string, PtySession>();
  private readonly bufferCap: number;
  private readonly ttlMs: number;
  private sweepTimer: NodeJS.Timeout | null = null;

  constructor(opts: { bufferCap?: number; ttlMs?: number } = {}) {
    this.bufferCap = opts.bufferCap ?? DEFAULT_BUFFER_BYTES;
    this.ttlMs = opts.ttlMs ?? DEFAULT_IDLE_TTL_MS;
  }

  startSweeper(intervalMs: number = SWEEP_INTERVAL_MS): void {
    if (this.sweepTimer) return;
    this.sweepTimer = setInterval(() => this.sweep(), intervalMs);
    if (typeof this.sweepTimer.unref === 'function') this.sweepTimer.unref();
  }

  stopSweeper(): void {
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = null;
    }
  }

  private sweep(): void {
    const now = Date.now();
    for (const [id, sess] of this.sessions) {
      if (sess.isReapable(now, this.ttlMs)) {
        sess.kill();
        this.sessions.delete(id);
      }
    }
  }

  get(id: string): PtySession | undefined {
    return this.sessions.get(id);
  }

  delete(id: string): void {
    const sess = this.sessions.get(id);
    if (sess) {
      sess.kill();
      this.sessions.delete(id);
    }
  }

  async create(opts: {
    cols: number;
    rows: number;
    cwd?: string;
    command?: string;
    args?: string[];
    injectedEnv?: Record<string, string>;
  }): Promise<PtySession> {
    const shell = process.env.SHELL || '/bin/zsh';

    let cwd = os.homedir();
    if (opts.cwd) {
      try {
        const stat = await fs.stat(opts.cwd);
        if (stat.isDirectory()) cwd = opts.cwd;
      } catch { /* keep homedir */ }
    }

    // Spawn strategy:
    //   - No command: plain login shell, like before.
    //   - With command: login interactive shell that runs `<cmd> <args>; exec $SHELL -l -i`.
    //     This sources .zshrc/.zprofile (PATH, aliases, FLOYD TTY Bridge),
    //     runs the requested tool with full env, then falls back to a fresh
    //     interactive shell so the pane stays usable when the tool exits.
    let spawnCmd: string;
    let spawnArgs: string[];
    if (typeof opts.command === 'string' && opts.command.trim().length > 0) {
      const cmd = opts.command.trim();
      const argList = (opts.args || []).filter((a): a is string => typeof a === 'string');
      const tail = argList.length > 0 ? ' ' + argList.map(shellQuote).join(' ') : '';
      const inner = `${shellQuote(cmd)}${tail}; exec ${shell} -l -i`;
      spawnCmd = shell;
      spawnArgs = ['-l', '-i', '-c', inner];
    } else {
      spawnCmd = shell;
      spawnArgs = ['-l'];
    }

    const proc = pty.spawn(spawnCmd, spawnArgs, {
      name: 'xterm-256color',
      cols: opts.cols,
      rows: opts.rows,
      cwd,
      env: {
        ...process.env,
        ...(opts.injectedEnv || {}),
        TERM: 'xterm-256color',
        COLORTERM: 'truecolor',
        TERM_PROGRAM: 'MWIDE',
      } as Record<string, string>,
    });

    const id = randomUUID();
    const session = new PtySession({ id, proc, shell, bufferCap: this.bufferCap });
    this.sessions.set(id, session);
    return session;
  }

  count(): number {
    return this.sessions.size;
  }
}

// ---------------------------------------------------------------------------
// setupPtyHub — wires WebSocketServer events to the session manager.
// ---------------------------------------------------------------------------

export function setupPtyHub(wss: WebSocketServer): void {
  const mgr = new PtySessionManager({
    bufferCap: Number(process.env.MWIDE_PTY_BUFFER_BYTES) || DEFAULT_BUFFER_BYTES,
    ttlMs:     Number(process.env.MWIDE_PTY_TTL_MS)       || DEFAULT_IDLE_TTL_MS,
  });
  mgr.startSweeper();

  wss.on('connection', (ws) => {
    let session: PtySession | null = null;

    const send = (obj: unknown): void => {
      if (ws.readyState === ws.OPEN) {
        try { ws.send(JSON.stringify(obj)); }
        catch { /* socket dying */ }
      }
    };

    ws.on('message', async (raw) => {
      let msg: { type: string; [k: string]: unknown };
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return;
      }

      if (msg.type === 'open' && !session) {
        const cols = Math.max(20, Number(msg.cols) || 80);
        const rows = Math.max(4,  Number(msg.rows) || 24);

        if (typeof msg.sessionId === 'string' && msg.sessionId) {
          const existing = mgr.get(msg.sessionId);
          if (existing && existing.exitCode === null) {
            existing.attach(ws);
            existing.resize(cols, rows);
            session = existing;
            send({
              type: 'ready',
              sessionId: existing.id,
              pid: existing.proc.pid,
              shell: existing.shell,
              resumed: true,
            });
            const replay = existing.getBufferText();
            if (replay.length > 0) send({ type: 'replay', data: replay });
            return;
          }
        }

        // Phase 2: extract optional command, args, vaultEnv from open message.
        const command = typeof msg.command === 'string' ? msg.command : undefined;
        const args = Array.isArray(msg.args)
          ? (msg.args as unknown[]).filter((a): a is string => typeof a === 'string')
          : undefined;
        const vaultEnvSpecs: VaultEnvSpec[] = Array.isArray(msg.vaultEnv)
          ? (msg.vaultEnv as unknown[]).filter((s): s is VaultEnvSpec =>
              !!s && typeof s === 'object'
              && typeof (s as VaultEnvSpec).id === 'string'
              && typeof (s as VaultEnvSpec).envVar === 'string')
          : [];
        const injectedEnv = await resolveVaultEnv(vaultEnvSpecs);

        try {
          session = await mgr.create({
            cols, rows,
            cwd: typeof msg.cwd === 'string' ? msg.cwd : undefined,
            command,
            args,
            injectedEnv,
          });
          session.attach(ws);
          send({
            type: 'ready',
            sessionId: session.id,
            pid: session.proc.pid,
            shell: session.shell,
            resumed: false,
          });
        } catch (err) {
          send({
            type: 'exit',
            code: -1,
            error: err instanceof Error ? err.message : String(err),
          });
          ws.close();
        }
        return;
      }

      if (msg.type === 'in' && session && typeof msg.data === 'string') {
        session.write(msg.data);
        return;
      }

      if (msg.type === 'resize' && session) {
        const cols = Math.max(20, Number(msg.cols) || 80);
        const rows = Math.max(4,  Number(msg.rows) || 24);
        session.resize(cols, rows);
        return;
      }

      if (msg.type === 'kill' && session) {
        const id = session.id;
        session = null;
        mgr.delete(id);
        send({ type: 'exit', code: 0 });
        return;
      }
    });

    ws.on('close', () => {
      if (session) {
        session.detach(ws);
        session = null;
      }
    });
  });
}
