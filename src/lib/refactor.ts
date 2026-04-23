// Lightweight refactoring tools that operate purely as text
// transformations. They support the most common mobile IDE tasks
// without requiring a full language server:
//   - rename identifier within the current file (word-boundary aware)
//   - extract the current selection into a new top-level function
//   - toggle line comment
//   - reformat JSON / format helpers
//
// These are intentionally small, deterministic operations so they can
// be offered as single-tap commands on mobile.

import { EditorView } from '@codemirror/view';

export function renameIdentifier(
  source: string,
  oldName: string,
  newName: string,
): string {
  if (!oldName) return source;
  const re = new RegExp(`(?<![A-Za-z0-9_$])${escape(oldName)}(?![A-Za-z0-9_$])`, 'g');
  return source.replace(re, newName);
}

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function extractToFunction(
  view: EditorView,
  functionName: string,
): void {
  const { state } = view;
  const sel = state.selection.main;
  if (sel.empty) return;
  const selected = state.sliceDoc(sel.from, sel.to);
  const indent = detectIndent(selected);
  const body = selected
    .split('\n')
    .map((l) => (l.startsWith(indent) ? l.slice(indent.length) : l))
    .join('\n');
  const fnText = `\nfunction ${functionName}() {\n${body
    .split('\n')
    .map((l) => '  ' + l)
    .join('\n')}\n}\n`;
  view.dispatch({
    changes: [
      { from: sel.from, to: sel.to, insert: `${functionName}();` },
      { from: state.doc.length, to: state.doc.length, insert: fnText },
    ],
  });
}

function detectIndent(block: string): string {
  const lines = block.split('\n').filter((l) => l.trim().length > 0);
  if (!lines.length) return '';
  let min = Infinity;
  for (const l of lines) {
    const m = l.match(/^[ \t]*/);
    if (m) min = Math.min(min, m[0].length);
  }
  return ' '.repeat(min === Infinity ? 0 : min);
}

export function toggleLineComment(view: EditorView, prefix = '// '): void {
  const { state } = view;
  const lines = state.doc.toString().split('\n');
  const sel = state.selection.main;
  let pos = 0;
  const changes: { from: number; to: number; insert: string }[] = [];
  for (let i = 0; i < lines.length; i++) {
    const len = lines[i].length;
    const lineStart = pos;
    const lineEnd = pos + len;
    if (lineEnd >= sel.from && lineStart <= sel.to) {
      const trimmed = lines[i].trimStart();
      const indent = lines[i].slice(0, lines[i].length - trimmed.length);
      if (trimmed.startsWith(prefix)) {
        const rel = indent.length;
        changes.push({
          from: lineStart + rel,
          to: lineStart + rel + prefix.length,
          insert: '',
        });
      } else if (trimmed.length) {
        changes.push({
          from: lineStart + indent.length,
          to: lineStart + indent.length,
          insert: prefix,
        });
      }
    }
    pos += len + 1;
  }
  if (changes.length) view.dispatch({ changes });
}

export function formatJson(source: string, spaces = 2): string {
  try {
    return JSON.stringify(JSON.parse(source), null, spaces);
  } catch {
    return source;
  }
}

// Very simple whitespace normalizer used for non-JSON files so the
// "Format" button always does something useful.
export function normalizeWhitespace(source: string): string {
  return source
    .replace(/[ \t]+$/gm, '') // trim trailing ws
    .replace(/\r\n?/g, '\n')
    .replace(/\n{3,}/g, '\n\n');
}
