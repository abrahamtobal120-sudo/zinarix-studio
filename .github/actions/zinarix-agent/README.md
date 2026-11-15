# zinarix agent (GitHub Action)

Corre el agente de Zinarix sin interfaz (`omni agent -p`) sobre el repositorio, y opcionalmente
abre un pull request con lo que cambió.

- Sigue las reglas del proyecto: `AGENTS.md`, `CLAUDE.md`, `.zinarix/rules/*.md`,
  `.cursor/rules/*.mdc` y `.github/copilot-instructions.md` (Fase 1).
- Ve las skills de `.zinarix/skills/` y ejecuta los hooks de `.zinarix/settings.json` (Fase 4).
- Solo trabaja dentro del repositorio: no puede leer `.git` ni salirse con `..`, enlaces o
  _junctions_.
- Los comandos que corre no reciben claves ni tokens (`*_API_KEY`, `*_TOKEN`, `*_SECRET`…).
- Nunca publica: `git push`, `gh pr`, `npm publish` y los deploys se rechazan siempre. El PR lo
  abre un paso aparte de la Action, que es el único que recibe `github-token`.

## Niveles de aprobación (`approve`)

| Nivel       | Leer | Editar archivos | Correr comandos             |
| ----------- | ---- | --------------- | --------------------------- |
| `read-only` | Sí   | No              | No                          |
| `auto-edit` | Sí   | Sí              | No                          |
| `full`      | Sí   | Sí              | Sí (menos los que publican) |

## Ejemplo: arreglar las pruebas que fallan y abrir un PR

```yaml
name: Agente
on: workflow_dispatch

permissions:
  contents: write
  pull-requests: write

jobs:
  fix:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          persist-credentials: false # el agente corre comandos: el token no queda en .git/config
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: 24, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - uses: <tu-org>/zinarix-studio/.github/actions/zinarix-agent@main
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
        with:
          prompt: Corre `pnpm test` y arregla lo que falle.
          model: anthropic/claude-sonnet-5-5
          approve: full
          open-pr: 'true'
```

Este repositorio trae el workflow listo en `.github/workflows/agent-fix.yml` (se lanza a mano).

## Entradas

| Entrada        | Por omisión              | Qué hace                                                |
| -------------- | ------------------------ | ------------------------------------------------------- |
| `prompt`       | —                        | La tarea (va por stdin, nunca en la línea de comandos). |
| `model`        | —                        | `provider/model`; su clave sale del entorno del job.    |
| `approve`      | `auto-edit`              | `read-only`, `auto-edit` o `full`.                      |
| `max-steps`    | `40`                     | Turnos del modelo antes de parar.                       |
| `open-pr`      | `false`                  | `true` hace commit en una rama nueva y abre un PR.      |
| `branch`       | `zinarix/agent-<run id>` | Rama del PR.                                            |
| `pr-title`     | primera línea del prompt | Título del PR.                                          |
| `lang`         | `es`                     | Idioma de los mensajes de la CLI.                       |
| `github-token` | `github.token`           | Solo lo usa el paso del PR.                             |

Salidas: `result` (ruta del JSON del resultado), `changed` (`true` si cambió archivos) y
`pr-url`.

## Desde la terminal

```sh
omni agent -p "explica cómo funciona el router" -m anthropic/claude-sonnet-5-5
omni agent -p "arregla las pruebas" --approve=full --json > resultado.json
git diff | omni agent --approve=read-only "revisa este diff"
omni agent -p "…" --stream-json   # un evento JSON por línea
```

Códigos de salida: `0` terminó · `1` error o tope de pasos · `3` clave inválida · `4` límite de
uso · `5` presupuesto · `130` cancelado.
