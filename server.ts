// Mobile Web IDE — server.
//
// Responsibilities:
//   - Serve the Vite-built client (dev mode uses Vite middleware,
//     production serves dist/).
//   - Provide a git CORS proxy at /api/git-proxy that forwards
//     isomorphic-git requests to any HTTPS git remote.
//   - Provide a WebSocket hub at /ws/collab for real-time
//     collaboration between peers sharing a room.

import express, { Request, Response, NextFunction, RequestHandler } from 'express';
import { createServer as createViteServer } from 'vite';
import { createServer as createHttpServer } from 'http';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import { WebSocketServer, WebSocket } from 'ws';
import fs from 'fs/promises';
import * as pty from 'node-pty';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer(): Promise<void> {
  const app = express();
  const PORT = Number(process.env.PORT || 10001);

  app.use(express.json({ limit: '50mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({
      status: 'ok',
      service: 'mobile-web-ide',
      time: new Date().toISOString(),
    });
  });

  // --- Git CORS proxy (isomorphic-git expects this path layout).
  // Mounts at /api/git-proxy and rewrites to the "real" origin path
  // that the client sends. The client sets corsProxy: '/api/git-proxy',
  // and isomorphic-git hits /api/git-proxy/<host>/<path>.
  app.use('/api/git-proxy', gitProxy);

  // --- GitHub API proxy (optional, same origin).
  app.use('/api/github-proxy', githubProxy);

  // --- LLM streaming proxy. Accepts provider config + messages,
  //     forwards to the provider, and normalizes SSE events back.
  //     Wrapped with asyncHandler() because Express 4 silently
  //     swallows rejected promises from async route handlers.
  app.post('/api/llm/stream', asyncHandler(llmStreamProxy));

  // --- LLM connection test. Returns JSON { ok, error?, model?, responseTime? }.
  app.post('/api/llm/test', asyncHandler(llmTestHandler));

  // --- Local filesystem bridge. Provides read/write access to the
  //     host machine's real filesystem through the server.
  //     Scoped to HOME by default; rejects paths outside allowed roots.
  app.get('/api/fs/home', (_req, res) => res.json({ home: homedir() }));
  app.get('/api/fs/list', asyncHandler(localFsList));

  // --- API key vault (server-local file, 0600, HOME-based).
  app.get('/api/vault/list',      asyncHandler(vaultListHandler));
  app.post('/api/vault/set',      asyncHandler(vaultSetHandler));
  app.delete('/api/vault/delete', asyncHandler(vaultDeleteHandler));
  app.get('/api/fs/read', asyncHandler(localFsRead));
  app.post('/api/fs/write', asyncHandler(localFsWrite));
  app.post('/api/fs/mkdir', asyncHandler(localFsMkdir));
  app.post('/api/fs/rename', asyncHandler(localFsRename));
  app.delete('/api/fs/remove', asyncHandler(localFsRemove));
  app.get('/api/fs/stat', asyncHandler(localFsStat));

  // --- Vite in dev / static in prod.
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  // --- HTTP + WebSocket server.
  const httpServer = createHttpServer(app);
  const collabWss = new WebSocketServer({ noServer: true });
  const ptyWss    = new WebSocketServer({ noServer: true });
  httpServer.on('upgrade', (req, socket, head) => {
    const u = new URL(req.url || '/', 'http://localhost');
    if (u.pathname === '/ws/collab') {
      collabWss.handleUpgrade(req, socket, head, (ws) =>
        collabWss.emit('connection', ws, req),
      );
    } else if (u.pathname === '/ws/pty') {
      ptyWss.handleUpgrade(req, socket, head, (ws) =>
        ptyWss.emit('connection', ws, req),
      );
    } else {
      socket.destroy();
    }
  });
  setupCollabHub(collabWss);
  setupPtyHub(ptyWss);

  // Bind localhost only. The FS bridge grants real-disk read/write to
  // anyone who can reach this port — binding to 127.0.0.1 keeps it off
  // the LAN. Set IDE_BIND=0.0.0.0 to override on trusted networks.
  const BIND = process.env.IDE_BIND || '127.0.0.1';
  httpServer.listen(PORT, BIND, () => {
    console.log(`[web-ide] http://localhost:${PORT}`);
    console.log(`[web-ide] git proxy at /api/git-proxy`);
    console.log(`[web-ide] collab websocket at /ws/collab`);
    console.log(`[web-ide] pty websocket at /ws/pty`);
  });
}

