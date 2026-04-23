// CodeMirror-6 based editor wrapper.
//
// Features wired here:
//   - Language-aware syntax highlighting (lib/languages.ts)
//   - Code completion (autocompletion; language + word-based)
//   - Project-wide symbol completion
//   - Search / replace (searchKeymap + openSearchPanel)
//   - Linting (generic diagnostics from lint extension)
//   - Line numbers, active-line highlight, folding
//   - Mobile-friendly keymap + touch selection support
//   - Theme switching (one-dark / light / solarized / dracula)
//   - onCursorChange / onChange callbacks for collab + status bar

import { useEffect, useRef } from 'react';
import {
  EditorView,
  keymap,
  highlightActiveLine,
  highlightActiveLineGutter,
  lineNumbers,
  drawSelection,
  rectangularSelection,
  crosshairCursor,
  dropCursor,
} from '@codemirror/view';
import {
  EditorState,
  Compartment,
  Extension,
  StateEffect,
} from '@codemirror/state';
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from '@codemirror/commands';
import {
  bracketMatching,
  foldGutter,
  foldKeymap,
  indentOnInput,
  indentUnit,
} from '@codemirror/language';
import {
  autocompletion,
  completionKeymap,
  CompletionContext,
  CompletionResult,
} from '@codemirror/autocomplete';
import {
  searchKeymap,
  highlightSelectionMatches,
  openSearchPanel,
} from '@codemirror/search';
import { lintKeymap, linter, Diagnostic } from '@codemirror/lint';
import { languageExtensions } from '../lib/languages';
import { Theme } from '../lib/themes';

export type EditorHandle = {
  setDoc: (doc: string) => void;
  getDoc: () => string;
  setTheme: (theme: Theme) => void;
  openSearch: () => void;
  focus: () => void;
  view: () => EditorView | undefined;
};

type Props = {
  path: string;
  initialDoc: string;
  theme: Theme;
  onChange?: (doc: string) => void;
  onCursor?: (line: number, col: number) => void;
  extraCompletions?: (ctx: CompletionContext) => CompletionResult | null;
  onRef?: (h: EditorHandle) => void;
};

function buildLinter(path: string): Extension {
  return linter((view) => {
    const diagnostics: Diagnostic[] = [];
    const text = view.state.doc.toString();
    // JSON lint
    if (path.endsWith('.json')) {
      try {
        JSON.parse(text);
      } catch (err: any) {
        diagnostics.push({
          from: 0,
          to: Math.min(text.length, 1),
          severity: 'error',
          message: 'JSON parse error: ' + err.message,
        });
      }
    }
    // Simple todo/fixme hints for any language
    const re = /\b(TODO|FIXME|XXX)\b/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      diagnostics.push({
        from: m.index,
        to: m.index + m[0].length,
        severity: 'info',
        message: m[0] + ' marker',
      });
    }
    return diagnostics;
  });
}

function wordCompletions(context: CompletionContext): CompletionResult | null {
  const word = context.matchBefore(/[A-Za-z_$][A-Za-z0-9_$]*/);
  if (!word || (word.from === word.to && !context.explicit)) return null;
  const text = context.state.doc.toString();
  const set = new Set<string>();
  const re = /[A-Za-z_$][A-Za-z0-9_$]{2,}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) set.add(m[0]);
  set.delete(word.text);
  const options = Array.from(set)
    .slice(0, 200)
    .map((label) => ({ label, type: 'text' }));
  return { from: word.from, options, validFor: /^[A-Za-z0-9_$]*$/ };
}

export default function CodeEditor(props: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | undefined>(undefined);
  const themeCompartment = useRef(new Compartment());
  const langCompartment = useRef(new Compartment());
  const lintCompartment = useRef(new Compartment());
  const lastPath = useRef(props.path);

  useEffect(() => {
    if (!hostRef.current) return;
    const state = EditorState.create({
      doc: props.initialDoc,
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        highlightActiveLine(),
        drawSelection(),
        dropCursor(),
        rectangularSelection(),
        crosshairCursor(),
        history(),
        foldGutter(),
        bracketMatching(),
        indentOnInput(),
        indentUnit.of('  '),
        highlightSelectionMatches(),
        autocompletion({
          override: props.extraCompletions
            ? [wordCompletions, props.extraCompletions]
            : [wordCompletions],
          activateOnTyping: true,
        }),
        EditorView.lineWrapping,
        EditorState.tabSize.of(2),
        keymap.of([
          ...defaultKeymap,
          ...historyKeymap,
          ...searchKeymap,
          ...completionKeymap,
          ...foldKeymap,
          ...lintKeymap,
          indentWithTab,
        ]),
        themeCompartment.current.of(props.theme.editor),
        langCompartment.current.of(languageExtensions(props.path)),
        lintCompartment.current.of(buildLinter(props.path)),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) props.onChange?.(u.state.doc.toString());
          if (u.selectionSet || u.docChanged) {
            const sel = u.state.selection.main.head;
            const line = u.state.doc.lineAt(sel);
            props.onCursor?.(line.number, sel - line.from + 1);
          }
        }),
      ],
    });
    const view = new EditorView({ state, parent: hostRef.current });
    viewRef.current = view;

    const handle: EditorHandle = {
      setDoc: (doc: string) => {
        view.dispatch({
          changes: { from: 0, to: view.state.doc.length, insert: doc },
        });
      },
      getDoc: () => view.state.doc.toString(),
      setTheme: (theme: Theme) => {
        view.dispatch({
          effects: themeCompartment.current.reconfigure(theme.editor),
        });
      },
      openSearch: () => openSearchPanel(view),
      focus: () => view.focus(),
      view: () => view,
    };
    props.onRef?.(handle);

    return () => {
      view.destroy();
      viewRef.current = undefined;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reconfigure language/lint when path changes.
  useEffect(() => {
    if (!viewRef.current) return;
    if (lastPath.current !== props.path) {
      viewRef.current.dispatch({
        effects: [
          langCompartment.current.reconfigure(languageExtensions(props.path)),
          lintCompartment.current.reconfigure(buildLinter(props.path)),
        ],
      });
      lastPath.current = props.path;
    }
  }, [props.path]);

  // Reconfigure theme when it changes.
  useEffect(() => {
    if (!viewRef.current) return;
    viewRef.current.dispatch({
      effects: themeCompartment.current.reconfigure(props.theme.editor),
    });
  }, [props.theme]);

  return <div ref={hostRef} className="editor-host" data-path={props.path} />;
}

export { StateEffect };
