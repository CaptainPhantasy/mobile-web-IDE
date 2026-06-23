import { useEffect, useMemo, useRef, useState } from 'react';
import { navigate } from '../router';
import type { RepoSummary } from '../types';

interface PaletteCommand {
  id: string;
  label: string;
  hint?: string;
  run: () => void;
}

export function CommandPalette({
  open,
  onClose,
  repos,
}: {
  open: boolean;
  onClose: () => void;
  repos: RepoSummary[];
}) {
  const [q, setQ] = useState('');
  const [idx, setIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const commands = useMemo<PaletteCommand[]>(() => {
    const list: PaletteCommand[] = [
      { id: 'home', label: 'Go: Overview', run: () => navigate({ name: 'home' }) },
      { id: 'settings', label: 'Go: Settings', run: () => navigate({ name: 'settings' }) },
    ];
    for (const r of repos) {
      list.push({ id: `repo:${r.id}`, label: `Open: ${r.label}`, hint: r.id, run: () => navigate({ name: 'repoDetail', repoId: r.id }) });
      list.push({ id: `act:${r.id}`, label: `Actions: ${r.label}`, hint: r.id, run: () => navigate({ name: 'repoActions', repoId: r.id }) });
      list.push({ id: `term:${r.id}`, label: `Terminal: ${r.label}`, hint: r.id, run: () => navigate({ name: 'repoTerminal', repoId: r.id }) });
    }
    return list;
  }, [repos]);

  const filtered = useMemo(() => {
    const s = q.toLowerCase().trim();
    if (!s) return commands;
    return commands.filter((c) => `${c.label} ${c.hint ?? ''}`.toLowerCase().includes(s));
  }, [q, commands]);

  useEffect(() => {
    if (open) {
      setQ('');
      setIdx(0);
      const t = window.setTimeout(() => inputRef.current?.focus(), 0);
      return () => window.clearTimeout(t);
    }
    return undefined;
  }, [open]);
  useEffect(() => setIdx(0), [q]);

  if (!open) return null;

  const exec = (c: PaletteCommand | undefined): void => {
    if (!c) return;
    c.run();
    onClose();
  };

  return (
    <>
      <button className="fixed inset-0 z-40 bg-black/50" onClick={onClose} aria-label="Close command palette" />
      <div className="fixed left-1/2 top-24 z-50 w-[36rem] max-w-[90vw] -translate-x-1/2 overflow-hidden rounded-xl border border-slate-700 bg-slate-900 shadow-2xl">
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setIdx((i) => Math.min(i + 1, filtered.length - 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setIdx((i) => Math.max(i - 1, 0));
            } else if (e.key === 'Enter') {
              e.preventDefault();
              exec(filtered[idx]);
            } else if (e.key === 'Escape') {
              e.preventDefault();
              onClose();
            }
          }}
          placeholder="Search repos, actions, pages…"
          className="w-full border-b border-slate-700 bg-transparent px-4 py-3 text-sm text-slate-100 outline-none"
        />
        <ul className="max-h-80 overflow-y-auto py-1">
          {filtered.length === 0 ? (
            <li className="px-4 py-2 text-sm text-slate-500">No matches</li>
          ) : (
            filtered.map((c, i) => (
              <li key={c.id}>
                <button
                  onClick={() => exec(c)}
                  onMouseEnter={() => setIdx(i)}
                  className={`flex w-full items-center justify-between px-4 py-2 text-left text-sm ${i === idx ? 'bg-sky-700 text-white' : 'text-slate-200'}`}
                >
                  <span>{c.label}</span>
                  {c.hint && <span className="text-xs text-slate-400">{c.hint}</span>}
                </button>
              </li>
            ))
          )}
        </ul>
      </div>
    </>
  );
}
