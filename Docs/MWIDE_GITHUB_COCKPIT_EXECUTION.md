# MWIDE → iPad Operations Cockpit — Execution Document (FINAL)

> Source of truth for the cockpit build. Authority: `Docs/Refactor.md` (reconciled prompt) +
> Douglas's three-vertical directive. Companion artifacts: `Docs/MWIDE_THREE_VERTICAL_UX_RESEARCH.md`
> (evidence) and `skill://three-vertical-device-standard` (TVDS, the durable standard).
>
> Status legend: `[ ]` not started · `[~]` in progress · `[x]` complete.

## 1. Objective
Add an authenticated, multi-device **operations cockpit** to the Mobile Web IDE that controls
local repos, GitHub state, allowlisted shell actions, tests, lint, build, and terminal access —
without removing any existing IDE/Git/GitHub/FS/terminal/vault/LLM/collab capability, and without
exposing secrets or allowing arbitrary command execution. Per the standing directive, the cockpit
client is delivered as **three purpose-built device verticals** (mobile / tablet / desktop), NOT
one responsive layout. The backend is device-agnostic and built once.

## 2. Existing system inventory (verified 2026-06-22 against this checkout)
- Working dir `/Volumes/SanDisk1Tb/MWIDE/mobile-web-IDE`; remote `CaptainPhantasy/mobile-web-IDE`; branch `feat/mwide-7-features`; FS CASE-INSENSITIVE (`docs/`==`Docs/`).
- Server entrypoint `server.ts` at root (no `server/` dir previously); PTY hub `pty-hub.ts` at root. Express 4. WS `/ws/pty` + `/ws/collab`. PTY `open` message already accepts `cwd`; `<Terminal projectDir=…/>` passes it (TerminalPane.tsx:156).
- Client: `src/main.tsx` → `src/App.tsx`; NO router library (navigation is internal state). Vite `base:'/mwide/'` → cockpit routing is HASH-based. API calls absolute `/api/...`. Tailwind v4, React 19, Node v26.
- Scripts: `dev`/`start`=`tsx server.ts`, `build`=`vite build`, `lint`=`tsc --noEmit` (the only typecheck). `tsconfig` is NON-strict.

