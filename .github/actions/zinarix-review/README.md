# zinarix review (GitHub Action)

Revisión de código con IA en cada pull request, con la CLI `omni review` de Zinarix:

- Hallazgos por severidad (crítico, alto, medio, bajo), archivo y línea.
- Puede usar varios modelos; lo que encuentran dos cuenta una sola vez.
- Un paso de verificación que descarta falsos positivos.
- Publica una revisión en el PR con comentarios en la línea de cada hallazgo (`post: true`).
- Busca secretos y código inseguro en las líneas que agrega el PR (`security: false` lo quita).
- Sigue la guía del proyecto: `.zinarix/review.md` (solo para revisiones) y el `AGENTS.md` raíz.
- No repite comentarios: si un hallazgo ya se publicó en el PR (en otro push o desde la app),
  no se vuelve a publicar.
- Respeta `.zinarix/review-ignore.json`: los hallazgos que el equipo marcó como "no es un
  problema" (desde la app) no vuelven a salir.
- Las anotaciones también aparecen en la pestaña _Files changed_, y el informe en Markdown en el
  resumen del job.

## Ejemplo

```yaml
name: Revisión con IA
on:
  pull_request:

permissions:
  contents: read
  pull-requests: write

jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0 # la revisión compara contra la rama base
      - uses: <tu-org>/zinarix-studio/.github/actions/zinarix-review@main
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
        with:
          models: anthropic/claude-sonnet-5-5, openai/gpt-5
          verifier: anthropic/claude-opus-5-5
          fail-on: high # opcional: el job falla si hay hallazgos altos o críticos
```

## Entradas

| Entrada         | Por defecto                     | Qué hace                                                                  |
| --------------- | ------------------------------- | ------------------------------------------------------------------------- |
| `models`        | modelo predeterminado de la CLI | Modelos que revisan, separados por comas                                  |
| `verifier`      | el primer modelo                | Modelo que verifica cada hallazgo                                         |
| `verify`        | `true`                          | `false` quita la verificación (más rápido, más falsos positivos)          |
| `base`          | `origin/<rama base del PR>`     | Contra qué se compara                                                     |
| `post`          | `true`                          | Publica los hallazgos como una revisión del PR                            |
| `fail-on`       | vacío                           | Falla el paso si hay hallazgos de esa severidad o más (código 6)          |
| `security`      | `true`                          | `false` quita la búsqueda de secretos y código inseguro                   |
| `project-files` | `true`                          | `false` no lee `.zinarix/review.md`, `AGENTS.md` ni la lista de ignorados |
| `lang`          | `es`                            | Idioma del texto (`es` o `en`)                                            |
| `github-token`  | `github.token`                  | Token con el que `gh` publica la revisión                                 |

Las llaves de los modelos se leen de las variables de entorno del job (`ANTHROPIC_API_KEY`,
`OPENAI_API_KEY`, `GEMINI_API_KEY`…). El diff pasa por el filtro de secretos de `omni` antes de
enviarse al modelo.

### Cuidado con PRs de forks

La guía y la lista de ignorados se leen del checkout del PR, así que quien abre el PR puede
cambiarlas. En repositorios que aceptan PRs de desconocidos, usa `project-files: false` o haz
checkout de la rama base para esos archivos.

## Desde la terminal

```sh
omni review                         # cambios locales contra HEAD
omni review --base origin/main      # la rama actual contra main
omni review --pr 42 --post          # un PR de GitHub, y publica la revisión
omni review -m anthropic/claude-sonnet-5-5 -m openai/gpt-5 --verifier anthropic/claude-opus-5-5
omni review --format json | jq '.findings[] | select(.severity == "critical")'
```
