# Redlinify

**Stop negotiating software architecture and DB schemas in linear chat threads.**

Redlinify gives you and your AI coding agent a shared, Git-tracked visual workbench directly inside your repository. Your agent drafts interactive architecture and ER diagrams over MCP (and starts the local browser UI for you automatically); you tweak boxes, bend lines, lock approved parts, and pin questions directly onto nodes—then prompt the agent to pull a compact **semantic diff** instead of re-reading pixels or screenshots.

---

## Why Use Redlinify?

* **Built for Two-Way Editing (Unlike Mermaid or ASCII):** Mermaid renders read-only images, and ASCII boxes break on every edit. In Redlinify, both you and your agent edit the exact same structured `.design/views/*.json` graph.
* **Lock Approved Pieces (`Violet`) Against Agent Rewrites:** Once a service contract or entity schema is settled, lock it. The agent is strictly blocked from mutating or deleting locked nodes and edges—while still linking source files (`code_refs`) as implementation completes.
* **Token-Efficient Semantic Diffs (Zero Pixel Bloat):** Positions, edge bends, and zoom stay isolated in `.design/.layout/*.json` (gitignored). Agent checkpoints (`.design/.checkpoint/*.json`) tell the agent *only* the structural changes you made (`+added node`, `~changed field`, `open thread`).
* **Architectural & Crow's Foot ER Modes:** Model class/system architectures alongside database schemas (`PK`, `FK`, `UQ`, `IDX`, nullable `○` / mandatory `*`, Crow's foot cardinalities, and `is-a` subtypes).
* **Decisions & Context Stay Attached to the Code:** Resolved threads graduate into a searchable **Decision Log** under **Decisions** and link back to code references across `draft → needs_input → approved → implemented | drifted`.
* **Local-First & Zero Telemetry:** Everything lives in plain JSON inside `.design/` in your Git repo; the UI binds strictly to loopback (`127.0.0.1`).

---

## How It Works in 30 Seconds

```text
1. Ask your agent to design a feature or schema
   └─ Agent calls upsert_view() → auto-creates .design/, starts the local UI, returns ui_url

2. Open http://127.0.0.1:4173 (live-synced via WebSockets)
   └─ Edit boxes/fields, bend lines, reply to amber questions, lock approved cards in violet

3. Tell your agent: "Review my feedback in Redlinify"
   └─ Agent calls get_pending_feedback() → receives clean semantic diff + replies, implements code
```

---

## Zero-Friction Setup

Requires **Node.js >= 22.0.0**.

```bash
git clone https://github.com/wltwror/Redlinify.git
cd Redlinify
npm install
npm run build
npm test
```

Expose the `redlinify` binary globally (recommended so any project can use it without paths):

```bash
npm link -w @redlinify/server
redlinify --version
```

### Connect Your Coding Agent (Only Step Needed Per Machine)

Add Redlinify to Claude Code, Cursor, OpenCode, or any MCP-compatible client:

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

Or without `npm link`:

```json
{
  "mcpServers": {
    "redlinify": {
      "command": "node",
      "args": ["/path/to/Redlinify/packages/server/dist/cli.js", "mcp"]
    }
  }
}
```

**No manual `init` or manual `ui` terminal required by default:**
* The MCP server embeds built-in workflow instructions automatically so agents know how to draft views, pin questions, respect locks, and resolve decisions out of the box (you can also load [skill/SKILL.md](skill/SKILL.md) for custom skills).
* Running `redlinify mcp` from a project directory automatically locates your Git root, initializes `.design/` on the first diagram write, and spawns the detached loopback UI daemon (`127.0.0.1:4173`, picking the next free port if busy).
* Prefer opening the browser manually or shutting down the background UI? Pass `--no-ui` / `--open` on `mcp`, or use the CLI directly:

```bash
redlinify ui --open --dir /path/to/repo   # Launch UI and open browser immediately
redlinify stop --dir /path/to/repo        # Stop the detached UI daemon for a repo
redlinify init --dir /path/to/repo        # Pre-initialize .design/ explicitly
```

---

## Repository Structure (`.design/` inside your project)

