// Mobile Web IDE — server.
//
// Responsibilities:
//   - Serve the Vite-built client (dev mode uses Vite middleware,
//     production serves dist/).
//   - Provide a git CORS proxy at /api/git-proxy that forwards
//     isomorphic-git requests to any HTTPS git remote.
//   - Provide a WebSocket hub at /ws/collab for real-time
//     collaboration between peers sharing a room.

import express, { Request, Response, NextFunction } from 'express';
import { createServer as createViteServer } from 'vite';
import { createServer as createHttpServer } from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer, WebSocket } from 'ws';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer(): Promise<void> {
  const app = express();
  const PORT = Number(process.env.PORT || 3000);

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
  const wss = new WebSocketServer({ noServer: true });
  httpServer.on('upgrade', (req, socket, head) => {
    const u = new URL(req.url || '/', 'http://localhost');
    if (u.pathname === '/ws/collab') {
      wss.handleUpgrade(req, socket, head, (ws) =>
        wss.emit('connection', ws, req),
      );
    } else {
      socket.destroy();
    }
  });
  setupCollabHub(wss);

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`[web-ide] http://localhost:${PORT}`);
    console.log(`[web-ide] git proxy at /api/git-proxy`);
    console.log(`[web-ide] collab websocket at /ws/collab`);
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

startServer().catch((err) => {
  console.error('failed to start:', err);
  process.exit(1);
});