// -------- PTY WebSocket hub --------
// One PTY per WebSocket. Spawns the user's login shell so .zshrc, Starship,
// FLOYD_MODE, PATH, aliases, etc. all work as if the user opened a fresh
// iTerm2 tab. Client framing is JSON messages:
//   client → server: {type:'open', cols, rows, cwd?} | {type:'in', data} | {type:'resize', cols, rows}
//   server → client: {type:'out', data} | {type:'exit', code} | {type:'ready', pid, shell}
function setupPtyHub(wss: WebSocketServer): void {
  wss.on('connection', (ws) => {
    let proc: pty.IPty | null = null;

    const send = (obj: unknown) => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj));
    };

    ws.on('message', async (raw) => {
      let msg: { type: string; [k: string]: unknown };
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return;
      }
      if (msg.type === 'open' && !proc) {
        const shell = process.env.SHELL || '/bin/zsh';
        const cols = Math.max(20, Number(msg.cols) || 80);
        const rows = Math.max(4,  Number(msg.rows) || 24);
        // Client may send a virtual-FS path from the IDE. node-pty/zsh
        // needs a real on-disk path, otherwise the shell exits immediately.
        // Resolve: use the requested cwd only if it exists on disk;
        // otherwise fall back to the user's homedir.
        let cwd = os.homedir();
        if (typeof msg.cwd === 'string' && msg.cwd) {
          try {
            const stat = await fs.stat(msg.cwd);
            if (stat.isDirectory()) cwd = msg.cwd;
          } catch { /* bad path — keep homedir */ }
        }
        try {
          proc = pty.spawn(shell, ['-l'], {
            name: 'xterm-256color',
            cols, rows, cwd,
            env: {
              ...process.env,
              TERM: 'xterm-256color',
              COLORTERM: 'truecolor',
              TERM_PROGRAM: 'MWIDE',
            } as Record<string, string>,
          });
        } catch (err) {
          send({ type: 'exit', code: -1, error: err instanceof Error ? err.message : String(err) });
          ws.close();
          return;
        }
        send({ type: 'ready', pid: proc.pid, shell });
        proc.onData((data) => send({ type: 'out', data }));
        proc.onExit(({ exitCode }) => {
          send({ type: 'exit', code: exitCode });
          try { ws.close(); } catch { /* already closed */ }
        });
      } else if (msg.type === 'in' && proc && typeof msg.data === 'string') {
        proc.write(msg.data);
      } else if (msg.type === 'resize' && proc) {
        const cols = Math.max(20, Number(msg.cols) || 80);
        const rows = Math.max(4,  Number(msg.rows) || 24);
        try { proc.resize(cols, rows); } catch { /* proc gone */ }
      }
    });

    ws.on('close', () => {
      if (proc) {
        try { proc.kill(); } catch { /* already dead */ }
        proc = null;
      }
    });
  });
}

// -------- Git CORS proxy --------
async function gitProxy(
  req: Request,
  res: Response,
  _next: NextFunction,
): Promise<void> {
  // The incoming path is e.g.
  //   /github.com/user/repo/info/refs?service=git-upload-pack
  // (because the client uses corsProxy='/api/git-proxy').
  let target = req.url;
  if (target.startsWith('/')) target = target.slice(1);
  if (!/^https?:\/\//i.test(target)) target = 'https://' + target;

  try {
    const targetUrl = new URL(target);
    if (targetUrl.protocol !== 'https:' && targetUrl.protocol !== 'http:') {
      res.status(400).send('bad protocol');
      return;
    }
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(req.headers)) {
      if (['host', 'connection', 'content-length'].includes(k.toLowerCase())) {
        continue;
      }
      if (Array.isArray(v)) headers[k] = v.join(',');
      else if (typeof v === 'string') headers[k] = v;
    }
    const method = (req.method || 'GET').toUpperCase();
    let body: Buffer | undefined;
    if (!['GET', 'HEAD'].includes(method)) {
      body = await new Promise<Buffer>((resolve, reject) => {
        const chunks: Buffer[] = [];
        req.on('data', (c: Buffer) => chunks.push(c));
        req.on('end', () => resolve(Buffer.concat(chunks)));
        req.on('error', reject);
      });
    }
    const upstream = await fetch(targetUrl.toString(), {
      method,
      headers,
      body,
    });
    res.status(upstream.status);
    upstream.headers.forEach((value, key) => {
      if (key.toLowerCase() === 'content-encoding') return;
      res.setHeader(key, value);
    });
    // Permissive CORS so the browser can read response.
    res.setHeader('Access-Control-Allow-Origin', '*');
    const buf = Buffer.from(await upstream.arrayBuffer());
    res.end(buf);
  } catch (err: any) {
    res.status(502).send('git proxy error: ' + (err?.message || err));
  }
}

