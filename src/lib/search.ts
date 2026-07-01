// Project-wide search & navigation.
// Supports:
//   - findInFiles: grep-style substring / regex search across the
//     entire project, with line/column hits
//   - symbolIndex: a best-effort symbol extractor for multiple
//     languages (JS/TS/Python/Rust/Java/C) for "Go to Symbol"
//   - buildFileIndex: lightweight list of every file path for quick
//     fuzzy file navigation ("Go to File")

import { readText, walkFiles } from './fs';
import { detectLanguage } from './languages';

export type FindHit = {
  path: string;
  line: number;
  col: number;
  text: string;
  preview: string;
};

export type FindOptions = {
  regex?: boolean;
  caseSensitive?: boolean;
  maxHits?: number;
  maxPreviewLength?: number;
};

type SymbolKind = 'function' | 'class' | 'method' | 'variable' | 'interface' | 'type';

export type SearchSymbol = {
  path: string;
  name: string;
  kind: SymbolKind;
  line: number;
  preview: string;
  score: number;
};

const FILE_INDEX_LIMIT = 5000;
const SYMBOL_INDEX_LIMIT = 5000;
const DEFAULT_MAX_HITS = 500;
const DEFAULT_MAX_PREVIEW = 220;

const fileIndexCache = new Map<string, string[]>();
const symbolIndexCache = new Map<string, SearchSymbol[]>();

const symbolPatterns: Record<string, Array<{ re: RegExp; kind: SymbolKind }>> = {
  javascript: [
    { re: /^\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/, kind: 'function' },
    { re: /^\s*(?:export\s+)?class\s+([A-Za-z_$][\w$]*)/, kind: 'class' },
    { re: /^\s*(?:export\s+)?interface\s+([A-Za-z_$][\w$]*)/, kind: 'interface' },
    { re: /^\s*(?:export\s+)?type\s+([A-Za-z_$][\w$]*)/, kind: 'type' },
    { re: /^\s*(?:export\s+)?const\s+([A-Za-z_$][\w$]*)/, kind: 'variable' },
  ],
  typescript: [
    { re: /^\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/, kind: 'function' },
    { re: /^\s*(?:export\s+)?class\s+([A-Za-z_$][\w$]*)/, kind: 'class' },
    { re: /^\s*(?:export\s+)?interface\s+([A-Za-z_$][\w$]*)/, kind: 'interface' },
    { re: /^\s*(?:export\s+)?type\s+([A-Za-z_$][\w$]*)/, kind: 'type' },
    { re: /^\s*(?:export\s+)?const\s+([A-Za-z_$][\w$]*)/, kind: 'variable' },
  ],
  jsx: [
    { re: /^\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/, kind: 'function' },
    { re: /^\s*(?:export\s+)?class\s+([A-Za-z_$][\w$]*)/, kind: 'class' },
    { re: /^\s*(?:export\s+)?const\s+([A-Za-z_$][\w$]*)/, kind: 'variable' },
  ],
  tsx: [
    { re: /^\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/, kind: 'function' },
    { re: /^\s*(?:export\s+)?class\s+([A-Za-z_$][\w$]*)/, kind: 'class' },
    { re: /^\s*(?:export\s+)?interface\s+([A-Za-z_$][\w$]*)/, kind: 'interface' },
    { re: /^\s*(?:export\s+)?type\s+([A-Za-z_$][\w$]*)/, kind: 'type' },
    { re: /^\s*(?:export\s+)?const\s+([A-Za-z_$][\w$]*)/, kind: 'variable' },
  ],
  python: [
    { re: /^\s*def\s+([A-Za-z_][\w]*)/, kind: 'function' },
    { re: /^\s*class\s+([A-Za-z_][\w]*)/, kind: 'class' },
  ],
  rust: [
    { re: /^\s*(?:pub\s+)?fn\s+([A-Za-z_][\w]*)/, kind: 'function' },
    { re: /^\s*(?:pub\s+)?struct\s+([A-Za-z_][\w]*)/, kind: 'class' },
    { re: /^\s*(?:pub\s+)?enum\s+([A-Za-z_][\w]*)/, kind: 'type' },
  ],
  java: [
    { re: /^\s*(?:public\s+|private\s+|protected\s+|static\s+|final\s+)*class\s+([A-Za-z_][\w]*)/, kind: 'class' },
    { re: /^\s*(?:public\s+|private\s+|protected\s+|static\s+|final\s+)+[\w<>,\[\]]+\s+([A-Za-z_][\w]*)\s*\(/, kind: 'method' },
  ],
  cpp: [
    { re: /^\s*(?:class|struct)\s+([A-Za-z_][\w]*)/, kind: 'class' },
    { re: /^[\w:<>&*\s]+\s+([A-Za-z_][\w]*)\s*\([^)]*\)\s*\{?$/, kind: 'function' },
  ],
};

function buildFindRegex(query: string, opts: FindOptions): RegExp {
  const flags = opts.caseSensitive ? 'g' : 'gi';
  const source = opts.regex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(source, flags);
}

function truncateLine(line: string, maxLen: number, matchIndex?: number): string {
  if (line.length <= maxLen) return line;
  if (matchIndex === undefined) return `${line.slice(0, maxLen - 1)}…`;
  const half = Math.floor((maxLen - 1) / 2);
  const start = Math.max(0, matchIndex - half);
  const end = Math.min(line.length, matchIndex + half);
  const left = start > 0 ? '…' : '';
  const right = end < line.length ? '…' : '';
  return `${left}${line.slice(start, end)}${right}`;
}

function scoreSymbolMatch(name: string, query: string): number {
  if (!query) return 0;
  const candidate = name.toLowerCase();
  const q = query.toLowerCase();
  if (!candidate.includes(q)) return 0;
  if (candidate === q) return 1;
  if (candidate.startsWith(q)) return 0.9;
  if (candidate.toLowerCase().includes(`_${q}`)) return 0.8;
  return 0.7;
}

export async function findInFiles(
  projectDir: string,
  query: string,
  opts: FindOptions = {},
): Promise<FindHit[]> {
  if (!query) return [];
  const max = opts.maxHits ?? DEFAULT_MAX_HITS;
  const maxPreview = opts.maxPreviewLength ?? DEFAULT_MAX_PREVIEW;
  const hits: FindHit[] = [];
  let re: RegExp;
  try {
    re = buildFindRegex(query, opts);
  } catch {
    return [];
  }
  for await (const filePath of walkFiles(projectDir)) {
    if (hits.length >= max) return hits;
    try {
      const text = await readText(filePath);
      const lines = text.split('\n');
      for (let i = 0; i < lines.length; i++) {
        re.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = re.exec(lines[i])) !== null) {
          const preview = truncateLine(lines[i], maxPreview, m.index);
          hits.push({
            path: filePath,
            line: i + 1,
            col: m.index + 1,
            text: lines[i],
            preview,
          });
          if (hits.length >= max) return hits;
          if (m.index === re.lastIndex) re.lastIndex++;
        }
      }
    } catch {
      // ignore non-text/binary files
    }
  }
  return hits;
}

