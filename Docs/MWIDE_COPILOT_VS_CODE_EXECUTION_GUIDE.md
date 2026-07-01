# MWIDE Copilot / VS Code Execution Guide

Date: 2026-06-30

## Objective

Turn `mobile-web-IDE` into a browser IDE that can credibly compete with VS Code and GitHub Copilot for day-to-day development work.

The bar is not feature count. The bar is whether a developer can:

1. Navigate code semantically.
2. Get useful AI help inline, not only in chat.
3. Run, test, debug, and review changes with low friction.
4. Move work across devices and remote machines without reconfiguration churn.
5. Extend the IDE through a trustworthy ecosystem.

## What Must Stay True

- Do not remove the existing browser IDE.
- Do not replace the current tools with opaque abstractions unless they solve a concrete user problem.
- Do not introduce AI features that write code without a review surface.
- Do not ship a feature without a visible empty state, busy state, and failure state.
- Do not add a capability without a UI that makes the capability discoverable on mobile and desktop.

## Product Gaps And UX Requirements

## Likely Repo Surfaces

The roadmap will mostly land in these existing areas:

- `src/App.tsx` for shell-level mode switching, layout, and global status.
- `src/components/Editor.tsx` for semantic hints, inline AI, hover, and quick-fix entry points.
- `src/components/SearchPanel.tsx` and `src/lib/search.ts` for semantic navigation and better result presentation.
- `src/components/AIChatPanel.tsx` and `src/lib/llm.ts` for inline AI, prompt scoping, and reviewable patch application.
- `src/components/DebugPanel.tsx` and `src/lib/debugger.ts` for the run/test/debug workflow.
- `src/components/ExtensionsPanel.tsx` and `src/lib/extensions.ts` for permissions, metadata, and extension health.
- `src/components/GitPanel.tsx` and `src/lib/git.ts` for diff review, branch comparison, and source-control UX.
- `src/components/Terminal.tsx` and `src/lib/terminal.ts` for task execution and remote-backed terminals.
- `src/index.css` and related layout styles for the hierarchy, status, and responsive behavior changes.

### 1. Semantic code intelligence

Current gap:
- Editor completion is word-based and heuristic.
- Search uses text scans and best-effort symbol parsing.
- There is no real definition/reference/rename/code-action model.

Implementation target:
- Add a semantic language layer for TypeScript, JavaScript, Python, and Rust first.
- Surface diagnostics, symbol navigation, rename, hover, and quick fixes.

UI/UX work required:
- Add a persistent Problems panel with severity badges and file jump links.
- Add hover cards and quick-fix affordances directly in the editor gutter.
- Add a semantic status pill in the top bar so users know whether the active file has language intelligence or only heuristics.
- Replace “Go to Symbol” text-only results with structured items: kind, file, line, preview, and confidence.
- Make rename a reviewable flow with an edit preview before applying project-wide changes.

Acceptance criteria:
- A user can jump from a warning to the file and line that owns it.
- A user can rename a symbol across the project and see the impact before applying.
- The editor shows useful states when the language service is unavailable or indexing is still in progress.

### 2. Copilot-style inline AI

Current gap:
- AI is chat-first.
- Tool use exists, but the editor does not get inline completions or selection-native rewrites.

Implementation target:
- Add ghost-text completions.
- Add selection rewrite and multi-step edit suggestions.
- Keep chat for broader requests and tool orchestration.

UI/UX work required:
- Place AI suggestions inside the editor surface at the caret, not only in a side panel.
- Add accept/reject controls that work on the current suggestion without opening a modal.
- Show a compact context chip row: active file, selected range, model, and edit mode.
- Add a diff drawer for any AI change that touches disk.
- Add “regenerate”, “trim context”, and “stop generating” controls in the same proximity as the suggestion.
- Make AI actions visibly scoped so the user knows whether the request is file-local, workspace-wide, or repo-wide.

Acceptance criteria:
- Typing produces inline suggestions when enabled.
- A selected block can be rewritten and reviewed before being applied.
- AI edits are reversible and never silently overwrite multiple files.

### 3. Reviewable multi-file edits

