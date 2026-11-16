# SPDX-FileCopyrightText: 2026 Zinarix Studio
#
# SPDX-License-Identifier: GPL-2.0-or-later

"""Spanish translations of the Zinarix AI add-on (registered by ``__init__.register``).

Keys are ``(context, msgid)``. Blender translates panel labels, property names and
descriptions, enum items, layout labels and operator reports in the default context
``"*"``; operator buttons that show ``bl_label`` (or ``text=`` on ``layout.operator``)
use the ``"Operator"`` context, so button texts are listed in both.

Messages with ``{:d}`` / ``{:s}`` are templates: the add-on translates them with
``pgettext_iface`` before calling ``format``, so the placeholders must stay as they are.

Blender 4.2-5.x names Spanish ``es``; ``es_ES`` is kept too because the template asks
for it first and older or custom builds may use it.
"""

# Button texts (operator labels and operator ``text=``): "*" and "Operator".
_BUTTONS = {
    "Send": "Enviar",
    "Stop": "Detener",
    "Run Step": "Ejecutar paso",
    "Skip": "Omitir",
    "Reset Conversation": "Reiniciar conversación",
    "Quick Action": "Acción rápida",
    "Open Text": "Abrir texto",
    "Refresh Models": "Actualizar modelos",
    "Open Script": "Abrir script",
    "Open Answer": "Abrir respuesta",
    "Run": "Ejecutar",
    # Quick actions.
    "Describe the Scene": "Describir la escena",
    "Fix Last Error": "Corregir último error",
    "Add Lighting": "Agregar iluminación",
    "Realistic Materials": "Materiales realistas",
    "Camera and Render": "Cámara y render",
}

