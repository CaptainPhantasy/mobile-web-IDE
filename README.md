# Mobile Web IDE

A fully functioning, mobile-first web IDE that runs entirely in the browser.

## Features

- **Code editor** (CodeMirror 6): syntax highlighting for JS/TS/JSX/TSX, Python, HTML, CSS, JSON, Markdown, C/C++, Java, Rust; code completion, inline diagnostics, find/replace, line wrapping, active-line, folding, bracket matching, and touch-friendly selection.
- **File explorer**: browse, create, rename, delete files and folders.
- **Virtual file system** backed by IndexedDB so projects persist across sessions.
- **Integrated terminal**: `ls`, `cd`, `cat`, `mkdir`, `rm`, `mv`, `cp`, `tree`, `grep`, `find`, `wc`, `head`, `tail`, `run`, `git ...`, `help`.
- **Debugger**: sandboxed iframe runner, breakpoints, step/continue, console output, error traces.
- **Full Git integration** via `isomorphic-git`: init, clone, stage, commit, push, pull, fetch, branch, checkout, merge, remotes, config, diff, log.
- **GitHub integration**: sign in with a Personal Access Token, browse repos, create repos, publish current project, one-click clone.
- **Google Drive integration**: OAuth sign-in (Google Identity Services), list/import/export files, whole-project sync.
- **Real-time collaboration**: join a room, share edits and cursors over WebSockets, chat with peers.
- **Project management**: create, open, delete, and switch projects; per-project task list.
- **Advanced code search & navigation**: find-in-files (regex + case-sensitive), fuzzy "Go to File", project-wide "Go to Symbol".
- **Refactoring**: rename identifier, extract selection to function, toggle line comment, format JSON/whitespace.
- **Customizable themes**: built-in One Dark, GitHub Light, Solarized Dark, Dracula, plus extension-registered themes.
- **Extensions API**: install built-in or custom JS extensions that can register commands, themes, status items, and listen to IDE events.
- **Command palette** (`⌘` button): run any command by name.

## Run Locally

**Prerequisites:** Node.js 20+

```
npm install
npm run dev
```

Then open http://localhost:3000.

## Environment

- `PORT` — server port (default 3000)
- `NODE_ENV=production` — serves the built assets from `dist/` instead of Vite dev middleware

## Architecture

| Layer | Location |
| ----- | -------- |
| Virtual FS | `src/lib/fs.ts` (LightningFS → IndexedDB) |
| KV store | `src/lib/kv.ts` (idb) |
| Git | `src/lib/git.ts` (isomorphic-git) |
| GitHub | `src/lib/github.ts` (REST v3) |
| Google Drive | `src/lib/gdrive.ts` (Drive v3 + GIS tokens) |
| Real-time collab | `src/lib/collab.ts` + server `/ws/collab` |
| Languages | `src/lib/languages.ts` (CodeMirror lang packs) |
| Themes | `src/lib/themes.ts` |
| Debugger | `src/lib/debugger.ts` (sandboxed iframe) |
| Terminal | `src/lib/terminal.ts` |
| Search/symbols | `src/lib/search.ts` |
| Refactoring | `src/lib/refactor.ts` |
| Extensions | `src/lib/extensions.ts` |

The server (`server.ts`) provides:
- `/api/health` health check
- `/api/git-proxy` CORS proxy for any HTTPS git remote (used by isomorphic-git)
- `/api/github-proxy` fallback for GitHub REST
- `/ws/collab` WebSocket room hub
