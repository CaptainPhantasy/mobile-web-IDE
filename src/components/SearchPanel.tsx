// Project-wide search panel (grep) and "Go to Symbol" / "Go to File"
// quick navigation.

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  buildFileIndex,
  buildSymbolIndex,
  scoreSymbols,
  FindHit,
  findInFiles,
  NavigationSymbol,
} from '../lib/search';

type Props = {
  projectDir: string;
  onOpen: (path: string, line?: number, col?: number) => void;
};

export default function SearchPanel({ projectDir, onOpen }: Props) {
  const [tab, setTab] = useState<'find' | 'files' | 'symbols'>('find');
  const [query, setQuery] = useState('');
  const [regex, setRegex] = useState(false);
  const [cs, setCs] = useState(false);
  const [hits, setHits] = useState<FindHit[]>([]);
  const [files, setFiles] = useState<string[]>([]);
  const [symbols, setSymbols] = useState<NavigationSymbol[]>([]);
  const [busy, setBusy] = useState(false);
  const [queryError, setQueryError] = useState<string>('');
  const [indexError, setIndexError] = useState<string>('');
  const [statusMessage, setStatusMessage] = useState('');
  const indexRunRef = useRef(0);

  const symbolMatches = query
    ? scoreSymbols(symbols, query)
    : symbols.slice(0, Math.min(symbols.length, 500));
  const fileMatches = query
    ? files.filter((f) => f.toLowerCase().includes(query.toLowerCase()))
    : files.slice(0, 500);

  useEffect(() => {
    const thisRun = ++indexRunRef.current;
    let cancelled = false;
    setIndexError('');
    if (tab === 'find') {
      setFiles([]);
      setSymbols([]);
      setStatusMessage('');
      return;
    }
    setStatusMessage(`${tab === 'files' ? 'Loading files' : 'Loading symbols'}...`);
    if (tab === 'files') {
      buildFileIndex(projectDir)
        .then((next) => {
          if (cancelled || thisRun !== indexRunRef.current) return;
          setFiles(next);
          setStatusMessage(`Loaded ${next.length} files`);
        })
        .catch((err: unknown) => {
          if (cancelled || thisRun !== indexRunRef.current) return;
          setFiles([]);
          setIndexError(err instanceof Error ? err.message : 'Unable to build file index');
          setStatusMessage('');
        })
        .finally(() => {
          // no-op: errors are surfaced through result state and this guard
        });
    } else {
      buildSymbolIndex(projectDir)
        .then((next) => {
          if (cancelled || thisRun !== indexRunRef.current) return;
          setSymbols(next);
          setStatusMessage(`Loaded ${next.length} symbols`);
        })
        .catch((err: unknown) => {
          if (cancelled || thisRun !== indexRunRef.current) return;
          setSymbols([]);
          setIndexError(err instanceof Error ? err.message : 'Unable to build symbol index');
          setStatusMessage('');
        })
        .finally(() => {
          // no-op: this effect is intentionally idempotent
        });
    }
    return () => {
      cancelled = true;
    };
  }, [tab, projectDir]);

  const doSearch = useCallback(async () => {
    if (!query.trim()) {
      setHits([]);
      setQueryError('');
      setStatusMessage('Type a query to search');
      return;
    }
    if (regex) {
      try {
        new RegExp(query);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Invalid regular expression';
        setQueryError(msg);
        return;
      }
    }
    setBusy(true);
    setQueryError('');
    setStatusMessage('Searching...');
    try {
      const h = await findInFiles(projectDir, query, {
        regex,
        caseSensitive: cs,
        maxHits: 500,
        maxPreviewLength: 300,
      });
      setHits(h);
      if (!h.length) {
        setStatusMessage('No results');
      } else {
        setStatusMessage(`Found ${h.length} matches`);
      }
    } finally {
      setBusy(false);
    }
  }, [cs, projectDir, query, regex]);

  const sortedSymbolMatches = tab === 'symbols'
    ? symbolMatches.slice(0, 500)
    : symbolMatches;

  return (
    <div className="panel search-panel">
      <div className="panel-header">
        <div className="panel-title">Search</div>
      </div>
      <div className="tabs">
        <button
          className={tab === 'find' ? 'active' : ''}
          onClick={() => setTab('find')}
        >
          Text
        </button>
        <button
          className={tab === 'files' ? 'active' : ''}
          onClick={() => setTab('files')}
        >
          Files
        </button>
        <button
          className={tab === 'symbols' ? 'active' : ''}
          onClick={() => setTab('symbols')}
        >
          Symbols
        </button>
      </div>
      <div className="search-input">
        <input
          placeholder={
            tab === 'find'
              ? 'Search project...'
              : tab === 'files'
              ? 'Go to file...'
              : 'Go to symbol...'
          }
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && tab === 'find') doSearch();
          }}
        />
        {tab === 'find' && (
          <>
            <button
              className={'toggle ' + (regex ? 'on' : '')}
              onClick={() => setRegex((x) => !x)}
              title="Regex"
            >
              .*
            </button>
            <button
              className={'toggle ' + (cs ? 'on' : '')}
              onClick={() => setCs((x) => !x)}
              title="Case-sensitive"
            >
              Aa
            </button>
            <button disabled={busy} onClick={doSearch}>
              Go
            </button>
          </>
        )}
      </div>

      {queryError && <div className="muted small">{queryError}</div>}
      {statusMessage && <div className="muted small">{statusMessage}</div>}
      {indexError && <div className="muted small">⚠ {indexError}</div>}
      <div className="results">
        {tab === 'find' &&
          hits.map((h, i) => {
            const rowText = h.preview || h.text.slice(0, 300);
            return (
              <button
                key={`${h.path}:${h.line}:${h.col}:${i}`}
                className="result-row"
                onClick={() => onOpen(h.path, h.line, h.col)}
              >
                <div className="result-path">{h.path}:{h.line}</div>
                <pre className="result-text">{rowText}</pre>
              </button>
            );
          })}
        {tab === 'files' &&
          fileMatches.map((f) => (
            <button key={f} className="result-row" onClick={() => onOpen(f)}>
              {f}
            </button>
          ))}
        {tab === 'symbols' &&
          sortedSymbolMatches.map((s, i) => (
            <button
              key={`${s.path}:${s.line}:${s.name}:${i}`}
              className="result-row"
              onClick={() => onOpen(s.path, s.line)}
            >
              <div>
                <span className={'symbol-kind symbol-' + s.kind}>{s.kind}</span>{' '}
                <span className="symbol-score">{s.score.toFixed(2)}</span>{' '}
                {s.name}
              </div>
              <div className="result-path muted small">
                {s.path}:{s.line}
              </div>
              <div className="result-text muted small">{s.preview}</div>
            </button>
          ))}
      </div>
    </div>
  );
}