```text
.design/
├── workspace.json              # Git-tracked: tab order, metadata, pending view_requests
├── views/
│   ├── architecture.json       # Git-tracked: semantic graph (zero pixel coordinates)
│   └── database_er.json
├── threads/
│   └── thr_a1b2c3d4e5f6.json   # Git-tracked: one file per anchored thread / decision
├── .layout/                    # Gitignored: manual node positions, edge bends, zoom
├── .checkpoint/                # Gitignored: last agent-authored semantic snapshot
└── .ui-server.json             # Gitignored: active detached UI server PID & port
```

---

## MCP Tool Reference (10 Tools)

| Tool | Purpose |
| :--- | :--- |
| `get_workspace_status` | List all tabs (`view_hash`, triage/drifted counts, human edit flags), `entity_ref` slugs, pending `view_requests`, and running `ui_url`. |
| `open_workbench` | Ensure the local detached workbench UI is running and return (or open in browser) the direct URL / deep link to a tab. |
| `get_view` | Read a semantic `DesignView` (zero coordinates), its `view_hash`, open threads, and optional 1-line Decision summaries. |
| `get_pending_feedback` | Pull semantic diffs since agent checkpoints, `view_hashes`, pending `view_requests`, and open threads awaiting agent response. |
| `upsert_view` | Create or replace a semantic `DesignView` with `base_hash` concurrency and lock protection; auto-starts the local UI and returns `ui_url`. |
| `patch_view` | Apply targeted edits (`meta`, add/update/remove nodes or edges, `section_ops`) with `base_hash` and lock guards; returns `ui_url`. |
| `acknowledge_feedback` | Advance agent checkpoints when human edits are accepted as-is. |
| `post_thread_message` | Open an anchored thread (`question`, `change_request`, `decision`, `drift_alert`), reply, or resolve with a 1-line `resolution_summary`. |
| `get_node_history` | Query full transcripts of resolved Decision (ADR) threads by `target_id`, `entity_ref`, `view_id`, or text search. |
| `sync_code_refs` | Link source `code_refs` (`path:symbol`) and update `implemented` / `drifted` status without clobbering unrelated human edits. |

---

## Canvas & Keyboard Controls

| Action | Shortcut / Gesture |
| :--- | :--- |
| Select element & open inspector | Click a box/entity or relationship line |
| Multi-select boxes | `Ctrl+Click` / `Cmd+Click` (or `Shift+Drag` marquee) |
| Connect two nodes | Drag from any 4-sided handle to another node |
| Bend or split an edge | Select a line and drag its midpoint or segment split handles |
| Inline edit title / entry / attribute | Double-click text inside an unlocked card |
| Quick actions menu | Right-click canvas, tab, card, or edge |
| Undo / Redo (nodes, edges & bends) | `Ctrl+Z` / `Ctrl+Shift+Z` (`Cmd` on macOS) |
| Delete selected unlocked elements | `Delete` or `Backspace` |
| Theme & canvas style | Top-right Sun/Moon (Dark/Light) and Dots/Grid toggles |

---

## Development & Architecture

```bash
npm run typecheck   # Type-check all workspace packages in topological order
npm run build       # Build @redlinify/shared, @redlinify/server, and @redlinify/ui
npm test            # Run Vitest unit & integration suites
```

Monorepo packages:

* `packages/shared` (`@redlinify/shared`): Zod v3 schemas, canonical hashing, semantic diff engine, lock/patch guards, and locked atomic storage (`@redlinify/shared/browser` for UI).
* `packages/server` (`@redlinify/server`): CLI (`mcp`, `ui`, `stop`, `init`), stdio MCP server (with workflow `instructions` + detached auto-UI launcher), and loopback HTTP + WebSocket UI host.
* `packages/ui` (`@redlinify/ui`): React 19 + TypeScript + Vite + `@xyflow/react` + `elkjs` Tailwind workbench.

See [SPEC.md](SPEC.md) for the specification and [AGENTS.md](AGENTS.md) for architectural invariants.

---

## Issues & License

Bug reports and PRs are welcome—run `npm run typecheck && npm run build && npm test` before submitting.

[MIT](LICENSE) © 2026 Vojtěch Faltus
