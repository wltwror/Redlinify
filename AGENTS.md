# Redlinify Repository Guidelines (`AGENTS.md`)

This document captures architectural invariants, conventions, and verification commands for **Redlinify**. Keep it updated alongside code changes.

---

## 1. Monorepo Layout

* `docs/SPEC.md` — Authoritative architecture, schema, MCP, and workbench specification.
* `examples/coffee-shop/` — Standalone sample `.design/` sandbox workspace kept separate from Redlinify's own `.design/` architecture views.
* `packages/shared` (`@redlinify/shared`) — Zod v4 schemas, canonical hashing, semantic diff engine, lock/patch guards, errors, and locked atomic `.design/` filesystem storage. Exports `@redlinify/shared/browser` (Node-free subset) for the UI.
* `packages/server` (`@redlinify/server`) — CLI (`redlinify init|mcp|ui|stop|update`), stdio MCP server (6 lean orthogonal tools with built-in workflow `instructions`, `readOnlyHint` annotations, compact non-echoing write responses, and detached `.design/.ui-server.json` auto-UI launcher), and loopback HTTP/WebSocket server (`127.0.0.1:4173`) with `chokidar` self-echo suppression.
* `packages/ui` (`@redlinify/ui`) — React 19 + Vite + `@xyflow/react` + lazy-loaded `elkjs` + Tailwind CSS browser workbench supporting structured architecture cards and Crow's Foot ER diagrams, Dark/Light + Dots/Grid themes, scrollable tab bar (`Tab`/`Shift+Tab`), typo-tolerant fuzzy search, diagram export (`PNG`/`SVG`/`Mermaid`/`JSON`), Vite `manualChunks` splitting, and unit tests in `packages/ui/test/`.
* `scripts/install.sh` & `scripts/install.ps1` — One-line installers (macOS/Linux/WSL and Windows PowerShell) that clone/fast-forward `~/.redlinify`, build, and link `redlinify` while keeping `.git` intact for `redlinify update`.
* `skill/SKILL.md` — Agent workflow skill instructions.

---

## 2. Core Invariants & Engineering Rules

1. **Strict TypeScript + ESM (`NodeNext` in backend packages)**:
   * `packages/shared` and `packages/server` use `"module": "NodeNext"` and `"moduleResolution": "NodeNext"`.
   * **Every relative import inside `packages/shared/src/` and `packages/server/src/` MUST use an explicit `.js` extension**.
   * Browser code MUST import from `@redlinify/shared/browser`, never `@redlinify/shared` (which pulls `node:fs` / `node:child_process`).
2. **Zod v4 + MCP SDK Compatibility**:
   * `@redlinify/shared` and `@redlinify/server` use `zod` (`^4.6.7`) alongside `@modelcontextprotocol/sdk` (`^1.32.2`), which supports Zod v4 natively. In `.superRefine(...)`, use `code: "custom"` (not `z.ZodIssueCode.custom`), and note `.superRefine(...)` has no `.shape`.
3. **Zero Pixel Coordinates in Shared Truth**:
   * `.design/workspace.json`, `.design/views/*.json`, and `.design/threads/*.json` are Git-tracked semantic truth and MUST NEVER contain layout positions (`x`, `y`) or viewport zoom.
   * Visual state lives solely in `.design/.layout/*.json` (positions, `edge_routes` handles & bend waypoints, and viewport zoom), and detached UI server metadata lives in `.design/.ui-server.json` (both gitignored).
4. **Cross-Process Locking & Atomic Writes**:
   * All `.design/` state reads-before-writes and mutations MUST run inside `DesignStorage.withLock(...)` (`.design/.lock` created via `wx`, with stale age/PID recovery) and persist via `writeJsonAtomic` (temp file `.tmp-*` in same directory -> `fsync` -> close -> `rename`).
   * Threads are stored one file per thread (`.design/threads/{thread_id}.json`), never in one monolithic `threads.json`.
   * All IDs used in file paths (`view.id`, `thread.id`, etc.) are validated against `ID_SLUG_REGEX` to prevent path traversal.
5. **Optimistic Concurrency, Lock Guards & `syncCodeRefs` Checkpoint Patching**:
   * `save_view` (`replace` updating existing views without `force`, `patch`, `acknowledge`) and UI `PUT /api/views/:id` require matching `base_hash` (`computeViewHash(view)`).
   * Agents cannot modify, delete, or unlock (`locked: true -> false`) locked nodes or locked edges via `save_view`.
   * `sync_code_refs` IS explicitly permitted to update `status` (`implemented | drifted`) and `code_refs` on `locked: true` nodes, and MUST patch **only** `status` and `code_refs` on those nodes inside `.design/.checkpoint/{view_id}.json` so unrelated pending human edits are never swallowed.
6. **Missing-Checkpoint Baseline Resolution**:
   * When `.design/.checkpoint/{id}.json` does not exist: if `view.created_by === "human"`, treat baseline as `null`; otherwise fall back to `git show HEAD:.design/views/{id}.json`; if unavailable, seed checkpoint from current view.
7. **Loopback Security Binding & Gateway HTTP Framing**:
   * `redlinify ui` MUST bind strictly to `127.0.0.1` (default port `4173`), never `0.0.0.0`.
   * All HTTP responses must explicitly set `Content-Length`, and request body reads must consume arbitrary chunked streams cleanly (`for await (const chunk of req)`).
8. **React Flow v12 Selection, Prop Stability & Layering Verification**:
   * Derive multi-selection IDs from `rfNodes`/`rfEdges` via `useMemo`; NEVER pass unmemoized `onSelectionChange` or inline array/object props (`multiSelectionKeyCode`, `deleteKeyCode`, `proOptions`) to `<ReactFlow>`, and NEVER include selection ID arrays in `useEffect`s calling `setRfNodes`/`setRfEdges` (prevents `StoreUpdater` / `SelectionListener` React Error `#185` loops).
   * Preserve existing runtime properties (`{ ...(existing ?? {}), ... }`) and `selected` flags inside functional `setRfNodes((prev) => ...)` / `setRfEdges((prev) => ...)` updaters.
   * Keep `.react-flow__edgelabel-renderer { z-index: 1100 !important; }` above elevated `.react-flow__edge.selected` (`z-index: 1000`) in `index.css` so edge `.react-flow__edge-interaction` paths do not swallow clicks on `<EdgeLabelRenderer>` bend handles.
   * Keep Light/Dark styling on `--rl-*` CSS variable tokens (`tailwind.config.js` + `index.css`), keep `locked` violet vs `needs_input` amber, keep per-view `HistoryEntry` undo/redo covering both semantic views and edge routes/positions, and run interactive Playwright click/drag/undo/theme checks after UI edits.
9. **Branch & Release Discipline (Post-`v0.2.1`)**:
   * After `v0.2.1`, do **NOT** push directly to `main`; create feature/fix branches and open pull requests instead.

---

## 3. Commands

```bash
npm install         # Install workspace dependencies
npm run typecheck   # Type-check all workspace packages in topological order
npm run build       # Build all workspace packages in topological order
npm test            # Run Vitest test suites (shared + server + ui)
npm run update      # Self-update local clone, rebuild, and restart active UI
```
