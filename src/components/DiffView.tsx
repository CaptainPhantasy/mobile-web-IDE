// Unified diff viewer: shows HEAD vs working-tree for a single file
// using @codemirror/merge's `unifiedMergeView`. Read-only.

import { useEffect, useRef, useState } from 'react';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { unifiedMergeView } from '@codemirror/merge';
import { oneDark } from '@codemirror/theme-one-dark';
import { readHeadAndWorking } from '../lib/git';
import { Glyph } from './Glyph';

interface Props {
  projectDir: string;
  path: string;
  onClose?: () => void;
}

export default function DiffView({ projectDir, path, onClose }: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [counts, setCounts] = useState<{ added: number; removed: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    (async () => {
      try {
        const { head, working } = await readHeadAndWorking(projectDir, path);
        if (cancelled || !hostRef.current) return;

        // Naive stats — exact counts come from unifiedMergeView's chunk
        // set, but for a header badge a line-level diff suffices.
        const headLines = head.split('\n');
        const workLines = working.split('\n');
        const setH = new Set(headLines);
        const setW = new Set(workLines);
        const added = workLines.filter((l) => !setH.has(l)).length;
        const removed = headLines.filter((l) => !setW.has(l)).length;
        setCounts({ added, removed });

        const state = EditorState.create({
          doc: working,
          extensions: [
            EditorView.editable.of(false),
            EditorState.readOnly.of(true),
            unifiedMergeView({ original: head }),
            oneDark,
            EditorView.theme({
              '&': {
                height: '100%',
                backgroundColor: 'var(--bg-0)',
                color: 'var(--fg)',
                fontSize: '12.5px',
                fontFamily: "var(--mono)",
              },
              '.cm-scroller': { fontFamily: 'var(--mono)' },
              '.cm-mergeViewEditor': { backgroundColor: 'var(--bg-0)' },
            }),
          ],
        });
        viewRef.current = new EditorView({ state, parent: hostRef.current });
        setStatus('ready');
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
          setStatus('error');
        }
      }
    })();

    return () => {
      cancelled = true;
      viewRef.current?.destroy();
      viewRef.current = null;
    };
  }, [projectDir, path]);

  return (
    <div className="diff-view" role="region" aria-label={`Diff for ${path}`}>
      <div className="diff-view-bar">
        <span className="diff-view-path" title={path}>{path}</span>
        {counts && (
          <span className="diff-view-counts" aria-label="lines changed">
            <span className="diff-added" title="added">+{counts.added}</span>
            <span className="diff-removed" title="removed">−{counts.removed}</span>
          </span>
        )}
        {onClose && (
          <button className="icon-btn" onClick={onClose} title="Close diff">
            <Glyph name="close" />
          </button>
        )}
      </div>
      {status === 'loading' && <div className="diff-view-loading">loading diff…</div>}
      {status === 'error' && <div className="panel-error">Diff failed: {error}</div>}
      <div ref={hostRef} className="diff-view-host" />
    </div>
  );
}