Current gap:
- The agent can write files, but the review model is thin.
- There is no first-class patch review or hunk-level approval workflow.

Implementation target:
- Convert AI write operations into patch objects.
- Present patches before commit or apply.
- Track undo and roll back partial applications.

UI/UX work required:
- Build a patch review view with file-by-file and hunk-by-hunk sections.
- Use explicit approve / reject / edit controls at the hunk level.
- Show a summary banner that states how many files, hunks, and lines will change.
- Add destructive-action confirmations that name the files being modified or deleted.
- Make the default path “review then apply”, not “apply immediately”.

Acceptance criteria:
- A multi-file AI edit cannot land without a visible diff review.
- The review view supports keyboard navigation and touch review.

### 4. Debugging and test workflow

Current gap:
- Debugging is sandboxed and simplified.
- There is no task runner, test explorer, or adapter-based debugger model.

Implementation target:
- Add tasks and tests as first-class workflow objects.
- Add debugger adapters or a clear adapter boundary.
- Support launch configurations and failure navigation.

UI/UX work required:
- Rework the bottom panel into a workflow strip with Run, Test, Debug, Problems, and Output states.
- Add a test tree with pass/fail/skip counts and instant navigation to failures.
- Add breakpoint status in the gutter and a visible paused state banner.
- Add variable, watch, and call-stack panes that open only when debugging is active.
- Keep the runtime model obvious: what is running, what is paused, what failed, and what is safe to stop.

Acceptance criteria:
- Users can discover and run tests without opening raw terminal commands first.
- Debug sessions expose at least stack, variables, and breakpoints in a dedicated view.

### 5. Workspace portability and sync

Current gap:
- Workspaces are mostly one project path plus recent history.
- There is no workspace manifest, profiles, or settings sync.

Implementation target:
- Introduce portable workspace definitions.
- Add user/workspace settings separation.
- Add profiles and sync for layout, theme, shortcuts, and trusted extensions.

UI/UX work required:
- Add a workspace switcher that shows path, last opened time, and sync state.
- Add a profile menu for editor layout, theme, keybindings, and panel presets.
- Surface trust and sync status in the top bar so the user knows what is portable and what is local-only.
- Provide a settings UI that separates global preferences from workspace overrides.
- Add clear offline/unsynced indicators instead of silent degradation.

Acceptance criteria:
- A user can export/import a workspace state without manual file archaeology.
- A user can see which settings are synced versus local.

### 6. Remote development

Current gap:
- The app opens local workspaces well enough, but it does not work like a remote-first IDE.

Implementation target:
- Add SSH and container backends first.
- Abstract file, terminal, and port operations behind a remote transport layer.

UI/UX work required:
- Add a connection status pill for local, SSH, and container sessions.
- Build a remote target picker with latency, auth, and port-forwarding state.
- Add a port-forward panel that shows open ports, published URLs, and connect health.
- Make remote errors actionable: auth failure, host unreachable, mount failure, port conflict.

Acceptance criteria:
- A remote codebase can be opened, edited, and run without copying it into browser storage first.

### 7. Extension ecosystem

Current gap:
- Extensions are custom JS blobs with a small host API.
- There is no package manifest, capability model, or marketplace-like install flow.

Implementation target:
- Add manifest-driven extension packages.
- Add permissions and compatibility metadata.
- Add install/update/uninstall flows that explain risk.

UI/UX work required:
- Turn the Extensions panel into a catalog with install source, permissions, version, and trust metadata.
- Add a permission review screen before activation.
- Surface extension health in the top bar and in the command palette.
- Show which extension contributed a command, theme, or status item.

Acceptance criteria:
- Users can tell what an extension does before enabling it.
- Failed extension activation has a visible error state and a recovery path.

### 8. Collaboration

Current gap:
- Collaboration is lightweight full-document sync.

Implementation target:
- Move to CRDT or OT-based editing.
- Add session history and presence state.

UI/UX work required:
- Show peer presence in the file header and editor margin.
- Add collaborator color chips and cursor labels.
- Add a room status view that shows connected users, permissions, and conflicts.
- Make remote edits legible with change attribution.

