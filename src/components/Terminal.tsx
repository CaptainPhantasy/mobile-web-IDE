// Integrated terminal UI.
// Keeps a scroll-back buffer and command history (ArrowUp/Down),
// forwards each line to lib/terminal runCommand().

import { useEffect, useRef, useState } from 'react';
import { runCommand, TerminalContext } from '../lib/terminal';

type Props = {
  projectDir: string;
  author: { name: string; email: string };
  onRun?: (path: string) => void;
};

type Line = { who: 'sys' | 'in' | 'out'; text: string };

export default function Terminal({ projectDir, author, onRun }: Props) {
  const [lines, setLines] = useState<Line[]>([
    { who: 'sys', text: 'Web IDE terminal. Type "help" for a list of commands.' },
  ]);
  const [cwd, setCwd] = useState(projectDir);
  const [history, setHistory] = useState<string[]>([]);
  const [histIdx, setHistIdx] = useState<number>(-1);
  const [input, setInput] = useState('');
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [lines]);

  useEffect(() => {
    setCwd(projectDir);
  }, [projectDir]);

  async function submit() {
    const line = input;
    setLines((l) => [...l, { who: 'in', text: `${prompt(cwd)} ${line}` }]);
    setInput('');
    setHistory((h) => [...h, line].slice(-200));
    setHistIdx(-1);
    const ctx: TerminalContext = { cwd, projectDir, author, onRun };
    const { output, cwd: nextCwd } = await runCommand(line, ctx);
    if (output === '\x1bCLEAR') {
      setLines([]);
    } else if (output) {
      setLines((l) => [...l, { who: 'out', text: output }]);
    }
    setCwd(nextCwd);
  }

  function prompt(wd: string): string {
    const rel = wd.replace(projectDir, '') || '/';
    return `${rel} $`;
  }

  return (
    <div className="terminal">
      <div className="terminal-log">
        {lines.map((l, i) => (
          <pre key={i} className={'term-line term-' + l.who}>
            {l.text}
          </pre>
        ))}
        <div ref={endRef} />
      </div>
      <div className="terminal-input">
        <span className="term-prompt">{prompt(cwd)}</span>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit();
            else if (e.key === 'ArrowUp') {
              if (history.length === 0) return;
              const next = histIdx < 0 ? history.length - 1 : Math.max(0, histIdx - 1);
              setHistIdx(next);
              setInput(history[next]);
            } else if (e.key === 'ArrowDown') {
              if (histIdx < 0) return;
              const next = histIdx + 1;
              if (next >= history.length) {
                setHistIdx(-1);
                setInput('');
              } else {
                setHistIdx(next);
                setInput(history[next]);
              }
            }
          }}
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
        />
      </div>
    </div>
  );
}
