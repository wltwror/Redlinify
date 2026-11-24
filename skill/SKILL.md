---
name: redlinify
description: >-
  Collaborative software design workflow using Redlinify MCP tools to author,
  review, and keep multi-view architectural diagrams synced with code.
---

# Redlinify Design Workflow (`SKILL.md`)

Use Redlinify whenever designing, refactoring, or clarifying non-trivial software architecture with the human developer.

## 1. Initial Design
1. Call `get_workspace_status()` first to inspect existing views, pending `view_requests`, and existing `entity_ref` slugs.
2. Choose **2–4 focused views** matching the problem (typically `Classes`, `Algorithm`, `Integrations`, and `Dataflow` when relevant) and author them via `upsert_view`.
3. Keep structured cards concise (4–6 items per section). Reuse canonical `snake_case` `entity_ref` slugs for concepts spanning multiple views.

## 2. Ask in the Diagram, Not in Chat
* When facing a genuine architectural tradeoff or ambiguity, commit your best draft choice, set the node's `status` to `"needs_input"`, and anchor a concise `question` thread on that exact node or edge via `post_thread_message`.
* Keep your chat message brief (e.g., *"Drafted 3 views and pinned 2 questions—open Redlinify to review"*).

## 3. Iterating on Human Feedback
1. Always begin by calling `get_pending_feedback()`.
2. Process every pending `view_request` (pass `fulfill_request_id` to `upsert_view`), every human semantic diff, and every open human thread.
3. **Never mutate, delete, or unlock (`locked: true -> false`) locked nodes or locked edges.** If a requested change conflicts with a locked element, explain the tradeoff in a `question` thread via `post_thread_message`.
4. Use `patch_view` (with `base_hash`) for targeted edits, `upsert_view` (with `base_hash`) for major restructures, and `acknowledge_feedback` when accepting human edits as-is.
5. Resolve settled threads (`resolve: true`) with a crisp 1-line `resolution_summary` so they graduate into searchable ADRs.

## 4. Implementation & Living Docs
1. Before implementing a module, call `get_view` and `get_node_history` on its `entity_ref` to respect prior decisions and rejected alternatives.
2. After implementing code, call `sync_code_refs` to link `path:symbol` references and transition nodes to `"implemented"`.
3. If real implementation constraints force an architectural deviation, mark the affected node `"drifted"` via `sync_code_refs` and post a `drift_alert` thread via `post_thread_message` explaining why.

## 5. ER Diagrams & Database Schema Translation
* When modeling database schemas, set `diagram_type: "er"` on the `DesignView`, `kind: "Entity"` on tables, and define columns in `node.fields` (`name`, `type`, `pk`, `fk`, `unique`, `nullable`, `indexed`, `default_value`, `note`).
* Define relationships using `source_cardinality` / `target_cardinality` (`"1"`, `"0..1"`, `"1..*"`, `"0..*"`) and `relation_kind` (`"association"`, `"identifying"`, `"subtype"`).
* When translating an ER diagram into SQL/ORM models, combine `node.fields` + `edges` + `get_node_history` ADRs; if on-delete rules or composite constraints aren't explicitly noted yet, ask in a node/edge `question` thread or check existing ADRs first.