// -------- GitHub API proxy (fallback) --------
async function githubProxy(
  req: Request,
  res: Response,
  _next: NextFunction,
): Promise<void> {
  const target = 'https://api.github.com' + req.url;
  try {
    const r = await fetch(target, {
      method: req.method,
      headers: {
        ...(req.headers.authorization
          ? { Authorization: String(req.headers.authorization) }
          : {}),
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body:
        req.method && ['POST', 'PUT', 'PATCH'].includes(req.method)
          ? JSON.stringify(req.body)
          : undefined,
    });
    res.status(r.status);
    const text = await r.text();
    res.setHeader(
      'Content-Type',
      r.headers.get('content-type') || 'application/json',
    );
    res.send(text);
  } catch (err: any) {
    res.status(502).send('gh proxy error: ' + (err?.message || err));
  }
}

// -------- Collab hub --------
type Room = {
  name: string;
  members: Map<WebSocket, { id: string; name: string; color: string }>;
};

function setupCollabHub(wss: WebSocketServer): void {
  const rooms = new Map<string, Room>();

  wss.on('connection', (ws, req) => {
    const roomName =
      new URL(req.url || '/', 'http://localhost').searchParams.get('room') ||
      'default';
    let room = rooms.get(roomName);
    if (!room) {
      room = { name: roomName, members: new Map() };
      rooms.set(roomName, room);
    }
    room.members.set(ws, { id: 'pending', name: 'anon', color: '#888' });

    ws.on('message', (raw) => {
      let msg: any;
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return;
      }
      if (msg.type === 'hello') {
        const member = {
          id: msg.peer?.id || 'anon',
          name: msg.peer?.name || 'anon',
          color: msg.peer?.color || '#888',
        };
        room!.members.set(ws, member);
        const peers = Array.from(room!.members.values());
        broadcast(room!, { type: 'peers', peers });
        return;
      }
      for (const peer of room!.members.keys()) {
        if (peer === ws) continue;
        if (peer.readyState === WebSocket.OPEN) peer.send(String(raw));
      }
    });

    ws.on('close', () => {
      const member = room!.members.get(ws);
      room!.members.delete(ws);
      if (member) broadcast(room!, { type: 'leave', id: member.id });
      if (room!.members.size === 0) rooms.delete(roomName);
    });
  });
}

function broadcast(room: { members: Map<WebSocket, any> }, msg: any): void {
  const text = JSON.stringify(msg);
  for (const peer of room.members.keys()) {
    if (peer.readyState === WebSocket.OPEN) peer.send(text);
  }
}

// -------- async route wrapper for Express 4 --------
// Express 4 does NOT catch rejected promises from async handlers.
// Without this, any throw inside an async route silently hangs the response,
// causing the browser to show "Failed to fetch".
function asyncHandler(fn: RequestHandler): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

// -------- LLM types --------

type LlmProvider = {
  id: string;
  name: string;
  type: 'openai' | 'anthropic' | 'custom';
  baseUrl: string;
  apiKey: string;
  model: string;
  maxTokens?: number;
};

type LlmMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>;
};

type LlmTool = {
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
};

