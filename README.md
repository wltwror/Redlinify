# Redlinify

**Redlinify** is a local-first, repo-native collaborative design workbench for human developers and AI coding agents.

* Semantic diagrams (`.design/views/*.json`) and discussion threads/ADRs (`.design/threads/*.json`) live in Git with **zero pixel coordinates**.
* Manual node positions and zoom live separately in `.design/.layout/*.json` (gitignored).
* Agent checkpoints (`.design/.checkpoint/*.json`, gitignored) power token-efficient semantic diffs via MCP.

---

## Quick Start

```bash
npm install
npm run build
npm test
```

### Initialize a Repository
```bash
node packages/server/dist/cli.js init --dir /path/to/repo --name MyProject
```

### Launch the Browser UI (`127.0.0.1:4173`)
```bash
node packages/server/dist/cli.js ui --dir /path/to/repo --port 4173
```

### MCP Client Configuration (stdio)
Add Redlinify to Claude Code, Cursor, OpenCode, or any MCP-compatible coding agent:

```json
{
  "mcpServers": {
    "redlinify": {
      "command": "node",
      "args": ["/home/ubuntu/Redlinify/packages/server/dist/cli.js", "mcp", "--dir", "/path/to/repo"]
    }
  }
}
```

Or if installed globally / linked via `npm link`:
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
