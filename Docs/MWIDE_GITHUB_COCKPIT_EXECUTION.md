# MWIDE → iPad Operations Cockpit — Execution Document

> Source of truth for the cockpit build. Authority: `Docs/Refactor.md` (reconciled prompt) +
> Douglas's three-vertical directive. Companion artifacts: `Docs/MWIDE_THREE_VERTICAL_UX_RESEARCH.md`
> (evidence) and `skill://three-vertical-device-standard` (TVDS, the durable standard). Internal
> build contract for subagents: `local://cockpit-contract.md`.
>
> Status legend: `[ ]` not started · `[~]` in progress · `[x]` complete · `[!]` blocked.

## 1. Objective
Add an authenticated, multi-device **operations cockpit** to the Mobile Web IDE that controls
local repos, GitHub state, allowlisted shell actions, tests, lint, build, and terminal access —
without removing any existing IDE/Git/GitHub/FS/terminal/vault/LLM/collab capability, and without
exposing secrets or allowing arbitrary command execution. Per Douglas's standing directive, the
cockpit client is delivered as **three purpose-built device verticals** (mobile / tablet / desktop),
NOT one responsive layout. The backend is device-agnostic and built once.

## 2. Existing system inventory (verified 2026-06-22 against this checkout)
- Working dir `/Volumes/SanDisk1Tb/MWIDE/mobile-web-IDE`; remote `CaptainPhantasy/mobile-web-IDE`; branch `feat/mwide-7-features`; FS CASE-INSENSITIVE (`docs/`==`Docs/`, inode 17701029).
- Server entrypoint `server.ts` at root (NO `server/` dir yet); PTY hub `pty-hub.ts` at root. Express 4. WS at `/ws/pty` and `/ws/collab` (server.ts:95-112). PTY `open` message already accepts `cwd` (pty-hub.ts:10); `<Terminal projectDir=…/>` passes it (TerminalPane.tsx:156).
- Client: `src/main.tsx` → `src/App.tsx` (~949 lines); NO router library (navigation is internal state). Vite `base:'/mwide/'` (vite.config.ts:9) → client routing is HASH-based. API calls are ABSOLUTE `/api/...`. Tailwind v4. React 19. PWA via vite-plugin-pwa (autoUpdate).
- Scripts: `dev`/`start`=`tsx server.ts`, `build`=`vite build`, `lint`=`tsc --noEmit` (the only typecheck), `preview`, `clean`. NO `test` script. Package manager npm. Node v26. `tsconfig` NON-strict, `moduleResolution: bundler`, `allowImportingTsExtensions`.
- Server already has a GitHub proxy (githubProxy server.ts:182-214, global fetch, no Octokit), vault (~/.config/mwide-vault.json), FS bridge, LLM proxy. Bind `127.0.0.1` default (IDE_BIND override).
- Pre-existing uncommitted, NON-cockpit working-tree changes (governance bootstrap): `.floyd/`, `SSOT/`, `.mcp.json`, `Docs/`, `.gitignore` (+trailing `.env`), `src/components/TerminalPane.tsx.backup`, root binary `Refactor`. These are OUT OF SCOPE and must not be entangled in cockpit commits.

