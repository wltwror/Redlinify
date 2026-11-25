# Redlinify — Finalized Coding Agent Specification (`SPEC.md`)

Everything below is the authoritative build specification for **Redlinify**, a local-first, repo-native collaborative design workbench for human developers and AI coding agents.

---

## 1. Project Overview & Goals

Build **Redlinify**, a local-first, repo-native collaborative design workbench for human developers and AI coding agents. Instead of iterating on software architecture exclusively through linear chat threads, the coding agent generates structured, multi-view diagrams stored as semantic JSON in the repository. The human reviews, edits, locks approved parts, and exchanges anchored comments/questions with the agent through a local browser UI.

**Core Design Principles:**

1. **Strict Separation of Truth, History, and Layout:**
   * Semantic graphs (`views/*.json`) and discussion threads (`threads/*.json`) are Git-tracked shared truth with **zero pixel coordinates**.
   * Manual visual positioning (`x`, `y`, viewport zoom) is isolated in `.layout/*.json` and never sent to the agent.
   * Agent checkpoints (`.checkpoint/*.json`) enable automatic, token-efficient **semantic diffs** whenever the human modifies a diagram.
2. **One Universal Visual Primitive:** Every view—whether class design, algorithm pipeline, external integrations, or dataflow—renders using the exact same **structured class-diagram box** (Header + typed sections + labeled/optionally numbered directed edges).
3. **Asynchronous, Prompt-Driven MCP Workflow:** No blocking review calls that risk tool timeouts. The agent updates files via MCP, the user edits/comments at their own pace in the browser, and when the user prompts the agent again, the agent pulls the exact semantic diff and open threads.
4. **Persistent Context & Living Docs:** Resolved comment threads remain anchored to nodes/edges as searchable Architecture Decision Records (ADRs). During implementation, nodes link to real source files (`code_refs`) and track `approved → implemented | drifted` status.

---

## 2. Tech Stack & Process Model

Redlinify is a **strict TypeScript monorepo** managed via **npm workspaces** (Node `>=22.12.0`, ESM with `NodeNext` resolution) so Zod v4 schemas, storage locking, guards, and semantic diff types are shared across the MCP server, HTTP/WebSocket server, and React UI with zero drift:

* **Shared (`packages/shared`):** TypeScript + `zod` (`^4.6.7`) schemas, canonical hashing, lock/patch guards, cross-process `.design/.lock` + atomic temp-rename JSON I/O, and the semantic diff engine.
* **Server/CLI (`packages/server`):**
  * `@modelcontextprotocol/sdk` (stdio transport via `redlinify mcp`).
  * CLI commands: `redlinify init`, `redlinify mcp`, `redlinify ui [--dir <path>] [--port <port>]`.
  * Local HTTP + WebSocket server (default **`127.0.0.1:4173`**, strictly loopback-bound) serving the built UI bundle, REST endpoints (`GET/PUT` with optimistic concurrency `base_hash` / `If-Match`), and `chokidar` file watching on `.design/` with **self-echo suppression** to broadcast real-time reloads when the agent modifies files.
  * *Why WebSockets over SSE for live sync:* All client→server writes already go over REST, and WebSockets avoid HTTP/1.1's 6-connection-per-origin browser cap across tabs, do not block automated Playwright `networkidle` checks (`verify-webapp`), and pass cleanly through local reverse proxies (`webapp-gateway`).
  * *Why separate stdio MCP and UI server over shared disk files:* Coding agents frequently spawn and restart stdio MCP processes. Keeping `.design/` on disk as the shared source of truth with cross-process locking and atomic writes ensures the user's browser tab stays alive and synced across agent restarts.
* **Frontend (`packages/ui`):** React 19 + TypeScript + Vite + `@xyflow/react` (React Flow) + `elkjs` (automatic hierarchical `TB` / `LR` layout) + Tailwind CSS.

