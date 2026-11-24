# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-11-24

### Added

* **Shared Core (`@redlinify/shared`)**: Zod v3 schemas (`DesignView`, `DesignThread`, `WorkspaceFile`, `ViewLayout`, ER attributes/cardinalities), canonical hashing, semantic diff engine, lock/patch guards, and locked atomic `.design/` storage.
* **MCP Server & CLI (`@redlinify/server`)**: `redlinify init`, `redlinify mcp`, and `redlinify ui` (`127.0.0.1:4173`) with 9 MCP tools, REST + WebSocket live reload, and `chokidar` self-echo suppression.
* **Workbench UI (`@redlinify/ui`)**: React 19 + React Flow + ELK layout canvas supporting both General architecture diagrams and Crow's Foot / Barker ER diagrams, smart non-overlapping edge routing, manual bend points, right-click context menus, inline card editing, Ctrl/Cmd multi-select, per-tab undo/redo, safe typed-confirmation tab deletion, anchored threads & searchable ADRs, top-level ErrorBoundary, and persistent **Dark / Light theme** toggle.
* **Agent Skill & Open-Source Tooling**: Reusable `skill/SKILL.md`, `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`, MIT `LICENSE`, GitHub Actions CI workflow, and issue/PR templates.