## 3. Target architecture
- **Server (device-agnostic, new `server/cockpit/`):** `types.ts`, `repo-registry.ts` (config load+validate+allowlist), `auth.ts` (token middleware), `action-runner.ts` (safe `spawn`), `git-status.ts`, `audit-log.ts` (JSONL), `github-service.ts` (REST, no Octokit), `router.ts` (Express router). Mounted in `server.ts` via `app.use('/api/cockpit', createCockpitRouter())`.
- **Client shared logic (`src/cockpit/`):** `types.ts`, `device.ts` (capability-first classifier + override), `router.ts` (hash routes), `api.ts` (typed envelope client), `state.ts` (data hooks), `confirm.ts` (arm→confirm), `format.ts` (+ shared kind color tokens), `haptics.ts`, `Cockpit.tsx` (device-class selector, lazy code-split, context). `App.tsx` gains an IDE|Cockpit toggle.
- **Three verticals (`src/cockpit/{mobile,tablet,desktop}/`):** each owns `CockpitLayout/CockpitHome/RepoList/RepoDetail/RepoActions/RepoTerminal/CockpitSettings` + `components/{RepoCard,ActionButton,StatusBadge,AuditLogPanel}`. Presentation forks 3×; **all logic/data/types/tokens are shared** (TVDS anti-footgun #3). Terminal reuses `<Terminal projectDir>`.
- **Routing (documented mapping):** spec paths → hash routes under `/mwide/`: `/cockpit`→`#/cockpit`, `/cockpit/repos`→`#/cockpit/repos`, `/cockpit/repos/:id`→`#/cockpit/repos/:id`, `…/actions`→`#/cockpit/repos/:id/actions`, `…/terminal`→`#/cockpit/repos/:id/terminal`, `/cockpit/settings`→`#/cockpit/settings`. Rationale: no router dep, robust under `base:'/mwide/'`, no server route changes.
- **File-structure mapping (documented):** the spec's single `src/cockpit/RepoList.tsx` etc. exist once PER VERTICAL (e.g. `src/cockpit/mobile/RepoList.tsx`); `api.ts`/`types.ts` remain shared at `src/cockpit/`. Justified by the spec's "nearest appropriate equivalent path + document the mapping" clause under the three-vertical directive.

## 4. Three-vertical build matrix (applied TVDS — MIN is a floor, ship the advancements)
See `skill://three-vertical-device-standard` for the durable rules; per-vertical floor + advancements summarized in `Docs/MWIDE_THREE_VERTICAL_UX_RESEARCH.md` §4. Classification is capability-first (desktop = fine pointer + hover even with touch; touch-primary split by min-viewport; iPad-as-Mac shim; manual override). Resize swaps trees with debounce+hysteresis; shared state survives.

## 5. Ordered implementation checklist
- [x] Verify Section 0 facts against live checkout
- [x] Persist UX research to `Docs/MWIDE_THREE_VERTICAL_UX_RESEARCH.md`
- [x] Codify TVDS as `skill://three-vertical-device-standard`
- [x] Author frozen build contract `local://cockpit-contract.md`
- [x] Create this execution document
- [~] Backend security core (types, repo-registry/validator, auth, action-runner, example config, .gitignore)
- [~] Backend services + routes (git-status, audit-log, github-service, router, server.ts mount)
- [~] Client shared core (types, device, router, api, state, confirm, format, haptics, Cockpit, App toggle)
- [~] Mobile vertical
- [~] Tablet vertical
- [~] Desktop vertical
- [~] Cockpit tests + `test:cockpit` script
- [ ] Integrate + `npm run lint` + `npm run build` + `npm run test:cockpit`
- [ ] Browser smoke-test each vertical
- [ ] Scoped commits per checkpoint
- [ ] Finalize matrix + evidence ledger

## 6. Validation checklist
- `npm run lint` (tsc --noEmit) exits 0 over all new server+client+test TS.
- `npm run build` (vite) exits 0; cockpit reachable from the built client.
- `npm run test:cockpit` runs ≥14 tests, all pass.
- Browser: cockpit loads at `#/cockpit`; vertical override switches mobile/tablet/desktop trees; repo list renders; auth/config status visible; terminal route mounts `<Terminal>`.
- Security spot-check: action runner rejects unknown repo/action, unsafe args, unconfirmed destructive; GitHub routes 503 without token; auth 503/401 paths.

## 7. Completion matrix
| ID | Requirement | File(s) | Verification | Status |
|---|---|---|---|---|
| C01 | Execution doc exists | `docs/MWIDE_GITHUB_COCKPIT_EXECUTION.md` | `test -f` | `[x]` |
| C02 | Example repo config exists | `mwide.repos.example.json` | `test -f` | `[~]` |
| C03 | Private config ignored | `.gitignore` | `grep mwide.repos.json` | `[~]` |
| C04 | Audit log ignored | `.gitignore` | `grep mwide.audit.log` | `[~]` |
| C05 | Config validator implemented | `server/cockpit/repo-registry.ts` | `npm run test:cockpit` | `[~]` |
| C06 | Auth implemented | `server/cockpit/auth.ts` | `npm run test:cockpit` | `[~]` |
| C07 | Repo status service | `server/cockpit/git-status.ts` | `npm run test:cockpit` | `[~]` |
| C08 | Audit log service | `server/cockpit/audit-log.ts` | `npm run test:cockpit` | `[~]` |
| C09 | Safe action runner | `server/cockpit/action-runner.ts` | `npm run test:cockpit` | `[~]` |
| C10 | GitHub service | `server/cockpit/github-service.ts` | `npm run lint` | `[~]` |
| C11 | Cockpit API routes mounted | `server.ts`, `server/cockpit/router.ts` | `npm run lint` | `[~]` |
| C12 | Cockpit client API | `src/cockpit/api.ts` | `npm run lint` | `[~]` |
| C13 | Cockpit routes implemented | `src/cockpit/*` (3 verticals) | `npm run build` | `[~]` |
| C14 | Repo list UI (×3) | `src/cockpit/{mobile,tablet,desktop}/RepoList.tsx` | `npm run build` | `[~]` |
| C15 | Repo detail UI (×3) | `…/RepoDetail.tsx` | `npm run build` | `[~]` |
| C16 | Action UI (×3) | `…/RepoActions.tsx` | `npm run build` | `[~]` |
| C17 | Terminal route reuses PTY (×3) | `…/RepoTerminal.tsx` → `<Terminal projectDir>` | `npm run build` | `[~]` |
| C18 | Confirm-required actions gated (×3) | `…/components/ActionButton.tsx` + `src/cockpit/confirm.ts` | `npm run build` | `[~]` |
| C19 | Error states visible (×3) | `src/cockpit/*` | `npm run build` | `[~]` |
| C20 | Tests added (≥14) | `server/cockpit/*.test.ts` | `npm run test:cockpit` | `[~]` |
| C21 | Typecheck passes | all TS | `npm run lint` | `[ ]` |
| C22 | Production build passes | all app | `npm run build` | `[ ]` |
| C23 | Completion doc finalized | this file | manual review | `[ ]` |
| C24 | Three device verticals exist | `src/cockpit/{mobile,tablet,desktop}/index.tsx` | `npm run build` | `[~]` |
| C25 | Capability-first device classifier + override | `src/cockpit/device.ts` | `npm run lint` + browser | `[~]` |
| C26 | Shared logic (no forked business logic) | `src/cockpit/{api,state,confirm,format,router}.ts` | review | `[~]` |
| C27 | TVDS standard captured | `skill://three-vertical-device-standard` | exists | `[x]` |
| C28 | Research persisted | `Docs/MWIDE_THREE_VERTICAL_UX_RESEARCH.md` | `test -f` | `[x]` |

Final status may only be declared complete when all rows are `[x]`.

## 8. Commit log (scoped, branch `feat/mwide-7-features`; cockpit paths only — never governance files)
- [ ] c1 `docs(cockpit): add execution plan + three-vertical standard`
- [ ] c2 `feat(cockpit): add config validation, auth, safe action runner`
- [ ] c3 `feat(cockpit): add repo status, audit, github services + routes`
- [ ] c4 `feat(cockpit): add shared client core + device router`
- [ ] c5 `feat(cockpit): add mobile/tablet/desktop verticals`
- [ ] c6 `test(cockpit): add cockpit validation and service tests`
- [ ] c7 `docs(cockpit): finalize completion matrix`
(Deviation from the original 9-commit list, documented per spec: UI is one commit covering three verticals; backend grouped into security-core + services. Reason: three verticals replace the single UI checkpoint, and scoped staging keeps governance artifacts out.)

## 9. Known risks and mitigations
- **3× UI maintenance / drift** → shared logic layer; only presentation forks (TVDS #3).
- **Device misclassification** (touchscreen laptops) → capability-first; fine+hover ⇒ desktop; manual override.
- **`node --import tsx --test` compatibility** → Node v26 + tsx 4 support it; fallback `tsx --test …` documented if needed.
- **Hash routing vs `base:'/mwide/'`** → hash is base-independent; chosen deliberately.
- **Action runner = remote code path** → allowlist + spawn + arg-token rejection + workspace confinement + confirm gate + timeout cap; tokens never reach client; 127.0.0.1 bind.
- **Commit entanglement with governance changes** → stage cockpit paths explicitly; never `git add -A`.

## 10. Final acceptance criteria
All matrix rows `[x]`; lint+build+test:cockpit exit 0; each vertical renders and is operable on its class; no footgun from the TVDS list present; existing IDE untouched and functional.

## 11. Startup & configuration
```
cp mwide.repos.example.json mwide.repos.json   # then edit paths/actions
export MWIDE_COCKPIT_TOKEN="replace-with-local-secret"
export GITHUB_TOKEN="replace-with-github-token"   # or GH_TOKEN
npm install
npm run dev
open http://localhost:10001/mwide/#/cockpit       # paste the cockpit token in Settings
```
**Security warning:** By default the server binds to `127.0.0.1`. Do NOT set `IDE_BIND=0.0.0.0`
unless the machine is protected by trusted network controls (Tailscale, firewall, or equivalent
private boundary). Cockpit mode can execute allowlisted local commands and read configured repo state.