```text
Redlinify/
├── package.json                # npm workspaces root
├── tsconfig.base.json
├── vitest.config.ts
├── packages/
│   ├── shared/
│   │   ├── src/
│   │   │   ├── schemas.ts      # Zod v4 schemas & regex constraints
│   │   │   ├── hash.ts         # Canonical JSON serialization & view_hash
│   │   │   ├── diff.ts         # Semantic diff engine (checkpoint vs. current)
│   │   │   ├── guards.ts       # Lock guards, code_ref preservation & applyViewPatch
│   │   │   ├── errors.ts       # Structured DesignError classes
│   │   │   ├── storage.ts      # Cross-process .lock, atomic I/O, DesignStorage
│   │   │   └── index.ts
│   │   └── test/
│   ├── server/
│   │   └── src/
│   │       ├── cli.ts          # `redlinify init`, `redlinify mcp`, `redlinify ui`
│   │       ├── mcp.ts          # 9 MCP tools registration & validation
│   │       └── web.ts          # REST API + WebSocket watcher (self-echo suppression)
│   └── ui/
│       └── src/
│           ├── components/
│           │   ├── TabBar.tsx          # Tabs + triage badges + `+` request/blank modal
│           │   ├── TriageBar.tsx       # Filter bar + Pending Review / Open Questions triggers
│           │   ├── StructuredNode.tsx  # Universal class-box React Flow node
│           │   ├── StepEdge.tsx        # Directed edge with optional step badge & label
│           │   └── InspectorDrawer.tsx # Spec / Threads / Links & Code / Workspace Triage drawer
│           ├── layout/elk.ts           # ELKjs auto-layout + incremental .layout/ merge
│           └── store/workspace.ts      # Client state + WebSocket sync
└── skill/
    └── SKILL.md                        # Agent workflow instructions
```

---

## 3. Target Repository File Structure (`.design/`)

Inside any project using Redlinify, all state lives in `.design/`:

```text
.design/
├── .gitignore                  # Generated by `redlinify init`: ignores .layout/, .checkpoint/, .lock, .tmp-*
├── workspace.json              # Git-tracked: tab order, view metadata, user view_requests
├── threads/                    # Git-tracked: one file per thread (prevents merge conflicts & lost updates)
│   └── thr_a1b2c3d4e5f6.json
├── views/
│   ├── classes.json            # Git-tracked: semantic graph (zero coordinates)
│   ├── algorithm.json
│   └── integrations.json
├── .layout/                    # Gitignored: manual node positions & viewport zoom
│   └── classes.json
├── .checkpoint/                # Gitignored: last agent-authored semantic snapshot per view
│   └── classes.json
└── .lock                       # Gitignored: short-lived cross-process mutex file
```

---

## 4. Exact Data Schemas

Implemented strictly with Zod v4 in `packages/shared/src/schemas.ts`:

* **ID & Slug Guardrails:**
  * `ID_SLUG_REGEX = /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/` — enforced on `view.id`, `node.id`, `section.id`, `edge.id`, `thread.id`, `view_request.id` (prevents path traversal and guarantees filesystem safety).
  * `ENTITY_REF_REGEX = /^[a-z0-9]+(?:_[a-z0-9]+)*$/` — canonical `snake_case` enforced on `entity_ref` so cross-tab linking stays consistent.

```typescript
// .design/workspace.json
export interface WorkspaceFile {
  version: 1;
  project_name: string;
  tabs: Array<{
    view_id: string;        // matches views/{view_id}.json
    title: string;          // e.g. "Classes", "Algorithm", "Integrations"
    description?: string;
    order: number;
  }>;
  view_requests: Array<{
    id: string;
    title: string;          // e.g. "Dataflow"
    prompt: string;         // e.g. "Show event ingestion, caching, and deduplication"
    created_at: string;
  }>;
}

// .design/views/{view_id}.json
export type NodeStatus = "draft" | "needs_input" | "approved" | "implemented" | "drifted";

export interface BoxSection {
  id: string;
  heading: string;          // e.g. "Fields", "Methods", "Invariants", "Endpoints"
  items: string[];          // concise lines; UI caps visible items at 5 with "+N more"
}

export interface DesignNode {
  id: string;               // stable slug, e.g. "dedup_engine"
  entity_ref?: string;      // optional canonical snake_case key linking same concept across tabs
  kind: string;             // short badge: "Class", "Interface", "Stage", "External API", "Store"
  title: string;
  summary?: string;
  status: NodeStatus;
  locked: boolean;          // if true, agent CANNOT mutate/delete/unlock via save_view
  sections: BoxSection[];
  code_refs?: Array<{
    path: string;           // repo-relative path, e.g. "src/dedup/engine.py"
    symbol?: string;        // e.g. "DedupEngine"
  }>;
}

export interface DesignEdge {
  id: string;
  source: string;           // must match a DesignNode.id in this view
  target: string;           // must match a DesignNode.id in this view
  label?: string;
  step?: number;            // optional 1, 2, 3... for ordered request/retry flows
  style?: "solid" | "dashed";
  locked?: boolean;         // optional; if true, agent CANNOT mutate/delete/unlock this edge
}

export interface DesignView {
  id: string;
  title: string;
  direction: "TB" | "LR";   // Top-Bottom for classes/algos; Left-Right for integrations/dataflow
  created_by?: "agent" | "human"; // aids missing-checkpoint baseline resolution
  nodes: DesignNode[];
  edges: DesignEdge[];
}

// .design/threads/{thread_id}.json
export interface ThreadMessage {
  id: string;
  author: "human" | "agent";
  body: string;
  created_at: string;
}

export interface DesignThread {
  id: string;
  target_type: "workspace" | "view" | "node" | "edge";
  view_id?: string;
  target_id?: string;       // node.id or edge.id
  entity_ref?: string;      // auto-populated from node if present, for cross-tab ADR lookup
  kind: "question" | "change_request" | "decision" | "drift_alert";
  status: "open" | "resolved";
  resolution_summary?: string; // 1-line ADR summary written on resolve
  messages: ThreadMessage[];
}

// .design/.layout/{view_id}.json
export interface ViewLayout {
  positions: Record<string, { x: number; y: number }>;
  viewport?: { x: number; y: number; zoom: number };
}
```

