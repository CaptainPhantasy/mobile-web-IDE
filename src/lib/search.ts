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
};

export async function findInFiles(
  projectDir: string,
  query: string,
  opts: { regex?: boolean; caseSensitive?: boolean; maxHits?: number } = {},
): Promise<FindHit[]> {
  if (!query) return [];
  const max = opts.maxHits ?? 500;
  const hits: FindHit[] = [];
  const flags = opts.caseSensitive ? 'g' : 'gi';
  const re = opts.regex
    ? new RegExp(query, flags)
    : new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags);
  for await (const path of walkFiles(projectDir)) {
    try {
      const text = await readText(path);
      const lines = text.split('\n');
      for (let i = 0; i < lines.length; i++) {
        re.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = re.exec(lines[i])) !== null) {
          hits.push({ path, line: i + 1, col: m.index + 1, text: lines[i] });
          if (hits.length >= max) return hits;
          if (m.index === re.lastIndex) re.lastIndex++;
        }
      }
    } catch {
      // binary file etc
    }
  }
  return hits;
}

export async function buildFileIndex(projectDir: string): Promise<string[]> {
  const out: string[] = [];
  for await (const p of walkFiles(projectDir)) {
    out.push(p);
  }
  return out;
}

export type Symbol = {
  path: string;
  name: string;
  kind: 'function' | 'class' | 'method' | 'variable' | 'interface' | 'type';
  line: number;
};

export async function buildSymbolIndex(projectDir: string): Promise<Symbol[]> {
  const out: Symbol[] = [];
  for await (const path of walkFiles(projectDir)) {
    const spec = detectLanguage(path);
    if (!spec) continue;
    try {
      const text = await readText(path);
      extractSymbols(path, spec.id, text, out);
    } catch {}
  }
  return out;
}

function extractSymbols(
  path: string,
  lang: string,
  text: string,
  out: Symbol[],
): void {
  const lines = text.split('\n');
  const patterns: Array<{ re: RegExp; kind: Symbol['kind'] }> = [];
  if (['javascript', 'typescript', 'jsx', 'tsx'].includes(lang)) {
    patterns.push(
      { re: /^\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/, kind: 'function' },
      { re: /^\s*(?:export\s+)?class\s+([A-Za-z_$][\w$]*)/, kind: 'class' },
      { re: /^\s*(?:export\s+)?interface\s+([A-Za-z_$][\w$]*)/, kind: 'interface' },
      { re: /^\s*(?:export\s+)?type\s+([A-Za-z_$][\w$]*)/, kind: 'type' },
      { re: /^\s*(?:export\s+)?const\s+([A-Za-z_$][\w$]*)/, kind: 'variable' },
    );
  } else if (lang === 'python') {
    patterns.push(
      { re: /^\s*def\s+([A-Za-z_][\w]*)/, kind: 'function' },
      { re: /^\s*class\s+([A-Za-z_][\w]*)/, kind: 'class' },
    );
  } else if (lang === 'rust') {
    patterns.push(
      { re: /^\s*(?:pub\s+)?fn\s+([A-Za-z_][\w]*)/, kind: 'function' },
      { re: /^\s*(?:pub\s+)?struct\s+([A-Za-z_][\w]*)/, kind: 'class' },
      { re: /^\s*(?:pub\s+)?enum\s+([A-Za-z_][\w]*)/, kind: 'type' },
    );
  } else if (lang === 'java') {
    patterns.push(
      { re: /^\s*(?:public\s+|private\s+|protected\s+|static\s+|final\s+)*class\s+([A-Za-z_][\w]*)/, kind: 'class' },
      { re: /^\s*(?:public\s+|private\s+|protected\s+|static\s+|final\s+)+[\w<>,\[\]]+\s+([A-Za-z_][\w]*)\s*\(/, kind: 'method' },
    );
  } else if (lang === 'cpp') {
    patterns.push(
      { re: /^\s*(?:class|struct)\s+([A-Za-z_][\w]*)/, kind: 'class' },
      { re: /^[\w:<>&*\s]+\s+([A-Za-z_][\w]*)\s*\([^)]*\)\s*\{?$/, kind: 'function' },
    );
  }
  for (let i = 0; i < lines.length; i++) {
    for (const { re, kind } of patterns) {
      const m = lines[i].match(re);
      if (m && m[1]) {
        out.push({ path, name: m[1], kind, line: i + 1 });
      }
    }
  }
}