Acceptance criteria:
- Concurrent edits remain stable under real use.
- Users can tell who is present and what they are changing.

## Sequenced Delivery Plan

### Phase 1: Semantic editor core

Deliverables:
- Language-service-backed diagnostics.
- Definition/reference/rename navigation.
- Problems panel and semantic status indicators.
- Search results upgraded to structured navigation.

UX checkpoint:
- The editor remains the center of the app.
- Navigation errors are visible, not implicit.

### Phase 2: Editor-native AI

Deliverables:
- Inline completions.
- Selection rewrite.
- Diff-first apply flow.
- AI scope indicators.

UX checkpoint:
- AI feels like part of the editor, not a separate app pane.

### Phase 3: Reviewable change application

Deliverables:
- Patch objects.
- Hunk review.
- Undo and rollback.
- Confirmation for destructive edits.

UX checkpoint:
- No change lands without a review surface when it is risky.

### Phase 4: Tasks, tests, and debugging

Deliverables:
- Task runner.
- Test explorer.
- Launch configs.
- Debug adapter boundary.

UX checkpoint:
- The bottom panel becomes a workflow deck, not a dumping ground.

### Phase 5: Workspace sync and remote dev

Deliverables:
- Workspace manifests.
- Profiles and settings sync.
- SSH/container backends.
- Port forwarding.

UX checkpoint:
- Users can move between devices and hosts without rebuilding their environment.

### Phase 6: Extension ecosystem and collaboration hardening

Deliverables:
- Manifest-driven extensions.
- Permissions and trust.
- CRDT/OT collaboration.

UX checkpoint:
- Extensibility and co-editing feel predictable and safe.

## UI System Rules

- Keep the editor visually primary.
- Use side panels for navigation, not for core action confirmation.
- Use drawers and split views for diffs, review, and diagnostics.
- Avoid nested card-on-card layouts.
- Keep critical status in the top bar and workflow status in the bottom panel.
- Use compact labels, not explanatory paragraphs, for persistent controls.
- Use a consistent three-state model everywhere: loading, ready, failed.
- On mobile, preserve the same information hierarchy with bottom tabs and compact drawers instead of collapsing capabilities.

## Implementation Checklist

- [ ] Add semantic language services and Problems UI.
- [ ] Add editor-native inline AI completions and selection rewrite.
- [ ] Add patch review before multi-file AI writes.
- [ ] Add tasks, tests, and a debugger adapter boundary.
- [ ] Add workspace manifests, profiles, and settings sync.
- [ ] Add SSH/container remote development support.
- [ ] Add manifest-driven extension packaging and permissions.
- [ ] Add CRDT/OT collaboration and presence.
- [ ] Redesign the shell to surface status, trust, and mode clearly.
- [ ] Validate mobile and desktop layouts after each phase.

## Validation Checklist

- [ ] Semantic navigation works on representative TS, JS, Python, and Rust files.
- [ ] Inline AI suggestion appears at the cursor and can be accepted or rejected.
- [ ] Multi-file AI changes show a patch review before disk writes.
- [ ] Debugging exposes launch, pause, step, stack, variables, and failure links.
- [ ] Workspace settings and profiles persist across reloads.
- [ ] Remote workspace connection shows healthy and failed states clearly.
- [ ] Extensions list permissions, source, and version before activation.
- [ ] Collaboration shows presence and attribution.
- [ ] Mobile viewport preserves the same flow without hiding critical actions.

## Risks

- Semantic services will expose many small UI decisions, so the Problems panel and status indicators need to ship with the engine, not after it.
- AI editor-native features will be rejected if they are slow or noisy, so latency and undo must be treated as first-class UX requirements.
- Remote development will fail if status is ambiguous, so connection health must be visible at all times.
- Extension permissions will be ignored if they are buried, so trust and capability disclosure must be front and center.

## Definition Of Done

This guide is complete when the app can:

- edit with semantic awareness,
- assist inline with AI,
- review every risky change,
- run and debug real tasks,
- sync workspace state,
- connect to remote codebases,
- and treat extensions as a safe ecosystem.