async function llmStreamProxy(req: Request, res: Response): Promise<void> {
  const { provider, messages, tools, debug } = req.body as {
    provider: LlmProvider;
    messages: LlmMessage[];
    tools: LlmTool[];
    debug?: boolean;
  };

  if (!provider || !messages) {
    res.status(400).json({ error: 'Missing provider or messages' });
    return;
  }
  // Resolve from vault first; falls back to client-provided key for
  // the migration window. After migration, clients should not include
  // apiKey in the request body.
  provider.apiKey = await resolveProviderKey(provider);
  if (!provider.apiKey) {
    res.status(400).json({ error: 'API key not configured for this provider' });
    return;
  }

  // SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const send = (event: Record<string, unknown>): void => {
    try {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
      if (typeof (res as any).flush === 'function') (res as any).flush();
    } catch (writeErr: any) {
      console.error('[llm] SSE write error:', writeErr?.message);
    }
  };

  const t0 = Date.now();
  console.log(`[llm] stream start provider=${provider.id} model=${provider.model} url=${provider.baseUrl} debug=${!!debug}`);

  try {
    if (provider.type === 'anthropic') {
      await streamAnthropic(provider, messages, tools, send, !!debug);
    } else {
      await streamOpenAICompatible(provider, messages, tools, send, !!debug);
    }
    console.log(`[llm] stream done in ${Date.now() - t0}ms`);
  } catch (err: any) {
    const msg = err?.message || String(err);
    const stack = err?.stack || '';
    console.error(`[llm] stream error: ${msg}`);
    if (debug) console.error(`[llm] stack: ${stack}`);
    send({ type: 'error', error: msg, ...(debug ? { stack, provider: provider.id, model: provider.model, baseUrl: provider.baseUrl } : {}) });
  } finally {
    try { res.write('data: [DONE]\n\n'); } catch {}
    res.end();
  }
}

