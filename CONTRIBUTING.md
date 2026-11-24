# Contributing to Redlinify

Thank you for helping improve Redlinify!

---

## Development Setup

Requirements:

* **Node.js >= 22.0.0** and **npm**
* Git

```bash
npm install
npm run typecheck
npm run build
npm test
```

If you are iterating on the frontend alongside the API/WebSocket server:

```bash
# Terminal 1: serve API + WS on 127.0.0.1:4173
node packages/server/dist/cli.js ui --dir /path/to/test-repo --port 4173

# Terminal 2: run Vite dev server (HMR) proxying to API/WS
npm run dev -w @redlinify/ui
```

---

## Workspace Structure

* `packages/shared` (`@redlinify/shared`) — Zod v3 schemas, canonical hashing, semantic diff engine, guards, errors, and locked atomic `.design/` storage. Exports `@redlinify/shared/browser` with zero Node builtins.
* `packages/server` (`@redlinify/server`) — CLI (`init`, `mcp`, `ui`), 9-tool stdio MCP server, and loopback HTTP/WebSocket server.
* `packages/ui` (`@redlinify/ui`) — React 19 + Vite + `@xyflow/react` + `elkjs` + Tailwind workbench UI.
* `skill/SKILL.md` — Reusable MCP workflow skill instructions for coding agents.

---

## Architectural Invariants

Before modifying code, please review [AGENTS.md](AGENTS.md) and [SPEC.md](SPEC.md). Key rules:

1. **Zero Pixel Coordinates in Shared Truth:** Never write `x`, `y`, waypoints, or zoom into `.design/workspace.json`, `.design/views/*.json`, or `.design/threads/*.json`. Layout belongs solely in `.design/.layout/*.json`.
2. **Explicit `.js` ESM Imports:** Relative imports inside `packages/shared/src/` and `packages/server/src/` must use explicit `.js` extensions (`NodeNext`).
3. **Browser Boundary:** Frontend code must import from `@redlinify/shared/browser` only, never `@redlinify/shared`.
4. **Atomic Locked Writes:** Mutations to `.design/` must execute inside `DesignStorage.withLock(...)` and persist via atomic temp-write + `fsync` + `rename`.
5. **Loopback Safety:** `redlinify ui` defaults to `127.0.0.1`. Keep path traversal guards (`idSlugSchema`) and `Content-Length` framing intact.

---

## Pull Request Checklist

1. Run `npm run typecheck`, `npm run build`, and `npm test` after your final edit.
2. Add or update unit tests in `packages/*/tests/` for schema, diff, storage, MCP, or HTTP changes.
3. For UI interaction changes, manually or automatically verify clicks, selections, edge routing, and Light/Dark themes in a real browser with zero console/page errors.
4. Do not commit local scratch edits under `.design/.layout/`, `.design/.checkpoint/`, or unrelated demo files.
5. Update `README.md`, `AGENTS.md`, or `CHANGELOG.md` when behavior or invariants change.
