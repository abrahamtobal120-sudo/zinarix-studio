# Transiciones de la comunidad

Cada archivo `.json` de esta carpeta es una transición de video que cualquier usuario de Zinarix Studio puede usar. Aparecen en **Video Studio → Transiciones → De la comunidad**: las que ya estaban al compilar la app vienen dentro del instalador, y las nuevas se descargan de aquí con el botón **Actualizar**.

## Cómo compartir una

1. Crea la transición. Puedes pedírsela a la IA, por ejemplo: _"crea una transición que entre girando con zoom"_. Queda guardada en **Mis transiciones**.
2. Pulsa **Compartir en GitHub** en su tarjeta, o pídeselo a la IA.
3. Se abre GitHub con el archivo ya escrito. Inicia sesión y pulsa **Propose changes**. Si no tienes permiso de escritura, GitHub crea solo un fork y un pull request.
4. Cuando se aprueba el pull request, la transición llega a todos los usuarios.

## Formato

Solo contiene datos, nunca código. Por eso es seguro descargar transiciones de otras personas.

```json
{
  "format": "zinarix-transition",
  "version": 1,
  "id": "zoom-desde-lejos",
  "name": "Zoom desde lejos",
  "description": "Opcional, hasta 200 caracteres.",
  "author": "Opcional",
  "ease": "smooth",
  "channels": {
    "alpha": [
      { "t": 0, "v": 0 },
      { "t": 0.35, "v": 1 },
      { "t": 1, "v": 1 }
    ],
    "scale": [
      { "t": 0, "v": 0.3 },
      { "t": 0.7, "v": 1.06 },
      { "t": 1, "v": 1 }
    ]
  }
}
```

- `t` va de 0 (empieza la transición) a 1 (el clip ya está en su lugar).
- Canales:

  | Canal                                                               | Valores | Valor final |
  | ------------------------------------------------------------------- | ------- | ----------- |
  | `alpha` (opacidad)                                                  | 0 a 1   | 1           |
  | `dx`, `dy` (desplazamiento, como parte del ancho o alto del cuadro) | −1 a 1  | 0           |
  | `scale` (tamaño)                                                    | 0.1 a 3 | 1           |
  | `reveal` (parte visible desde la izquierda)                         | 0 a 1   | 1           |

- Cada canal tiene de 2 a 12 claves. La última siempre es el valor final, para que el clip termine en su lugar.
- `ease`: `smooth` (suave) o `linear` (lineal).
- `id`: minúsculas, números y guiones. El nombre del archivo debe ser `<id>.json`.

La prueba `apps/desktop/test/communityTransitions.test.ts` revisa todos los archivos de esta carpeta. Un pull request con un archivo inválido no pasa CI.