async function streamOpenAICompatible(
  provider: LlmProvider,
  messages: LlmMessage[],
  tools: LlmTool[],
  send: (e: Record<string, unknown>) => void,
  debug: boolean,
): Promise<void> {
  const url = `${provider.baseUrl.replace(/\/+$/, '')}/chat/completions`;
  if (debug) console.log(`[llm] openai req URL: ${url}`);
  const body: Record<string, unknown> = {
    model: provider.model,
    messages,
    stream: true,
    max_tokens: provider.maxTokens || 4096,
  };
  if (tools && tools.length > 0) {
    body.tools = tools;
    body.tool_choice = 'auto';
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${provider.apiKey}`,
  };
  // Some providers use different header conventions
  if (provider.id === 'openrouter') {
    headers['HTTP-Referer'] = 'https://mobile-web-ide.local';
    headers['X-Title'] = 'Mobile Web IDE';
  }

  const reqBody = JSON.stringify(body);
  if (debug) console.log(`[llm] openai req body length: ${reqBody.length} chars`);

  let upstream: globalThis.Response;
  try {
    upstream = await fetch(url, {
      method: 'POST',
      headers,
      body: reqBody,
    });
  } catch (fetchErr: any) {
    const msg = fetchErr?.message || String(fetchErr);
    console.error(`[llm] fetch failed to ${url}: ${msg}`);
    throw new Error(`Network error reaching ${url}: ${msg}`);
  }

  if (!upstream.ok) {
    const text = await upstream.text();
    console.error(`[llm] provider returned ${upstream.status}: ${text.slice(0, 300)}`);
    throw new Error(`Provider returned HTTP ${upstream.status}: ${text.slice(0, 500)}`);
  }

  const reader = upstream.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6).trim();
      if (data === '[DONE]') return;

      let chunk: any;
      try { chunk = JSON.parse(data); } catch { continue; }

      const choice = chunk.choices?.[0];
      if (!choice) continue;

      // Text content
      const content = choice.delta?.content;
      if (content) {
        send({ type: 'token', text: content });
      }

      // Tool calls
      const tcDeltas = choice.delta?.tool_calls;
      if (tcDeltas && Array.isArray(tcDeltas)) {
        for (const tc of tcDeltas) {
          send({
            type: 'tool_call',
            tool_call: {
              id: tc.id || '',
              type: 'function',
              function: {
                name: tc.function?.name || '',
                arguments: tc.function?.arguments || '',
              },
            },
          });
        }
      }

      // Finish reason
      if (choice.finish_reason === 'stop' || choice.finish_reason === 'end_turn') {
        return;
      }
    }
  }
}

async function streamAnthropic(
  provider: LlmProvider,
  messages: LlmMessage[],
  tools: LlmTool[],
  send: (e: Record<string, unknown>) => void,
  debug: boolean,
): Promise<void> {
  const url = `${provider.baseUrl.replace(/\/+$/, '')}/messages`;
  if (debug) console.log(`[llm] anthropic req URL: ${url}`);

  // Convert OpenAI-style messages to Anthropic format
  const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n');
  const nonSystem = messages.filter((m) => m.role !== 'system');

  const anthropicMessages: any[] = [];
  for (const msg of nonSystem) {
    if (msg.role === 'tool') {
      // Tool result — Anthropic wraps it as a user message with tool_result content blocks
      anthropicMessages.push({
        role: 'user',
        content: [{
          type: 'tool_result',
          tool_use_id: msg.tool_call_id || '',
          content: msg.content,
        }],
      });
    } else if (msg.role === 'assistant' && msg.tool_calls && msg.tool_calls.length > 0) {
      // Assistant with tool calls — Anthropic uses content blocks
      const content: any[] = [];
      if (msg.content) content.push({ type: 'text', text: msg.content });
      for (const tc of msg.tool_calls) {
        let input: any = {};
        try { input = JSON.parse(tc.function.arguments); } catch {}
        content.push({
          type: 'tool_use',
          id: tc.id,
          name: tc.function.name,
          input,
        });
      }
      anthropicMessages.push({ role: 'assistant', content });
    } else {
      anthropicMessages.push({ role: msg.role, content: msg.content });
    }
  }

  // Convert tools to Anthropic format
  const anthropicTools = (tools || []).map((t) => ({
    name: t.function.name,
    description: t.function.description,
    input_schema: t.function.parameters as any,
  }));

  const body: Record<string, unknown> = {
    model: provider.model,
    max_tokens: provider.maxTokens || 4096,
    messages: anthropicMessages,
    stream: true,
  };
  if (system) body.system = system;
  if (anthropicTools.length > 0) {
    body.tools = anthropicTools;
    body.tool_choice = { type: 'auto' };
  }

  let upstream: globalThis.Response;
  try {
    upstream = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': provider.apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify(body),
    });
  } catch (fetchErr: any) {
    const msg = fetchErr?.message || String(fetchErr);
    console.error(`[llm] fetch failed to ${url}: ${msg}`);
    throw new Error(`Network error reaching ${url}: ${msg}`);
  }

  if (!upstream.ok) {
    const text = await upstream.text();
    console.error(`[llm] anthropic returned ${upstream.status}: ${text.slice(0, 300)}`);
    throw new Error(`Anthropic returned HTTP ${upstream.status}: ${text.slice(0, 500)}`);
  }

  const reader = upstream.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  // Accumulate tool call data across events
  const pendingToolCalls = new Map<string, { id: string; name: string; input: string }>();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6).trim();
      let evt: any;
      try { evt = JSON.parse(data); } catch { continue; }

      if (evt.type === 'content_block_delta') {
        const delta = evt.delta;
        if (delta?.type === 'text_delta' && delta.text) {
          send({ type: 'token', text: delta.text });
        } else if (delta?.type === 'input_json_delta' && delta.partial_json) {
          // Accumulate tool input — we'll send the full tool_call on content_block_stop
          const idx = evt.index ?? 0;
          const key = String(idx);
          const pending = pendingToolCalls.get(key);
          if (pending) pending.input += delta.partial_json;
        }
      } else if (evt.type === 'content_block_start') {
        const cb = evt.content_block;
        if (cb?.type === 'tool_use') {
          pendingToolCalls.set(String(evt.index ?? 0), {
            id: cb.id || '',
            name: cb.name || '',
            input: '',
          });
        }
      } else if (evt.type === 'content_block_stop') {
        const key = String(evt.index ?? 0);
        const pending = pendingToolCalls.get(key);
        if (pending) {
          send({
            type: 'tool_call',
            tool_call: {
              id: pending.id,
              type: 'function',
              function: {
                name: pending.name,
                arguments: pending.input,
              },
            },
          });
          pendingToolCalls.delete(key);
        }
      } else if (evt.type === 'message_stop') {
        return;
      }
    }
  }
}

// -------- LLM connection test --------
async function llmTestHandler(req: Request, res: Response): Promise<void> {
  const { provider } = req.body as { provider: LlmProvider };

  if (!provider) {
    res.status(400).json({ ok: false, error: 'Missing provider config' });
    return;
  }
  provider.apiKey = await resolveProviderKey(provider);
  if (!provider.apiKey) {
    res.json({ ok: false, error: 'API key not configured' });
    return;
  }
  if (!provider.baseUrl) {
    res.json({ ok: false, error: 'Base URL not configured' });
    return;
  }
  if (!provider.model) {
    res.json({ ok: false, error: 'Model not configured' });
    return;
  }

  const t0 = Date.now();

  try {
    if (provider.type === 'anthropic') {
      // Anthropic test: POST to /messages with a minimal message
      const url = `${provider.baseUrl.replace(/\/\/+$/, '')}/messages`;
      console.log(`[llm:test] anthropic ${url} model=${provider.model}`);
      const r = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': provider.apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model: provider.model,
          max_tokens: 10,
          messages: [{ role: 'user', content: 'Say OK' }],
        }),
      });
      const text = await r.text();
      const ms = Date.now() - t0;
      if (!r.ok) {
        console.error(`[llm:test] anthropic ${r.status}: ${text.slice(0, 300)}`);
        res.json({ ok: false, error: `HTTP ${r.status}: ${text.slice(0, 500)}`, httpStatus: r.status, responseTime: ms, url });
        return;
      }
      console.log(`[llm:test] anthropic OK in ${ms}ms`);
      res.json({ ok: true, model: provider.model, responseTime: ms, snippet: text.slice(0, 200) });
    } else {
      // OpenAI-compatible test: POST to /chat/completions with a minimal message
      const url = `${provider.baseUrl.replace(/\/\/+$/, '')}/chat/completions`;
      console.log(`[llm:test] openai ${url} model=${provider.model}`);
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${provider.apiKey}`,
      };
      if (provider.id === 'openrouter') {
        headers['HTTP-Referer'] = 'https://mobile-web-ide.local';
        headers['X-Title'] = 'Mobile Web IDE';
      }
      const r = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: provider.model,
          max_tokens: 10,
          messages: [{ role: 'user', content: 'Say OK' }],
        }),
      });
      const text = await r.text();
      const ms = Date.now() - t0;
      if (!r.ok) {
        console.error(`[llm:test] openai ${r.status}: ${text.slice(0, 300)}`);
        res.json({ ok: false, error: `HTTP ${r.status}: ${text.slice(0, 500)}`, httpStatus: r.status, responseTime: ms, url });
        return;
      }
      console.log(`[llm:test] openai OK in ${ms}ms`);
      res.json({ ok: true, model: provider.model, responseTime: ms, snippet: text.slice(0, 200) });
    }
  } catch (err: any) {
    const ms = Date.now() - t0;
    const msg = err?.message || String(err);
    console.error(`[llm:test] error: ${msg}`);
    res.json({ ok: false, error: `Connection failed: ${msg}`, responseTime: ms, url: `${provider.baseUrl.replace(/\/\/+$/, '')}/chat/completions` });
  }
}