---

## 5. MCP Tool Surface (6 Lean Orthogonal Tools)

Expose coarse, high-signal tools with lean wire schemas and `readOnlyHint` annotations on `redlinify mcp` (strict slug/schema validation runs inside handlers; write calls return compact non-echoing metadata):

| Tool | Inputs | Behavior & Return Value |
| --- | --- | --- |
| `get_workspace` | `{ view_id?, include_diff?: boolean, open_browser?: boolean }` | **Read hub & iteration tool.** Returns tabs (with `view_hash`, thread counts, `drifted_count`, `has_human_edits`, `diff_counts`), `view_requests`, `entity_refs` registry, and (by default) `view_diffs`, `view_hashes`, and `pending_threads` awaiting agent response. Pass `open_browser: true` to ensure/open the UI and return `ui_url`. |
| `get_view` | `{ view_id, include_resolved_summaries?: boolean }` | Returns `{ view, view_hash, open_threads }` for that view. Optionally includes 1-line `resolution_summary` metadata for resolved threads (keeps tokens low). |
| `get_decisions` | `{ view_id?, target_id?, entity_ref?, query?, status?: "resolved" \| "open" \| "all" }` | Returns matching thread transcripts (default `status: "resolved"`) so the agent can recall ADRs, past tradeoffs, and rejected alternatives on demand. |
| `save_view` | `{ view_id?, mode?: "replace" \| "patch" \| "acknowledge", base_hash?, title?, diagram_type?, direction?, nodes?, edges?, remove_nodes?, remove_edges?, fulfill_request_id?, force?, acknowledge_views? }` | Unified write endpoint (`mode="replace"` creates/replaces a full view; `mode="patch"` upserts nodes/edges by `id` with `section_ops`/nullable clears and `remove_*`; `mode="acknowledge"` advances checkpoints). Enforces `base_hash` optimistic concurrency, code ref preservation, and violet lock guards; auto-starts the local UI and returns `{ mode, view_id, view_hash, ui_url, ... }`. |
| `post_thread` | `{ thread_id?, target_type?, view_id?, target_id?, entity_ref?, kind?, body, resolve?: boolean, reopen?: boolean, resolution_summary?: string }` | Creates a new thread file `.design/threads/{id}.json` or appends an `agent` reply. For `target_type: "node"`, auto-populates `entity_ref` from the target node when omitted. Setting `resolve: true` requires a non-empty `resolution_summary` so it is archived as an ADR. |
| `sync_code_refs` | `{ view_id, updates: Array<{ node_id, status: "implemented" \| "drifted", code_refs }> }` | Updates implementation links and statuses on matching nodes—explicitly **allowed on `locked: true` nodes**—without touching other node fields. Patches **only** `status` and `code_refs` on those nodes inside `.checkpoint/{view_id}.json` so unrelated pending human edits remain visible in `get_workspace`. |

---

## 6. Semantic Diff Engine, Checkpoint Baseline & Storage Rules