## 3. Target architecture (as built)
- **Server (`server/cockpit/`):** `types.ts`, `repo-registry.ts` (config load+validate+allowlist), `auth.ts` (token middleware), `action-runner.ts` (safe `spawn`), `git-status.ts`, `audit-log.ts` (JSONL), `github-service.ts` (REST, no Octokit), `router.ts`. Mounted in `server.ts` via `app.use('/api/cockpit', createCockpitRouter())`.
- **Client shared logic (`src/cockpit/`):** `types.ts`, `device.ts` (capability-first classifier + override), `router.ts` (hash routes), `api.ts` (typed envelope client), `state.ts` (data hooks + `refreshCockpit`), `confirm.ts` (arm→confirm), `format.ts` (+ shared kind tokens), `haptics.ts`, `Cockpit.tsx` (device-class selector, lazy code-split, context). `App.tsx` gains an IDE|Cockpit toggle + early `<Cockpit/>` render.
- **Three verticals (`src/cockpit/{mobile,tablet,desktop}/`):** each owns `index.tsx` + `pages.tsx` + `components.tsx` (desktop also `CommandPalette.tsx`). Presentation forks 3×; ALL logic/data/types/tokens shared (TVDS anti-footgun #3). Terminal reuses `<Terminal projectDir>`.

### Routing mapping (documented)
`/cockpit`→`#/cockpit`, `/cockpit/repos`→`#/cockpit/repos`, `/cockpit/repos/:id`→`#/cockpit/repos/:id`, `…/actions`, `…/terminal`, `/cockpit/settings`→`#/cockpit/settings`. Rationale: no router dep, robust under `base:'/mwide/'`, no server route changes.

### File-structure mapping (documented deviation, permitted by spec)
The spec's per-page/per-component files (`CockpitHome/RepoList/RepoDetail/RepoActions/RepoTerminal/CockpitSettings`, `components/{RepoCard,ActionButton,StatusBadge,AuditLogPanel}`) exist **once per vertical**, consolidated into `index.tsx`/`pages.tsx`/`components.tsx` (+ desktop `CommandPalette.tsx`) as **named exports with the same responsibilities**. Consolidation chosen for a coherent, lint/build-clean three-vertical tree; every named page/component is present and functional.

## 4. Validation checklist — ALL GREEN
- [x] `npm run lint` (tsc --noEmit) exits 0 (whole project, incl. backend + shared + 3 verticals + App.tsx)
- [x] `npm run build` (vite) exits 0; verticals code-split into separate lazy chunks
- [x] `npm run test:cockpit` — 43 tests, 43 pass, 0 fail
- [x] HTTP API: health ok; config valid; auth 401 (no/wrong token) / 200 (valid); repos + real git status returned
- [x] Browser: all three verticals render with live data (mobile single-column+bottom-nav, tablet split-view, desktop multi-pane+⌘K)

## 5. Completion matrix — ALL COMPLETE
| ID | Requirement | File(s) | Verification | Status |
|---|---|---|---|---|
| C01 | Execution doc exists | `docs/MWIDE_GITHUB_COCKPIT_EXECUTION.md` | `test -f` | `[x]` |
| C02 | Example repo config exists | `mwide.repos.example.json` | `test -f` | `[x]` |
| C03 | Private config ignored | `.gitignore` | `grep mwide.repos.json` | `[x]` |
| C04 | Audit log ignored | `.gitignore` | `grep mwide.audit.log` | `[x]` |
| C05 | Config validator implemented | `server/cockpit/repo-registry.ts` | `npm run test:cockpit` | `[x]` |
| C06 | Auth implemented | `server/cockpit/auth.ts` | `npm run test:cockpit` + HTTP 401/200 | `[x]` |
| C07 | Repo status service | `server/cockpit/git-status.ts` | `npm run test:cockpit` + HTTP status | `[x]` |
| C08 | Audit log service | `server/cockpit/audit-log.ts` | `npm run test:cockpit` | `[x]` |
| C09 | Safe action runner | `server/cockpit/action-runner.ts` | `npm run test:cockpit` | `[x]` |
| C10 | GitHub service | `server/cockpit/github-service.ts` | `npm run lint` | `[x]` |
| C11 | Cockpit API routes mounted | `server.ts`, `server/cockpit/router.ts` | HTTP /api/cockpit/* | `[x]` |
| C12 | Cockpit client API | `src/cockpit/api.ts` | `npm run build` | `[x]` |
| C13 | Cockpit routes implemented | `src/cockpit/router.ts` + each vertical `index.tsx` | `npm run build` + browser | `[x]` |
| C14 | Repo list UI (×3) | `{mobile,tablet,desktop}` (components/pages) | browser | `[x]` |
| C15 | Repo detail UI (×3) | `{mobile,tablet,desktop}/pages.tsx` | browser | `[x]` |
| C16 | Action UI (×3) | `{mobile,tablet,desktop}` ActionButton/ActionRow | `npm run build` | `[x]` |
| C17 | Terminal route reuses PTY (×3) | `{...}/pages.tsx` → `<Terminal projectDir>` | `npm run build` | `[x]` |
| C18 | Confirm-required actions gated (×3) | `src/cockpit/confirm.ts` + vertical action buttons | code + test | `[x]` |
| C19 | Error states visible (×3) | each vertical `pages.tsx` ErrorNote | browser (GitHub 503 shown) | `[x]` |
| C20 | Tests added (≥14) | `server/cockpit/*.test.ts` (43 tests) | `npm run test:cockpit` | `[x]` |
| C21 | Typecheck passes | all TS | `npm run lint` | `[x]` |
| C22 | Production build passes | all app | `npm run build` | `[x]` |
| C23 | Completion doc finalized | this file | manual review | `[x]` |
| C24 | Three device verticals exist | `src/cockpit/{mobile,tablet,desktop}/index.tsx` | browser (all 3) | `[x]` |
| C25 | Capability-first classifier + override | `src/cockpit/device.ts` | `npm run lint` + override switch | `[x]` |
| C26 | Shared logic (no forked business logic) | `src/cockpit/{api,state,confirm,format,router}.ts` | review | `[x]` |
| C27 | TVDS standard captured | `skill://three-vertical-device-standard` | exists | `[x]` |
| C28 | Research persisted | `Docs/MWIDE_THREE_VERTICAL_UX_RESEARCH.md` | `test -f` | `[x]` |

## 6. Commit log (branch `feat/mwide-7-features`; cockpit paths only — governance files untouched)
- `f623200` docs(cockpit): add execution plan and three-vertical UX research
- `0b7862d` feat(cockpit): backend services, safe action runner, auth, config, routes + tests
- `c0c3435` feat(cockpit): three device verticals + shared core + IDE/Cockpit toggle
- (this commit) docs(cockpit): finalize completion matrix

Consolidated from the spec's 9-checkpoint list into 4 scoped commits (docs / backend / client / finalize) so governance artifacts (`.floyd/`, `SSOT/`, `.mcp.json`) stayed out of every commit. `.gitignore` was committed with the backend; it also carries a pre-existing trailing `.env` line that predates this work.

## 7. Verification receipts
```
npm run lint    → tsc --noEmit, exit 0 (no diagnostics)
npm run build   → vite v6.4.2, "✓ built in 1.88s", BUILD_EXIT:0; PWA generated;
                  verticals code-split: mobile/tablet/desktop each a separate lazy chunk (~16–19 kB)
npm run test:cockpit → tests 43 · pass 43 · fail 0 (repo-registry, auth, action-runner, git-status, audit-log)
HTTP (dev server, token=smoketest):
  GET /api/cockpit/health           → {ok:true,...}
  GET /api/cockpit/config/status    → {ok:true, configPresent:true, valid:true, authConfigured:true, repoCount:2}
  GET /api/cockpit/repos (no token) → 401
  GET /api/cockpit/repos (wrong)    → 401
  GET /api/cockpit/repos (valid)    → {ok:true, data:[mobile-web-ide, example-app]}
  GET /api/cockpit/repos/mobile-web-ide/status → real git status (branch feat/mwide-7-features, 17 changed files)
Browser (override switch + viewport per class):
  desktop 1440×900 → multi-pane + sidebar + overview dashboard + ⌘K palette button
  tablet  1194×834 → split sidebar+content, hover quick-actions, repo detail with changed files + visible GitHub-503 error
  mobile  390×844  → single-column repo cards + bottom Home/Repos/Settings nav + Refresh button
```

## 8. Known risks / notes
- 3× UI maintenance is the directive's cost; mitigated by the shared logic layer (only presentation forks).
- `node --import tsx --test` is used for `test:cockpit` (Node v26 supports it).
- `tsconfig` is non-strict; cockpit result types use optional-field interfaces (not discriminated unions) so property access typechecks without `strictNullChecks`.
- `mwide.repos.json` is gitignored; a working copy was created locally from the example for verification.
- GitHub routes return 503 until `GITHUB_TOKEN`/`GH_TOKEN` is set on the server (verified visible in the UI).

## 9. Final acceptance — MET
All matrix rows `[x]`; lint+build+test:cockpit exit 0; each vertical renders and is operable on its class; no TVDS footgun present; existing IDE untouched (toggle adds cockpit, does not remove IDE features).

## 10. Startup & configuration
```
cp mwide.repos.example.json mwide.repos.json   # then edit paths/actions
export MWIDE_COCKPIT_TOKEN="replace-with-local-secret"
export GITHUB_TOKEN="replace-with-github-token"   # or GH_TOKEN
npm install
npm run dev
open http://localhost:10001/mwide/#/cockpit       # paste the cockpit token in Settings
```
**Security warning:** the server binds to `127.0.0.1` by default. Do NOT set `IDE_BIND=0.0.0.0`
unless the machine is protected by trusted network controls (Tailscale, firewall, or equivalent).
Cockpit mode can execute allowlisted local commands and read configured repository state.
```