// -------- API key vault --------
// Keys are held in ~/.config/mwide-vault.json, chmod 0600, written via
// atomic rename. The client never stores keys — it only sees which
// provider IDs have keys set (via /api/vault/list) and sends
// provider.id to the proxy endpoints. The proxy reads the key from the
// vault by that ID before calling the upstream provider.
//
// Threat model: protects against XSS in the page reading keys out of
// localStorage/IndexedDB. Does NOT protect against the server process
// itself being compromised — but the server is the trust boundary
// (it's running on the user's machine with the user's permissions).

import { homedir as _vaultHomedir } from 'os';
const VAULT_DIR  = path.join(_vaultHomedir(), '.config');
const VAULT_PATH = path.join(VAULT_DIR, 'mwide-vault.json');

async function vaultRead(): Promise<Record<string, string>> {
  try {
    const txt = await fs.readFile(VAULT_PATH, 'utf-8');
    const obj = JSON.parse(txt);
    return (obj && typeof obj === 'object') ? obj as Record<string, string> : {};
  } catch {
    return {};
  }
}

async function vaultWrite(data: Record<string, string>): Promise<void> {
  await fs.mkdir(VAULT_DIR, { recursive: true });
  const tmp = VAULT_PATH + '.tmp';
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
  await fs.rename(tmp, VAULT_PATH);
  try { await fs.chmod(VAULT_PATH, 0o600); } catch { /* best effort */ }
}

