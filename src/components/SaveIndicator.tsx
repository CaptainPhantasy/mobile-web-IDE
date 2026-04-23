import { useEffect, useState } from 'react';
import { AutosaveState, formatRelative } from '../hooks/useAutosave';
import { Glyph } from './Glyph';

interface Props {
  state: AutosaveState;
}

/** Status-bar pill reflecting autosave state.
 *  Updates the "saved Xs ago" label on an interval even when React
 *  doesn't re-render the parent. */
export default function SaveIndicator({ state }: Props) {
  const [, tick] = useState(0);
  useEffect(() => {
    if (state.status !== 'saved' || !state.lastSavedAt) return;
    const id = setInterval(() => tick((t) => t + 1), 10000);
    return () => clearInterval(id);
  }, [state.status, state.lastSavedAt]);

  if (state.status === 'saving') {
    return (
      <span className="st-save saving" aria-live="polite" title="Saving…">
        <Glyph name="spinner" /> saving…
      </span>
    );
  }
  if (state.status === 'error') {
    return (
      <span
        className="st-save err"
        role="alert"
        title={state.error || 'save failed'}
      >
        <Glyph name="err" /> save failed
      </span>
    );
  }
  if (state.lastSavedAt) {
    return (
      <span className="st-save ok" aria-live="polite">
        <Glyph name="ok" /> saved {formatRelative(state.lastSavedAt)}
      </span>
    );
  }
  return <span className="st-save idle">—</span>;
}
