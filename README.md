# Redlinify

**Redlinify** is a local-first, repo-native collaborative design workbench for human developers and AI coding agents.

Instead of negotiating architecture, database schemas, and flows exclusively in ephemeral chat threads, your coding agent writes structured multi-view semantic diagrams straight into `.design/` via MCP. You inspect, edit, lock approved parts (violet), bend edges, and exchange anchored questions or change requests in a fast local browser UI—then prompt the agent to pull a concise semantic diff.

---

## Why Redlinify?

* **Git-Tracked Semantic Truth, Zero Coordinates:** `.design/workspace.json`, `.design/views/*.json`, and `.design/threads/*.json` contain semantic nodes, sections/attributes, typed edges, and discussions with zero pixel positions.
* **Isolated Layout & Checkpoints:** Manual positions, edge bend waypoints, and viewport zoom stay in `.design/.layout/*.json` (gitignored). Agent snapshots in `.design/.checkpoint/*.json` (gitignored) power compact token-efficient semantic diffs.
* **General & ER Diagram Modes:** Model component architectures, algorithms, and integrations alongside Crow's Foot / Barker ER schemas with `PK`, `FK`, `UQ`, `IDX`, and nullable/mandatory (`○` / `*`) toggles.
* **Asynchronous, Prompt-Driven MCP Workflow:** Separate stdio MCP (`redlinify mcp`) and local web server (`redlinify ui`) processes communicate over atomic locked `.design/` files on disk, keeping your browser live across agent restarts.
* **Decisions & Code Traceability:** Anchored threads graduate into searchable Architecture Decision Records under **Decisions** when resolved, and nodes track `code_refs` across `draft → needs_input → approved → implemented | drifted`.
* **Light/Dark Themes & Dots/Grid Canvas:** Persistent Light/Dark theme and Dots/Grid background toggles in the top bar.

---

## Repository Structure (inside your project)

```text
.design/
├── workspace.json              # Git-tracked: tab order, metadata, pending view_requests
├── views/
│   ├── architecture.json       # Git-tracked: semantic graph (zero pixel coordinates)
│   └── database_er.json
├── threads/
│   └── thr_a1b2c3d4e5f6.json   # Git-tracked: one file per anchored thread / decision
├── .layout/                    # Gitignored: manual node positions, edge bends, zoom
└── .checkpoint/                # Gitignored: last agent-authored semantic snapshot
```

---

## Quick Start

Requires **Node.js >= 22.0.0**.

```bash
git clone <your-repo-url>
cd Redlinify
npm install
npm run build
npm test
```

Optionally expose `redlinify` globally from your local checkout:

```bash
npm link -w @redlinify/server
redlinify --version
```

### 1. Initialize `.design/` in any repository

```bash
redlinify init --dir /path/to/your-repo --name MyProject
# Or without npm link:
node /path/to/Redlinify/packages/server/dist/cli.js init --dir /path/to/your-repo --name MyProject
```

### 2. Launch the local browser UI (`127.0.0.1:4173`)

```bash
redlinify ui --dir /path/to/your-repo --port 4173
```

Open `http://127.0.0.1:4173`. The server binds strictly to loopback (`127.0.0.1`) by default and streams disk updates over WebSockets.

### 3. Connect your coding agent via MCP (stdio)

Add Redlinify to Claude Code, Cursor, OpenCode, or any MCP-compatible client:

```json
{
  "mcpServers": {
    "redlinify": {
      "command": "node",
      "args": ["/path/to/Redlinify/packages/server/dist/cli.js", "mcp", "--dir", "/path/to/your-repo"]
    }
  }
}
```

Or if linked via `npm link`:

```json
{
  "mcpServers": {
    "redlinify": {
      "command": "redlinify",
      "args": ["mcp"]
    }
  }
}
```

For agent prompting best practices, see [skill/SKILL.md](skill/SKILL.md).

---

## MCP Tool Reference

| Tool | Purpose |
| :--- | :--- |
| `get_workspace_status` | List all tabs (`view_hash`, triage/drifted counts, human edit flags), pending `view_requests`, and canonical `entity_ref` slugs. |
| `get_view` | Read a semantic `DesignView` (zero coordinates), its `view_hash`, open threads, and optional 1-line ADR summaries. |
| `get_pending_feedback` | Pull semantic diffs since agent checkpoints, `view_hashes`, pending `view_requests`, and open threads awaiting agent response. |
| `upsert_view` | Create or replace a semantic `DesignView` with optimistic concurrency (`base_hash`) and lock protection. |
| `patch_view` | Apply targeted edits (`meta`, add/update/remove nodes or edges, `section_ops`) with `base_hash` and lock guards. |
| `acknowledge_feedback` | Advance agent checkpoints when human edits are accepted as-is. |
| `post_thread_message` | Open an anchored thread (`question`, `change_request`, `decision`, `drift_alert`), reply, or resolve with a 1-line `resolution_summary`. |
| `get_node_history` | Query full transcripts of resolved Decision/ADR threads by `target_id`, `entity_ref`, `view_id`, or text search. |
| `sync_code_refs` | Link source `code_refs` (`path:symbol`) and update `implemented` / `drifted` status without clobbering unrelated human edits. |

---

## Canvas & Keyboard Controls

| Action | Shortcut / Gesture |
| :--- | :--- |
| Select element & open inspector | Click a box/entity or relationship line |
| Multi-select boxes | `Ctrl+Click` / `Cmd+Click` (or `Shift+Drag` marquee) |
| Connect two nodes | Drag from any 4-sided handle to another node |
| Manual edge bend point | Select a line and drag its midpoint handle (double-click to remove) |
| Inline edit title / entry / attribute | Double-click text inside an unlocked card |
| Quick actions menu | Right-click canvas, tab, card, or edge |
| Undo / Redo (nodes, edges & bends) | `Ctrl+Z` / `Ctrl+Shift+Z` (`Cmd` on macOS) |
| Delete selected unlocked elements | `Delete` or `Backspace` |

---

## Development & Verification

```bash
npm run typecheck   # Type-check all workspace packages in topological order
npm run build       # Build @redlinify/shared, @redlinify/server, and @redlinify/ui
npm test            # Run Vitest unit & integration suites
```

Monorepo packages:

* `packages/shared` (`@redlinify/shared`): Zod v3 schemas, canonical hashing, semantic diff engine, lock/patch guards, and locked atomic storage (plus `@redlinify/shared/browser`).
* `packages/server` (`@redlinify/server`): CLI (`init`, `mcp`, `ui`), stdio MCP server, and loopback HTTP + WebSocket UI host with `chokidar` self-echo suppression.
* `packages/ui` (`@redlinify/ui`): React 19 + TypeScript + Vite + `@xyflow/react` + `elkjs` Tailwind workbench.

See [SPEC.md](SPEC.md) for the design specification and [AGENTS.md](AGENTS.md) for architectural invariants.

---

## Issues & License

Bug reports and PRs are welcome—run `npm run typecheck && npm run build && npm test` before submitting.

[MIT](LICENSE) © 2026 Vojtěch Faltus