function validVaultId(id: unknown): id is string {
  return typeof id === 'string' && /^[A-Za-z0-9._-]{1,64}$/.test(id);
}

async function vaultListHandler(_req: Request, res: Response): Promise<void> {
  const data = await vaultRead();
  // Never return the key values — only the ids with a non-empty value.
  res.json({ ids: Object.keys(data).filter((k) => !!data[k]) });
}

async function vaultSetHandler(req: Request, res: Response): Promise<void> {
  const { id, key } = req.body as { id: string; key: string };
  if (!validVaultId(id) || typeof key !== 'string') {
    res.status(400).json({ error: 'invalid id or key' });
    return;
  }
  const data = await vaultRead();
  if (key.length === 0) {
    delete data[id];
  } else {
    data[id] = key;
  }
  await vaultWrite(data);
  res.json({ ok: true, id });
}

async function vaultDeleteHandler(req: Request, res: Response): Promise<void> {
  const id = String(req.query.id || '');
  if (!validVaultId(id)) {
    res.status(400).json({ error: 'invalid id' });
    return;
  }
  const data = await vaultRead();
  delete data[id];
  await vaultWrite(data);
  res.json({ ok: true, id });
}

/** Resolve an API key for a provider. Prefers the vault; falls back to
 *  whatever the client sent in-band for backwards compat during the
 *  migration window. Returns empty string if neither exists. */
async function resolveProviderKey(provider: { id: string; apiKey?: string }): Promise<string> {
  if (provider.id) {
    const data = await vaultRead();
    if (data[provider.id]) return data[provider.id];
  }
  return provider.apiKey || '';
}

// -------- Local filesystem bridge --------
// Allow-list / deny-list per Legacy AI governance (.supercache contracts):
//   - SanDisk1Tb: active development, read+write
//   - Storage:    secondary projects, read+write
//   - T7:         OFF LIMITS (Time Machine target) — hard deny
//   - Google Drive: read-only cloud backbone
//   - HOME + cwd: always allowed
// Deny list is checked first so T7 is never reachable even if someone
// requests it via a traversal trick.

import { homedir } from 'os';

const DENY_ROOTS = [
  '/Volumes/T7',
  '/private/var/db',
  '/System',
];
const ALLOWED_ROOTS = [
  homedir(),
  process.cwd(),
  '/Volumes/SanDisk1Tb',
  '/Volumes/Storage',
  path.join(homedir(), 'Library/CloudStorage'), // Google Drive etc.
  '/tmp',
  '/opt',
  '/usr/local',
];
const LIST_CAP = 5000;

function assertAllowed(p: string): void {
  const resolved = path.resolve(p);
  if (DENY_ROOTS.some((r) => resolved === r || resolved.startsWith(r + path.sep))) {
    throw new Error(`Path denied: ${resolved}`);
  }
  const ok = ALLOWED_ROOTS.some(
    (r) => resolved === r || resolved.startsWith(r + path.sep),
  );
  if (!ok) throw new Error(`Path not allowed: ${resolved}`);
}

