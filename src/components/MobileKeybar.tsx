// Sticky row of developer-critical keys for mobile browsers. Mobile
// virtual keyboards on iOS/Android don't expose Esc, Tab, arrow keys,
// {, }, [, ], ;, ~, |, /, -, _, $, # — every one of those takes a
// two-level touch dance.
//
// Synthetic KeyboardEvents do not cause typing in contentEditable
// elements (browsers block this for security). We therefore dispatch
// directly to CodeMirror's EditorView where available, and fall back
// to DOM-level insertion for input/textarea.

import { useEffect, useState, useCallback, PointerEvent as RPointerEvent } from 'react';
import { EditorView } from '@codemirror/view';

interface Key {
  label: string;
  /** Logical key. Arrow keys, Escape, Tab and Enter take special paths. */
  key: string;
  /** Text to insert when the key is a printable character. */
  insert?: string;
  aria?: string;
  wide?: boolean;
}

const KEYS: Key[] = [
  { label: 'esc',  key: 'Escape', aria: 'Escape', wide: true },
  { label: 'tab',  key: 'Tab',    aria: 'Tab',    wide: true },
  { label: '←',    key: 'ArrowLeft',  aria: 'Left arrow' },
  { label: '→',    key: 'ArrowRight', aria: 'Right arrow' },
  { label: '↑',    key: 'ArrowUp',    aria: 'Up arrow' },
  { label: '↓',    key: 'ArrowDown',  aria: 'Down arrow' },
  { label: '{',    key: '{', insert: '{' },
  { label: '}',    key: '}', insert: '}' },
  { label: '[',    key: '[', insert: '[' },
  { label: ']',    key: ']', insert: ']' },
  { label: '<',    key: '<', insert: '<' },
  { label: '>',    key: '>', insert: '>' },
  { label: ';',    key: ';', insert: ';' },
  { label: ':',    key: ':', insert: ':' },
  { label: '/',    key: '/', insert: '/' },
  { label: '\\',   key: '\\', insert: '\\' },
  { label: '|',    key: '|', insert: '|' },
  { label: '~',    key: '~', insert: '~' },
  { label: '`',    key: '`', insert: '`' },
  { label: '"',    key: '"', insert: '"' },
  { label: "'",    key: "'", insert: "'" },
  { label: '-',    key: '-', insert: '-' },
  { label: '_',    key: '_', insert: '_' },
  { label: '=',    key: '=', insert: '=' },
  { label: '$',    key: '$', insert: '$' },
  { label: '#',    key: '#', insert: '#' },
  { label: '&',    key: '&', insert: '&' },
  { label: '*',    key: '*', insert: '*' },
];

function isMobileTouch(): boolean {
  try {
    if (import.meta.env.DEV) {
      if (new URLSearchParams(location.search).get('keybar') === 'force') return true;
      if ((window as unknown as { __forceKeybar?: boolean }).__forceKeybar) return true;
    }
    const narrow = window.matchMedia('(max-width: 860px)').matches;
    const touch = 'ontouchstart' in window ||
      (navigator as Navigator & { maxTouchPoints?: number }).maxTouchPoints! > 0;
    return narrow && touch;
  } catch {
    return false;
  }
}

/** Locate the last-focused CodeMirror EditorView. `activeElement` lands
 *  inside `.cm-content`; its ancestor `.cm-editor` is what findFromDOM
 *  understands. */
function focusedEditor(): EditorView | null {
  const active = document.activeElement as HTMLElement | null;
  const editorEl = (active?.closest?.('.cm-editor') as HTMLElement | null)
    || (document.querySelector('.editor-host .cm-editor') as HTMLElement | null);
  if (!editorEl) return null;
  return EditorView.findFromDOM(editorEl) ?? null;
}