### 6.1 Semantic Diff Rules (`computeSemanticDiff(checkpointView, currentView)`)
* **Ignore:** `.layout/` files, JSON key ordering, whitespace, and non-semantic `created_by`.
* **Detect & emit:**
  * `view_meta_changed` (`title`, `direction`)
  * `nodes_added`: full new `DesignNode` objects.
  * `nodes_removed`: `{ id, title }` of deleted nodes.
  * `nodes_modified`: `{ id, title, changes, sections_added, sections_removed, sections_modified }` — section items are diffed at the item level (`added_items`, `removed_items`, `reordered`) with ID matching first and unique heading fallback.
  * `edges_added`, `edges_removed`, `edges_modified`.
* If `checkpointView === null` (human-created new view), treat all nodes/edges as `nodes_added` / `edges_added`.

### 6.2 Missing-Checkpoint Baseline Resolution
Because `.design/.checkpoint/` is gitignored, fresh clones and branch switches start with an empty `.checkpoint/` directory. When `.checkpoint/{id}.json` is missing:
1. If `currentView.created_by === "human"`, return `null` (new manual draft: all nodes/edges appear as `nodes_added` / `edges_added`).
2. Otherwise, check `git show HEAD:.design/views/{id}.json`: if valid `DesignView` JSON exists at `HEAD`, seed `.checkpoint/{id}.json` from `HEAD` and return it.
3. Otherwise (e.g., repository without Git or untracked agent view after `.checkpoint/` wipe), seed `.checkpoint/{id}.json` from `currentView` and return `currentView` so committed designs do not falsely appear as unsynced edits.

### 6.3 Storage Concurrency & Atomicity
* All read-modify-write sequences acquire `.design/.lock` via exclusive file creation (`O_CREAT | O_EXCL` / Node `"wx"`) with retry backoff and stale-lock recovery (stale timestamp or dead PID via `ESRCH`).
* Every file write uses `writeJsonAtomic`: writes to `.tmp-{pid}-{ts}-{uuid}.json` in the target directory, `fsync`s, closes, and atomically `rename`s over the destination.

---

## 7. Interactive Browser UI Requirements

Build a clean, dark-mode-friendly developer workbench hosted at **`http://127.0.0.1:4173`** (loopback-only default):

1. **Browser-Style Top Tab Bar (`TabBar.tsx`):**
   * One tab per entry in `workspace.json`, ordered by `order` (and reorderable).
   * **Triage badges on tabs:**
     * **Amber pill with count** = open threads where the last message is from `agent` (waiting on human).
     * **Blue dot** = view has unsynced human edits (diff vs. checkpoint) or open threads waiting on `agent`.
     * **Red dot** = contains `drifted` nodes.
   * **`+` Button** at the right end of the tab strip with two choices:
     * *Request View from Agent* (title + short prompt -> appends to `workspace.view_requests` and renders as a pending placeholder tab).
     * *Create Blank View* (creates an empty `views/{id}.json` with `created_by: "human"` so the user can sketch manually).
2. **Canvas & Unified Structured Box (`StructuredNode.tsx`, `StepEdge.tsx`):**
   * Renders every node as a crisp class-diagram card:
     * Top bar: `kind` pill badge, bold `title`, status indicator dot/pill, lock icon button, and open-thread count badge.
     * Body: Horizontal dividers separating each `BoxSection` (`heading` + monospaced/clean `items`). Cap canvas display at **5 items per section** with an inline `+N more` expand toggle so large nodes never blow up the graph.
     * Highlight ring on nodes modified by the human since the last agent checkpoint.
   * **Layout Engine (`elkjs`):**
     * Auto-lays out nodes according to `view.direction` (`TB` or `LR`) using deterministic estimates + measured dimensions.
     * Applies `.layout/{view_id}.json` manual position overrides only for nodes that have saved positions so adding one node doesn't scramble existing ones.
     * Includes an **"Auto-Layout / Reset Positions"** toolbar button that clears overrides for the active tab.
   * **Lightweight Inline Editing:**
     * Toolbar `+ Add Box` button.
     * Drag from node handles to create a new edge (prompts inline for optional label & step number).
     * Double-click title or section items to edit inline; `Delete`/`Backspace` removes selected **unlocked** nodes/edges **only when no input/textarea/contentEditable element is focused**.
     * All edits persist via REST API (`PUT /api/views/:id` with `base_hash`) immediately to `.design/views/{id}.json`, while drags persist separately to `PUT /api/layout/:id`.