async function localFsList(req: Request, res: Response): Promise<void> {
  const dir = String(req.query.path || homedir());
  // Drive picker: when path === '/Volumes', we ask the OS; but assertAllowed
  // would reject bare '/Volumes', so short-circuit here with a synthesized
  // listing of mounted volumes (minus the deny list).
  if (dir === '/Volumes') {
    try {
      const vols = await fs.readdir('/Volumes', { withFileTypes: true });
      const items = vols
        .filter((e) => e.isDirectory() || e.isSymbolicLink())
        .map((e) => {
          const full = path.join('/Volumes', e.name);
          const denied = DENY_ROOTS.some((r) => full === r || full.startsWith(r + path.sep));
          return { name: e.name, path: full, type: 'dir' as const, size: 0, mtimeMs: 0, denied };
        })
        .filter((e) => !e.denied)
        .sort((a, b) => a.name.localeCompare(b.name));
      res.json({ path: dir, items, truncated: false, total: items.length });
      return;
    } catch (err) {
      res.status(500).json({ error: String(err) });
      return;
    }
  }

  assertAllowed(dir);
  const entries = await fs.readdir(dir, { withFileTypes: true });
  // No longer hides dotfiles — dev IDE needs to see .env, .gitignore, .github.
  // `showHidden=false` query param opts out (to uphide system cruft).
  const showHidden = req.query.showHidden !== 'false';
  const filtered = showHidden ? entries : entries.filter((e) => !e.name.startsWith('.'));
  const total = filtered.length;
  const items = await Promise.all(
    filtered
      .sort((a, b) => {
        if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
        return a.name.localeCompare(b.name);
      })
      .slice(0, LIST_CAP)
      .map(async (e) => {
        const full = path.join(dir, e.name);
        try {
          const st = await fs.stat(full);
          return {
            name: e.name,
            path: full,
            type: e.isDirectory() ? 'dir' : 'file',
            size: st.size,
            mtimeMs: st.mtimeMs,
          };
        } catch {
          return { name: e.name, path: full, type: 'file' as const, size: 0, mtimeMs: 0 };
        }
      }),
  );
  res.json({
    path: dir,
    items,
    total,
    truncated: total > LIST_CAP,
  });
}

async function localFsRead(req: Request, res: Response): Promise<void> {
  const file = String(req.query.path || '');
  if (!file) { res.status(400).json({ error: 'path required' }); return; }
  assertAllowed(file);
  const content = await fs.readFile(file, 'utf-8');
  res.json({ path: file, content });
}

async function localFsWrite(req: Request, res: Response): Promise<void> {
  const { path: fpath, content } = req.body as { path: string; content: string };
  if (!fpath) { res.status(400).json({ error: 'path required' }); return; }
  assertAllowed(fpath);
  await fs.mkdir(path.dirname(fpath), { recursive: true });
  await fs.writeFile(fpath, content, 'utf-8');
  res.json({ ok: true, path: fpath, bytes: content.length });
}

async function localFsMkdir(req: Request, res: Response): Promise<void> {
  const { path: fpath } = req.body as { path: string };
  if (!fpath) { res.status(400).json({ error: 'path required' }); return; }
  assertAllowed(fpath);
  await fs.mkdir(fpath, { recursive: true });
  res.json({ ok: true, path: fpath });
}

async function localFsRename(req: Request, res: Response): Promise<void> {
  const { from, to } = req.body as { from: string; to: string };
  if (!from || !to) { res.status(400).json({ error: 'from and to required' }); return; }
  assertAllowed(from);
  assertAllowed(to);
  await fs.mkdir(path.dirname(to), { recursive: true });
  await fs.rename(from, to);
  res.json({ ok: true });
}

async function localFsRemove(req: Request, res: Response): Promise<void> {
  const fpath = String(req.query.path || '');
  if (!fpath) { res.status(400).json({ error: 'path required' }); return; }
  assertAllowed(fpath);
  const st = await fs.stat(fpath);
  if (st.isDirectory()) await fs.rm(fpath, { recursive: true });
  else await fs.unlink(fpath);
  res.json({ ok: true });
}

async function localFsStat(req: Request, res: Response): Promise<void> {
  const fpath = String(req.query.path || '');
  if (!fpath) { res.status(400).json({ error: 'path required' }); return; }
  assertAllowed(fpath);
  const st = await fs.stat(fpath);
  res.json({
    path: fpath,
    type: st.isDirectory() ? 'dir' : 'file',
    size: st.size,
    mtimeMs: st.mtimeMs,
    mode: st.mode,
  });
}

startServer().catch((err) => {
  console.error('failed to start:', err);
  process.exit(1);
});
