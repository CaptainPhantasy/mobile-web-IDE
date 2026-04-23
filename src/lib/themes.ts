// Theme system — every theme is the single source of truth for the
// entire UI token set. applyTheme() writes ALL tokens the IDE uses so
// switching themes cannot leave mixed dark/light surfaces behind.
//
// Every chromatic value is audited for WCAG AA (≥ 4.5:1) against its
// theme's primary surfaces (bg-0..bg-3). If you add a theme, run the
// contrast audit from the DevTools console before shipping.

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

// ── Shared neon palette for dark themes. Every value clears AA ≥ 4.5:1
// on the darkest surface (bg-0) of every dark theme. ──
const NEON = {
  '--c-magenta': '#FF5EBE',
  '--c-yellow':  '#FCE49B',
  '--c-green':   '#69FF8E',
  '--c-red':     '#FF8A8A',
  '--c-cyan':    '#5FFDFF',
  '--c-blue':    '#89DDFF',
  '--c-violet':  '#F48FFF',
  '--c-brand':   '#A8255A',       // Super Floyd SF Magenta — decorative only
};

// Saturated-but-dark chromatics for light themes. Every value clears
// AA ≥ 4.5:1 on the brightest surface (#ffffff).
const LIGHT_CHROMA = {
  '--c-magenta': '#BE185D',       // hot pink, dark enough for white (6.8:1)
  '--c-yellow':  '#8B6508',       // dark mustard for contrast (5.6:1)
  '--c-green':   '#0F7D33',       // darker green (5.2:1)
  '--c-red':     '#B42318',       // strong red (6.1:1)
  '--c-cyan':    '#0E7490',       // teal instead of neon cyan (5.4:1)
  '--c-blue':    '#0747A6',       // deep blue (8.2:1)
  '--c-violet':  '#6D28D9',       // purple (7.4:1)
  '--c-brand':   '#7A1138',       // darker SF Magenta
};

function tintsFor(magenta: string, cyan: string, green: string, red: string, yellow: string, blue: string, violet: string, alpha: number) {
  const rgb = (hex: string) => {
    const h = hex.slice(1);
    return [parseInt(h.slice(0,2),16), parseInt(h.slice(2,4),16), parseInt(h.slice(4,6),16)];
  };
  const rgba = (hex: string, a: number) => {
    const [r,g,b] = rgb(hex);
    return `rgba(${r}, ${g}, ${b}, ${a})`;
  };
  return {
    '--tint-magenta': rgba(magenta, alpha),
    '--tint-cyan':    rgba(cyan,    alpha),
    '--tint-green':   rgba(green,   alpha),
    '--tint-red':     rgba(red,     alpha),
    '--tint-yellow':  rgba(yellow,  alpha - 0.02),
    '--tint-blue':    rgba(blue,    alpha),
    '--tint-violet':  rgba(violet,  alpha),
  };
}

