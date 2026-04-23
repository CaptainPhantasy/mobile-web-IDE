// Collaboration panel: join/leave a room, see connected peers, chat.

import { useEffect, useRef, useState } from 'react';
import { Collab, CollabPeer } from '../lib/collab';

type Props = {
  projectDir: string;
  me: CollabPeer;
  onDocIncoming?: (path: string, text: string) => void;
  onCursor?: (peer: string, line: number, col: number, path: string) => void;
  bindOut?: (collab: Collab | null) => void;
};

export default function CollabPanel({
  projectDir,
  me,
  onDocIncoming,
  onCursor,
  bindOut,
}: Props) {
  const [room, setRoom] = useState(projectDir);
  const [peers, setPeers] = useState<CollabPeer[]>([]);
  const [status, setStatus] = useState<'idle' | 'connecting' | 'open' | 'closed' | 'error'>('idle');
  const [chat, setChat] = useState<Array<{ name: string; text: string; time: number; me?: boolean }>>([]);
  const [msg, setMsg] = useState('');
  const collabRef = useRef<Collab | null>(null);

  useEffect(() => {
    setRoom(projectDir);
  }, [projectDir]);

  function connect() {
    disconnect();
    const c = new Collab(me);
    c.on({
      onStatus: (s) => setStatus(s),
      onPeers: (ps) =>
        setPeers((prev) => {
          const map = new Map(prev.map((p) => [p.id, p]));
          for (const p of ps) map.set(p.id, p);
          return Array.from(map.values());
        }),
      onDoc: (text, from, path) => {
        onDocIncoming?.(path, text);
        setChat((l) => [
          ...l,
          { name: from.slice(0, 6), text: '(synced ' + path + ')', time: Date.now() },
        ].slice(-200));
      },
      onCursor: (peerId, line, col, path) => onCursor?.(peerId, line, col, path),
      onChat: (_from, name, text, time) =>
        setChat((l) => [...l, { name, text, time }].slice(-200)),
    });
    c.connect(room);
    collabRef.current = c;
    bindOut?.(c);
  }

  function disconnect() {
    collabRef.current?.disconnect();
    collabRef.current = null;
    bindOut?.(null);
    setStatus('idle');
    setPeers([]);
  }

  function send() {
    if (!msg || !collabRef.current) return;
    collabRef.current.sendChat(msg);
    setChat((l) =>
      [...l, { name: me.name, text: msg, time: Date.now(), me: true }].slice(-200),
    );
    setMsg('');
  }

  useEffect(() => {
    return () => disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="panel collab-panel">
      <div className="panel-header">
        <div className="panel-title">Collaboration</div>
      </div>
      <div className="collab-section">
        <div className="row">
          <input
            placeholder="Room"
            value={room}
            onChange={(e) => setRoom(e.target.value)}
          />
          {status === 'open' ? (
            <button onClick={disconnect}>Leave</button>
          ) : (
            <button onClick={connect}>Join</button>
          )}
        </div>
        <div className="muted small">
          Status: <strong>{status}</strong>
          {' · '}
          You: <span style={{ color: me.color }}>{me.name}</span>
        </div>
      </div>

      <div className="collab-section">
        <div className="collab-subtitle">Peers</div>
        <div className="peers">
          {peers.map((p) => (
            <div key={p.id} className="peer">
              <span className="dot" style={{ background: p.color }} />
              {p.name}
            </div>
          ))}
          {peers.length === 0 && <div className="muted">No peers yet.</div>}
        </div>
      </div>

      <div className="collab-section chat-section">
        <div className="collab-subtitle">Chat</div>
        <div className="chat-log">
          {chat.map((c, i) => (
            <div key={i} className={'chat-msg ' + (c.me ? 'me' : '')}>
              <strong>{c.name}</strong> {c.text}
            </div>
          ))}
        </div>
        <div className="row">
          <input
            value={msg}
            onChange={(e) => setMsg(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && send()}
            placeholder="Message"
          />
          <button onClick={send} disabled={!msg || status !== 'open'}>
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
