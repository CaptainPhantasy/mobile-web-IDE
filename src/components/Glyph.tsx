import { G, GlyphName } from '../lib/glyphs';

interface GlyphProps {
  name: GlyphName;
  color?: string;
  size?: number | string;
  title?: string;
  className?: string;
}

/** A Nerd Font glyph rendered as text. No SVG, no library payload.
 *  Baseline-aligned with surrounding monospace by definition. */
export function Glyph({ name, color, size, title, className }: GlyphProps) {
  return (
    <span
      className={'nf ' + (className || '')}
      aria-hidden={title ? undefined : true}
      title={title}
      style={{
        color,
        fontSize: typeof size === 'number' ? size + 'px' : size,
        fontFamily: 'var(--mono-glyph)',
        lineHeight: 1,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        minWidth: '1.1em',
        fontVariantLigatures: 'none',
      }}
    >
      {G[name]}
    </span>
  );
}
