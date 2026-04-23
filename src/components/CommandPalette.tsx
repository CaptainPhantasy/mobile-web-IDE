// Command palette: fuzzy-filter + run any registered command.
// Used for IDE actions and extension-contributed commands.

import { useEffect, useRef, useState } from 'react';
import { IdeCommand } from '../lib/extensions';

type Props = {
  open: boolean;
  commands: IdeCommand[];
  onClose: () => void;
};

export default function CommandPalette({ open, commands, onClose }: Props) {
  const [q, setQ] = useState('');
  const ref = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (open) {
      setQ('');
      setTimeout(() => ref.current?.focus(), 10);
    }
  }, [open]);

  if (!open) return null;

  const filtered = commands
    .filter((c) =>
      q ? (c.title + ' ' + (c.category || '')).toLowerCase().includes(q.toLowerCase()) : true,
    )
    .slice(0, 50);

  return (
    <div className="palette-backdrop" onClick={onClose}>
      <div className="palette" onClick={(e) => e.stopPropagation()}>
        <input
          ref={ref}
          placeholder="Type a command..."
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onClose();
            if (e.key === 'Enter' && filtered[0]) {
              onClose();
              filtered[0].run();
            }
          }}
        />
        <div className="palette-list">
          {filtered.map((c) => (
            <button
              key={c.id}
              className="palette-item"
              onClick={() => {
                onClose();
                c.run();
              }}
            >
              <span className="palette-title">{c.title}</span>
              <span className="palette-category">{c.category || c.id.split('.')[0]}</span>
            </button>
          ))}
          {filtered.length === 0 && (
            <div className="muted" style={{ padding: 12 }}>
              No commands.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