function applyKeyToEditor(view: EditorView, k: Key): boolean {
  const state = view.state;
  const main = state.selection.main;

  if (k.insert) {
    view.dispatch({
      changes: { from: main.from, to: main.to, insert: k.insert },
      selection: { anchor: main.from + k.insert.length },
      scrollIntoView: true,
      userEvent: 'input.type',
    });
    return true;
  }
  switch (k.key) {
    case 'Tab': {
      const indent = '  ';
      view.dispatch({
        changes: { from: main.from, to: main.to, insert: indent },
        selection: { anchor: main.from + indent.length },
        scrollIntoView: true,
        userEvent: 'input',
      });
      return true;
    }
    case 'Escape': {
      view.contentDOM.blur();
      return true;
    }
    case 'ArrowLeft': {
      const next = Math.max(0, main.head - 1);
      view.dispatch({ selection: { anchor: next }, scrollIntoView: true });
      return true;
    }
    case 'ArrowRight': {
      const next = Math.min(state.doc.length, main.head + 1);
      view.dispatch({ selection: { anchor: next }, scrollIntoView: true });
      return true;
    }
    case 'ArrowUp':
    case 'ArrowDown': {
      const line = state.doc.lineAt(main.head);
      const col = main.head - line.from;
      const targetLine = k.key === 'ArrowUp' ? line.number - 1 : line.number + 1;
      if (targetLine < 1 || targetLine > state.doc.lines) return true;
      const t = state.doc.line(targetLine);
      const anchor = Math.min(t.from + col, t.to);
      view.dispatch({ selection: { anchor }, scrollIntoView: true });
      return true;
    }
  }
  return false;
}

function insertIntoActiveInput(k: Key): boolean {
  const target = document.activeElement;
  if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) {
    return false;
  }
  const el = target;
  const start = el.selectionStart ?? el.value.length;
  const end = el.selectionEnd ?? el.value.length;
  if (k.insert) {
    el.value = el.value.slice(0, start) + k.insert + el.value.slice(end);
    el.selectionStart = el.selectionEnd = start + k.insert.length;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  }
  if (k.key === 'ArrowLeft') { el.selectionStart = el.selectionEnd = Math.max(0, start - 1); return true; }
  if (k.key === 'ArrowRight') { const n = Math.min(el.value.length, start + 1); el.selectionStart = el.selectionEnd = n; return true; }
  if (k.key === 'Tab') {
    const tab = '  ';
    el.value = el.value.slice(0, start) + tab + el.value.slice(end);
    el.selectionStart = el.selectionEnd = start + tab.length;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  }
  if (k.key === 'Escape') { el.blur(); return true; }
  return false;
}

export default function MobileKeybar() {
  const [visible, setVisible] = useState<boolean>(() => isMobileTouch());
  const [bottom, setBottom] = useState(0);

  useEffect(() => {
    const onResize = () => setVisible(isMobileTouch());
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
    };
  }, []);

  useEffect(() => {
    if (!visible) return;
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => {
      const offset = Math.max(0, window.innerHeight - (vv.height + vv.offsetTop));
      setBottom(offset);
    };
    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
    };
  }, [visible]);

  const onKey = useCallback((e: RPointerEvent<HTMLButtonElement>, k: Key) => {
    e.preventDefault(); // keep focus on the editor / input
    const view = focusedEditor();
    if (view) {
      if (applyKeyToEditor(view, k)) return;
    }
    insertIntoActiveInput(k);
  }, []);

  if (!visible) return null;

  return (
    <div
      className="mobile-keybar"
      role="toolbar"
      aria-label="Mobile developer keys"
      style={{ bottom }}
    >
      {KEYS.map((k, i) => (
        <button
          key={i}
          className={'mk-key' + (k.wide ? ' mk-key-wide' : '')}
          aria-label={k.aria || k.label}
          onPointerDown={(e) => onKey(e, k)}
          onMouseDown={(e) => e.preventDefault()}
        >
          {k.label}
        </button>
      ))}
    </div>
  );
}
