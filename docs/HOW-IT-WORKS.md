# How dsh-plugin-tool-doctor works

Diagnostico de servidores MCP instalados en DeepSeek Harness: arranca cada runtime en un DSH_HOME aislado, hace handshake MCP, lista sus tools y reporta los que fallan con stderr y duracion.

## Architecture

```
DSH ──MCP stdio──► server.mjs (single-file bundle)
                    └─ local plugin logic
```

## Safety

- Read by default; actions require `confirm:true`.
- `read-only` mode via environment variable.
- Allowlists where applicable.
- Audit at `<DSH_HOME>\cache\tool-doctor\audit.jsonl`.
- Action rate limit.

## Validation

End-to-end tests with the official MCP client (`@modelcontextprotocol/client@2.2.0`)
and the packaged artifact (`npm pack` → `postinstall` → deployed server).
