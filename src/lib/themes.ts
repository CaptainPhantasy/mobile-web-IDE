// Theme system — provides editor and UI theme bundles that can be
// switched at runtime. The set is extensible; extensions may register
// additional themes through the extensions API.

import { Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { oneDark } from '@codemirror/theme-one-dark';

export type Theme = {
  id: string;
  label: string;
  isDark: boolean;
  colors: Record<string, string>;
  editor: Extension;
};

const lightEditor: Extension = EditorView.theme(
  {
    '&': { backgroundColor: '#ffffff', color: '#1f2328' },
    '.cm-gutters': { backgroundColor: '#f6f8fa', color: '#57606a', border: 'none' },
    '.cm-activeLine': { backgroundColor: '#eef4ff' },
    '.cm-selectionBackground, ::selection': { backgroundColor: '#cfe8ff' },
    '.cm-cursor': { borderLeftColor: '#0969da' },
    '.cm-tooltip': {
      backgroundColor: '#ffffff',
      border: '1px solid #d0d7de',
      color: '#1f2328',
    },
  },
  { dark: false },
);

const solarizedEditor: Extension = EditorView.theme(
  {
    '&': { backgroundColor: '#002b36', color: '#93a1a1' },
    '.cm-gutters': { backgroundColor: '#073642', color: '#586e75', border: 'none' },
    '.cm-activeLine': { backgroundColor: '#073642' },
    '.cm-selectionBackground, ::selection': { backgroundColor: '#274642' },
    '.cm-cursor': { borderLeftColor: '#93a1a1' },
  },
  { dark: true },
);

const draculaEditor: Extension = EditorView.theme(
  {
    '&': { backgroundColor: '#282a36', color: '#f8f8f2' },
    '.cm-gutters': { backgroundColor: '#21222c', color: '#6272a4', border: 'none' },
    '.cm-activeLine': { backgroundColor: '#44475a' },
    '.cm-selectionBackground, ::selection': { backgroundColor: '#44475a' },
    '.cm-cursor': { borderLeftColor: '#f8f8f2' },
  },
  { dark: true },
);

export const BUILTIN_THEMES: Theme[] = [
  {
    id: 'dark',
    label: 'One Dark',
    isDark: true,
    colors: {
      '--bg': '#0d1117',
      '--bg-2': '#161b22',
      '--bg-3': '#21262d',
      '--fg': '#e6edf3',
      '--fg-2': '#9198a1',
      '--accent': '#2f81f7',
      '--border': '#30363d',
      '--danger': '#f85149',
      '--ok': '#3fb950',
    },
    editor: oneDark,
  },
  {
    id: 'light',
    label: 'GitHub Light',
    isDark: false,
    colors: {
      '--bg': '#ffffff',
      '--bg-2': '#f6f8fa',
      '--bg-3': '#eaeef2',
      '--fg': '#1f2328',
      '--fg-2': '#57606a',
      '--accent': '#0969da',
      '--border': '#d0d7de',
      '--danger': '#cf222e',
      '--ok': '#1a7f37',
    },
    editor: lightEditor,
  },
  {
    id: 'solarized',
    label: 'Solarized Dark',
    isDark: true,
    colors: {
      '--bg': '#002b36',
      '--bg-2': '#073642',
      '--bg-3': '#0b4250',
      '--fg': '#eee8d5',
      '--fg-2': '#93a1a1',
      '--accent': '#268bd2',
      '--border': '#586e75',
      '--danger': '#dc322f',
      '--ok': '#859900',
    },
    editor: solarizedEditor,
  },
  {
    id: 'dracula',
    label: 'Dracula',
    isDark: true,
    colors: {
      '--bg': '#282a36',
      '--bg-2': '#1e1f29',
      '--bg-3': '#44475a',
      '--fg': '#f8f8f2',
      '--fg-2': '#bd93f9',
      '--accent': '#ff79c6',
      '--border': '#44475a',
      '--danger': '#ff5555',
      '--ok': '#50fa7b',
    },
    editor: draculaEditor,
  },
];

export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  for (const [k, v] of Object.entries(theme.colors)) {
    root.style.setProperty(k, v);
  }
  root.dataset.theme = theme.id;
  root.dataset.themeMode = theme.isDark ? 'dark' : 'light';
}
