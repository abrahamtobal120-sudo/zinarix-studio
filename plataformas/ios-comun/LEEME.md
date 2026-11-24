# Código compartido de iPhone y iPad

Las apps de `plataformas/iphone` y `plataformas/ipad` usan este mismo código (Swift, UIKit, sin librerías externas). Cada app solo agrega su `App/Variante.swift` y su `project.yml`.

| Archivo                                 | Qué hace                                                                                      |
| --------------------------------------- | --------------------------------------------------------------------------------------------- |
| `Fuentes/App.swift`                     | Arranque, ventanas (iPhone: lista → panel; iPad: barra lateral + panel) y bloqueo con Face ID |
| `Fuentes/Link.swift`                    | Qué enlaces de Zinarix se aceptan (las mismas reglas que la app de Android)                   |
| `Fuentes/Computers.swift`               | Computadoras guardadas y opciones                                                             |
| `Fuentes/PanelViewController.swift`     | El panel de la computadora y el puente `ZinarixNative` que usa `phonePage.ts`                 |
| `Fuentes/LocalViewController.swift`     | Solo iPad: Zinarix sin computadora. Muestra `ipad/Web` y le da llaves, archivos y red         |
| `Fuentes/ComputersViewController.swift` | Lista de computadoras; agregar por QR, pegando o escribiendo                                  |
| `Fuentes/ScannerViewController.swift`   | Lector de QR                                                                                  |
| `Fuentes/OptionsViewController.swift`   | Opciones de la app                                                                            |
| `Fuentes/Texts.swift`                   | Textos en español e inglés                                                                    |
| `Recursos/Assets.xcassets`              | Ícono y color de la app                                                                       |

Como control a distancia, la app no guarda ni manda datos propios: muestra la página que sirve **tu** Zinarix Studio (`apps/desktop/src/main/phonePage.ts`) y solo abre el host del enlace que tú pegaste o escaneaste.

## El iPad independiente

`Variante.independiente` (solo en `ipad/App/Variante.swift`) enciende el modo sin computadora. La interfaz es una página propia, `plataformas/ipad/Web` (`index.html`, `app.css`, `app.js`, sin librerías), que va dentro de la app y no carga nada de internet. `LocalViewController.swift` le da lo que una página no puede hacer sola:

| Pide la página | Lo hace Swift                                                                             |
| -------------- | ----------------------------------------------------------------------------------------- |
| `keys.*`       | Llaves de API en el llavero. La página nunca las recibe de vuelta                         |
| `http`         | La llamada al proveedor de IA. La llave solo se pone si el host es el de esa llave        |
| `fs.*`         | Archivos de la carpeta Documentos de la app (la que se ve en Archivos); no se puede salir |
| `store.*`      | Chats y ajustes (Application Support)                                                     |

Para probar la interfaz en una computadora, sirve la carpeta `ipad/Web` con cualquier servidor web y ábrela en el navegador: sin la app usa el almacenamiento del navegador.
