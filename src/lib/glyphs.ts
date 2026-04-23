// Nerd Font glyph codepoints used across the IDE.
// All glyphs live in Private Use Area — @font-face in fonts.css ensures
// they render in SymbolsNerdFontMono regardless of the surrounding font.
//
// Reference: https://www.nerdfonts.com/cheat-sheet
// Names are intention-first, not visual.

export const G = {
  // Activity bar
  files:       '',  // nf-fa-folder
  folder_open: '',  // nf-fa-folder_open
  search:      '',  // nf-fa-search
  git:         '',  // nf-dev-git_branch
  debug:       '',  // nf-fa-share_alt
  drive:       '',  // nf-fa-cloud
  ext:         '',  // nf-fa-plug
  projects:    '',  // nf-fa-book
  collab:      '',  // nf-fa-users
  ai:          '',  // nf-mdi-robot

  // Topbar / chrome
  menu:       '',  // nf-fa-bars
  palette:    '',  // nf-fa-terminal
  bottom:     '',  // nf-oct-terminal
  save:       '',  // nf-fa-save
  close:      '',  // nf-fa-times
  chevron_dn: '',  // nf-fa-angle_down
  chevron_up: '',  // nf-fa-angle_up
  chevron_rt: '',  // nf-fa-angle_right
  dot:        '',  // nf-oct-dot_fill
  circle:     '',  // nf-fa-circle
  plus:       '',  // nf-fa-plus
  pencil:     '',  // nf-fa-pencil
  trash:      '',  // nf-fa-trash
  arrow_left: '',  // nf-fa-arrow_left
  send:       '',  // nf-fa-paper_plane

  // File extensions (file tree)
  file_ts:    '',
  file_js:    '',
  file_jsx:   '',
  file_tsx:   '',
  file_py:    '',
  file_rs:    '',
  file_go:    '',
  file_java:  '',
  file_cpp:   '',
  file_c:     '',
  file_html:  '',
  file_css:   '',
  file_json:  '',
  file_md:    '',
  file_yml:   '',
  file_sh:    '',
  file_txt:   '',
  file_lock:  '',
  file_env:   '',
  file_git:   '',
  file_pkg:   '',
  file_generic: '',

  // Git
  branch:     '',
  commit:     '',
  diff_add:   '',
  diff_del:   '',
  diff_mod:   '',

  // Status
  ok:         '',
  err:        '',
  warn:       '',
  info:       '',
  spinner:    '',
  bolt:       '',
  eye:        '',
  rocket:     '',
  terminal:   '',

  // Brand monogram
  brand_l:    '',
} as const;

export type GlyphName = keyof typeof G;

export function glyphForFile(path: string): string {
  const name = path.split('/').pop() || '';
  const lower = name.toLowerCase();
  if (lower === 'package.json') return G.file_pkg;
  if (lower.startsWith('.env')) return G.file_env;
  if (lower === '.gitignore' || lower.startsWith('.git')) return G.file_git;
  const ext = lower.includes('.') ? lower.split('.').pop()! : '';
  switch (ext) {
    case 'ts': return G.file_ts;
    case 'tsx': return G.file_tsx;
    case 'js': case 'mjs': case 'cjs': return G.file_js;
    case 'jsx': return G.file_jsx;
    case 'py': return G.file_py;
    case 'rs': return G.file_rs;
    case 'go': return G.file_go;
    case 'java': return G.file_java;
    case 'cpp': case 'cc': case 'cxx': case 'hpp': case 'h': return G.file_cpp;
    case 'c': return G.file_c;
    case 'html': case 'htm': return G.file_html;
    case 'css': case 'scss': case 'sass': case 'less': return G.file_css;
    case 'json': return G.file_json;
    case 'md': case 'mdx': return G.file_md;
    case 'yml': case 'yaml': case 'toml': return G.file_yml;
    case 'sh': case 'zsh': case 'bash': return G.file_sh;
    case 'txt': case 'log': return G.file_txt;
    case 'lock': return G.file_lock;
    default: return G.file_generic;
  }
}

export function colorForFile(path: string): string {
  const name = (path.split('/').pop() || '').toLowerCase();
  if (name === 'package.json') return 'var(--c-red)';
  if (name.startsWith('.env')) return 'var(--c-yellow)';
  if (name.startsWith('.git')) return 'var(--c-magenta)';
  const ext = name.includes('.') ? name.split('.').pop()! : '';
  switch (ext) {
    case 'ts': case 'tsx': return 'var(--c-blue)';
    case 'js': case 'jsx': case 'mjs': case 'cjs': return 'var(--c-yellow)';
    case 'py': return 'var(--c-yellow)';
    case 'rs': return '#dea584';
    case 'go': return 'var(--c-cyan)';
    case 'java': return 'var(--c-red)';
    case 'cpp': case 'cc': case 'c': case 'hpp': case 'h': return 'var(--c-blue)';
    case 'html': case 'htm': return 'var(--c-red)';
    case 'css': case 'scss': return 'var(--c-violet)';
    case 'json': return 'var(--c-yellow)';
    case 'md': case 'mdx': return 'var(--c-cyan)';
    case 'yml': case 'yaml': case 'toml': return 'var(--c-violet)';
    case 'sh': case 'zsh': case 'bash': return 'var(--c-green)';
    default: return 'var(--fg-2)';
  }
}
