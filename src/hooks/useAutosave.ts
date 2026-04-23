// Debounced autosave hook. Fires `save(path, text)` `delayMs` after the
// last change, per active file. Only re-saves when content actually
// changes (memoized per path), so switching tabs does not trigger a
// write. Errors surface via `state.error` without throwing.

import { useEffect, useRef, useState } from 'react';

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export interface AutosaveState {
  status: SaveStatus;
  /** ms epoch of most recent successful save, or null if never */
  lastSavedAt: number | null;
  /** most recent error message, if status === 'error' */
  error: string | null;
}

export function useAutosave(
  active: string | undefined,
  content: string,
  save: (path: string, text: string) => Promise<void>,
  delayMs = 500,
): AutosaveState {
  const [status, setStatus] = useState<SaveStatus>('idle');
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const lastSaved = useRef<Record<string, string>>({});
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!active) return;
    // First time we see this path, treat the current content as the
    // persisted baseline — avoids a redundant write on file-open.
    if (!(active in lastSaved.current)) {
      lastSaved.current[active] = content;
      return;
    }
    // Already persisted — no-op. Switching tabs back to a file whose
    // content matches what we last saved does not trigger a write.
    if (lastSaved.current[active] === content) return;

    if (timer.current) clearTimeout(timer.current);
    const path = active;
    const text = content;
    timer.current = setTimeout(async () => {
      setStatus('saving');
      try {
        await save(path, text);
        lastSaved.current[path] = text;
        setLastSavedAt(Date.now());
        setStatus('saved');
        setError(null);
      } catch (e) {
        setStatus('error');
        setError(e instanceof Error ? e.message : String(e));
      }
    }, delayMs);

    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [active, content, save, delayMs]);

  return { status, lastSavedAt, error };
}

/** Short relative-time for the save indicator. */
export function formatRelative(fromMs: number): string {
  const secs = Math.max(0, Math.floor((Date.now() - fromMs) / 1000));
  if (secs < 5) return 'just now';
  if (secs < 60) return secs + 's ago';
  const mins = Math.floor(secs / 60);
  if (mins < 60) return mins + 'm ago';
  const hours = Math.floor(mins / 60);
  return hours + 'h ago';
}
