# Issue 0001 — Seven-Feature Rollout

**Status:** PHASE 1 COMPLETE — Phase 2 starting
**Branch:** `feat/mwide-7-features`
**Owner:** Claude (Sonnet/Opus, sole accountability)
**Opened:** 2026-04-25

## Phase 0 evidence — COMPLETE

| Item | Status | Evidence |
|------|--------|----------|
| 0.1 Working tree captured | DONE | governance dirt only (`.floyd/.supercache_version`, `SSOT/`) |
| 0.2 Branch created        | DONE | `feat/mwide-7-features` from `main@7fece5f` |
| 0.3 Baseline build        | PASS | exit 0 in 1.94s |
| 0.4 Baseline lint         | PASS | exit 0 |
| 0.5 Test run              | N/A  | no test script in package.json |
| 0.6 Issues file           | DONE | this file |
| 0.7 Lockfile snapshot     | DONE | `package-lock.json` at HEAD, untouched |

## Phase 1 evidence — COMPLETE

Persistent multi-pane PTY (features #1 + #2).

| ID  | Item | Status | Evidence |
|-----|------|--------|----------|
| 1.1 | Server `Session<id, {pty, ringBuffer, lastActive}>` map | DONE | `pty-hub.ts` `PtySession` + `PtySessionManager` classes |
| 1.2 | `ws.open` accepts `{sessionId?, cols, rows, cwd?}` | DONE | `pty-hub.ts` setupPtyHub message handler |
| 1.3 | Ring buffer (64KB default) replayed on resume      | DONE | `pty-hub.ts` `appendBuffer`+`getBufferText`; replay dispatched on resume path |
| 1.4 | Idle TTL sweeper (30 min default)                  | DONE | `pty-hub.ts` `startSweeper` + `isReapable` |
| 1.5 | Open-message protocol additive (backward-compat)   | DONE | new fields are optional; old clients ignore unknown msg types |
| 1.6 | TerminalPane component                             | DONE | `src/components/TerminalPane.tsx` (261 lines) |
| 1.7 | Terminal deck (multi-pane container)               | DONE | `src/components/Terminal.tsx` rewritten (198 lines) |
| 1.8 | sessionId persisted in localStorage                | DONE | TerminalPane `read/write/clearStoredSessionId` keyed by project + paneKey |
| 1.9 | Visible status indicator                           | DONE | `Terminal.tsx` `statusDot()` + tab dot rendering + CSS |
| 1.10| `npm run lint` exit 0                              | PASS | floyd-runner:lint exit 0, 8.42s |
| 1.10| `npm run build` exit 0                             | PASS | floyd-runner:build exit 0, 6.99s — 229 modules transformed, dist produced |

### File changes

| File | Action | Lines |
|------|--------|-------|
| `pty-hub.ts` (new)                 | CREATE   | 312 |
| `src/components/TerminalPane.tsx`  | CREATE   | 261 |
| `src/components/Terminal.tsx`      | REWRITE  | 198 (was 183 single-pane) |
| `src/index.css`                    | APPEND   | +110 lines (terminal deck styling) |
| `server.ts`                        | EDIT     | line 19 import swap; lines 121–196 deleted (76 lines removed); 1042 → 966 |
| `server.ts.bak-phase1`             | BACKUP   | original preserved |

### Wire protocol changes

Old (still works for unaware clients):
```
client → {type:'open', cols, rows, cwd?}
server → {type:'ready', pid, shell}
       → {type:'out', data}
       → {type:'exit', code}
```

New (additive):
```
client → {type:'open', sessionId?, cols, rows, cwd?}
server → {type:'ready', sessionId, pid, shell, resumed: bool}
       → {type:'replay', data}             # only when resumed
       → {type:'out', data}
       → {type:'kicked', reason}           # superseded by another client
       → {type:'exit', code}
client → {type:'kill'}                     # explicit terminate
```

### Manual smoke test (deferred, requires browser)

Open http://localhost:10001 (or whatever PORT). Expected:
- Terminal panel renders with one tab "shell 1" + "+" button
- Shell prompt appears (full zsh -l environment, FLOYD TTY Bridge happy)
- Reload page → status dot is "↺" (resumed), prior output replayed
- Click "+" → second pane spawns, independent shell
- Click "×" on a tab → that pane's PTY killed, others unaffected

## Phase 2 — IN PROGRESS

Launcher + vault-injected env (features #5 + #6).