# Everything else, default context "*".
_TEXTS = {
    # Add-on info (Preferences > Add-ons).
    "Zinarix AI": "Zinarix AI",
    "3D Viewport > Sidebar > Zinarix": "Vista 3D > Barra lateral > Zinarix",
    "An AI agent that builds and edits your scene step by step, with your approval":
        "Un agente de IA que crea y edita tu escena paso a paso, con tu aprobación",

    # Preferences: properties.
    "Provider": "Proveedor",
    "Model": "Modelo",
    "Model id. Empty uses the provider default":
        "Id del modelo. Vacío usa el del proveedor",
    "Available Models": "Modelos disponibles",
    "Models offered by the provider (press Refresh to update the list)":
        "Modelos que ofrece el proveedor (presiona Actualizar para renovar la lista)",
    "(refresh to list models)": "(actualiza para ver los modelos)",
    "Server URL": "URL del servidor",
    "API base URL. Empty uses the provider default":
        "URL base de la API. Vacío usa la del proveedor",
    "API Key": "Clave de API",
    "Stored in your preferences file. Empty reads the environment variable":
        "Se guarda en tu archivo de preferencias. Vacío lee la variable de entorno",
    "Max Tokens": "Tokens máximos",
    "Auto-run": "Ejecución automática",
    "Run each script as soon as the AI writes it. Scripts with risky calls "
    "(files, processes, network) always ask first":
        "Ejecuta cada script en cuanto la IA lo escribe. Los scripts con llamadas "
        "riesgosas (archivos, procesos, red) siempre preguntan antes",
    "Most scripts the agent may run for one request":
        "Máximo de scripts que el agente puede ejecutar por solicitud",
    "What you want, e.g. \"add a low-poly tree next to the cube\"":
        "Lo que quieres, p. ej. \"agrega un árbol low-poly junto al cubo\"",

    # Provider names (client.PROVIDERS labels).
    "Zinarix Studio": "Zinarix Studio",
    "Anthropic (Claude)": "Anthropic (Claude)",
    "OpenAI": "OpenAI",
    "OpenRouter": "OpenRouter",
    "Ollama (local)": "Ollama (local)",
    "Custom (OpenAI-compatible)": "Personalizado (compatible con OpenAI)",

    # Preferences: labels.
    "Zinarix Studio chose the provider for this session.":
        "Zinarix Studio eligió el proveedor para esta sesión.",
    "Without a key here, {:s} is read.": "Sin una clave aquí, se lee {:s}.",
    "Keys saved here are stored in plain text in userpref.blend.":
        "Las claves guardadas aquí quedan en texto plano en userpref.blend.",

    # Operator descriptions (tooltips).
    "Send the request and a description of the scene to the AI agent":
        "Envía la solicitud y una descripción de la escena al agente de IA",
    "Stop the agent. A reply still on its way is ignored":
        "Detiene el agente. Se ignora una respuesta que aún no llega",
    "Run the script the AI wrote (text \"zinarix_ai.py\") and send the result back. Ctrl+Z undoes it":
        "Ejecuta el script que escribió la IA (texto \"zinarix_ai.py\") y le envía el resultado. "
        "Ctrl+Z lo deshace",
    "Do not run this script; tell the AI and let it try something else":
        "No ejecuta este script; se lo dice a la IA para que intente otra cosa",
    "Forget the conversation so the next request starts fresh":
        "Olvida la conversación para que la próxima solicitud empiece de cero",
    "Fill the prompt with a common request": "Llena la solicitud con una petición común",
    "Open the AI script or the last answer in a Text Editor":
        "Abre el script de la IA o la última respuesta en un Editor de texto",
    "Ask the provider which models it offers and check the connection":
        "Pregunta al proveedor qué modelos ofrece y revisa la conexión",

    # Quick actions: descriptions and the prompts they write.
    "Describe what is in the scene and suggest improvements":
        "Describe lo que hay en la escena y sugiere mejoras",
    "Ask the AI to fix the last error": "Pide a la IA que corrija el último error",
    "Add good-looking lighting to the scene": "Agrega una buena iluminación a la escena",
    "Make the materials realistic": "Haz que los materiales se vean realistas",
    "Set up a camera and the render settings": "Configura una cámara y el render",
    "Describe the scene: what is in it and what could be improved. Do not change anything.":
        "Describe la escena: qué hay y qué se podría mejorar. No cambies nada.",
    "Fix the last error.": "Corrige el último error.",
    "Add good-looking lighting to the scene (key, fill and rim lights, and a world background).":
        "Agrega una buena iluminación a la escena (luz principal, de relleno y de contorno, "
        "y un fondo de mundo).",
    "Make the materials of the objects realistic, using Principled BSDF settings that suit each object.":
        "Haz realistas los materiales de los objetos, con ajustes de Principled BSDF adecuados "
        "para cada objeto.",
    "Set up a camera that frames the whole scene nicely and configure the render settings for a good image.":
        "Coloca una cámara que encuadre bien toda la escena y configura el render para una "
        "buena imagen.",

    # Open Text choices.
    "Script": "Script",
    "The script \"zinarix_ai.py\"": "El script \"zinarix_ai.py\"",
    "Answer": "Respuesta",
    "The last answer \"zinarix_ai_answer.md\"": "La última respuesta \"zinarix_ai_answer.md\"",

    # Panel.
    "Zinarix Studio connected": "Zinarix Studio conectado",
    "Zinarix Studio not connected": "Zinarix Studio no conectado",
    "Add an API key in the add-on preferences":
        "Agrega una clave de API en las preferencias del complemento",
    "Step {:d}/{:d}": "Paso {:d}/{:d}",
    "Ready": "Listo",
    "Script waiting for approval": "Script en espera de aprobación",
    "Uses: {:s}": "Usa: {:s}",
    "... {:d} more lines": "... {:d} líneas más",
    "Last Answer": "Última respuesta",

    # Status and reports.
    "Step {:d}/{:d}: waiting for {:s}...": "Paso {:d}/{:d}: esperando a {:s}...",
    "Done.": "Listo.",
    "Finished with errors: see the answer.": "Terminó con errores: revisa la respuesta.",
    "Step {:d}/{:d}: the script uses {:s}. Review it before running.":
        "Paso {:d}/{:d}: el script usa {:s}. Revísalo antes de ejecutarlo.",
    "Step {:d}/{:d}: review the script, then Run Step or Skip.":
        "Paso {:d}/{:d}: revisa el script y luego elige Ejecutar paso u Omitir.",
    "Reached the step limit ({:d}). Send a new message to continue.":
        "Se alcanzó el límite de pasos ({:d}). Envía un mensaje nuevo para continuar.",
    "The script failed: {:s}": "El script falló: {:s}",
    "{:d} models available.": "{:d} modelos disponibles.",
    "Could not list models: {:s}": "No se pudieron listar los modelos: {:s}",
    "The provider did not list any models.": "El proveedor no mostró ningún modelo.",
    "Error: {:s}": "Error: {:s}",
    "Stopped: another file was opened.": "Detenido: se abrió otro archivo.",
    "Stopped.": "Detenido.",
    "Online access is disabled. Enable it in Preferences > System > Network, "
    "or use Zinarix Studio or a local server (Ollama).":
        "El acceso en línea está desactivado. Actívalo en Preferencias > Sistema > Red, "
        "o usa Zinarix Studio o un servidor local (Ollama).",
    "The script uses {:s}. Run it anyway?": "El script usa {:s}. ¿Ejecutarlo de todos modos?",
    "The script failed; the error was sent to the AI.": "El script falló; el error se envió a la IA.",
    "Nothing to show yet.": "Todavía no hay nada que mostrar.",
    "Open a Text Editor to read \"{:s}\".": "Abre un Editor de texto para leer \"{:s}\".",
    "This version cannot list models; type the model id.":
        "Esta versión no puede listar modelos; escribe el id del modelo.",
    "Looking for models...": "Buscando modelos...",

    # client.ClientError messages with a fixed text: the add-on translates them before
    # putting them in "Error: {:s}" (messages with server details stay in English).
    "Zinarix Studio is not running or the bridge is closed; open 3D Pro from Zinarix Studio.":
        "Zinarix Studio no está abierto o el puente está cerrado; abre 3D Pro desde Zinarix Studio.",
    "Set the server URL in the add-on preferences.":
        "Escribe la URL del servidor en las preferencias del complemento.",
    "Set the model in the add-on preferences.":
        "Escribe el modelo en las preferencias del complemento.",
    "Unexpected answer from the server.": "Respuesta inesperada del servidor.",
    "The model returned an empty answer.": "El modelo devolvió una respuesta vacía.",
    "The Zinarix Studio bridge closed the connection; try again.":
        "El puente de Zinarix Studio cerró la conexión; inténtalo de nuevo.",
    "The server did not return valid JSON.": "El servidor no devolvió un JSON válido.",
}

# Names that Blender's own Spanish catalog translates otherwise ("Intervalos máx",
# "Cursor"): their properties use this context (I18N_CONTEXT in __init__.py).
I18N_CONTEXT = "ZinarixAI"
_CONTEXT_TEXTS = {
    "Max Steps": "Pasos máximos",
    "Prompt": "Solicitud",
}

_ES = {}
for _msgid, _msgstr in _CONTEXT_TEXTS.items():
    _ES[(I18N_CONTEXT, _msgid)] = _msgstr
for _msgid, _msgstr in _TEXTS.items():
    _ES[("*", _msgid)] = _msgstr
for _msgid, _msgstr in _BUTTONS.items():
    _ES[("*", _msgid)] = _msgstr
    _ES[("Operator", _msgid)] = _msgstr

translations_dict = {
    "es": _ES,
    "es_ES": _ES,
}

del _msgid, _msgstr
