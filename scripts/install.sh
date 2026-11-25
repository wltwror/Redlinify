#!/usr/bin/env bash
set -euo pipefail

INSTALL_DIR="${REDLINIFY_HOME:-$HOME/.redlinify}"
REPO_URL="${REDLINIFY_REPO:-https://github.com/wltwror/Redlinify.git}"
BRANCH="${REDLINIFY_BRANCH:-main}"
BIN_DIR="${REDLINIFY_BIN_DIR:-$HOME/.local/bin}"
NO_GLOBAL_LINK=0

usage() {
  cat <<'EOF'
Redlinify installer (macOS / Linux / WSL)

Usage:
  install.sh [options]

Options:
  --dir <path>         Install directory (default: $REDLINIFY_HOME or ~/.redlinify)
  --repo <url>         Git repository URL (default: https://github.com/wltwror/Redlinify.git)
  --branch <name>      Git branch or tag to install (default: main)
  --bin-dir <path>     Fallback bin directory if global npm link fails (default: ~/.local/bin)
  --no-global-link     Skip `npm link -w @redlinify/server`; install launcher into --bin-dir
  -h, --help           Show this help message
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --dir)
      [ "$#" -ge 2 ] || { echo "Error: --dir requires a path." >&2; exit 1; }
      INSTALL_DIR="$2"
      shift 2
      ;;
    --repo)
      [ "$#" -ge 2 ] || { echo "Error: --repo requires a URL." >&2; exit 1; }
      REPO_URL="$2"
      shift 2
      ;;
    --branch)
      [ "$#" -ge 2 ] || { echo "Error: --branch requires a branch or tag name." >&2; exit 1; }
      BRANCH="$2"
      shift 2
      ;;
    --bin-dir)
      [ "$#" -ge 2 ] || { echo "Error: --bin-dir requires a path." >&2; exit 1; }
      BIN_DIR="$2"
      shift 2
      ;;
    --no-global-link)
      NO_GLOBAL_LINK=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Error: Unknown option '$1'. Run with --help for usage." >&2
      exit 1
      ;;
  esac
done

log() {
  printf '[redlinify] %s\n' "$*"
}

fail() {
  printf 'Error: %s\n' "$*" >&2
  exit 1
}

for cmd in git node npm; do
  command -v "$cmd" >/dev/null 2>&1 || fail "'$cmd' is required. Install Git and Node.js >= 22.12.0 (https://nodejs.org) first."
done

NODE_VER="$(node -p 'process.versions.node')"
IFS='.' read -r NODE_MAJOR NODE_MINOR _ <<EOF
$NODE_VER
EOF
if [ "${NODE_MAJOR:-0}" -lt 22 ] || { [ "${NODE_MAJOR:-0}" -eq 22 ] && [ "${NODE_MINOR:-0}" -lt 12 ]; }; then
  fail "Node.js >= 22.12.0 is required (found v${NODE_VER}). Please upgrade Node.js first."
fi

if [ -e "$INSTALL_DIR/.git" ]; then
  if [ -n "$(git -C "$INSTALL_DIR" status --porcelain)" ]; then
    fail "Existing clone at '$INSTALL_DIR' has uncommitted changes. Commit/stash them or choose another path with --dir."
  fi
  log "Updating existing Redlinify checkout at $INSTALL_DIR..."
  git -C "$INSTALL_DIR" fetch --tags origin
  git -C "$INSTALL_DIR" pull --ff-only origin "$BRANCH"
elif [ -e "$INSTALL_DIR" ]; then
  if [ -n "$(ls -A "$INSTALL_DIR" 2>/dev/null || true)" ]; then
    fail "Directory '$INSTALL_DIR' already exists and is not empty. Remove it or set REDLINIFY_HOME to another path."
  fi
  log "Cloning Redlinify ($BRANCH) into $INSTALL_DIR..."
  git clone --branch "$BRANCH" "$REPO_URL" "$INSTALL_DIR"
else
  mkdir -p "$(dirname "$INSTALL_DIR")"
  log "Cloning Redlinify ($BRANCH) into $INSTALL_DIR..."
  git clone --branch "$BRANCH" "$REPO_URL" "$INSTALL_DIR"
fi

ABS_INSTALL_DIR="$(cd "$INSTALL_DIR" && pwd)"

log "Installing dependencies..."
if [ -f "$ABS_INSTALL_DIR/package-lock.json" ]; then
  (cd "$ABS_INSTALL_DIR" && (npm ci || npm install))
else
  (cd "$ABS_INSTALL_DIR" && npm install)
fi

log "Building @redlinify/shared, @redlinify/server, and @redlinify/ui..."
(cd "$ABS_INSTALL_DIR" && npm run build)

CLI_JS="$ABS_INSTALL_DIR/packages/server/dist/cli.js"
chmod +x "$CLI_JS"

LINKED_VIA="local"
INSTALLED_CMD=""

if [ "$NO_GLOBAL_LINK" -eq 0 ]; then
  if (cd "$ABS_INSTALL_DIR" && npm link -w @redlinify/server >/dev/null 2>&1); then
    if command -v redlinify >/dev/null 2>&1 && redlinify --version >/dev/null 2>&1; then
      LINKED_VIA="npm-global"
      INSTALLED_CMD="$(command -v redlinify)"
    fi
  fi
fi

if [ "$LINKED_VIA" != "npm-global" ]; then
  mkdir -p "$BIN_DIR"
  ABS_BIN_DIR="$(cd "$BIN_DIR" && pwd)"
  INSTALLED_CMD="$ABS_BIN_DIR/redlinify"
  ESCAPED_CLI="$(printf '%s' "$CLI_JS" | sed "s/'/'\\\\''/g")"
  cat > "$INSTALLED_CMD" <<EOF
#!/usr/bin/env sh
exec node '${ESCAPED_CLI}' "\$@"
EOF
  chmod +x "$INSTALLED_CMD"
fi

INSTALLED_VERSION="$("$INSTALLED_CMD" --version)"

log "Installed Redlinify v${INSTALLED_VERSION} (${ABS_INSTALL_DIR})."
log "CLI executable: ${INSTALLED_CMD}"

case ":${PATH}:" in
  *":$(dirname "$INSTALLED_CMD"):"*)
    MCP_COMMAND="redlinify"
    ;;
  *)
    MCP_COMMAND="$INSTALLED_CMD"
    printf '\nNote: %s is not currently on your PATH.\n' "$(dirname "$INSTALLED_CMD")"
    printf 'Add this line to your shell profile (~/.bashrc, ~/.zshrc, etc.):\n'
    printf '  export PATH="%s:$PATH"\n' "$(dirname "$INSTALLED_CMD")"
    ;;
esac

cat <<EOF

Add Redlinify to your MCP client config (Claude Code, Cursor, OpenCode, etc.):

{
  "mcpServers": {
    "redlinify": {
      "command": "${MCP_COMMAND}",
      "args": ["mcp"]
    }
  }
}

Keep Redlinify up to date anytime with:
  redlinify update
EOF
