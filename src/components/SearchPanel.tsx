// Project-wide search panel (grep) and "Go to Symbol" / "Go to File"
// quick navigation.

import { useEffect, useState } from 'react';
import { buildFileIndex, buildSymbolIndex, findInFiles, FindHit, Symbol } from '../lib/search';

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
  const [symbols, setSymbols] = useState<Symbol[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (tab === 'files') buildFileIndex(projectDir).then(setFiles);
    if (tab === 'symbols') buildSymbolIndex(projectDir).then(setSymbols);
  }, [tab, projectDir]);

  async function doSearch() {
    setBusy(true);
    try {
      const h = await findInFiles(projectDir, query, {
        regex,
        caseSensitive: cs,
      });
      setHits(h);
    } finally {
      setBusy(false);
    }
  }

  const fileMatches = files.filter((f) =>
    query ? f.toLowerCase().includes(query.toLowerCase()) : true,
  );
  const symbolMatches = symbols.filter((s) =>
    query ? s.name.toLowerCase().includes(query.toLowerCase()) : true,
  );

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

      <div className="results">
        {tab === 'find' &&
          hits.map((h, i) => (
            <button
              key={i}
              className="result-row"
              onClick={() => onOpen(h.path, h.line, h.col)}
            >
              <div className="result-path">{h.path}:{h.line}</div>
              <pre className="result-text">{h.text.slice(0, 300)}</pre>
            </button>
          ))}
        {tab === 'files' &&
          fileMatches.slice(0, 500).map((f) => (
            <button key={f} className="result-row" onClick={() => onOpen(f)}>
              {f}
            </button>
          ))}
        {tab === 'symbols' &&
          symbolMatches.slice(0, 500).map((s, i) => (
            <button
              key={i}
              className="result-row"
              onClick={() => onOpen(s.path, s.line)}
            >
              <div>
                <span className={'symbol-kind symbol-' + s.kind}>{s.kind}</span>{' '}
                {s.name}
              </div>
              <div className="muted small">{s.path}:{s.line}</div>
            </button>
          ))}
      </div>
    </div>
  );
}
