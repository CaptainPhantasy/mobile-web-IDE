# MWIDE Copilot / VS Code Gap Analysis

Date: 2026-06-30

## Scope

This report compares the current `mobile-web-IDE` feature set against what a user expects from a serious VS Code and GitHub Copilot competitor.

The conclusion is simple: the app already has the bones of a browser IDE, but it is still missing the platform layer that makes VS Code and Copilot feel indispensable.

## What Already Exists

The repo already ships a respectable base:

- Code editor with syntax highlighting, folding, completion, search, linting, and mobile-friendly selection.
- Virtual filesystem plus local workspace support.
- Terminal, Git, GitHub, Drive, collaboration, extensions, themes, and a chat-based AI panel.

That is a real product surface, not a prototype. The shortfall is not breadth alone. The shortfall is depth, integration, and ecosystem parity.

## Where The Current Set Falls Short

| Priority | Gap | Current implementation | Why it falls short | Actionable fix |
|---|---|---|---|---|
| P0 | Semantic code intelligence | `Editor.tsx` uses CodeMirror completion plus word-based suggestions and a heuristic linter; `SearchPanel.tsx` uses file scans and best-effort symbol extraction. | VS Code-class editing depends on real language intelligence: go-to-definition, find references, hover, rename across project, signature help, code actions, and diagnostics from language servers. | Add an LSP layer or equivalent semantic index for the top languages first. Wire hover/definition/references/rename/code actions into the editor and command palette. |
| P0 | Copilot-style inline AI | `AIChatPanel.tsx` is chat-first. It supports tool calls, file writes, and repo actions, but not inline completions or editor-native suggestions. | Copilot wins because it lives where the cursor is. A side panel alone does not replace inline completion, selection rewrite, or next-edit suggestions. | Add inline completions, selection-scoped rewrite, and a diff-first apply flow directly inside the editor. Treat chat as the fallback, not the primary path. |
| P0 | Reviewable multi-file AI edits | The AI agent can read/write/search/git/github, but there is no structured plan view, no staged patch review, and no “accept/reject per hunk” workflow. | Autonomy without review is risky and slower in practice. Copilot cloud agent and modern IDE assistants both expose diff review before commit. | Make the agent produce patch sets, not blind file overwrites. Show per-file and per-hunk diffs, support undo, and require confirmation for destructive changes. |
| P0 | Real debugging and test workflow | `DebugPanel.tsx` runs a sandboxed iframe runner with injected breakpoints. There is no adapter-based debugger, launch configuration, test explorer, or problem matcher system. | That is enough for demos, not for day-to-day app debugging. VS Code users expect runtime-specific debugging, test running, and failure navigation. | Add a task/test layer and a debugger adapter abstraction. Support launch configs, test discovery, breakpoints, variables, call stack, and jump-to-failure. |
| P0 | Workspace model and sync | App state is centered on a single `projectDir` plus recent-workspace KV entries. There are no workspace files, profiles, settings sync, or shared keyboard shortcut state. | VS Code’s productivity comes from portable workspaces and synced setup. Without that, every browser/session starts from scratch. | Introduce a workspace manifest, user/workspace settings, profiles, and cross-device sync for layout, theme, keybindings, and trusted extensions. |
| P1 | Remote development | The app can open local folders and browser-backed projects, but there is no SSH/Dev Container/WSL/port-forwarded remote workspace model. | VS Code’s remote story is a major competitive advantage because it moves compute to where the code lives. | Add remote workspace backends and a transport abstraction for file, terminal, and port access. Start with SSH and container-based backends. |
| P1 | Extension ecosystem | `ExtensionsPanel.tsx` installs text blobs from the browser; `extensions.ts` evaluates them with `Function(...)` and exposes a small custom host API. | This is useful, but it is not the VS Code extension marketplace, versioning model, or compatibility surface. | Add a manifest-driven extension package format, dependency metadata, permissions, install/update flow, and a sandboxed host boundary. |
| P1 | Search and symbol navigation scale | Search is implemented as linear project scanning with regex plus heuristic symbol parsing. | That works on small projects, but it will lag on larger repositories and misses language-aware navigation. | Build a persistent index, cache parse results, and replace heuristic symbols with parser/LSP-backed navigation. |
| P1 | Source control review workflow | `GitPanel.tsx` covers broad GitHub operations, but the surface is still action-oriented rather than review-oriented. | A competitor needs branch comparison, blame, merge conflict resolution, history graphing, and review-centric diff flows. | Add a proper compare/merge editor, blame/history views, conflict resolution, and review comments anchored to diffs. |
| P1 | Collaboration quality | `collab.ts` broadcasts full-document updates and cursors in a room model. | Good for lightweight co-editing, but not strong enough for resilient concurrent editing at scale. | Move to CRDT/OT-based sync, presence state, session history, and permissioned rooms. |
| P2 | AI context and governance | The AI panel can call tools, but there is no prompt library, repository instructions, policy controls, or audit trail for AI actions. | Copilot-style workflows increasingly depend on scoped context and guardrails, not just model access. | Add repository instructions, prompt presets, scoped tool permissions, action logs, and configurable model policy. |

