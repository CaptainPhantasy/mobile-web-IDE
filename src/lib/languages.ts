// Language registry for syntax highlighting, file-type detection and
// language-aware features (autocompletion sources, lint runners, etc.).
//
// The registry associates file extensions with CodeMirror language
// packs. Unknown extensions fall back to plain text.

import { Extension } from '@codemirror/state';
import { javascript } from '@codemirror/lang-javascript';
import { python } from '@codemirror/lang-python';
import { html } from '@codemirror/lang-html';
import { css } from '@codemirror/lang-css';
import { json } from '@codemirror/lang-json';
import { markdown } from '@codemirror/lang-markdown';
import { cpp } from '@codemirror/lang-cpp';
import { java } from '@codemirror/lang-java';
import { rust } from '@codemirror/lang-rust';

export type LangSpec = {
  id: string;
  label: string;
  extensions: string[];
  build: () => Extension;
};

export const LANGS: LangSpec[] = [
  {
    id: 'javascript',
    label: 'JavaScript',
    extensions: ['.js', '.mjs', '.cjs'],
    build: () => javascript(),
  },
  {
    id: 'jsx',
    label: 'JavaScript (JSX)',
    extensions: ['.jsx'],
    build: () => javascript({ jsx: true }),
  },
  {
    id: 'typescript',
    label: 'TypeScript',
    extensions: ['.ts'],
    build: () => javascript({ typescript: true }),
  },
  {
    id: 'tsx',
    label: 'TypeScript (TSX)',
    extensions: ['.tsx'],
    build: () => javascript({ typescript: true, jsx: true }),
  },
  { id: 'python', label: 'Python', extensions: ['.py'], build: () => python() },
  {
    id: 'html',
    label: 'HTML',
    extensions: ['.html', '.htm'],
    build: () => html(),
  },
  { id: 'css', label: 'CSS', extensions: ['.css', '.scss', '.less'], build: () => css() },
  { id: 'json', label: 'JSON', extensions: ['.json'], build: () => json() },
  {
    id: 'markdown',
    label: 'Markdown',
    extensions: ['.md', '.markdown'],
    build: () => markdown(),
  },
  {
    id: 'cpp',
    label: 'C/C++',
    extensions: ['.c', '.cpp', '.cc', '.h', '.hpp'],
    build: () => cpp(),
  },
  { id: 'java', label: 'Java', extensions: ['.java'], build: () => java() },
  { id: 'rust', label: 'Rust', extensions: ['.rs'], build: () => rust() },
];

export function detectLanguage(path: string): LangSpec | undefined {
  const lower = path.toLowerCase();
  for (const spec of LANGS) {
    for (const ext of spec.extensions) {
      if (lower.endsWith(ext)) return spec;
    }
  }
  return undefined;
}

export function languageExtensions(path: string): Extension[] {
  const spec = detectLanguage(path);
  return spec ? [spec.build()] : [];
}
