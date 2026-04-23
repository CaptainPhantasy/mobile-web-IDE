// Theme picker. Lists built-in + extension-contributed themes.

import { Theme } from '../lib/themes';

type Props = {
  themes: Theme[];
  current: string;
  onPick: (theme: Theme) => void;
};

export default function ThemePicker({ themes, current, onPick }: Props) {
  return (
    <div className="theme-picker">
      {themes.map((t) => (
        <button
          key={t.id}
          className={'theme-chip ' + (t.id === current ? 'active' : '')}
          onClick={() => onPick(t)}
        >
          <span className="swatch" style={{ background: t.colors['--bg'] }} />
          <span className="swatch" style={{ background: t.colors['--accent'] }} />
          {t.label}
        </button>
      ))}
    </div>
  );
}
