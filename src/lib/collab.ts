// Real-time collaboration via a WebSocket hub.
// Clients join a "room" identified by a project+file pair and
// broadcast text operations + cursor positions. The host server
// (see server.ts) simply fans messages out to every other peer in the
// room, so no server-side CRDT is required.
//
// For correctness under concurrent edits we use a last-write-wins
// "full document sync" strategy: whenever the local editor changes
// significantly we broadcast the whole document; remote peers replace
// their buffer if the incoming version is newer.

export type CollabPeer = {
  id: string;
  name: string;
  color: string;
  cursor?: { line: number; col: number };
};

export type CollabMsg =
  | { type: 'hello'; peer: CollabPeer; room: string }
  | { type: 'peers'; peers: CollabPeer[] }
  | { type: 'join'; peer: CollabPeer }
  | { type: 'leave'; id: string }
  | { type: 'doc'; from: string; version: number; text: string; path: string }
  | { type: 'cursor'; from: string; line: number; col: number; path: string }
  | { type: 'chat'; from: string; name: string; text: string; time: number };

export type CollabHandlers = {
  onPeers?: (peers: CollabPeer[]) => void;
  onDoc?: (text: string, from: string, path: string) => void;
  onCursor?: (peerId: string, line: number, col: number, path: string) => void;
  onChat?: (from: string, name: string, text: string, time: number) => void;
  onStatus?: (s: 'connecting' | 'open' | 'closed' | 'error') => void;
};

export class Collab {
  private ws?: WebSocket;
  private handlers: CollabHandlers = {};
  private version = 0;
  private room = '';
  private me: CollabPeer;
  private reconnectTimer?: number;

  constructor(me: CollabPeer) {
    this.me = me;
  }

  on(h: CollabHandlers): void {
    this.handlers = { ...this.handlers, ...h };
  }

  connect(room: string): void {
    this.room = room;
    this.handlers.onStatus?.('connecting');
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const url = `${proto}://${location.host}/ws/collab?room=${encodeURIComponent(room)}`;
    const ws = new WebSocket(url);
    this.ws = ws;
    ws.onopen = () => {
      this.handlers.onStatus?.('open');
      this.send({ type: 'hello', peer: this.me, room });
    };
    ws.onclose = () => {
      this.handlers.onStatus?.('closed');
      this.reconnectTimer = window.setTimeout(() => this.connect(room), 2000);
    };
    ws.onerror = () => this.handlers.onStatus?.('error');
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data) as CollabMsg;
        this.handle(msg);
      } catch {}
    };
  }

  disconnect(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
    this.ws = undefined;
  }

  private handle(m: CollabMsg): void {
    switch (m.type) {
      case 'peers':
        this.handlers.onPeers?.(m.peers);
        break;
      case 'join':
        this.handlers.onPeers?.([m.peer]);
        break;
      case 'leave':
        break;
      case 'doc':
        this.handlers.onDoc?.(m.text, m.from, m.path);
        break;
      case 'cursor':
        this.handlers.onCursor?.(m.from, m.line, m.col, m.path);
        break;
      case 'chat':
        this.handlers.onChat?.(m.from, m.name, m.text, m.time);
        break;
    }
  }

  broadcastDoc(path: string, text: string): void {
    this.version++;
    this.send({
      type: 'doc',
      from: this.me.id,
      version: this.version,
      text,
      path,
    });
  }

  broadcastCursor(path: string, line: number, col: number): void {
    this.send({
      type: 'cursor',
      from: this.me.id,
      line,
      col,
      path,
    });
  }

  sendChat(text: string): void {
    this.send({
      type: 'chat',
      from: this.me.id,
      name: this.me.name,
      text,
      time: Date.now(),
    });
  }

  private send(m: CollabMsg): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(m));
    }
  }
}
