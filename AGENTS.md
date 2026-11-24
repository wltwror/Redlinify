# Redlinify Repository Guidelines (`AGENTS.md`)

This document captures architectural invariants, conventions, and verification commands for **Redlinify**. Keep it updated alongside code changes.

---

## 1. Monorepo Layout

* `SPEC.md` — Authoritative project specification across all 5 milestones.
* `packages/shared` (`@redlinify/shared`) — Zod v3 schemas, canonical hashing, semantic diff engine, lock/patch guards, errors, and locked atomic `.design/` filesystem storage.
* `packages/server` *(Milestone 2+)* — CLI (`redlinify init|mcp|ui`), stdio MCP server, and loopback HTTP/WebSocket server (`127.0.0.1:4173`).
* `packages/ui` *(Milestone 3+)* — React 19 + Vite + `@xyflow/react` + `elkjs` browser workbench.
* `skill/` *(Milestone 5)* — Agent workflow skill (`SKILL.md`).

---

## 2. Core Invariants & Engineering Rules

1. **Strict TypeScript + ESM (`NodeNext`)**:
   * All packages use strict TypeScript extending `tsconfig.base.json` (`"module": "NodeNext"`, `"moduleResolution": "NodeNext"`).
   * **Every relative import inside `src/` MUST use an explicit `.js` extension** (e.g. `import { DesignViewSchema } from "./schemas.js"`).
2. **Zod v3 Compatibility**:
   * `@redlinify/shared` pins `zod` (`^3.24.2`, Zod v3) so `@modelcontextprotocol/sdk` consumes schemas directly without Zod v4 runtime mismatches.
3. **Zero Pixel Coordinates in Shared Truth**:
   * `.design/workspace.json`, `.design/views/*.json`, and `.design/threads/*.json` are Git-tracked semantic truth and MUST NEVER contain layout positions (`x`, `y`) or viewport zoom.
   * Visual state lives solely in `.design/.layout/*.json` (gitignored).
4. **Cross-Process Locking & Atomic Writes**:
   * All `.design/` state reads-before-writes and mutations MUST run inside `DesignStorage.withLock(...)` (`.design/.lock` created via `wx`, with stale age/PID recovery) and persist via `writeJsonAtomic` (temp file `.tmp-*` in same directory -> `fsync` -> close -> `rename`).
   * Threads are stored one file per thread (`.design/threads/{thread_id}.json`), never in one monolithic `threads.json`.
   * All IDs used in file paths (`view.id`, `thread.id`, etc.) are validated against `ID_SLUG_REGEX` to prevent path traversal.
5. **Optimistic Concurrency, Lock Guards & `syncCodeRefs` Checkpoint Patching**:
   * `upsert_view` (when updating existing views without `force`), `patch_view`, `acknowledge_feedback`, and UI `PUT /api/views/:id` require matching `base_hash` (`computeViewHash(view)`).
   * Agents cannot modify, delete, or unlock (`locked: true -> false`) locked nodes or locked edges via `upsert_view` or `patch_view`.
   * `sync_code_refs` IS explicitly permitted to update `status` (`implemented | drifted`) and `code_refs` on `locked: true` nodes, and MUST patch **only** `status` and `code_refs` on those nodes inside `.design/.checkpoint/{view_id}.json` so unrelated pending human edits are never swallowed.
6. **Missing-Checkpoint Baseline Resolution**:
   * When `.design/.checkpoint/{id}.json` does not exist: if `view.created_by === "human"`, treat baseline as `null`; otherwise fall back to `git show HEAD:.design/views/{id}.json`; if unavailable, seed checkpoint from current view.
7. **Loopback Security Binding**:
   * Any HTTP/WebSocket server (`redlinify ui`) MUST bind strictly to `127.0.0.1` (default port `4173`), never `0.0.0.0`.

---

## 3. Commands

```bash
npm install         # Install workspace dependencies
npm run typecheck   # Type-check all workspace packages
npm run build       # Build all workspace packages
npm test            # Run Vitest test suites
```
