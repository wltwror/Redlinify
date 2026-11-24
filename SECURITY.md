# Security Policy

## Architectural Security Posture

Redlinify is designed to run **locally** alongside your repository:

* **Loopback-Only Binding:** `redlinify ui` binds strictly to `127.0.0.1` by default (never `0.0.0.0` unless explicitly overridden by `--host`).
* **Zero Telemetry / External Calls:** The server and UI do not collect analytics or phone home.
* **Path Traversal Protection:** All `view_id`, `thread_id`, and entity identifiers used in filesystem paths under `.design/` are validated against a strict `idSlugSchema` (`^[a-z0-9][a-z0-9_-]{0,63}$`).
* **Request Size Limits:** HTTP mutation payloads are bounded (`5 MB`) in `packages/server/src/web.ts`.

## Supported Versions

| Version | Supported |
| :--- | :--- |
| `0.1.x` | Yes |

## Reporting a Vulnerability

If you discover a security vulnerability in Redlinify (for example, path traversal in `.design/` file resolution, XSS in rendered diagram/thread fields, or WebSocket/HTTP request smuggling):

1. **Please do not open a public GitHub issue** with exploit details while the fix is unreleased.
2. Report it privately using GitHub's **"Report a vulnerability"** advisory form on the repository's Security tab.
3. Include steps to reproduce, affected version/commit, and potential impact. We aim to acknowledge reports within 72 hours.
