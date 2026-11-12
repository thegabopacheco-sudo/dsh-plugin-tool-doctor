# Cómo funciona dsh-plugin-tool-doctor

Diagnostico de servidores MCP instalados en DeepSeek Harness: arranca cada runtime en un DSH_HOME aislado, hace handshake MCP, lista sus tools y reporta los que fallan con stderr y duracion.

## Arquitectura

```
DSH ──MCP stdio──► server.mjs (bundle single-file)
                    └─ lógica local del plugin
```

## Herramientas reales

- `status`: Estado
- `scan`: Escanear servidores
- `check`: Revisar servidor

## Seguridad

- Lectura por defecto; acciones con `confirm:true`.
- Modo `read-only` por variable de entorno.
- Listas blancas cuando aplique.
- Auditoría en `<DSH_HOME>\cache\tool-doctor\audit.jsonl`.
- Rate limit de acciones.

## Verificación

Tests end-to-end con el cliente MCP oficial (`@modelcontextprotocol/client@2.2.0`)
y artefacto empaquetado (`npm pack` → `postinstall` → servidor desplegado).