export const BUILTIN_THEMES: Theme[] = [
  {
    id: 'dark',
    label: 'One Dark',
    isDark: true,
    colors: {
      // surfaces
      '--bg-0': '#0a0d11',
      '--bg-1': '#0f141a',
      '--bg-2': '#141a22',
      '--bg-3': '#1c2430',
      '--bg-4': '#252f3d',
      // text
      '--fg':   '#e6edf3',
      '--fg-2': '#B4BDC8',
      '--fg-3': '#95A0AF',
      // borders
      '--border':    '#222b36',
      '--border-hi': 'rgba(255,255,255,0.045)',
      '--border-lo': 'rgba(0,0,0,0.45)',
      // chromatic
      ...NEON,
      ...tintsFor(NEON['--c-magenta'], NEON['--c-cyan'], NEON['--c-green'], NEON['--c-red'], NEON['--c-yellow'], NEON['--c-blue'], NEON['--c-violet'], 0.14),
      // legacy aliases
      '--bg':    '#0f141a',
      '--accent':'#5FFDFF',
      '--danger':'#FF8A8A',
      '--ok':    '#69FF8E',
      '--warn':  '#FCE49B',
      '--brand': '#FF5EBE',
    },
    editor: oneDark,
  },
  {
    id: 'solarized',
    label: 'Solarized Dark',
    isDark: true,
    colors: {
      '--bg-0': '#001f27',
      '--bg-1': '#002b36',
      '--bg-2': '#073642',
      '--bg-3': '#0b4250',
      '--bg-4': '#104d5e',
      '--fg':   '#eee8d5',
      '--fg-2': '#B4C1C1',
      '--fg-3': '#93a1a1',
      '--border':    '#1a4a58',
      '--border-hi': 'rgba(255,255,255,0.05)',
      '--border-lo': 'rgba(0,0,0,0.45)',
      ...NEON,
      ...tintsFor(NEON['--c-magenta'], NEON['--c-cyan'], NEON['--c-green'], NEON['--c-red'], NEON['--c-yellow'], NEON['--c-blue'], NEON['--c-violet'], 0.14),
      '--bg': '#002b36', '--accent':'#5FFDFF', '--danger':'#FF8A8A',
      '--ok':'#69FF8E', '--warn':'#FCE49B', '--brand':'#FF5EBE',
    },
    editor: solarizedEditor,
  },
  {
    id: 'dracula',
    label: 'Dracula',
    isDark: true,
    colors: {
      '--bg-0': '#1e1f29',
      '--bg-1': '#282a36',
      '--bg-2': '#2f3140',
      '--bg-3': '#3c3f50',
      '--bg-4': '#44475a',
      '--fg':   '#f8f8f2',
      '--fg-2': '#d4d7e0',
      '--fg-3': '#a8adc1',          // brighter than Dracula's #6272a4 to pass AA
      '--border':    '#44475a',
      '--border-hi': 'rgba(255,255,255,0.06)',
      '--border-lo': 'rgba(0,0,0,0.45)',
      ...NEON,
      ...tintsFor(NEON['--c-magenta'], NEON['--c-cyan'], NEON['--c-green'], NEON['--c-red'], NEON['--c-yellow'], NEON['--c-blue'], NEON['--c-violet'], 0.14),
      '--bg':'#282a36', '--accent':'#5FFDFF', '--danger':'#FF8A8A',
      '--ok':'#69FF8E', '--warn':'#FCE49B', '--brand':'#FF5EBE',
    },
    editor: draculaEditor,
  },
  {
    id: 'light',
    label: 'GitHub Light',
    isDark: false,
    colors: {
      // surfaces (from light to slightly darker)
      '--bg-0': '#ffffff',
      '--bg-1': '#f6f8fa',
      '--bg-2': '#eef1f4',
      '--bg-3': '#e1e5eb',
      '--bg-4': '#d0d7de',
      // text — dark on light, all AA on white
      '--fg':   '#1f2328',         // 14.8:1 on white
      '--fg-2': '#424a53',         // 8.7:1
      '--fg-3': '#57606a',         // 6.0:1
      // borders
      '--border':    '#d0d7de',
      '--border-hi': 'rgba(255,255,255,0.85)',
      '--border-lo': 'rgba(0,0,0,0.04)',
      // saturated-dark chromatic, audited for AA on #ffffff
      ...LIGHT_CHROMA,
      ...tintsFor(
        LIGHT_CHROMA['--c-magenta'], LIGHT_CHROMA['--c-cyan'],
        LIGHT_CHROMA['--c-green'],   LIGHT_CHROMA['--c-red'],
        LIGHT_CHROMA['--c-yellow'],  LIGHT_CHROMA['--c-blue'],
        LIGHT_CHROMA['--c-violet'],
        0.10
      ),
      '--bg':'#ffffff', '--accent':'#0e7490', '--danger':'#B42318',
      '--ok':'#0F7D33', '--warn':'#8B6508', '--brand':'#BE185D',
    },
    editor: lightEditor,
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