## Recommended Delivery Order

1. Ship semantic editing first.
   - LSP or equivalent semantic indexing.
   - Real diagnostics, definition, references, rename, code actions.
   - This is the clearest VS Code parity gap.

2. Make AI editor-native.
   - Inline completions.
   - Selection rewrite.
   - Diff-first multi-file application.
   - Undo and confirmation for destructive operations.

3. Replace demo debugging with a real dev loop.
   - Tasks.
   - Test discovery.
   - Launch configurations.
   - Failure navigation.

4. Add workspace portability.
   - Workspace manifest.
   - Profiles.
   - Settings and extension sync.
   - Trust and permissions.

5. Add remote development and ecosystem support.
   - SSH and container backends.
   - Marketplace-style extension installation.
   - Permissioned sandbox for third-party code.

## Acceptance Criteria

The app is materially closer to VS Code and Copilot when it can do all of the following:

- Offer semantic navigation for at least TypeScript/JavaScript/Python/Rust without relying on text heuristics.
- Provide inline AI suggestions while typing, not just chat responses.
- Show diffs before writing multi-file AI changes.
- Run and debug a project with real launch/test flows.
- Preserve workspaces, settings, and profiles across devices.
- Open a remote codebase without copying it into the browser workspace first.
- Install extensions from a manifest-driven ecosystem with versioning and permissions.

## Evidence From This Repo

Current code confirms the gap analysis above:

- `README.md:7-21` documents the present feature surface.
- `src/App.tsx:100-210` shows the single-app shell, workspace boot, and extension wiring.
- `src/components/Editor.tsx:1-12` and `79-171` show CodeMirror completion + heuristic linting, not semantic language services.
- `src/components/SearchPanel.tsx:1-145` and `src/lib/search.ts` show linear search and heuristic symbol extraction.
- `src/components/AIChatPanel.tsx:1-10` and `275-459` show a chat-first AI surface with tool use, not inline editor assistance.
- `src/components/DebugPanel.tsx` and `src/lib/debugger.ts` show a sandboxed iframe debugger, not a runtime adapter layer.
- `src/components/ExtensionsPanel.tsx` and `src/lib/extensions.ts:1-227` show a custom JS extension host, not a marketplace or sandboxed compatibility layer.

## Reference Baseline

Current official product references used for the comparison:

- VS Code Settings Sync: https://code.visualstudio.com/docs/configure/settings-sync
- VS Code Extension Marketplace: https://code.visualstudio.com/docs/configure/extensions/extension-marketplace
- VS Code Profiles: https://code.visualstudio.com/docs/configure/profiles
- VS Code Remote Development overview: https://code.visualstudio.com/docs/remote/remote-overview
- GitHub Copilot code suggestions and inline suggestions: https://docs.github.com/en/copilot/concepts/completions/code-suggestions
- GitHub Copilot cloud agent: https://docs.github.com/copilot/concepts/agents/cloud-agent/about-cloud-agent
- GitHub Copilot custom agents: https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/customize-cloud-agent/create-custom-agents
- GitHub Copilot MCP support: https://docs.github.com/en/copilot/tutorials/enhance-agent-mode-with-mcp

## Bottom Line

This app is already a competent browser IDE. It is not yet a VS Code / Copilot competitor because the core differentiators are still missing:

- semantic language intelligence,
- editor-native AI,
- remote development,
- settings/profile sync,
- and a real extension ecosystem.

Until those exist, the product will remain useful, but not substitutable.
