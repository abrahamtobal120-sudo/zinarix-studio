# Banco de tareas del agente

Mide qué tan bien resuelve tareas reales el agente de Zinarix (`omni agent`), con cualquier
modelo conectado. Sirve para saber si un cambio en el motor del agente mejora o empeora.

## Uso

```bash
pnpm build                                        # el banco usa apps/cli/dist
pnpm evals:check                                  # comprueba las tareas, sin usar ningún modelo
pnpm evals --model ollama/qwen2.5-coder:7b        # corre las 12 tareas con ese modelo
pnpm evals --model openai/gpt-5-mini --task 03,12 --runs 3 --label antes-de-A5
```

Opciones: `--task` (prefijos separados por coma), `--runs` (repeticiones), `--max-steps`
(pasos por tarea, 25 por omisión), `--timeout` (segundos por tarea, 600), `--keep` (no borra
las carpetas de trabajo) y `--label` (nombre del archivo de resultados).

Imprime una tabla por tarea (resuelta o no, pasos, herramientas y errores, tokens, costo y
tiempo) y guarda el detalle en `evals/results/<fecha>-<etiqueta>.json`.

Correr el banco con un modelo de pago cuesta dinero: cada tarea es una sesión completa del
agente.

## Cómo es una tarea

```
evals/tasks/<id>/
  task.json    título, prompt y, si hace falta, "approve" (full por omisión) y "crlf"
  repo/        el proyecto sobre el que trabaja el agente (se copia a una carpeta temporal)
  check.mjs    comprobación oculta: se copia solo cuando el agente terminó; código 0 = resuelta
  solution/    solución de referencia (la usa `pnpm evals:check`)
```

- El agente nunca ve `check.mjs` ni `solution/`.
- La respuesta final del agente se guarda en `__answer__.txt` antes de la comprobación (para
  tareas de solo lectura).
- `"crlf": ["ruta"]` convierte esos archivos a fin de línea de Windows al preparar la tarea
  (git los guarda con LF).
- Las tareas no instalan nada: solo Node.

`pnpm evals:check` exige que cada tarea **falle** tal como viene y **pase** con su solución.
Corre en CI.

## Qué cubren las 12 tareas

Arreglar un error con la causa a la vista (01, 08), con la causa en otro módulo (06) y en
código asíncrono (04); escribir código desde una especificación (02, 09); cambios en varios
archivos (03, 07); ampliar un programa de línea de comandos (05); editar una línea entre
muchas casi iguales (10); responder sin tocar nada (11); y respetar fin de línea CRLF y
tabuladores (12).

Faltan, a propósito de la meta de 30–50 tareas: proyectos más grandes, TypeScript con
comprobación de tipos, Python, tareas que piden correr las pruebas del proyecto y tareas
largas que llenen el contexto.
