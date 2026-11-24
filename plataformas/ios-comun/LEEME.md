# Código compartido de iPhone y iPad

Las apps de `plataformas/iphone` y `plataformas/ipad` usan este mismo código (Swift, UIKit, sin librerías externas). Cada app solo agrega su `App/Variante.swift` y su `project.yml`.

| Archivo                                 | Qué hace                                                                                      |
| --------------------------------------- | --------------------------------------------------------------------------------------------- |
| `Fuentes/App.swift`                     | Arranque, ventanas (iPhone: lista → panel; iPad: barra lateral + panel) y bloqueo con Face ID |
| `Fuentes/Link.swift`                    | Qué enlaces de Zinarix se aceptan (las mismas reglas que la app de Android)                   |
| `Fuentes/Computers.swift`               | Computadoras guardadas y opciones                                                             |
| `Fuentes/PanelViewController.swift`     | El panel de la computadora y el puente `ZinarixNative` que usa `phonePage.ts`                 |
| `Fuentes/ComputersViewController.swift` | Lista de computadoras; agregar por QR, pegando o escribiendo                                  |
| `Fuentes/ScannerViewController.swift`   | Lector de QR                                                                                  |
| `Fuentes/OptionsViewController.swift`   | Opciones de la app                                                                            |
| `Fuentes/Texts.swift`                   | Textos en español e inglés                                                                    |
| `Recursos/Assets.xcassets`              | Ícono y color de la app                                                                       |

La app no guarda ni manda datos propios: muestra la página que sirve **tu** Zinarix Studio (`apps/desktop/src/main/phonePage.ts`) y solo abre el host del enlace que tú pegaste o escaneaste.