3. **Top Triage Filter Bar & Pending Review Bridge:**
   * Filter/dim canvas nodes by: `All`, `Waiting on Me` (agent questions), `My Edits`, `Locked`, `Drifted`.
   * **Workspace / View Triage Panel** (accessible via top-bar button or when no node/edge is selected):
     * **Open Questions Queue** across all tabs with 1-click *"Jump to node/edge"* navigation.
     * **View/Workspace threads** and **Archived ADRs** (including threads on deleted nodes).
     * **Pending for Agent** preview showing the live `computeSemanticDiff` summary + open human replies + view requests, plus a **1-click "Copy Prompt for Agent"** button.
4. **Right-Hand Inspector Drawer (`InspectorDrawer.tsx`, responsive slide-over sheet on mobile `<768px`):**
   * **Spec Tab:** Edit `title`, `kind`, `summary`, `entity_ref`, `status`, `locked` toggle, and add/edit/reorder/delete `sections` and `items`.
   * **Threads Tab:** Chat-style list of threads anchored to this node/edge, start new `change_request` or `question` thread, reply (`author: "human"`), `Resolve` with optional 1-line `resolution_summary`, plus "Resolved Decisions (ADRs)" accordion.
   * **Links & Code Tab:**
     * **"Also in:" cross-tab pills:** Scans other views for matching `entity_ref`. Clicking switches tabs, centers viewport on the linked node, and briefly pulses it.
     * **Code References:** Displays `code_refs` (`path:symbol`) with copy-path button.
5. **Real-Time Sync (WebSockets):**
   * Server `chokidar` watches `.design/` (ignoring `.tmp-*`, `.lock`, `.layout/`, `.checkpoint/`) and suppresses self-echoes triggered by UI REST mutations.
   * Pushes `{ type: "workspace_updated" | "view_updated" | "threads_updated", view_id? }` over WebSocket.
   * Shows a subtle non-blocking toast (*"Agent updated Integrations (+1 question)"*) without resetting current pan/zoom.

---

## 8. Agent Workflow Skill (`skill/SKILL.md`)

Ship a ready-to-install `SKILL.md` defining the agent's behavioral contract:
* **Initial Design:** Call `get_workspace()` first to inspect existing tabs and `entity_refs`. Generate 2–4 focused views (`Classes`, `Algorithm`, `Integrations`, `Dataflow`) via `save_view`, keeping boxes concise and `entity_ref` slugs consistent.
* **Ask in the Diagram, Not in Chat:** Pin `question` threads via `post_thread` with node status `needs_input` whenever an architectural ambiguity exists.
* **Iterating on Feedback:** Always start with `get_workspace()`. Use `save_view({ mode: "patch", base_hash, ... })` for targeted updates, `save_view({ mode: "replace", base_hash, ... })` for full rewrites, and `save_view({ mode: "acknowledge", ... })` when accepting human edits without modifying a diagram. Never mutate or unlock `locked: true` nodes/edges. Resolve settled threads with a crisp 1-line `resolution_summary`.
* **Implementation & Living Docs:** Before coding, call `get_view` and `get_decisions` on relevant `entity_ref`s. Afterward, call `sync_code_refs` to attach `code_refs` and transition `approved -> implemented | drifted` (posting a `drift_alert` thread if reality forced a deviation).

---

## 9. Phased Implementation Plan

1. **Milestone 1 — Core Schema, Storage & Diff Engine (`packages/shared`):** Implement Zod v4 schemas, canonical hashing, lock/patch guards, cross-process locking + atomic `.design/` file I/O, missing-checkpoint Git fallback, and `computeSemanticDiff` with comprehensive unit & integration tests.
2. **Milestone 2 — CLI & MCP Server (`packages/server`):** Implement `redlinify init` and `redlinify mcp` over stdio with all 6 lean MCP tools and end-to-end tests against `.design/`.
3. **Milestone 3 — Local Web Server & Read-Only Multi-Tab Canvas (`packages/server` + `packages/ui`):** Build `redlinify ui` (`127.0.0.1:4173` REST + WebSocket + `chokidar` self-echo suppression), `TabBar`, `StructuredNode`, `StepEdge`, and `elkjs` auto-layout (`TB`/`LR`) with `.layout/` persistence.
4. **Milestone 4 — Interactive Editing, Threads & Cross-Tab Links:** Implement inline editing, `+ Add Box`, edge creation, `InspectorDrawer` (Spec / Threads / Links & Code), `+ Request View` stubs, and WebSocket live reload without losing viewport state.
5. **Milestone 5 — Triage UX & Skill Packaging:** Add tab triage badges, canvas diff highlights, triage filter bar, Pending Review / Copy Prompt bridge, Open Questions queue, and finalize `skill/SKILL.md` + `README.md`.
