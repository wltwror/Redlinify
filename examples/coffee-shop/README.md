# Coffee Shop Sandbox (`examples/coffee-shop`)

Standalone sample `.design/` workspace for trying Redlinify interactively without modifying the main repository's `.design/` diagrams.

## Launch

From the repository root:

```bash
redlinify ui --open --dir examples/coffee-shop
```

(Or without a global `redlinify` link:)

```bash
node packages/server/dist/cli.js ui --open --dir examples/coffee-shop
```

## Things to Try

- Double-click card titles or items to edit inline (clear text + `Enter` removes entries).
- Drag boxes, click `+ Add Box`, or drag between 4-sided handles to connect orthogonal edges.
- Lock a node in **violet**, reply to the open question thread on `espresso_bar`, and open **Pending Review** to inspect the semantic diff.
