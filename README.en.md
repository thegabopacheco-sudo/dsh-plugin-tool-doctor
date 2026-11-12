# dsh-plugin-tool-doctor — Tool Doctor

Diagnostico de servidores MCP instalados en DeepSeek Harness: arranca cada runtime en un DSH_HOME aislado, hace handshake MCP, lista sus tools y reporta los que fallan con stderr y duracion.

## Tools

| Tool | Qué hace |
|---|---|
| `status` | Estado |
| `scan` | Escanear servidores |
| `check` | Revisar servidor |

## Instalación

Desde **DSH → Settings → Plugins** instala `github:thegabopacheco-sudo/dsh-plugin-tool-doctor` y permite el script de instalación.

```
dsh plugin --profile <perfil> add github:thegabopacheco-sudo/dsh-plugin-tool-doctor
```

## Seguridad

- Lectura por defecto; escritura solo con `confirm:true` y pedido explícito.
- `DSH_TOOL_DOCTOR_MODE=read-only` desactiva acciones.
- Listas blancas y auditoría en `<DSH_HOME>\cache\tool-doctor\audit.jsonl`.

## Licencia

MIT © thegabopacheco-sudo
