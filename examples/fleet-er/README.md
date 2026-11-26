# Fleet ER Sandbox (`examples/fleet-er`)

Standalone Crow's Foot Entity-Relationship workspace for trying Redlinify's relational schema mode without modifying the main repository's `.design/` diagrams.

## Launch

From the repository root:

```bash
redlinify ui --open --dir examples/fleet-er
```

(Or without a global `redlinify` link:)

```bash
node packages/server/dist/cli.js ui --open --dir examples/fleet-er
```

## Things to Try

- Inspect `PK` / `FK` / `UQ` badges, mandatory (`*`) vs optional (`○`) fields, Crow's foot cardinalities (`1`, `0..1`, `1..*`, `0..*`), and `is-a` subtype relationships (`Van` / `Car` → `Vehicle`).
- Double-click an entity title or field to edit inline; clear a field name + press `Enter` to delete it, then `Ctrl+Z` to restore.
- Drag edge bend handles or connect entities from any 4-sided handle, then export to Mermaid `erDiagram`, vector `SVG`, or `PNG`.