export async function buildFileIndex(projectDir: string): Promise<string[]> {
  const cached = fileIndexCache.get(projectDir);
  if (cached) return [...cached];
  const out: string[] = [];
  for await (const p of walkFiles(projectDir)) {
    if (out.length >= FILE_INDEX_LIMIT) break;
    out.push(p);
  }
  fileIndexCache.set(projectDir, out);
  return out;
}

export type NavigationSymbol = SearchSymbol;

export async function buildSymbolIndex(projectDir: string): Promise<NavigationSymbol[]> {
  const cached = symbolIndexCache.get(projectDir);
  if (cached) return [...cached];
  const out: NavigationSymbol[] = [];
  for await (const path of walkFiles(projectDir)) {
    if (out.length >= SYMBOL_INDEX_LIMIT) break;
    const spec = detectLanguage(path);
    if (!spec) continue;
    try {
      const text = await readText(path);
      extractSymbols(path, spec.id, text, out);
    } catch {}
  }
  out.sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line);
  symbolIndexCache.set(projectDir, out);
  return out;
}

function extractSymbols(
  path: string,
  lang: string,
  text: string,
  out: NavigationSymbol[],
): void {
  const lines = text.split('\n');
  const patterns: Array<{ re: RegExp; kind: NavigationSymbol['kind'] }> = symbolPatterns[lang] ?? [];
  for (let i = 0; i < lines.length; i++) {
    for (const { re, kind } of patterns) {
      const m = lines[i].match(re);
      if (m && m[1]) {
        const name = m[1];
        out.push({
          path,
          name,
          kind,
          line: i + 1,
          preview: lines[i].trim(),
          score: 0,
        });
      }
    }
  }
}

export function scoreSymbols(symbols: NavigationSymbol[], query: string): NavigationSymbol[] {
  const q = query.trim();
  if (!q) return symbols;
  return symbols
    .map((s) => ({ ...s, score: scoreSymbolMatch(s.name, q) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
}

export function clearSearchIndexCaches(projectDir?: string): void {
  if (projectDir) {
    fileIndexCache.delete(projectDir);
    symbolIndexCache.delete(projectDir);
    return;
  }
  fileIndexCache.clear();
  symbolIndexCache.clear();
}
