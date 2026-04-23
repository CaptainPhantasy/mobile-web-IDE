// Panel-scoped error boundary. Catches render and lifecycle errors
// inside its children, shows a compact copy-trace + reload card in
// the panel's own slot, and leaves the rest of the IDE alive.
//
// 2026 note: React 19 added `onCaughtError` / `onUncaughtError` at the
// root, but per-component recovery still requires a class boundary.
// No `useErrorBoundary` equivalent in core React yet.

import { Component, ErrorInfo, ReactNode } from 'react';
import { Glyph } from './Glyph';

interface Props {
  /** Short human-readable scope label, e.g. "Editor", "Git panel". */
  label: string;
  /** Reset key: when this value changes, the boundary clears its error
   *  state. Useful for resetting on active-panel switch. */
  resetKey?: unknown;
  children: ReactNode;
}

interface State {
  error: Error | null;
  info: ErrorInfo | null;
  incarnation: number;
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, info: null, incarnation: 0 };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidUpdate(prevProps: Props) {
    if (prevProps.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null, info: null });
    }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Keep this visible in DevTools — useful when diagnosing a panel
    // that's crashing repeatedly.
    // eslint-disable-next-line no-console
    console.error('[ErrorBoundary:' + this.props.label + ']', error, info);
    this.setState({ info });
  }

  private copyTrace = async (): Promise<void> => {
    const { error, info } = this.state;
    if (!error) return;
    const trace =
      `${this.props.label}\n` +
      `${error.name}: ${error.message}\n` +
      (error.stack ? error.stack + '\n' : '') +
      (info?.componentStack ? 'Component stack:' + info.componentStack : '');
    try {
      await navigator.clipboard.writeText(trace);
    } catch {
      // Clipboard not available (e.g. http:// non-secure context). Fall
      // back to a hidden textarea so the user can still copy.
      const ta = document.createElement('textarea');
      ta.value = trace;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); } finally { document.body.removeChild(ta); }
    }
  };

  private reload = (): void => {
    this.setState(({ incarnation }) => ({
      error: null,
      info: null,
      incarnation: incarnation + 1,
    }));
  };

  render(): ReactNode {
    const { error } = this.state;
    if (error) {
      return (
        <div className="err-card" role="alert">
          <div className="err-card-head">
            <Glyph name="err" />
            <span>{this.props.label} crashed</span>
          </div>
          <div className="err-card-msg">{error.name}: {error.message}</div>
          <div className="err-card-actions">
            <button onClick={this.copyTrace} title="Copy trace to clipboard">
              <Glyph name="palette" /> copy trace
            </button>
            <button onClick={this.reload} title="Reload this panel">
              <Glyph name="rocket" /> reload panel
            </button>
          </div>
          <details className="err-card-details">
            <summary>stack trace</summary>
            <pre>{error.stack || '(no stack)'}</pre>
          </details>
        </div>
      );
    }
    // `incarnation` keyed on the subtree remounts it after `reload()`.
    return (
      <div key={this.state.incarnation} style={{ display: 'contents' }}>
        {this.props.children}
      </div>
    );
  }
}
